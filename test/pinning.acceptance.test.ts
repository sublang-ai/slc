// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashFile } from '../src/hash.js';
import { evaluatePins, hashTree } from '../src/pin-currency.js';
import {
  PINS_FILE,
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  type PinFile,
  type PinRecord,
} from '../src/pins.js';

/** A compiled artifact that resolves to the linked `playbook` format (PIN-13). */
const PHASE_ARTIFACT =
  'export default function createPlaybookRuntime() {\n  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };\n}\n';

// System-level acceptance over fixture pipeline directories with a committed
// slc.pins.json, driving the validator through evaluatePins (PIN-7..PIN-14).
describe('pin validator acceptance (PIN-7..PIN-14)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-pin-accept-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };

  const writeReviewedBundle = async (phase: string): Promise<void> => {
    await write(`${phase}.slc/${phase}.playbook.ts`, PHASE_ARTIFACT);
    for (const suffix of [
      'fsm.ts',
      'gears.md',
      'gears-fsm.test.ts',
      'fsm.introspect.test.ts',
      'prompt-contract.test.ts',
      'fsm.coverage.test.ts',
    ]) {
      await write(`${phase}.slc/${phase}.${suffix}`, `fixture: ${suffix}\n`);
    }
  };

  /** Writes a matching pipeline and returns its pin record with current hashes. */
  const currentRecord = async (phase = 'text2gears'): Promise<PinRecord> => {
    await write(`${phase}.md`, '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write('reference/gears.md', 'gears reference body\n');
    await writeReviewedBundle(phase);
    await write('link/code.ts', 'link target bytes\n');
    await write('runtime/runtime.ts', 'export const version = 1;\n');
    return {
      definition: {
        path: `${phase}.md`,
        hash: await hashFile(join(dir, `${phase}.md`)),
      },
      artifact: {
        path: `${phase}.slc/${phase}.playbook.ts`,
        hash: await hashFile(join(dir, `${phase}.slc/${phase}.playbook.ts`)),
      },
      artifactBundle: {
        path: `${phase}.slc`,
        hash: await hashTree(join(dir, `${phase}.slc`)),
      },
      semanticInputs: [
        {
          path: 'reference/gears.md',
          hash: await hashFile(join(dir, 'reference/gears.md')),
          role: 'reference',
        },
      ],
      externalInputs: [],
      runtimeDependencies: [
        {
          kind: 'file',
          locator: 'runtime/runtime.ts',
          identity: await hashFile(join(dir, 'runtime/runtime.ts')),
        },
      ],
      linkTarget: {
        kind: 'file',
        locator: 'link/code.ts',
        identity: await hashFile(join(dir, 'link/code.ts')),
      },
    };
  };

  const writePinFile = async (record: PinRecord): Promise<void> => {
    const file: PinFile = {
      schema: PIN_SCHEMA,
      hashAlgorithm: PIN_HASH_ALGORITHM,
      pathBoundary: { path: '.' },
      pins: { text2gears: record },
    };
    await write(PINS_FILE, JSON.stringify(file, null, 2));
  };

  it('reports no pins when slc.pins.json is absent (PIN-7)', async () => {
    const result = await evaluatePins(dir);
    expect(result.verdicts).toBeUndefined();
    expect(result.malformed).toBeUndefined();
  });

  it('reports current for a fully matching pin (PIN-8)', async () => {
    await writePinFile(await currentRecord());

    const result = await evaluatePins(dir);
    expect(result.path).toBe(join(dir, PINS_FILE));
    expect(result.verdicts?.text2gears).toEqual({ status: 'current' });
  });

  it('reports swapped otherwise-current phase records malformed', async () => {
    const text2gears = await currentRecord('text2gears');
    const gears2fsm = await currentRecord('gears2fsm');
    const file: PinFile = {
      schema: PIN_SCHEMA,
      hashAlgorithm: PIN_HASH_ALGORITHM,
      pathBoundary: { path: '.' },
      pins: { text2gears: gears2fsm, gears2fsm: text2gears },
    };
    await write(PINS_FILE, JSON.stringify(file, null, 2));

    const result = await evaluatePins(dir);
    expect(result.verdicts?.text2gears?.status).toBe('malformed');
    expect(result.verdicts?.gears2fsm?.status).toBe('malformed');
  });

  it.each([
    ['definition', 'text2gears.md'],
    ['artifact', 'text2gears.slc/text2gears.playbook.ts'],
    ['artifactBundle', 'text2gears.slc/text2gears.fsm.ts'],
    ['semanticInput', 'reference/gears.md'],
    ['runtimeDependencies[0]', 'runtime/runtime.ts'],
    ['linkTarget', 'link/code.ts'],
  ])('reports stale when the %s changes (PIN-9)', async (label, rel) => {
    await writePinFile(await currentRecord());
    await write(rel, 'mutated after pinning\n');

    const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
    expect(verdict?.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain(label);
  });

  it('reports stale on a semantic-input closure mismatch (PIN-10)', async () => {
    const record = await currentRecord();
    record.semanticInputs = []; // definition still cites reference/gears.md
    await writePinFile(record);

    const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
    expect(verdict?.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain('closure');
  });

  it('reports stale for an artifact that is not a playbook module (PIN-14)', async () => {
    const record = await currentRecord();
    await write(
      'text2gears.slc/text2gears.playbook.ts',
      'export const value = 42;\n',
    );
    record.artifact.hash = await hashFile(
      join(dir, 'text2gears.slc/text2gears.playbook.ts'),
    );
    record.artifactBundle.hash = await hashTree(join(dir, 'text2gears.slc'));
    await writePinFile(record);

    const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
    expect(verdict?.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain('playbook format');
  });

  // File-level malformations rejected at parse time (PIN-11).
  it.each([
    ['not JSON', '{ not json', 'JSON'],
    [
      'an unsupported schema',
      JSON.stringify({
        schema: 'sublang.slc.pins.v0',
        hashAlgorithm: PIN_HASH_ALGORITHM,
        pins: {},
      }),
      'schema',
    ],
    [
      'an unsupported hash algorithm',
      JSON.stringify({ schema: PIN_SCHEMA, hashAlgorithm: 'md5', pins: {} }),
      'hashAlgorithm',
    ],
    [
      'an unknown field',
      JSON.stringify({
        schema: PIN_SCHEMA,
        hashAlgorithm: PIN_HASH_ALGORITHM,
        bogus: true,
        pins: {},
      }),
      'bogus',
    ],
    [
      'a wrong-typed field',
      JSON.stringify({
        schema: PIN_SCHEMA,
        hashAlgorithm: PIN_HASH_ALGORITHM,
        pins: { text2gears: { artifact: { path: 42, hash: 'x' } } },
      }),
      'path',
    ],
  ])(
    'reports a file-level malformed pin for %s, naming the field (PIN-11)',
    async (_label, content, field) => {
      await write(PINS_FILE, content);

      const result = await evaluatePins(dir);
      expect(result.malformed).toContain(field);
      expect(result.verdicts).toBeUndefined();
    },
  );

  // Portable-path syntax is rejected while parsing; boundary escapes are
  // rejected when the parsed phase is resolved (PIN-11).
  it.each([
    ['an absolute', '/etc/passwd'],
    ['a boundary-escaping', '../escape'],
  ])(
    'reports malformed, no phase current, for %s recorded path (PIN-11)',
    async (_label, badPath) => {
      const record = await currentRecord();
      record.artifact.path = badPath;
      await writePinFile(record);

      const result = await evaluatePins(dir);
      const verdict = result.verdicts?.text2gears;
      expect(
        result.malformed !== undefined || verdict?.status === 'malformed',
      ).toBe(true);
      expect(
        result.malformed ?? (verdict as { reason: string }).reason,
      ).toContain('artifact');
      expect(
        Object.values(result.verdicts ?? {}).some(
          (candidate) => candidate.status === 'current',
        ),
      ).toBe(false);
    },
  );

  // Malformed recorded digests rejected per phase (PIN-11).
  const digestCases: Array<[string, (record: PinRecord) => void, string]> = [
    [
      'a non-digest file hash',
      (record) => {
        record.definition.hash = 'not-a-hash';
      },
      'definition',
    ],
    [
      'a non-content-addressed link-target identity',
      (record) => {
        record.linkTarget.identity = 'name@1.2.3';
      },
      'linkTarget',
    ],
  ];
  it.each(digestCases)(
    'reports malformed, naming the field, for %s (PIN-11)',
    async (_label, mutate, field) => {
      const record = await currentRecord();
      mutate(record);
      await writePinFile(record);

      const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
      expect(verdict?.status).toBe('malformed');
      expect((verdict as { reason: string }).reason).toContain(field);
    },
  );

  it.each([
    ['an unvendored mutable reference', 'latest'],
    ['a bare URL', 'https://example.com/data'],
  ])(
    'reports malformed for %s external input (PIN-12)',
    async (_label, identity) => {
      const record = await currentRecord();
      record.externalInputs = [{ identity }];
      await writePinFile(record);

      const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
      expect(verdict?.status).toBe('malformed');
      expect((verdict as { reason: string }).reason).toContain(
        'externalInputs',
      );
    },
  );

  it('validates without issuing any network request (PIN-12)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const record = await currentRecord();
    record.externalInputs = [{ identity: `sha256:${'a'.repeat(64)}` }];
    await writePinFile(record);

    await evaluatePins(dir);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

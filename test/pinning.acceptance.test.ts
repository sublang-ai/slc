// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashFile } from '../src/hash.js';
import { evaluatePins } from '../src/pin-currency.js';
import {
  PINS_FILE,
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  type PinFile,
  type PinRecord,
} from '../src/pins.js';

/** A compiled artifact that resolves to the linked `phase` format (PIN-13). */
const PHASE_ARTIFACT =
  'export default function createPhaseRunner() {\n  return { run: async () => ({ status: "ok", diagnostics: [] }) };\n}\n';

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

  /** Writes a matching pipeline and returns its pin record with current hashes. */
  const currentRecord = async (): Promise<PinRecord> => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write('reference/gears.md', 'gears reference body\n');
    await write('text2gears.phase.ts', PHASE_ARTIFACT);
    await write('link/code.ts', 'link target bytes\n');
    return {
      definition: {
        path: 'text2gears.md',
        hash: await hashFile(join(dir, 'text2gears.md')),
      },
      artifact: {
        path: 'text2gears.phase.ts',
        hash: await hashFile(join(dir, 'text2gears.phase.ts')),
      },
      semanticInputs: [
        {
          path: 'reference/gears.md',
          hash: await hashFile(join(dir, 'reference/gears.md')),
          role: 'reference',
        },
      ],
      externalInputs: [],
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

  it.each([
    ['definition', 'text2gears.md'],
    ['artifact', 'text2gears.phase.ts'],
    ['semanticInput', 'reference/gears.md'],
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

  it('reports stale for an artifact that is not a phase module (PIN-14)', async () => {
    const record = await currentRecord();
    await write('text2gears.phase.ts', 'export const value = 42;\n');
    record.artifact.hash = await hashFile(join(dir, 'text2gears.phase.ts'));
    await writePinFile(record);

    const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
    expect(verdict?.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain('phase format');
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

  // Path malformations rejected per phase at resolution time (PIN-11).
  it.each([
    ['an absolute', '/etc/passwd'],
    ['a boundary-escaping', '../escape'],
  ])(
    'reports malformed, no phase current, for %s recorded path (PIN-11)',
    async (_label, badPath) => {
      const record = await currentRecord();
      record.artifact.path = badPath;
      await writePinFile(record);

      const verdict = (await evaluatePins(dir)).verdicts?.text2gears;
      expect(verdict?.status).toBe('malformed');
      expect((verdict as { reason: string }).reason).toContain('artifact');
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

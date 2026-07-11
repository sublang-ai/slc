// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashFile } from '../src/hash.js';
import { evaluatePin, evaluatePins, hashTree } from '../src/pin-currency.js';
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

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slc-currency-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = async (rel: string, content: string): Promise<void> => {
  const path = join(dir, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const writeReviewedBundle = async (): Promise<void> => {
  await write('text2gears.slc/text2gears.playbook.ts', PHASE_ARTIFACT);
  for (const name of [
    'text2gears.fsm.ts',
    'text2gears.gears.md',
    'text2gears.gears-fsm.test.ts',
    'text2gears.fsm.introspect.test.ts',
    'text2gears.prompt-contract.test.ts',
    'text2gears.fsm.coverage.test.ts',
  ]) {
    await write(`text2gears.slc/${name}`, `fixture: ${name}\n`);
  }
};

/** Writes a matching pipeline and returns its `current` pin file and record. */
async function currentFixture(): Promise<{ file: PinFile; record: PinRecord }> {
  await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
  await write('reference/gears.md', 'gears reference body\n');
  await writeReviewedBundle();
  await write('link/code.ts', 'link target bytes\n');

  const record: PinRecord = {
    definition: {
      path: 'text2gears.md',
      hash: await hashFile(join(dir, 'text2gears.md')),
    },
    artifact: {
      path: 'text2gears.slc/text2gears.playbook.ts',
      hash: await hashFile(join(dir, 'text2gears.slc/text2gears.playbook.ts')),
    },
    artifactBundle: {
      path: 'text2gears.slc',
      hash: await hashTree(join(dir, 'text2gears.slc')),
    },
    semanticInputs: [
      {
        path: 'reference/gears.md',
        hash: await hashFile(join(dir, 'reference/gears.md')),
        role: 'reference',
      },
    ],
    externalInputs: [],
    runtimeDependencies: [],
    linkTarget: {
      kind: 'file',
      locator: 'link/code.ts',
      identity: await hashFile(join(dir, 'link/code.ts')),
    },
  };
  const file: PinFile = {
    schema: PIN_SCHEMA,
    hashAlgorithm: PIN_HASH_ALGORITHM,
    pathBoundary: { path: '.' },
    pins: { text2gears: record },
  };
  return { file, record };
}

describe('hashTree canonical framing', () => {
  it('matches the cross-implementation fixed vector', async () => {
    await write('a.txt', 'hello\n');
    await write('nested/empty.txt', '');
    await write('é.txt', 'accent\n');

    expect(await hashTree(dir)).toBe(
      'sha256:2d0b41184acb03869b779930630f3c69522d934fe482cb32b8f81a49599e999d',
    );
  });

  it.skipIf(process.platform !== 'linux')(
    'rejects a filename whose raw bytes are not valid UTF-8',
    async () => {
      await write('�', 'valid replacement character\n');
      const invalidPath = Buffer.concat([
        Buffer.from(dir),
        Buffer.from(sep),
        Buffer.from([0xff]),
      ]);
      await writeFile(invalidPath, 'invalid byte\n');

      await expect(hashTree(dir)).rejects.toThrow(/valid UTF-8/);
    },
  );
});

describe('evaluatePin (PIN-2..PIN-6)', () => {
  it('reports a fully matching pin as current', async () => {
    const { file, record } = await currentFixture();
    expect(await evaluatePin(dir, file, 'text2gears', record)).toEqual({
      status: 'current',
    });
  });

  it('reports malformed when a record is indexed under another phase', async () => {
    const { file, record } = await currentFixture();
    const verdict = await evaluatePin(dir, file, 'gears2fsm', record);
    expect(verdict).toMatchObject({
      status: 'malformed',
      reason: expect.stringMatching(/pin key "gears2fsm"/) as string,
    });
  });

  it.each([
    ['definition', 'text2gears.md'],
    ['artifact', 'text2gears.slc/text2gears.playbook.ts'],
    ['artifactBundle', 'text2gears.slc/text2gears.fsm.ts'],
    ['semanticInput', 'reference/gears.md'],
    ['linkTarget', 'link/code.ts'],
  ])('reports stale when the %s file changes', async (label, rel) => {
    const { file, record } = await currentFixture();
    await write(rel, 'mutated content\n');

    const verdict = await evaluatePin(dir, file, 'text2gears', record);
    expect(verdict.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain(label);
  });

  it('reports stale when the recorded closure differs from ## Pin Inputs', async () => {
    const { file, record } = await currentFixture();
    const dropped = clone(record);
    dropped.semanticInputs = []; // definition still cites reference/gears.md

    const verdict = await evaluatePin(dir, file, 'text2gears', dropped);
    expect(verdict.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain('closure');
  });

  it('reports stale when the artifact does not resolve to the playbook format (PIN-13)', async () => {
    const { file, record } = await currentFixture();
    // Hash-matching bytes that are not a `playbook` module.
    await write(
      'text2gears.slc/text2gears.playbook.ts',
      'export const value = 42;\n',
    );
    const bad = clone(record);
    bad.artifact.hash = await hashFile(
      join(dir, 'text2gears.slc/text2gears.playbook.ts'),
    );
    bad.artifactBundle.hash = await hashTree(join(dir, 'text2gears.slc'));

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain('playbook format');
  });

  it('reports malformed when the entry path is not canonical for its phase', async () => {
    const { file, record } = await currentFixture();
    await write('text2gears.slc/text2gears.playbook.mjs', PHASE_ARTIFACT);
    const bad = clone(record);
    bad.artifact.path = 'text2gears.slc/text2gears.playbook.mjs';
    bad.artifact.hash = await hashFile(
      join(dir, 'text2gears.slc/text2gears.playbook.mjs'),
    );
    bad.artifactBundle.hash = await hashTree(join(dir, 'text2gears.slc'));

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict).toMatchObject({
      status: 'malformed',
      reason: expect.stringMatching(/pin key "text2gears"/) as string,
    });
  });

  it('reports stale when the bundle contains a symbolic link', async () => {
    const { file, record } = await currentFixture();
    await symlink(
      join(dir, 'text2gears.md'),
      join(dir, 'text2gears.slc', 'definition-link.md'),
    );

    const verdict = await evaluatePin(dir, file, 'text2gears', record);
    expect(verdict).toMatchObject({
      status: 'stale',
      reason: expect.stringMatching(/unsupported entry/) as string,
    });
  });

  it('reports stale when the bundle omits a required verification file', async () => {
    const { file, record } = await currentFixture();
    await rm(join(dir, 'text2gears.slc/text2gears.fsm.coverage.test.ts'));
    const bad = clone(record);
    bad.artifactBundle.hash = await hashTree(join(dir, 'text2gears.slc'));

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict).toMatchObject({
      status: 'stale',
      reason: expect.stringMatching(/missing required sibling/) as string,
    });
  });

  it('reports malformed for a recorded hash that is not a sha256 hash', async () => {
    const { file, record } = await currentFixture();
    const bad = clone(record);
    bad.definition.hash = 'not-a-hash';

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict.status).toBe('malformed');
    expect((verdict as { reason: string }).reason).toContain('definition');
  });

  it('reports malformed for an absolute recorded path', async () => {
    const { file, record } = await currentFixture();
    const bad = clone(record);
    bad.semanticInputs[0].path = '/etc/passwd';

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict.status).toBe('malformed');
    expect((verdict as { reason: string }).reason).toContain('relative');
  });

  it('reports malformed for a bare-URL external input', async () => {
    const { file, record } = await currentFixture();
    const bad = clone(record);
    bad.externalInputs = [{ identity: 'https://example.com/data' }];

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict.status).toBe('malformed');
    expect((verdict as { reason: string }).reason).toContain('externalInputs');
  });

  it('reports malformed for a non-hash file link-target identity', async () => {
    const { file, record } = await currentFixture();
    const bad = clone(record);
    bad.linkTarget.identity = `sha256:${'z'.repeat(64)}`;

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict.status).toBe('malformed');
    expect((verdict as { reason: string }).reason).toContain(
      'linkTarget.identity',
    );
  });

  it('accepts an immutable content-addressed external input', async () => {
    const { file, record } = await currentFixture();
    const withExternal = clone(record);
    withExternal.externalInputs = [{ identity: `sha256:${'a'.repeat(64)}` }];

    expect(await evaluatePin(dir, file, 'text2gears', withExternal)).toEqual({
      status: 'current',
    });
  });
});

describe('evaluatePin link targets and external inputs (PIN-2, PIN-6)', () => {
  const withDirectoryLinkTarget = async (
    record: PinRecord,
  ): Promise<PinRecord> => {
    const updated = clone(record);
    updated.linkTarget = {
      kind: 'directory',
      locator: 'link',
      identity: await hashTree(join(dir, 'link')),
    };
    return updated;
  };

  it('reports current for a matching directory link target', async () => {
    const { file, record } = await currentFixture();
    await write('link/util.ts', 'second link file\n');

    expect(
      await evaluatePin(
        dir,
        file,
        'text2gears',
        await withDirectoryLinkTarget(record),
      ),
    ).toEqual({ status: 'current' });
  });

  it('reports stale when a directory link-target file changes', async () => {
    const { file, record } = await currentFixture();
    await write('link/util.ts', 'second link file\n');
    const pinned = await withDirectoryLinkTarget(record);
    await write('link/util.ts', 'mutated after pinning\n');

    const verdict = await evaluatePin(dir, file, 'text2gears', pinned);
    expect(verdict.status).toBe('stale');
    expect((verdict as { reason: string }).reason).toContain('linkTarget');
  });

  it('binds symbolic-link entries in a directory link target', async () => {
    const { file, record } = await currentFixture();
    await write('link/target-a.ts', 'identical\n');
    await write('link/target-b.ts', 'identical\n');
    await symlink('target-a.ts', join(dir, 'link/current.ts'));
    const pinned = await withDirectoryLinkTarget(record);

    expect(await evaluatePin(dir, file, 'text2gears', pinned)).toEqual({
      status: 'current',
    });
    await unlink(join(dir, 'link/current.ts'));
    await symlink('target-b.ts', join(dir, 'link/current.ts'));

    const verdict = await evaluatePin(dir, file, 'text2gears', pinned);
    expect(verdict.status).toBe('stale');
  });

  it('reports malformed for a non-hash directory link-target identity', async () => {
    const { file, record } = await currentFixture();
    const bad = clone(record);
    bad.linkTarget = { kind: 'directory', locator: 'link', identity: 'latest' };

    const verdict = await evaluatePin(dir, file, 'text2gears', bad);
    expect(verdict.status).toBe('malformed');
    expect((verdict as { reason: string }).reason).toContain(
      'linkTarget.identity',
    );
  });

  it.each([
    'name@1.2.3',
    'latest',
    'plain-string',
    'sha512-AAAAAAAAAAAAAAAAAAAA', // too short to be a real sha512 digest
  ])(
    'reports malformed for a non-content-addressed external reference (%s)',
    async (identity) => {
      const { file, record } = await currentFixture();
      const bad = clone(record);
      bad.externalInputs = [{ identity }];

      const verdict = await evaluatePin(dir, file, 'text2gears', bad);
      expect(verdict.status).toBe('malformed');
      expect((verdict as { reason: string }).reason).toContain(
        'externalInputs',
      );
    },
  );
});

describe('evaluatePins (PIN-1, PIN-5)', () => {
  it('returns no verdicts when slc.pins.json is absent', async () => {
    const result = await evaluatePins(dir);
    expect(result.path).toBeUndefined();
    expect(result.verdicts).toBeUndefined();
    expect(result.malformed).toBeUndefined();
  });

  it('reports a file-level malformed pin file', async () => {
    await write(PINS_FILE, '{ not json');
    const result = await evaluatePins(dir);
    expect(result.malformed).toBeDefined();
    expect(result.verdicts).toBeUndefined();
  });

  it('evaluates each phase of a valid pin file', async () => {
    const { file } = await currentFixture();
    await write(PINS_FILE, JSON.stringify(file));

    const result = await evaluatePins(dir);
    expect(result.path).toBe(join(dir, PINS_FILE));
    expect(result.verdicts?.text2gears).toEqual({ status: 'current' });
  });

  it('reports no phase current when another record is malformed', async () => {
    const { file, record } = await currentFixture();
    file.pins.gears2fsm = {
      ...clone(record),
      definition: { path: 'gears2fsm.md', hash: 'not-a-hash' },
      artifact: {
        path: 'gears2fsm.slc/gears2fsm.playbook.ts',
        hash: record.artifact.hash,
      },
      artifactBundle: {
        path: 'gears2fsm.slc',
        hash: record.artifactBundle.hash,
      },
    };
    await write(PINS_FILE, JSON.stringify(file));

    const result = await evaluatePins(dir);
    expect(result.verdicts?.gears2fsm?.status).toBe('malformed');
    expect(result.verdicts?.text2gears?.status).toBe('malformed');
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILD_MANIFEST_SCHEMA,
  SOURCE_COPY,
  encodeLocator,
  loadBuildHistory,
  recordBuild,
  resolveLocator,
  verifiedCopyPath,
  type BuildHistory,
} from '../src/build-history.js';
import { hashBytes } from '../src/hash.js';

let dir: string;
let artDir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'slc-history-'));
  artDir = join(dir, 'wf.playbook');
  await mkdir(artDir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const write = async (rel: string, content: string): Promise<string> => {
  const path = join(dir, rel);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
  return path;
};

const record = async (over?: {
  steps?: Parameters<typeof recordBuild>[0]['steps'];
}): Promise<void> => {
  const source = await write('wf.md', 'the source\n');
  const gears = await write('wf.playbook/wf.gears.md', 'gears bytes\n');
  await recordBuild({
    artDir,
    pipeline: 'playbook',
    sourcePath: source,
    steps: over?.steps ?? [
      {
        kind: 'phase',
        name: 'text2gears',
        target: gears,
        inputs: [hashBytes(Buffer.from('the source\n'))],
        copyFrom: gears,
      },
    ],
  });
};

describe('recordBuild + loadBuildHistory (INCR-9, INCR-11, INCR-18)', () => {
  it('records a first build as 1 with manifest, copies, and latest', async () => {
    await record();
    const history = await loadBuildHistory(artDir);
    expect(history).not.toBeNull();
    expect(history?.build).toBe(1);
    expect(history?.manifest).toEqual({
      schema: BUILD_MANIFEST_SCHEMA,
      pipeline: 'playbook',
      source: {
        path: '../wf.md',
        hash: hashBytes(Buffer.from('the source\n')),
      },
      steps: [
        {
          kind: 'phase',
          name: 'text2gears',
          target: 'wf.gears.md',
          inputs: [hashBytes(Buffer.from('the source\n'))],
          output: hashBytes(Buffer.from('gears bytes\n')),
          copy: 'outputs/wf.gears.md',
        },
      ],
    });
    expect(
      await readFile(join(artDir, '.slc/builds/1', SOURCE_COPY), 'utf8'),
    ).toBe('the source\n');
    expect(
      await readFile(join(artDir, '.slc/builds/1/outputs/wf.gears.md'), 'utf8'),
    ).toBe('gears bytes\n');
    expect(await readFile(join(artDir, '.slc/latest'), 'utf8')).toBe('1\n');
  });

  it('numbers past both latest and orphaned build directories', async () => {
    await record();
    // An interrupted recording left an orphan above latest.
    await mkdir(join(artDir, '.slc/builds/7'), { recursive: true });
    await record();
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(8);
  });

  it('records a carried-forward copy from another file', async () => {
    const prior = await write('elsewhere/prior-copy', 'accepted bytes\n');
    const gears = join(artDir, 'wf.gears.md');
    await write('wf.playbook/wf.gears.md', 'live bytes differ\n');
    await record({
      steps: [
        {
          kind: 'phase',
          name: 'text2gears',
          target: gears,
          inputs: [],
          copyFrom: prior,
        },
      ],
    });
    const history = await loadBuildHistory(artDir);
    expect(history?.manifest.steps[0].output).toBe(
      hashBytes(Buffer.from('accepted bytes\n')),
    );
    expect(
      await readFile(join(artDir, '.slc/builds/1/outputs/wf.gears.md'), 'utf8'),
    ).toBe('accepted bytes\n');
  });
});

describe('loadBuildHistory leniency (INCR-10, INCR-22)', () => {
  it('returns null with no history at all', async () => {
    expect(await loadBuildHistory(artDir)).toBeNull();
  });

  it.each([
    ['non-numeric latest', async () => write('wf.playbook/.slc/latest', 'x')],
    ['zero latest', async () => write('wf.playbook/.slc/latest', '0')],
    ['missing manifest', async () => write('wf.playbook/.slc/latest', '3')],
    [
      'garbage manifest',
      async () => {
        await write('wf.playbook/.slc/latest', '1');
        await write('wf.playbook/.slc/builds/1/manifest.json', 'not json');
      },
    ],
    [
      'wrong schema',
      async () => {
        await write('wf.playbook/.slc/latest', '1');
        await write(
          'wf.playbook/.slc/builds/1/manifest.json',
          JSON.stringify({
            schema: 'sublang.slc.build.v0',
            pipeline: 'p',
            source: { path: 's', hash: hashBytes(Buffer.from('')) },
            steps: [],
          }),
        );
      },
    ],
    [
      'absolute step target',
      async () => {
        await write('wf.playbook/.slc/latest', '1');
        await write(
          'wf.playbook/.slc/builds/1/manifest.json',
          JSON.stringify({
            schema: BUILD_MANIFEST_SCHEMA,
            pipeline: 'p',
            source: { path: '../wf.md', hash: hashBytes(Buffer.from('')) },
            steps: [
              {
                kind: 'phase',
                name: 'n',
                target: '/etc/passwd',
                inputs: [],
                output: hashBytes(Buffer.from('')),
                copy: 'outputs/x',
              },
            ],
          }),
        );
      },
    ],
    [
      'copy escaping the build directory',
      async () => {
        await write('wf.playbook/.slc/latest', '1');
        await write(
          'wf.playbook/.slc/builds/1/manifest.json',
          JSON.stringify({
            schema: BUILD_MANIFEST_SCHEMA,
            pipeline: 'p',
            source: { path: '../wf.md', hash: hashBytes(Buffer.from('')) },
            steps: [
              {
                kind: 'phase',
                name: 'n',
                target: 'wf.gears.md',
                inputs: [],
                output: hashBytes(Buffer.from('')),
                copy: '../../escape',
              },
            ],
          }),
        );
      },
    ],
    [
      'malformed hash',
      async () => {
        await write('wf.playbook/.slc/latest', '1');
        await write(
          'wf.playbook/.slc/builds/1/manifest.json',
          JSON.stringify({
            schema: BUILD_MANIFEST_SCHEMA,
            pipeline: 'p',
            source: { path: '../wf.md', hash: 'sha256:short' },
            steps: [],
          }),
        );
      },
    ],
  ])('returns null on %s', async (_name, arrange) => {
    await arrange();
    expect(await loadBuildHistory(artDir)).toBeNull();
  });
});

describe('verifiedCopyPath (INCR-10)', () => {
  const loaded = async (): Promise<BuildHistory> => {
    await record();
    const history = await loadBuildHistory(artDir);
    if (history === null) throw new Error('expected history');
    return history;
  };

  it('returns the absolute path when bytes match', async () => {
    const history = await loaded();
    const step = history.manifest.steps[0];
    const path = await verifiedCopyPath(history, step.copy, step.output);
    expect(path).toBe(join(artDir, '.slc/builds/1/outputs/wf.gears.md'));
  });

  it('returns null when the copy is missing or tampered', async () => {
    const history = await loaded();
    const step = history.manifest.steps[0];
    await writeFile(
      join(artDir, '.slc/builds/1/outputs/wf.gears.md'),
      'tampered\n',
    );
    expect(await verifiedCopyPath(history, step.copy, step.output)).toBeNull();
    expect(
      await verifiedCopyPath(history, 'outputs/absent', step.output),
    ).toBeNull();
  });
});

describe('locators', () => {
  it('round-trips inward and outward paths', () => {
    const inward = join(artDir, 'wf.gears.md');
    expect(encodeLocator(artDir, inward)).toBe('wf.gears.md');
    expect(resolveLocator(artDir, 'wf.gears.md')).toBe(inward);
    const outward = join(dir, 'wf.md');
    expect(encodeLocator(artDir, outward)).toBe('../wf.md');
    expect(resolveLocator(artDir, '../wf.md')).toBe(outward);
  });
});

describe('latest commit ordering (INCR-11)', () => {
  it('leaves the prior build authoritative when a newer directory is incomplete', async () => {
    await record();
    // Simulate an interrupted second recording: build dir exists, latest not moved.
    await write('wf.playbook/.slc/builds/2/manifest.json', 'partial');
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(1);
  });

  it('ignores a symlinked latest target when parsing fails', async () => {
    await record();
    await rm(join(artDir, '.slc/latest'));
    await symlink('/nonexistent', join(artDir, '.slc/latest'));
    expect(await loadBuildHistory(artDir)).toBeNull();
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILD_MANIFEST_SCHEMA,
  invalidateBuildHistory,
  loadBuildHistory,
  outputCopyPath,
  recordBuild,
  verifiedInput,
} from '../src/build-history.js';
import { hashBytes } from '../src/hash.js';

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('complete build history (incremental-compilation-9..12)', () => {
  let root: string;
  let artDir: string;
  let source: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-history-'));
    artDir = join(root, 'work.flow');
    source = join(root, 'work.text.md');
    await mkdir(artDir);
    await writeFile(source, 'source one\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function publish(
    sourceText = 'source one\n',
    outputText = 'output one\n',
  ): Promise<void> {
    const output = bytes(outputText);
    await recordBuild({
      artDir,
      pipeline: 'flow',
      sourcePath: source,
      sourceBytes: bytes(sourceText),
      steps: [
        {
          kind: 'compile',
          name: 'one',
          target: join(artDir, 'work.one.md'),
          inputs: [
            hashBytes(bytes(sourceText)),
            hashBytes(bytes('definition')),
          ],
          output: hashBytes(output),
          bytes: output,
        },
      ],
    });
  }

  it('publishes fixed copies and loads the active build as one unit', async () => {
    await publish();

    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(1);
    expect(history?.manifest).toEqual({
      schema: BUILD_MANIFEST_SCHEMA,
      pipeline: 'flow',
      source: {
        path: '../work.text.md',
        hash: hashBytes(bytes('source one\n')),
      },
      steps: [
        {
          kind: 'compile',
          name: 'one',
          target: 'work.one.md',
          inputs: [
            hashBytes(bytes('source one\n')),
            hashBytes(bytes('definition')),
          ],
          output: hashBytes(bytes('output one\n')),
        },
      ],
    });
    expect(await readFile(join(history!.dir, 'source'), 'utf8')).toBe(
      'source one\n',
    );
    expect(await readFile(outputCopyPath(history!, 0), 'utf8')).toBe(
      'output one\n',
    );
  });

  it('keeps snapshot directories and payloads owner-only', async () => {
    await publish();
    const history = (await loadBuildHistory(artDir))!;
    for (const path of [
      join(artDir, '.slc'),
      join(artDir, '.slc', 'builds'),
      history.dir,
      join(history.dir, 'outputs'),
    ]) {
      expect((await stat(path)).mode & 0o077).toBe(0);
    }
    for (const path of [
      join(artDir, '.slc', 'latest'),
      join(history.dir, 'source'),
      join(history.dir, 'manifest.json'),
      outputCopyPath(history, 0),
    ]) {
      expect((await stat(path)).mode & 0o077).toBe(0);
    }
  });

  it.each([
    ['source copy', (dir: string) => join(dir, 'source')],
    ['output copy', (dir: string) => join(dir, 'outputs', '0')],
  ])(
    'treats a damaged %s as wholly absent history',
    async (_label, pathFor) => {
      await publish();
      const history = await loadBuildHistory(artDir);
      await writeFile(pathFor(history!.dir), 'tampered\n');
      expect(await loadBuildHistory(artDir)).toBeNull();
    },
  );

  it('ignores malformed or orphaned store state', async () => {
    await publish();
    await writeFile(join(artDir, '.slc', 'latest'), 'not-a-build\n');
    expect(await loadBuildHistory(artDir)).toBeNull();

    await mkdir(join(artDir, '.slc', 'builds', '2'));
    expect(await loadBuildHistory(artDir)).toBeNull();
  });

  it('rejects manifest fields outside the frozen schema', async () => {
    await publish();
    const history = (await loadBuildHistory(artDir))!;
    const manifestPath = join(history.dir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    manifest.extra = true;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(await loadBuildHistory(artDir)).toBeNull();
  });

  it('claims a fresh numbered directory without traversing a planted entry', async () => {
    await publish();
    const victim = join(root, 'victim');
    await mkdir(victim);
    await writeFile(join(victim, 'sentinel'), 'keep\n');
    await symlink(victim, join(artDir, '.slc', 'builds', '2'));

    await publish('source two\n', 'output two\n');

    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(3);
    expect(await readFile(join(artDir, '.slc', 'latest'), 'utf8')).toBe('3\n');
    expect(await readFile(join(victim, 'sentinel'), 'utf8')).toBe('keep\n');
  });

  it('re-verifies the exact prior chained-input copy at use time', async () => {
    await publish();
    const history = (await loadBuildHistory(artDir))!;
    const expected = history.manifest.steps[0].inputs[0];
    expect((await verifiedInput(history, 0, expected))?.bytes.toString()).toBe(
      'source one\n',
    );

    await writeFile(join(history.dir, 'source'), 'changed\n');
    expect(await verifiedInput(history, 0, expected)).toBeNull();
  });

  it('removes a valid active marker and never follows a foreign history root', async () => {
    await publish();
    await invalidateBuildHistory(artDir, true);
    expect(await loadBuildHistory(artDir)).toBeNull();

    const foreign = join(root, 'foreign');
    const otherArtDir = join(root, 'other.flow');
    await mkdir(foreign);
    await mkdir(otherArtDir);
    await writeFile(join(foreign, 'latest'), 'keep\n');
    await symlink(foreign, join(otherArtDir, '.slc'));
    await invalidateBuildHistory(otherArtDir, false);
    expect(await readFile(join(foreign, 'latest'), 'utf8')).toBe('keep\n');
  });
});

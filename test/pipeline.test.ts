// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  discoverPhaseFiles,
  inferChain,
  loadPipeline,
  PipelineError,
  resolvePipeline,
} from '../src/pipeline.js';
import type { Phase } from '../src/phase.js';

const phase = (name: string, source: string, target: string): Phase => ({
  name,
  source: { format: source, ext: '.md' },
  target: { format: target, ext: '.md' },
});

const formatsDoc = (
  source: string,
  target: string,
  targetExt = '.md',
): string =>
  `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${source} | .md |
| target | ${target} | ${targetExt} |
`;

describe('inferChain (PIPE-4, PIPE-5)', () => {
  it('orders a linear chain from entry to exit', () => {
    const chain = inferChain([
      phase('gears2fsm', 'gears', 'fsm'),
      phase('text2gears', 'text', 'gears'),
    ]);
    expect(chain.map((p) => p.name)).toEqual(['text2gears', 'gears2fsm']);
  });

  it('accepts a single-phase pipeline', () => {
    const chain = inferChain([phase('text2fsm', 'text', 'fsm')]);
    expect(chain.map((p) => p.name)).toEqual(['text2fsm']);
  });

  it('refuses an empty pipeline as incomplete', () => {
    expect(() => inferChain([])).toThrow(
      expect.objectContaining({ code: 'chain-incomplete' }),
    );
  });

  it('refuses a branch where one format feeds two phases', () => {
    expect(() =>
      inferChain([
        phase('gears2fsm', 'gears', 'fsm'),
        phase('gears2run', 'gears', 'run'),
      ]),
    ).toThrow(expect.objectContaining({ code: 'chain-branch' }));
  });

  it('refuses a branch where two phases produce one format', () => {
    expect(() =>
      inferChain([
        phase('text2gears', 'text', 'gears'),
        phase('fsm2gears', 'fsm', 'gears'),
      ]),
    ).toThrow(expect.objectContaining({ code: 'chain-branch' }));
  });

  it('refuses a cycle with no entry phase', () => {
    expect(() =>
      inferChain([phase('a2b', 'a', 'b'), phase('b2a', 'b', 'a')]),
    ).toThrow(expect.objectContaining({ code: 'chain-cycle' }));
  });

  it('refuses phases disconnected from the entry chain', () => {
    expect(() =>
      inferChain([
        phase('a2b', 'a', 'b'),
        phase('p2q', 'p', 'q'),
        phase('q2p', 'q', 'p'),
      ]),
    ).toThrow(expect.objectContaining({ code: 'chain-incomplete' }));
  });
});

describe('resolvePipeline (PIPE-16)', () => {
  it('returns the single resolved directory', async () => {
    await expect(
      resolvePipeline('playbook', () => ['/pipelines/playbook']),
    ).resolves.toBe('/pipelines/playbook');
  });

  it('supports async resolvers', async () => {
    await expect(
      resolvePipeline('playbook', () =>
        Promise.resolve(['/pipelines/playbook']),
      ),
    ).resolves.toBe('/pipelines/playbook');
  });

  it('refuses an unresolved reference', async () => {
    await expect(resolvePipeline('missing', () => [])).rejects.toMatchObject({
      code: 'unresolved-pipeline',
    });
  });

  it('refuses an ambiguous reference', async () => {
    await expect(
      resolvePipeline('dup', () => ['/a/dup', '/b/dup']),
    ).rejects.toMatchObject({
      code: 'ambiguous-pipeline',
    });
  });
});

describe('discoverPhaseFiles and loadPipeline (PIPE-17)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-pipeline-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists direct .md phase files, reserves link.md, and skips subdirectories', async () => {
    await writeFile(join(dir, 'text2gears.md'), formatsDoc('text', 'gears'));
    await writeFile(
      join(dir, 'gears2fsm.md'),
      formatsDoc('gears', 'fsm', '.ts'),
    );
    await writeFile(join(dir, 'link.md'), '# link');
    await mkdir(join(dir, 'nested'));
    await writeFile(
      join(dir, 'nested', 'ignored2me.md'),
      formatsDoc('ignored', 'me'),
    );

    const { phaseFiles, linkFile } = await discoverPhaseFiles(dir);
    expect(phaseFiles).toEqual([
      join(dir, 'gears2fsm.md'),
      join(dir, 'text2gears.md'),
    ]);
    expect(linkFile).toBe(join(dir, 'link.md'));
  });

  it('loads and orders the pipeline chain', async () => {
    await writeFile(join(dir, 'text2gears.md'), formatsDoc('text', 'gears'));
    await writeFile(
      join(dir, 'gears2fsm.md'),
      formatsDoc('gears', 'fsm', '.ts'),
    );

    const pipeline = await loadPipeline(dir);
    expect(pipeline.dir).toBe(dir);
    expect(pipeline.phases.map((p) => p.name)).toEqual([
      'text2gears',
      'gears2fsm',
    ]);
    expect(pipeline.linkFile).toBeNull();
  });

  it('refuses a directory whose phases do not form a chain', async () => {
    await writeFile(join(dir, 'a2b.md'), formatsDoc('a', 'b'));
    await writeFile(join(dir, 'c2d.md'), formatsDoc('c', 'd'));

    await expect(loadPipeline(dir)).rejects.toBeInstanceOf(PipelineError);
  });
});

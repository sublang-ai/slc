// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPipelineResolver,
  pipelineSearchRoots,
} from '../src/resolver.js';

describe('pipelineSearchRoots (CLI-6)', () => {
  it('defaults to [cwd] when SLC_PIPELINE_PATH is unset, empty, or blank', () => {
    expect(pipelineSearchRoots(undefined, '/work')).toEqual(['/work']);
    expect(pipelineSearchRoots('', '/work')).toEqual(['/work']);
    expect(pipelineSearchRoots(`  ${delimiter} `, '/work')).toEqual(['/work']);
  });

  it('splits the OS path-list and preserves order', () => {
    const value = ['/a', '/b', '/c'].join(delimiter);
    expect(pipelineSearchRoots(value, '/work')).toEqual(['/a', '/b', '/c']);
  });

  it('resolves relative roots against cwd and keeps absolute roots', () => {
    const value = ['pipes', '/abs/pipes'].join(delimiter);
    expect(pipelineSearchRoots(value, '/work')).toEqual([
      resolve('/work', 'pipes'),
      '/abs/pipes',
    ]);
  });

  it('drops blank entries and collapses duplicates while preserving order', () => {
    const value = ['/a', '', '/b', '/a'].join(delimiter);
    expect(pipelineSearchRoots(value, '/work')).toEqual(['/a', '/b']);
  });

  it('normalizes absolute roots, stripping trailing slashes, and dedups variants', () => {
    expect(pipelineSearchRoots('/abs/pipes/', '/work')).toEqual(['/abs/pipes']);
    const value = ['/abs/pipes', '/abs/pipes/'].join(delimiter);
    expect(pipelineSearchRoots(value, '/work')).toEqual(['/abs/pipes']);
  });

  it('accepts the config-file sequence form, resolving relative roots against cwd', () => {
    expect(pipelineSearchRoots(['pipes', '/abs/pipes'], '/work')).toEqual([
      resolve('/work', 'pipes'),
      '/abs/pipes',
    ]);
  });

  it('defaults to [cwd] for an empty or all-blank sequence', () => {
    expect(pipelineSearchRoots([], '/work')).toEqual(['/work']);
    expect(pipelineSearchRoots(['  ', ''], '/work')).toEqual(['/work']);
  });
});

describe('createPipelineResolver (CLI-6)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-resolver-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('resolves a reference to the directory directly under a search root (hit)', async () => {
    const rootA = join(root, 'a');
    await mkdir(join(rootA, 'flow'), { recursive: true });
    const resolver = createPipelineResolver([rootA]);

    expect(await resolver('flow')).toEqual([join(rootA, 'flow')]);
  });

  it('matches a direct child even when the root has a trailing slash', async () => {
    const rootA = join(root, 'a');
    await mkdir(join(rootA, 'flow'), { recursive: true });
    const resolver = createPipelineResolver([`${rootA}/`]);

    expect(await resolver('flow')).toEqual([join(rootA, 'flow')]);
  });

  it('returns no candidate when the reference is absent (miss)', async () => {
    const rootA = join(root, 'a');
    await mkdir(rootA, { recursive: true });
    const resolver = createPipelineResolver([rootA]);

    expect(await resolver('flow')).toEqual([]);
  });

  it('returns every match across roots so runSlc refuses an ambiguous reference', async () => {
    const rootA = join(root, 'a');
    const rootB = join(root, 'b');
    await mkdir(join(rootA, 'flow'), { recursive: true });
    await mkdir(join(rootB, 'flow'), { recursive: true });
    const resolver = createPipelineResolver([rootA, rootB]);

    expect(await resolver('flow')).toEqual([
      join(rootA, 'flow'),
      join(rootB, 'flow'),
    ]);
  });

  it('ignores a non-directory match', async () => {
    const rootA = join(root, 'a');
    await mkdir(rootA, { recursive: true });
    await writeFile(join(rootA, 'flow'), 'not a dir');
    const resolver = createPipelineResolver([rootA]);

    expect(await resolver('flow')).toEqual([]);
  });

  it('ignores nested-path and parent-traversal references', async () => {
    const rootA = join(root, 'a');
    await mkdir(join(rootA, 'nested', 'deep'), { recursive: true });
    const sibling = join(root, 'sibling');
    await mkdir(sibling, { recursive: true });
    const resolver = createPipelineResolver([rootA]);

    expect(await resolver(join('nested', 'deep'))).toEqual([]);
    expect(await resolver('..')).toEqual([]);
    expect(await resolver(join('..', 'sibling'))).toEqual([]);
  });

  it('deduplicates when the same root appears more than once', async () => {
    const rootA = join(root, 'a');
    await mkdir(join(rootA, 'flow'), { recursive: true });
    const resolver = createPipelineResolver([rootA, rootA]);

    expect(await resolver('flow')).toEqual([join(rootA, 'flow')]);
  });
});

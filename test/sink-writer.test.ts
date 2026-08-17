// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  link,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeFileNoFollow } from '../src/verify.js';

describe('writeFileNoFollow (PHEXEC-39)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-sink-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates and replaces regular files', async () => {
    const path = join(dir, 'out.txt');
    await writeFileNoFollow(path, 'first');
    await writeFileNoFollow(path, 'second');
    expect(await readFile(path, 'utf8')).toBe('second');
  });

  it('refuses a symlink leaf and leaves its destination unchanged', async () => {
    const victim = join(dir, 'victim.txt');
    await writeFile(victim, 'victim bytes');
    const path = join(dir, 'out.txt');
    await symlink(victim, path);
    await expect(writeFileNoFollow(path, 'redirected')).rejects.toThrow();
    expect(await readFile(victim, 'utf8')).toBe('victim bytes');
  });

  it('refuses a hard-linked leaf and leaves the other name unchanged', async () => {
    const victim = join(dir, 'victim.txt');
    await writeFile(victim, 'victim bytes');
    const path = join(dir, 'out.txt');
    await link(victim, path);
    await expect(writeFileNoFollow(path, 'redirected')).rejects.toThrow(
      /private regular file/,
    );
    expect(await readFile(victim, 'utf8')).toBe('victim bytes');
  });
});

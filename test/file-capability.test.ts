// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type FileCapability,
  type FileErrorCode,
  type FileResult,
  createFileCapability,
} from '../src/file-capability.js';
import { hashBytes } from '../src/hash.js';

// Integration acceptance over a capability rooted at a fixture directory on a
// real filesystem (FCAP-7..FCAP-10).
describe('file capability (FCAP-7..FCAP-10)', () => {
  let root: string;
  let cap: FileCapability;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-fcap-'));
    cap = createFileCapability(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (rel: string, content: string): Promise<void> => {
    await writeFile(join(root, rel), content);
  };

  const expectErr = (
    result: FileResult<unknown>,
    code: FileErrorCode,
  ): void => {
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(code);
    }
  };

  it('round-trips bytes with matching write and read hashes (FCAP-8)', async () => {
    const bytes = enc.encode('compiled artifact bytes\n');
    await mkdir(join(root, 'out'), { recursive: true });
    const ok = await cap.write('out/artifact.ts', bytes);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.hash).toBe(hashBytes(bytes));
    }

    const read = await cap.read('out/artifact.ts');
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.hash).toBe(hashBytes(bytes));
      expect(dec.decode(read.value.bytes)).toBe('compiled artifact bytes\n');
    }
  });

  it('reports not_found and not_file for read (FCAP-3)', async () => {
    await mkdir(join(root, 'sub'));
    expectErr(await cap.read('missing.txt'), 'not_found');
    expectErr(await cap.read('sub'), 'not_file');
  });

  it('lists only immediate children, directories before files (FCAP-9)', async () => {
    await mkdir(join(root, 'zeta-dir'));
    await mkdir(join(root, 'alpha-dir'));
    await write('beta.txt', 'b');
    await write('alpha.txt', 'a');
    await mkdir(join(root, 'alpha-dir', 'nested'));

    const result = await cap.list('/');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entries).toEqual([
        { name: 'alpha-dir', kind: 'directory' },
        { name: 'zeta-dir', kind: 'directory' },
        { name: 'alpha.txt', kind: 'file' },
        { name: 'beta.txt', kind: 'file' },
      ]);
    }
  });

  it('reports not_directory when listing a file (FCAP-4)', async () => {
    await write('a.txt', 'a');
    expectErr(await cap.list('a.txt'), 'not_directory');
  });

  it('honors ifMatch as a compare-and-swap (FCAP-10)', async () => {
    const first = enc.encode('v1');
    const created = await cap.write('doc.txt', first);
    if (!created.ok) {
      throw new Error(`write failed: ${created.diagnostic}`);
    }
    const firstHash = created.value.hash;

    // Matching ifMatch succeeds and returns the new hash.
    const second = enc.encode('v2');
    const updated = await cap.write('doc.txt', second, { ifMatch: firstHash });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.hash).toBe(hashBytes(second));
    }

    // A now-stale ifMatch is refused and leaves the file unchanged.
    const stale = await cap.write('doc.txt', enc.encode('v3'), {
      ifMatch: firstHash,
    });
    expectErr(stale, 'stale');
    expect(await readFile(join(root, 'doc.txt'), 'utf8')).toBe('v2');
  });

  it('serializes concurrent ifMatch writes so exactly one applies (FCAP-6)', async () => {
    const created = await cap.write('cas.txt', enc.encode('v0'));
    if (!created.ok) {
      throw new Error(`seed write failed: ${created.diagnostic}`);
    }
    const old = created.value.hash;

    const results = await Promise.all([
      cap.write('cas.txt', enc.encode('A'), { ifMatch: old }),
      cap.write('cas.txt', enc.encode('B'), { ifMatch: old }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === 'stale')).toHaveLength(1);
  });

  it('reports stale for ifMatch against a missing file (FCAP-6)', async () => {
    const guard = `sha256:${'a'.repeat(64)}` as const;
    expectErr(
      await cap.write('fresh.txt', enc.encode('x'), { ifMatch: guard }),
      'stale',
    );
  });

  it('resolves leading-slash, dot, and bare paths to the same file (FCAP-7)', async () => {
    await write('a.txt', 'same');
    const want = hashBytes(enc.encode('same'));
    for (const variant of [
      '/a.txt',
      './a.txt',
      'a.txt',
      'b/../a.txt',
      'a.txt',
    ]) {
      const read = await cap.read(variant);
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(read.value.hash).toBe(want);
      }
    }
  });

  it('rejects boundary-escaping and platform-absolute paths (FCAP-2, FCAP-7)', async () => {
    expectErr(await cap.read('../escape'), 'invalid_path');
    expectErr(await cap.read('a/../../escape'), 'invalid_path');
    expectErr(await cap.read('C:\\Windows\\system32'), 'invalid_path');
    expectErr(
      await cap.write('\\\\server\\share', enc.encode('x')),
      'invalid_path',
    );
  });

  it('confines reads after resolving symlinks (FCAP-2, FCAP-7)', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'slc-fcap-out-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'secret');
      // A symlink inside the root whose target is outside the root.
      await symlink(join(outside, 'secret.txt'), join(root, 'leak.txt'));
      expectErr(await cap.read('leak.txt'), 'invalid_path');

      // A symlink inside the root pointing to an in-root file is allowed.
      await write('real.txt', 'in-root');
      await symlink(join(root, 'real.txt'), join(root, 'alias.txt'));
      const read = await cap.read('alias.txt');
      expect(read.ok).toBe(true);
      if (read.ok) {
        expect(dec.decode(read.value.bytes)).toBe('in-root');
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

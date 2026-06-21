// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type FileCapability,
  type FileErrorCode,
  type FileResult,
} from '../src/file-capability.js';
import {
  buildRunGrants,
  createGuardedCapability,
  isScopeFailure,
} from '../src/file-grants.js';

// Integration acceptance for the default-deny grant model over a fixture run
// root (FCAP-15..FCAP-17).
describe('file capability grants (FCAP-15..FCAP-17)', () => {
  let root: string;
  let cap: FileCapability;
  const enc = new TextEncoder();

  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(root, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
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

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-grants-'));
    await write('source.md', 'source');
    await write('reference/gears.md', 'reference');
    await write('other.txt', 'ungranted');
    await mkdir(join(root, 'out'), { recursive: true });
    // A compile run: read source + closure, write only the target.
    cap = createGuardedCapability(
      root,
      buildRunGrants({
        kind: 'compile',
        source: '/source.md',
        target: '/out/artifact.ts',
        semanticInputs: [{ path: '/reference/gears.md' }],
      }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('denies any access no grant covers (FCAP-15)', async () => {
    expectErr(await cap.read('/other.txt'), 'unauthorized');
    expectErr(await cap.list('/'), 'unauthorized');
    expectErr(await cap.write('/other.txt', enc.encode('x')), 'unauthorized');
  });

  it('makes only the target writable (FCAP-16)', async () => {
    const ok = await cap.write('/out/artifact.ts', enc.encode('artifact'));
    expect(ok.ok).toBe(true);

    // The read-granted source is not writable, and stays unchanged.
    expectErr(
      await cap.write('/source.md', enc.encode('tampered')),
      'unauthorized',
    );
    expect(await readFile(join(root, 'source.md'), 'utf8')).toBe('source');
  });

  it('reads only within the closure (FCAP-17)', async () => {
    expect((await cap.read('/source.md')).ok).toBe(true);
    expect((await cap.read('/reference/gears.md')).ok).toBe(true);
    expectErr(await cap.read('/other.txt'), 'unauthorized');
  });

  it('reports invalid_path, not unauthorized, for an escaping path (FCAP-14)', async () => {
    expectErr(await cap.read('../escape'), 'invalid_path');
    expectErr(await cap.read('C:\\Windows'), 'invalid_path');
  });

  it('classifies scope failures (FCAP-14)', () => {
    expect(isScopeFailure('invalid_path')).toBe(true);
    expect(isScopeFailure('unauthorized')).toBe(true);
    expect(isScopeFailure('not_found')).toBe(false);
    expect(isScopeFailure('stale')).toBe(false);
  });

  it('requires read access for listing, not just listing:true (FCAP-11)', async () => {
    await mkdir(join(root, 'dir'));

    const writeListed = createGuardedCapability(root, [
      {
        path: '/dir',
        access: 'write',
        kind: 'directory',
        listing: true,
        reason: 'target',
      },
    ]);
    expectErr(await writeListed.list('/dir'), 'unauthorized');

    const readListed = createGuardedCapability(root, [
      {
        path: '/dir',
        access: 'read',
        kind: 'directory',
        listing: true,
        reason: 'semanticInput',
      },
    ]);
    expect((await readListed.list('/dir')).ok).toBe(true);
  });

  it('grants the writable path by phase kind (FCAP-12)', () => {
    const compile = buildRunGrants({ kind: 'compile', target: '/t.ts' });
    expect(compile.filter((g) => g.access === 'write')).toEqual([
      { path: '/t.ts', access: 'write', kind: 'file', reason: 'target' },
    ]);

    const link = buildRunGrants({
      kind: 'link',
      objects: ['/o.fsm.ts'],
      linked: '/l.phase.ts',
    });
    expect(link.filter((g) => g.access === 'write')).toEqual([
      { path: '/l.phase.ts', access: 'write', kind: 'file', reason: 'linked' },
    ]);
  });
});

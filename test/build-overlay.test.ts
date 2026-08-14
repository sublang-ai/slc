// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  link,
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
  BuildOverlayError,
  createCandidateOverlay,
  type AcceptedOverlayMember,
  type CandidateOverlayMember,
  type OverlayIdentityGuard,
} from '../src/build-overlay.js';
import { hashBytes, hashFile, type Hash } from '../src/hash.js';

const bytesHash = (value: string): Hash =>
  hashBytes(new TextEncoder().encode(value));

describe('candidate build overlays (INCR-8 foundation)', () => {
  let root: string;
  let artifactDir: string;
  let entryPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-overlay-'));
    artifactDir = join(root, 'workflow.fixture');
    entryPath = join(root, 'workflow.ts');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stages a cold build in an equivalent private layout without canonical writes', async () => {
    const overlay = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted: [],
      candidate: coldCandidate(),
    });
    expect(overlay.stagePath('workflow.fsm.ts')).toBe(
      join(overlay.root, 'workflow.fixture', 'workflow.fsm.ts'),
    );
    expect(overlay.stagePath('../workflow.ts')).toBe(
      join(overlay.root, 'workflow.ts'),
    );
    await expect(readFile(artifactDir)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(readFile(entryPath)).rejects.toMatchObject({ code: 'ENOENT' });

    for (const path of coldCandidate().map((member) => member.path)) {
      await writeFile(overlay.stagePath(path), `candidate:${path}\n`);
    }
    const sealed = await overlay.seal();
    await mkdir(artifactDir);
    await writeFile(join(artifactDir, 'notes.txt'), 'unrecorded\n');
    await expect(sealed.assertReady()).resolves.toBeUndefined();
    expect(sealed.manifest.replace.map((item) => item.path)).toEqual([
      '../workflow.ts',
      '.slc-build.json',
      '.slc-source',
      'workflow.fsm.ts',
    ]);
    expect(await readFile(join(artifactDir, 'notes.txt'), 'utf8')).toBe(
      'unrecorded\n',
    );
    await sealed.discard();
    await expect(readFile(sealed.root)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('calculates replace, retain, and obsolete paths only from trusted inventory', async () => {
    await mkdir(artifactDir);
    await writeFile(join(artifactDir, '.slc-build.json'), 'old record\n');
    await writeFile(join(artifactDir, '.slc-source'), 'source\n');
    await writeFile(join(artifactDir, 'workflow.gears.md'), 'old gears\n');
    await writeFile(join(artifactDir, 'workflow.fsm.ts'), 'old fsm\n');
    await writeFile(entryPath, 'old entry\n');
    await writeFile(join(artifactDir, 'notes.txt'), 'unrecorded\n');
    const accepted = await acceptedMembers([
      ['record', 'build-record', '.slc-build.json'],
      ['snapshot', 'source-snapshot', '.slc-source'],
      ['gears', 'semantic', 'workflow.gears.md'],
      ['fsm', 'semantic', 'workflow.fsm.ts'],
      ['entry', 'entry', '../workflow.ts'],
    ]);
    const candidate: CandidateOverlayMember[] = [
      staged('record', 'build-record', '.slc-build.json'),
      retained('snapshot', 'source-snapshot', '.slc-source'),
      staged('gears-v2', 'semantic', 'workflow.gears.md'),
      retained('entry', 'entry', '../workflow.ts'),
    ];
    const overlay = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted,
      candidate,
    });
    await writeFile(overlay.stagePath('.slc-build.json'), 'new record\n');
    await writeFile(overlay.stagePath('workflow.gears.md'), 'new gears\n');
    await writeFile(join(artifactDir, 'notes.txt'), 'concurrent edit\n');
    const sealed = await overlay.seal();
    expect(sealed.manifest.replace.map((item) => [item.id, item.path])).toEqual(
      [
        ['record', '.slc-build.json'],
        ['gears-v2', 'workflow.gears.md'],
      ],
    );
    expect(sealed.manifest.retain.map((item) => item.path)).toEqual([
      '../workflow.ts',
      '.slc-source',
    ]);
    expect(sealed.manifest.remove.map((item) => item.path)).toEqual([
      'workflow.fsm.ts',
    ]);
    expect(JSON.stringify(sealed.manifest)).not.toContain('notes.txt');
    await expect(sealed.assertReady()).resolves.toBeUndefined();
    await sealed.discard();
  });

  it('rejects drift in accepted, new, guarded, and staged bytes', async () => {
    await mkdir(artifactDir);
    await writeFile(join(artifactDir, '.slc-build.json'), 'old record\n');
    await writeFile(join(artifactDir, '.slc-source'), 'source\n');
    await writeFile(join(artifactDir, 'old.txt'), 'old\n');
    const guardState = { value: 'input-v1' };
    const guard = valueGuard('guard:plan', guardState);
    const create = () =>
      createCandidateOverlay({
        artifactDir,
        pipeline: 'fixture',
        accepted: acceptedMembersSync([
          ['record', 'build-record', '.slc-build.json', 'old record\n'],
          ['snapshot', 'source-snapshot', '.slc-source', 'source\n'],
          ['old', 'semantic', 'old.txt', 'old\n'],
        ]),
        candidate: [
          staged('record', 'build-record', '.slc-build.json'),
          retained('snapshot', 'source-snapshot', '.slc-source'),
          retained('old', 'semantic', 'old.txt'),
          staged('new', 'semantic', 'new.txt'),
        ],
        guards: [guard],
      });

    let overlay = await create();
    await writeFile(join(artifactDir, 'old.txt'), 'changed\n');
    await expect(overlay.assertBasisCurrent()).rejects.toMatchObject({
      code: 'overlay-conflict',
    });
    await overlay.discard();
    await writeFile(join(artifactDir, 'old.txt'), 'old\n');

    overlay = await create();
    await writeFile(join(artifactDir, 'new.txt'), 'occupied\n');
    await expect(overlay.assertBasisCurrent()).rejects.toBeInstanceOf(
      BuildOverlayError,
    );
    await overlay.discard();
    await rm(join(artifactDir, 'new.txt'));

    overlay = await create();
    guardState.value = 'input-v2';
    await expect(overlay.assertBasisCurrent()).rejects.toMatchObject({
      code: 'overlay-conflict',
    });
    await overlay.discard();
    guardState.value = 'input-v1';

    overlay = await create();
    await writeFile(overlay.stagePath('.slc-build.json'), 'new record\n');
    await writeFile(overlay.stagePath('new.txt'), 'new\n');
    const sealed = await overlay.seal();
    await writeFile(overlay.stagePath('new.txt'), 'tampered\n');
    await expect(sealed.assertReady()).rejects.toMatchObject({
      code: 'overlay-conflict',
    });
    await sealed.discard();
  });

  it('baselines pre-lineage outputs and retains byte-identical regeneration', async () => {
    await mkdir(artifactDir);
    await writeFile(join(artifactDir, 'workflow.fsm.ts'), 'existing\n');
    const overlay = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted: [],
      candidate: coldCandidate(),
    });
    for (const member of coldCandidate()) {
      await writeFile(
        overlay.stagePath(member.path),
        member.path === 'workflow.fsm.ts' ? 'existing\n' : member.path,
      );
    }
    const sealed = await overlay.seal();
    expect(sealed.manifest.retain).toEqual([
      expect.objectContaining({
        id: 'fsm',
        path: 'workflow.fsm.ts',
        identity: bytesHash('existing\n'),
      }),
    ]);
    expect(
      sealed.manifest.replace.find(
        (operation) => operation.path === 'workflow.fsm.ts',
      ),
    ).toBeUndefined();
    await writeFile(join(artifactDir, 'workflow.fsm.ts'), 'concurrent\n');
    await expect(sealed.assertReady()).rejects.toMatchObject({
      code: 'overlay-conflict',
    });
    await sealed.discard();
  });

  it('rejects symlink, hard-link, and wrong-type managed paths', async () => {
    await mkdir(artifactDir);
    await writeFile(join(artifactDir, '.slc-build.json'), 'old record\n');
    await writeFile(join(artifactDir, '.slc-source'), 'source\n');
    await mkdir(join(artifactDir, 'nested'));
    await writeFile(join(artifactDir, 'nested', 'old.txt'), 'old\n');
    const accepted = acceptedMembersSync([
      ['record', 'build-record', '.slc-build.json', 'old record\n'],
      ['snapshot', 'source-snapshot', '.slc-source', 'source\n'],
      ['old', 'semantic', 'nested/old.txt', 'old\n'],
    ]);
    const candidate = [
      staged('record', 'build-record', '.slc-build.json'),
      retained('snapshot', 'source-snapshot', '.slc-source'),
      retained('old', 'semantic', 'nested/old.txt'),
    ];
    await rm(join(artifactDir, 'nested'), { recursive: true });
    await writeFile(join(artifactDir, 'nested'), 'not a directory\n');
    await expect(
      createCandidateOverlay({
        artifactDir,
        pipeline: 'fixture',
        accepted,
        candidate,
      }),
    ).rejects.toMatchObject({ code: 'overlay-unsafe' });

    await rm(join(artifactDir, 'nested'));
    await mkdir(join(artifactDir, 'nested'));
    await writeFile(join(artifactDir, 'target.txt'), 'target\n');
    await symlink('target.txt', join(artifactDir, 'nested', 'old.txt'));
    await expect(
      createCandidateOverlay({
        artifactDir,
        pipeline: 'fixture',
        accepted,
        candidate,
      }),
    ).rejects.toMatchObject({ code: 'overlay-unsafe' });

    await rm(join(artifactDir, 'nested', 'old.txt'));
    await writeFile(join(artifactDir, 'nested', 'old.txt'), 'old\n');
    const overlay = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted,
      candidate,
    });
    await symlink(
      join(artifactDir, '.slc-build.json'),
      overlay.stagePath('.slc-build.json'),
    );
    await expect(overlay.seal()).rejects.toMatchObject({
      code: 'overlay-unsafe',
    });
    await overlay.discard();

    const hardLinked = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted,
      candidate,
    });
    await link(
      join(artifactDir, '.slc-build.json'),
      hardLinked.stagePath('.slc-build.json'),
    );
    await expect(hardLinked.seal()).rejects.toMatchObject({
      code: 'overlay-unsafe',
    });
    await hardLinked.discard();

    const wrongType = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted,
      candidate,
    });
    await mkdir(wrongType.stagePath('.slc-build.json'));
    await expect(wrongType.seal()).rejects.toMatchObject({
      code: 'overlay-unsafe',
    });
    await wrongType.discard();
  });

  it('validates guard kinds and rejects impossible overlay shapes', async () => {
    const value = { kind: 'value' as const, identity: bytesHash('v1') };
    const treeKind = { value: 'tree' as 'tree' | 'file' };
    const overlay = await createCandidateOverlay({
      artifactDir,
      pipeline: 'fixture',
      accepted: [],
      candidate: coldCandidate(),
      guards: [
        {
          id: 'guard:value',
          expected: value,
          observe: () => ({ ...value }),
        },
        {
          id: 'guard:tree',
          expected: { kind: 'tree', identity: bytesHash('same') },
          observe: () => ({
            kind: treeKind.value,
            identity: bytesHash('same'),
          }),
        },
      ],
    });
    for (const member of coldCandidate()) {
      await writeFile(overlay.stagePath(member.path), member.path);
    }
    await expect(overlay.seal()).resolves.toBeDefined();
    treeKind.value = 'file';
    await expect(overlay.assertBasisCurrent()).rejects.toMatchObject({
      code: 'overlay-conflict',
    });
    await overlay.discard();

    await expect(
      createCandidateOverlay({
        artifactDir,
        pipeline: 'other',
        accepted: [],
        candidate: coldCandidate(),
      }),
    ).rejects.toMatchObject({ code: 'overlay-invalid' });
    await expect(
      createCandidateOverlay({
        artifactDir,
        pipeline: 'fixture',
        accepted: [
          {
            id: 'untrusted',
            role: 'semantic',
            path: 'untrusted.txt',
            identity: bytesHash('untrusted'),
          },
        ],
        candidate: coldCandidate(),
      }),
    ).rejects.toMatchObject({ code: 'overlay-invalid' });

    await expect(
      createCandidateOverlay({
        artifactDir,
        pipeline: 'fixture',
        accepted: [],
        candidate: [staged('record', 'build-record', '.slc-build.json')],
      }),
    ).rejects.toMatchObject({ code: 'overlay-invalid' });
    await expect(
      createCandidateOverlay({
        artifactDir,
        pipeline: 'fixture',
        accepted: [],
        candidate: [
          staged('record', 'build-record', '.slc-build.json'),
          staged('snapshot', 'source-snapshot', '.slc-source'),
          staged('parent', 'semantic', 'nested'),
          staged('interposed', 'semantic', 'nested-name'),
          staged('child', 'semantic', 'nested/child.txt'),
        ],
      }),
    ).rejects.toMatchObject({ code: 'overlay-invalid' });
  });

  function coldCandidate(): CandidateOverlayMember[] {
    return [
      staged('record', 'build-record', '.slc-build.json'),
      staged('snapshot', 'source-snapshot', '.slc-source'),
      staged('entry', 'entry', '../workflow.ts'),
      staged('fsm', 'semantic', 'workflow.fsm.ts'),
    ];
  }

  async function acceptedMembers(
    entries: readonly (readonly [
      string,
      AcceptedOverlayMember['role'],
      string,
    ])[],
  ): Promise<AcceptedOverlayMember[]> {
    return Promise.all(
      entries.map(async ([id, role, path]) => ({
        id,
        role,
        path,
        identity: await hashFile(
          path.startsWith('../')
            ? join(root, path.slice(3))
            : join(artifactDir, path),
        ),
      })),
    );
  }

  function acceptedMembersSync(
    entries: readonly (readonly [
      string,
      AcceptedOverlayMember['role'],
      string,
      string,
    ])[],
  ): AcceptedOverlayMember[] {
    return entries.map(([id, role, path, value]) => ({
      id,
      role,
      path,
      identity: bytesHash(value),
    }));
  }

  function valueGuard(
    id: string,
    state: { value: string },
  ): OverlayIdentityGuard {
    return {
      id,
      expected: { kind: 'value', identity: bytesHash(state.value) },
      observe: () => ({ kind: 'value', identity: bytesHash(state.value) }),
    };
  }
});

function staged(
  id: string,
  role: CandidateOverlayMember['role'],
  path: string,
): CandidateOverlayMember {
  return { id, role, path, disposition: 'stage' };
}

function retained(
  id: string,
  role: CandidateOverlayMember['role'],
  path: string,
): CandidateOverlayMember {
  return { id, role, path, disposition: 'retain' };
}

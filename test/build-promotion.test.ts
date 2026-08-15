// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  OverlayRemove,
  OverlayReplace,
  SealedOverlay,
} from '../src/build-overlay.js';
import {
  BuildPromotionError,
  type PromotionCheckpointName,
  promoteLineage,
  recoverLineagePromotion,
} from '../src/build-promotion.js';
import { hashBytes } from '../src/hash.js';

const exists = async (path: string): Promise<boolean> =>
  stat(path)
    .then(() => true)
    .catch(() => false);

describe('forward-only lineage promotion (DR-021, INCR-8, INCR-27)', () => {
  let root: string;
  let artDir: string;
  let stage: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-promotion-'));
    artDir = join(root, 'flow.playbook');
    await mkdir(artDir, { recursive: true });
    stage = join(root, `.${basename(artDir)}.slc-stage-test`);
    await mkdir(stage, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  interface Product {
    name: string;
    role: OverlayReplace['role'];
    prior?: string;
    candidate: string;
  }

  /** Stages candidates and builds a minimal sealed overlay around them. */
  async function seal(
    products: Product[],
    removals: {
      name: string;
      prior: string;
      role?: OverlayReplace['role'];
    }[] = [],
    retained: { name: string; content: string }[] = [],
  ): Promise<SealedOverlay> {
    const replace: OverlayReplace[] = [];
    for (const [index, product] of products.entries()) {
      const canonicalPath = join(artDir, product.name);
      const stagedPath = join(stage, product.name);
      await mkdir(dirname(stagedPath), { recursive: true });
      await writeFile(stagedPath, product.candidate);
      if (product.prior !== undefined) {
        await writeFile(canonicalPath, product.prior);
      }
      replace.push({
        id: `p${index}`,
        role: product.role,
        path: product.name,
        canonicalPath,
        stagedPath,
        prior:
          product.prior === undefined
            ? { kind: 'absent' }
            : {
                kind: 'file',
                identity: hashBytes(new TextEncoder().encode(product.prior)),
              },
        candidateIdentity: hashBytes(
          new TextEncoder().encode(product.candidate),
        ),
      });
    }
    const remove: OverlayRemove[] = [];
    for (const [index, removal] of removals.entries()) {
      const role = removal.role ?? 'semantic';
      const canonicalPath =
        role === 'entry'
          ? join(root, removal.name)
          : join(artDir, removal.name);
      await writeFile(canonicalPath, removal.prior);
      remove.push({
        id: `r${index}`,
        role,
        path: removal.name,
        canonicalPath,
        priorIdentity: hashBytes(new TextEncoder().encode(removal.prior)),
      });
    }
    const retain = [];
    for (const [index, member] of retained.entries()) {
      const canonicalPath = join(artDir, member.name);
      await writeFile(canonicalPath, member.content);
      retain.push({
        id: `k${index}`,
        role: 'semantic' as const,
        path: member.name,
        canonicalPath,
        identity: hashBytes(new TextEncoder().encode(member.content)),
      });
    }
    return {
      root: stage,
      manifest: { replace, remove, retain },
      assertReady: async () => {},
      discard: async () => rm(stage, { recursive: true, force: true }),
    };
  }

  const standardSet = (): Product[] => [
    { name: 'flow.gears.md', role: 'semantic', prior: 'old', candidate: 'new' },
    { name: '.slc-source', role: 'source-snapshot', candidate: 'src' },
    { name: '.slc-build.json', role: 'build-record', candidate: '{"v":2}' },
  ];

  it('applies products, commits the record last, and removes the stage', async () => {
    const order: PromotionCheckpointName[] = [];
    await promoteLineage({
      overlay: await seal(standardSet(), [{ name: 'stale.md', prior: 'x' }]),
      checkpoint: ({ name }) => {
        order.push(name);
      },
    });
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe('new');
    expect(await readFile(join(artDir, '.slc-build.json'), 'utf8')).toBe(
      '{"v":2}',
    );
    expect(await exists(join(artDir, 'stale.md'))).toBe(false);
    expect(await exists(stage)).toBe(false);
    expect(order[order.length - 1]).toBe('record-committed');
  });

  it('preserves unrecorded files through promotion', async () => {
    await writeFile(join(artDir, 'notes.txt'), 'mine');
    await promoteLineage({ overlay: await seal(standardSet()) });
    expect(await readFile(join(artDir, 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('aborts as a conflict when an obsolete product changed concurrently', async () => {
    const overlay = await seal(standardSet(), [
      { name: 'stale.md', prior: 'x' },
    ]);
    await writeFile(join(artDir, 'stale.md'), 'edited');
    await expect(promoteLineage({ overlay })).rejects.toMatchObject({
      code: 'conflict',
    });
    // The concurrent edit survives and the stage is retained for inspection.
    expect(await readFile(join(artDir, 'stale.md'), 'utf8')).toBe('edited');
    expect(await exists(stage)).toBe(true);
  });

  it.each(['replaces-applied', 'removes-applied'] as const)(
    'finishes forward after an interruption at %s without touching the marker early',
    async (interruptAt) => {
      const overlay = await seal(standardSet());
      await expect(
        promoteLineage({
          overlay,
          checkpoint: ({ name }) => {
            if (name === interruptAt) throw new Error('crash');
          },
        }),
      ).rejects.toThrow('crash');
      // The record (the commit marker) has not moved yet.
      expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);

      const recovered = await recoverLineagePromotion({
        artifactDir: artDir,
        pipeline: 'flow',
      });
      expect(recovered).toBe('candidate-completed');
      expect(await readFile(join(artDir, '.slc-build.json'), 'utf8')).toBe(
        '{"v":2}',
      );
      expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe('new');
      expect(await exists(stage)).toBe(false);
    },
  );

  it('completes cleanup when interrupted after the record committed', async () => {
    const overlay = await seal(standardSet());
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'record-committed') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    expect(await readFile(join(artDir, '.slc-build.json'), 'utf8')).toBe(
      '{"v":2}',
    );
    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('candidate-completed');
    expect(await exists(stage)).toBe(false);
  });

  it('removes a pre-promotion stage without touching canonical paths', async () => {
    await writeFile(join(stage, 'flow.gears.md'), 'staged');
    await writeFile(join(artDir, 'flow.gears.md'), 'accepted');
    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe(
      'accepted',
    );
  });

  it('voids the stage on external interference and leaves the conflict', async () => {
    const overlay = await seal(standardSet());
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'replaces-applied') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // A third party rewrites a managed product to neither prior nor candidate.
    await writeFile(join(artDir, 'flow.gears.md'), 'sabotage');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    // The mixed state is left for ordinary conflict classification.
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe(
      'sabotage',
    );
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('voids a stage whose staged bytes no longer match the sealed identity', async () => {
    const overlay = await seal(standardSet());
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'manifest-published') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // The staged product is truncated between the crash and recovery.
    await writeFile(join(stage, 'flow.gears.md'), '');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    // Nothing was committed from the corrupt stage.
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe('old');
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('refuses a manifest whose staged path escapes the stage root', async () => {
    const outside = join(root, 'outside.md');
    await writeFile(outside, 'attacker bytes');
    await writeFile(join(artDir, 'flow.gears.md'), 'old');
    const manifest = {
      schema: 'sublang.slc.stage.v1',
      artifactDir: artDir,
      replace: [
        {
          role: 'semantic',
          canonicalPath: join(artDir, 'flow.gears.md'),
          stagedPath: outside,
          prior: {
            kind: 'file',
            identity: hashBytes(new TextEncoder().encode('old')),
          },
          candidateIdentity: hashBytes(
            new TextEncoder().encode('attacker bytes'),
          ),
        },
        {
          role: 'build-record',
          canonicalPath: join(artDir, '.slc-build.json'),
          stagedPath: join(stage, '.slc-build.json'),
          prior: { kind: 'absent' },
          candidateIdentity: hashBytes(new TextEncoder().encode('{}')),
        },
      ],
      remove: [],
      retain: [],
    };
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(stage, '.slc-build.json'), '{}');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe('old');
  });

  it('never disturbs an unrecorded file resembling a promotion temp name', async () => {
    const bystander = join(artDir, '.flow.gears.md.slc-tmp');
    await writeFile(bystander, 'mine');
    await promoteLineage({ overlay: await seal(standardSet()) });
    expect(await readFile(bystander, 'utf8')).toBe('mine');
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe('new');
  });

  it('voids a stage when a retained member drifted before recovery', async () => {
    const overlay = await seal(
      standardSet(),
      [],
      [{ name: 'kept.md', content: 'kept' }],
    );
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'replaces-applied') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // The retained member the candidate record still describes is edited
    // between the crash and recovery.
    await writeFile(join(artDir, 'kept.md'), 'edited');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('finishes forward a product whose legal name begins with dots', async () => {
    const overlay = await seal([
      { name: '..gears.md', role: 'semantic', candidate: 'dotted' },
      { name: '.slc-build.json', role: 'build-record', candidate: '{"v":3}' },
    ]);
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'replaces-applied') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('candidate-completed');
    expect(await readFile(join(artDir, '..gears.md'), 'utf8')).toBe('dotted');
  });

  it('refuses a manifest whose metadata role leaves its reserved path', async () => {
    await writeFile(join(artDir, 'victim.md'), 'accepted');
    const manifest = {
      schema: 'sublang.slc.stage.v1',
      artifactDir: artDir,
      replace: [
        {
          role: 'build-record',
          canonicalPath: join(artDir, 'victim.md'),
          stagedPath: join(stage, 'victim.md'),
          prior: {
            kind: 'file',
            identity: hashBytes(new TextEncoder().encode('accepted')),
          },
          candidateIdentity: hashBytes(new TextEncoder().encode('forged')),
        },
      ],
      remove: [],
      retain: [],
    };
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(stage, 'victim.md'), 'forged');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await readFile(join(artDir, 'victim.md'), 'utf8')).toBe('accepted');
  });

  it('recovers an interrupted removal of the sibling entry module', async () => {
    const obsoleteEntry = join(root, 'flow.ts');
    const overlay = await seal(standardSet(), [
      { name: 'flow.ts', prior: 'old entry', role: 'entry' },
    ]);
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'replaces-applied') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'playbook',
    });
    expect(recovered).toBe('candidate-completed');
    expect(await exists(obsoleteEntry)).toBe(false);
    expect(await readFile(join(artDir, '.slc-build.json'), 'utf8')).toBe(
      '{"v":2}',
    );
  });

  it('voids a stage whose retained member became a symlink to equal bytes', async () => {
    const overlay = await seal(
      standardSet(),
      [],
      [{ name: 'kept.md', content: 'kept' }],
    );
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'replaces-applied') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // The retained member is swapped for a symlink whose target carries the
    // exact recorded bytes; the link itself is the managed edit.
    const target = join(root, 'elsewhere.md');
    await writeFile(target, 'kept');
    await rm(join(artDir, 'kept.md'));
    await symlink(target, join(artDir, 'kept.md'));

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('refuses recovery through a symlinked managed directory component', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    const overlay = await seal([
      { name: 'verify/check.ts', role: 'verification', candidate: 'check' },
      { name: '.slc-build.json', role: 'build-record', candidate: '{"v":4}' },
    ]);
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'manifest-published') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // The managed directory is swapped for a symlink pointing outside the
    // bundle before recovery runs.
    await rm(join(artDir, 'verify'), { recursive: true, force: true });
    await symlink(outside, join(artDir, 'verify'));

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await readdir(outside)).toEqual([]);
  });

  it('aborts without overwriting a destination edited after the manifest published', async () => {
    const overlay = await seal(standardSet());
    await expect(
      promoteLineage({
        overlay,
        checkpoint: async ({ name }) => {
          if (name === 'manifest-published') {
            await writeFile(join(artDir, 'flow.gears.md'), 'user edit');
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await readFile(join(artDir, 'flow.gears.md'), 'utf8')).toBe(
      'user edit',
    );
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('refuses to commit a record over a retained member edited mid-promotion', async () => {
    const overlay = await seal(
      standardSet(),
      [],
      [{ name: 'kept.md', content: 'kept' }],
    );
    await expect(
      promoteLineage({
        overlay,
        checkpoint: async ({ name }) => {
          if (name === 'removes-applied') {
            await writeFile(join(artDir, 'kept.md'), 'edited');
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // The record never committed over the drifted inventory.
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
    expect(await readFile(join(artDir, 'kept.md'), 'utf8')).toBe('edited');
  });

  it('voids recovery instead of overwriting an edit made during recovery', async () => {
    const overlay = await seal(standardSet());
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'manifest-published') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');

    // The edit lands mid-recovery, after the body replaces applied but
    // before the snapshot installs.
    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
      checkpoint: async ({ name }) => {
        if (name === 'replaces-applied') {
          await writeFile(join(artDir, '.slc-source'), 'recovery edit');
        }
      },
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await readFile(join(artDir, '.slc-source'), 'utf8')).toBe(
      'recovery edit',
    );
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('refuses recovery through an artifact directory swapped for a symlink', async () => {
    const overlay = await seal(standardSet());
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'manifest-published') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // The bundle root itself becomes a symlink to a byte-identical mirror.
    const mirror = join(root, 'mirror');
    await rename(artDir, mirror);
    await symlink(mirror, artDir);

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    // Nothing was committed through the redirected root.
    expect(await exists(join(mirror, '.slc-build.json'))).toBe(false);
  });

  it('refuses the record when an applied path is re-parented behind a symlink', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    const overlay = await seal([
      { name: 'verify/check.ts', role: 'verification', candidate: 'check' },
      { name: '.slc-build.json', role: 'build-record', candidate: '{"v":5}' },
    ]);
    // Interrupt after the body applied: verify/check.ts already sits at its
    // candidate identity.
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'replaces-applied') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');
    // The applied directory is re-parented behind a symlink whose target
    // carries the exact candidate bytes.
    await writeFile(join(outside, 'check.ts'), 'check');
    await rm(join(artDir, 'verify'), { recursive: true, force: true });
    await symlink(outside, join(artDir, 'verify'));

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('refuses the record when an obsolete path reappears mid-promotion', async () => {
    const overlay = await seal(standardSet(), [
      { name: 'stale.md', prior: 'x' },
    ]);
    await expect(
      promoteLineage({
        overlay,
        checkpoint: async ({ name }) => {
          if (name === 'removes-applied') {
            await writeFile(join(artDir, 'stale.md'), 'restored');
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // The reappeared path is left in place, not deleted a second time.
    expect(await readFile(join(artDir, 'stale.md'), 'utf8')).toBe('restored');
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('voids recovery when an obsolete path reappears during recovery', async () => {
    const overlay = await seal(standardSet(), [
      { name: 'stale.md', prior: 'x' },
    ]);
    await expect(
      promoteLineage({
        overlay,
        checkpoint: ({ name }) => {
          if (name === 'manifest-published') throw new Error('crash');
        },
      }),
    ).rejects.toThrow('crash');

    const recovered = await recoverLineagePromotion({
      artifactDir: artDir,
      pipeline: 'flow',
      checkpoint: async ({ name }) => {
        if (name === 'removes-applied') {
          await writeFile(join(artDir, 'stale.md'), 'restored');
        }
      },
    });
    expect(recovered).toBe('nothing-pending');
    expect(await exists(stage)).toBe(false);
    expect(await readFile(join(artDir, 'stale.md'), 'utf8')).toBe('restored');
    expect(await exists(join(artDir, '.slc-build.json'))).toBe(false);
  });

  it('rejects a sealed overlay without a build-record replacement', async () => {
    const overlay = await seal([
      { name: 'flow.gears.md', role: 'semantic', candidate: 'new' },
    ]);
    await expect(promoteLineage({ overlay })).rejects.toBeInstanceOf(
      BuildPromotionError,
    );
  });
});

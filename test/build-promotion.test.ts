// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
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
    removals: { name: string; prior: string }[] = [],
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
      const canonicalPath = join(artDir, removal.name);
      await writeFile(canonicalPath, removal.prior);
      remove.push({
        id: `r${index}`,
        role: 'semantic',
        path: removal.name,
        canonicalPath,
        priorIdentity: hashBytes(new TextEncoder().encode(removal.prior)),
      });
    }
    return {
      root: stage,
      manifest: { replace, remove, retain: [] },
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

  it('rejects a sealed overlay without a build-record replacement', async () => {
    const overlay = await seal([
      { name: 'flow.gears.md', role: 'semantic', candidate: 'new' },
    ]);
    await expect(promoteLineage({ overlay })).rejects.toBeInstanceOf(
      BuildPromotionError,
    );
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const writeControl = vi.hoisted(() => ({
  delayedPath: undefined as string | undefined,
  failedPath: undefined as string | undefined,
  failureObserved: false,
  releaseDelayedWrite: undefined as (() => void) | undefined,
  written: [] as string[],
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      const path = String(args[0]);
      if (path === writeControl.failedPath) {
        writeControl.failureObserved = true;
        throw new Error('injected support write failure');
      }
      if (path === writeControl.delayedPath) {
        await new Promise<void>((resolve) => {
          writeControl.releaseDelayedWrite = resolve;
        });
      }
      const result = await actual.writeFile(...args);
      writeControl.written.push(path);
      return result;
    },
  };
});

import {
  VERIFIER_SUPPORT_FILES,
  VerifierSupportEmissionError,
  emitVerifierSupport,
  verifierSupportManifest,
} from '../src/verify-support.js';

describe('verifier support emission', () => {
  it('exposes the exact stable checker closure in emission order', () => {
    expect(VERIFIER_SUPPORT_FILES).toEqual([
      'hash.js',
      'hash.d.ts',
      'verify.js',
      'verify.d.ts',
      'verify-coverage.js',
      'verify-coverage.d.ts',
    ]);
    expect(verifierSupportManifest('/candidate/support')).toEqual(
      VERIFIER_SUPPORT_FILES.map((file) => ({
        file,
        path: join('/candidate/support', file),
      })),
    );
  });

  it('writes an explicit manifest with canonical-equivalent bytes and no derived output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-verify-support-stage-'));
    const canonicalArtifact = join(root, 'canonical');
    const candidateArtifact = join(root, 'candidate');
    const explicitSupport = join(candidateArtifact, 'explicit-support');
    try {
      const canonical = await emitVerifierSupport(canonicalArtifact);
      const manifest = verifierSupportManifest(explicitSupport);
      const candidate = await emitVerifierSupport({ manifest });

      expect(candidate).toEqual(manifest.map(({ path }) => path));
      for (const [index, path] of candidate.entries()) {
        expect(await readFile(path, 'utf8')).toBe(
          await readFile(canonical[index], 'utf8'),
        );
        expect(await readFile(path, 'utf8')).not.toContain(root);
      }
      await expect(
        readFile(join(candidateArtifact, '.slc-verify', 'verify.js'), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an incomplete or reordered explicit manifest before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-verify-support-bad-'));
    try {
      const manifest = verifierSupportManifest(root);
      await expect(
        emitVerifierSupport({ manifest: manifest.slice(1) }),
      ).rejects.toThrow(/exact closure/);
      await expect(
        emitVerifierSupport({ manifest: [...manifest].reverse() }),
      ).rejects.toThrow(/reordered/);
      await expect(
        emitVerifierSupport({
          manifest: manifest.map((entry, index) =>
            index === 1 ? { ...entry, path: manifest[0].path } : entry,
          ),
        }),
      ).rejects.toThrow(/duplicates/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('waits for every sibling write to settle before reporting a failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-verify-support-settle-'));
    const manifest = verifierSupportManifest(root);
    writeControl.failedPath = manifest[0].path;
    writeControl.delayedPath = manifest[1].path;
    writeControl.failureObserved = false;
    writeControl.releaseDelayedWrite = undefined;
    writeControl.written.length = 0;
    let settled = false;
    const emission = emitVerifierSupport({ manifest }).then(
      () => {
        settled = true;
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );

    try {
      await vi.waitFor(() => {
        expect(writeControl.failureObserved).toBe(true);
        expect(writeControl.releaseDelayedWrite).toBeTypeOf('function');
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      writeControl.releaseDelayedWrite?.();
      await expect(emission).resolves.toEqual(
        expect.objectContaining({
          message: 'injected support write failure',
          written: expect.arrayContaining([manifest[1].path]),
          failures: [expect.objectContaining({ path: manifest[0].path })],
        }),
      );
      expect(await emission).toBeInstanceOf(VerifierSupportEmissionError);
      expect(writeControl.written).toContain(manifest[1].path);
    } finally {
      writeControl.releaseDelayedWrite?.();
      writeControl.failedPath = undefined;
      writeControl.delayedPath = undefined;
      await rm(root, { recursive: true, force: true });
    }
  });
});

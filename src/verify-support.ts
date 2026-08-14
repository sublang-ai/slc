// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Artifact-local verification support for generated playbook tests.
 *
 * The generated tests must not require their destination project to install
 * SLC. A built SLC already contains the complete checker module closure, so a
 * reserved-pipeline run copies that exact closure beside the artifact and has
 * every generated test import it relatively. `xstate` remains a bare import:
 * the compiled FSM already requires the destination project to provide it.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERIFIER_SUPPORT_DIR = '.slc-verify';
export const VERIFIER_SUPPORT_MODULE = `./${VERIFIER_SUPPORT_DIR}/verify.js`;

/** Exact artifact-local checker closure, in deterministic emission order. */
export const VERIFIER_SUPPORT_FILES = Object.freeze([
  'hash.js',
  'hash.d.ts',
  'verify.js',
  'verify.d.ts',
  'verify-coverage.js',
  'verify-coverage.d.ts',
] as const);

export type VerifierSupportFile = (typeof VERIFIER_SUPPORT_FILES)[number];

/** One exact physical verifier-support output. */
export interface VerifierSupportManifestEntry {
  file: VerifierSupportFile;
  path: string;
}

/** Complete settled outcome when one or more support writes fail. */
export class VerifierSupportEmissionError extends AggregateError {
  readonly written: readonly string[];
  readonly failures: readonly { path: string; reason: unknown }[];

  constructor(
    written: readonly string[],
    failures: readonly { path: string; reason: unknown }[],
  ) {
    super(
      failures.map(({ reason }) => reason),
      failures.length === 1
        ? messageOf(failures[0].reason)
        : `failed to emit verifier support: ${failures
            .map(({ path }) => path)
            .join(', ')}`,
    );
    this.name = 'VerifierSupportEmissionError';
    this.written = Object.freeze([...written]);
    this.failures = Object.freeze(
      failures.map(({ path, reason }) => Object.freeze({ path, reason })),
    );
  }
}

/** Stable exact output manifest for a caller-selected support directory. */
export function verifierSupportManifest(
  outputDir: string,
): VerifierSupportManifestEntry[] {
  return VERIFIER_SUPPORT_FILES.map((file) => ({
    file,
    path: join(outputDir, file),
  }));
}

function compiledModuleDir(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  return extname(modulePath) === '.js'
    ? moduleDir
    : resolve(moduleDir, '../dist');
}

function withoutSourceMapReference(content: string): string {
  return content.replace(/\n\/\/# sourceMappingURL=[^\n]+\n?$/u, '\n');
}

/**
 * Emits the compiled verifier closure and returns every written file in stable
 * order. SLC CI builds before tests, while the public CLI always runs from
 * `dist`, so both source-driven tests and installed execution copy the same
 * compiled bytes.
 */
export async function emitVerifierSupport(
  destination: string | { manifest: readonly VerifierSupportManifestEntry[] },
): Promise<string[]> {
  const sourceDir = compiledModuleDir();
  const manifest =
    typeof destination === 'string'
      ? verifierSupportManifest(join(destination, VERIFIER_SUPPORT_DIR))
      : validateManifest(destination.manifest);
  const settled = await Promise.allSettled(
    manifest.map(async ({ file, path }) => {
      await mkdir(dirname(path), { recursive: true });
      const content = await readFile(join(sourceDir, file), 'utf8');
      await writeFile(path, withoutSourceMapReference(content));
      return path;
    }),
  );
  const written: string[] = [];
  const failures: { path: string; reason: unknown }[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      written.push(result.value);
    } else {
      failures.push({ path: manifest[index].path, reason: result.reason });
    }
  }
  if (failures.length > 0) {
    throw new VerifierSupportEmissionError(written, failures);
  }
  return written;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateManifest(
  manifest: readonly VerifierSupportManifestEntry[],
): VerifierSupportManifestEntry[] {
  if (manifest.length !== VERIFIER_SUPPORT_FILES.length) {
    throw new Error(
      'verifier support manifest does not name the exact closure',
    );
  }
  const paths = new Set<string>();
  return manifest.map((entry, index) => {
    const expected = VERIFIER_SUPPORT_FILES[index];
    if (
      entry.file !== expected ||
      typeof entry.path !== 'string' ||
      entry.path.length === 0
    ) {
      throw new Error(
        'verifier support manifest is missing, reordered, or malformed',
      );
    }
    if (paths.has(entry.path)) {
      throw new Error('verifier support manifest duplicates an output path');
    }
    paths.add(entry.path);
    return { file: entry.file, path: entry.path };
  });
}

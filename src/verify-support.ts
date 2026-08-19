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

import { readFile } from 'node:fs/promises';

import { ensureRealDir } from './build-history.js';
import { writeFileNoFollow } from './verify.js';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERIFIER_SUPPORT_DIR = '.slc-verify';
export const VERIFIER_SUPPORT_MODULE = `./${VERIFIER_SUPPORT_DIR}/verify.js`;

const SUPPORT_FILES = [
  'hash.js',
  'hash.d.ts',
  'verify.js',
  'verify.d.ts',
  'verify-coverage.js',
  'verify-coverage.d.ts',
] as const;

/**
 * The installed compiled files `emitVerifierSupport` reads — part of the
 * run's read inventory, so no planned output may overwrite them (PHEXEC-39).
 */
export function verifierSupportSources(): string[] {
  const sourceDir = compiledModuleDir();
  return SUPPORT_FILES.map((file) => join(sourceDir, file));
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
  artifactDir: string,
): Promise<string[]> {
  const sourceDir = compiledModuleDir();
  const targetDir = join(artifactDir, VERIFIER_SUPPORT_DIR);
  // A symlinked `.slc-verify` would route these writes into an arbitrary
  // directory — including the very files being read (PHEXEC-39).
  await ensureRealDir(targetDir);
  return Promise.all(
    SUPPORT_FILES.map(async (file) => {
      const path = join(targetDir, file);
      const content = await readFile(join(sourceDir, file), 'utf8');
      await writeFileNoFollow(path, withoutSourceMapReference(content));
      return path;
    }),
  );
}

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

const SUPPORT_FILES = [
  'hash.js',
  'hash.d.ts',
  'verify.js',
  'verify.d.ts',
  'verify-coverage.js',
  'verify-coverage.d.ts',
] as const;

/** One installed verifier source and its deterministic artifact-local copy. */
export interface VerifierSupportFile {
  source: string;
  target: string;
}

function compiledModuleDir(): string {
  const modulePath = fileURLToPath(import.meta.url);
  const moduleDir = dirname(modulePath);
  return extname(modulePath) === '.js'
    ? moduleDir
    : resolve(moduleDir, '../dist');
}

/** Exact verifier-support copy inventory for one artifact directory. */
export function verifierSupportFiles(
  artifactDir: string,
): VerifierSupportFile[] {
  const sourceDir = compiledModuleDir();
  const targetDir = join(artifactDir, VERIFIER_SUPPORT_DIR);
  return SUPPORT_FILES.map((file) => ({
    source: join(sourceDir, file),
    target: join(targetDir, file),
  }));
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
  const targetDir = join(artifactDir, VERIFIER_SUPPORT_DIR);
  await mkdir(targetDir, { recursive: true });
  return Promise.all(
    verifierSupportFiles(artifactDir).map(async ({ source, target }) => {
      const content = await readFile(source, 'utf8');
      await writeFile(target, withoutSourceMapReference(content));
      return target;
    }),
  );
}

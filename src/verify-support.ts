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
  await mkdir(targetDir, { recursive: true });
  return Promise.all(
    SUPPORT_FILES.map(async (file) => {
      const path = join(targetDir, file);
      const content = await readFile(join(sourceDir, file), 'utf8');
      await writeFile(path, withoutSourceMapReference(content));
      return path;
    }),
  );
}

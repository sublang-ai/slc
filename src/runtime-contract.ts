// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * The declared engine contract behind a pin's link target (phase-execution-30,
 * verification-21; DR-028).
 *
 * A Playbook engine self-reports its compatibility on the
 * `@sublang/playbook/xstate-runtime` surface as `RUNTIME_ABI` and
 * `SUPPORTED_ARTIFACT_SCHEMAS` (Playbook DR-022). {@link readPlaybookRuntimeDeclaration}
 * walks from a link target to the `@sublang/playbook` package that owns it,
 * resolves that package's own engine subpath, imports it, and returns the raw
 * declaration together with the package's `name@version` provenance, so the
 * schema-3 generation is selected by what the installed engine declares rather
 * than by an exact release number. The historical exact provenance maps stay
 * with their callers; this module never infers a contract from a version. The
 * declaration shape and its predicates live in `verify.ts`, whose
 * artifact-local copy carries the verification-only schema decision whole.
 */

import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isAbsentPathError, messageOf } from './errors.js';
import type { PlaybookRuntimeDeclaration } from './verify.js';

export {
  declaresComposedV3,
  describeRuntimeDeclaration,
  type PlaybookRuntimeDeclaration,
} from './verify.js';

/** The package whose installed engine declares the compiled-execution contract. */
export const PLAYBOOK_PACKAGE = '@sublang/playbook';
/** The engine surface carrying `RUNTIME_ABI` and `SUPPORTED_ARTIFACT_SCHEMAS`. */
export const PLAYBOOK_ENGINE_SPECIFIER = '@sublang/playbook/xstate-runtime';

/**
 * Reads the engine declaration of the `@sublang/playbook` package that owns
 * `linkTarget`: the first package manifest above the target owns it, so a
 * parent workspace manifest lends no identity to a nested local file.
 *
 * @returns `undefined` when no owning manifest names `@sublang/playbook`.
 * @throws when the owning package cannot resolve or import its engine
 *   subpath, naming the package and the failure.
 */
export async function readPlaybookRuntimeDeclaration(
  linkTarget: string,
): Promise<PlaybookRuntimeDeclaration | undefined> {
  const owner = await owningPlaybookPackage(linkTarget);
  if (owner === undefined) return undefined;
  const provenance = `${PLAYBOOK_PACKAGE}@${owner.version}`;
  let entry: string;
  try {
    // A package may reference its own `exports` by name (Node self-reference),
    // so the resolution consults exactly the manifest that owns the target.
    entry = createRequire(join(owner.root, 'package.json')).resolve(
      PLAYBOOK_ENGINE_SPECIFIER,
    );
  } catch (error) {
    throw new Error(
      `${provenance} at ${owner.root} does not resolve ${PLAYBOOK_ENGINE_SPECIFIER}: ${messageOf(error)}`,
      { cause: error },
    );
  }
  let engine: Record<string, unknown>;
  try {
    engine = (await import(pathToFileURL(entry).href)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    throw new Error(
      `${provenance} engine ${entry} failed to import: ${messageOf(error)}`,
      { cause: error },
    );
  }
  return {
    provenance,
    packageRoot: owner.root,
    runtimeAbi: engine.RUNTIME_ABI,
    supportedArtifactSchemas: engine.SUPPORTED_ARTIFACT_SCHEMAS,
  };
}

async function owningPlaybookPackage(
  path: string,
): Promise<{ root: string; version: string } | undefined> {
  const absolute = resolve(path);
  let cursor: string;
  try {
    cursor = (await stat(absolute)).isDirectory()
      ? absolute
      : dirname(absolute);
  } catch (error) {
    if (!isAbsentPathError(error)) throw error;
    cursor = dirname(absolute);
  }
  for (;;) {
    const manifestPath = join(cursor, 'package.json');
    let source: string | undefined;
    try {
      source = await readFile(manifestPath, 'utf8');
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
    }
    if (source !== undefined) {
      let manifest: unknown;
      try {
        manifest = JSON.parse(source) as unknown;
      } catch {
        return undefined;
      }
      if (
        typeof manifest !== 'object' ||
        manifest === null ||
        !('name' in manifest) ||
        manifest.name !== PLAYBOOK_PACKAGE ||
        !('version' in manifest) ||
        typeof manifest.version !== 'string' ||
        manifest.version.length === 0
      ) {
        return undefined;
      }
      return { root: cursor, version: manifest.version };
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Resolve a bare package import from the same location as a compiled artifact.
 * The returned root preserves the lexical `node_modules` path (including a root
 * symlink) so pin hashing binds the package Node will actually select.
 */

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { isAbsolute, join, relative, sep } from 'node:path';

export interface ResolvedRuntimePackage {
  root: string;
  version: string;
}

export function resolveRuntimePackage(
  fromFile: string,
  specifier: string,
): ResolvedRuntimePackage {
  const packageName = packageNameFromSpecifier(specifier);
  const requireFromArtifact = createRequire(fromFile);

  // Confirm that Node can load this exact specifier. Package search paths alone
  // do not account for an invalid entry point or a blocked exports subpath.
  const selectedEntry = realpathSync.native(
    requireFromArtifact.resolve(specifier),
  );
  const searchPaths = requireFromArtifact.resolve.paths(packageName);
  if (searchPaths === null) {
    throw new Error(`runtime dependency is not a local package: ${specifier}`);
  }

  for (const searchPath of searchPaths) {
    const root = join(searchPath, packageName);
    const selectedPath = firstExistingPackagePath(root);
    if (selectedPath === undefined) continue;
    if (selectedPath !== root) {
      throw new Error(
        `selected runtime dependency is a file, not a package directory (${selectedPath})`,
      );
    }
    const realRoot = realpathSync.native(root);
    if (!isInside(realRoot, selectedEntry)) {
      throw new Error(
        `runtime dependency does not resolve from the nearest package root (${root})`,
      );
    }

    const manifestPath = join(root, 'package.json');
    let source: string;
    try {
      source = readFileSync(manifestPath, 'utf8');
    } catch (error) {
      if (isAbsent(error)) {
        throw new Error(
          `selected runtime dependency has no package manifest (${root})`,
          { cause: error },
        );
      }
      throw error;
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(source) as unknown;
    } catch (error) {
      throw new Error(
        `runtime dependency package manifest is not JSON (${manifestPath}): ${messageOf(error)}`,
        { cause: error },
      );
    }
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      Array.isArray(manifest) ||
      !('name' in manifest) ||
      manifest.name !== packageName ||
      !('version' in manifest) ||
      typeof manifest.version !== 'string' ||
      manifest.version.length === 0
    ) {
      throw new Error(
        `runtime dependency package manifest has no matching name and version (${manifestPath})`,
      );
    }
    return { root, version: manifest.version };
  }

  throw new Error(
    `runtime dependency package root cannot be located for ${specifier}`,
  );
}

function firstExistingPackagePath(root: string): string | undefined {
  for (const candidate of [
    root,
    `${root}.js`,
    `${root}.json`,
    `${root}.node`,
  ]) {
    try {
      lstatSync(candidate);
      return candidate;
    } catch (error) {
      if (!isAbsent(error)) throw error;
    }
  }
  return undefined;
}

function packageNameFromSpecifier(specifier: string): string {
  if (
    specifier.length === 0 ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('#') ||
    specifier.includes('\\') ||
    specifier.includes('\0') ||
    specifier.includes(':') ||
    isBuiltin(specifier)
  ) {
    throw new Error(`runtime dependency must use a bare package specifier`);
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.length >= 2 && parts[0] !== '@' && parts[1].length > 0
      ? `${parts[0]}/${parts[1]}`
      : ''
    : parts[0];
  if (name.length === 0) {
    throw new Error(`runtime dependency must use a bare package specifier`);
  }
  return name;
}

export function isBarePackageSpecifier(specifier: string): boolean {
  try {
    packageNameFromSpecifier(specifier);
    return true;
  } catch {
    return false;
  }
}

function isInside(root: string, path: string): boolean {
  if (root === path) return true;
  const rel = relative(root, path);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

function isAbsent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

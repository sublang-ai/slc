// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Stable identities for deterministic entry and verification products. */

import { createRequire } from 'node:module';
import { lstat, readFile } from 'node:fs/promises';
import { dirname, extname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from './build-record.js';
import type { DeterministicComponent } from './build-plan.js';
import { hashBytes, hashFile, type Hash } from './hash.js';
import { hashTree } from './pin-currency.js';

const SCHEMA = 'sublang.slc.deterministic-identity.v1';

const ENTRY_MODULES = [
  'deterministic-derivatives',
  'entry-module',
  'hash',
  'verify',
  'verify-coverage',
] as const;

const VERIFICATION_GENERATOR_MODULES = [
  'deterministic-derivatives',
  'hash',
  'verify',
  'verify-coverage',
  'verify-support',
] as const;

const VERIFICATION_CHECKER_MODULES = ['emitted-suite'] as const;

const LOAD_INTEGRITY_CHECKER_MODULES = ['emitted-imports'] as const;

const SUPPORT_FILES = [
  'hash.js',
  'hash.d.ts',
  'verify.js',
  'verify.d.ts',
  'verify-coverage.js',
  'verify-coverage.d.ts',
] as const;

/** @internal Filesystem resolution override for hermetic identity tests. */
export interface DeterministicIdentityOptions {
  moduleRoot?: string;
  moduleExtension?: '.js' | '.ts';
  supportRoot?: string;
  vitestPackagePath?: string;
  generatorXstatePackagePath?: string;
  xstatePackagePath?: string;
}

interface NamedHash {
  name: string;
  hash: Hash;
}

interface ResolvedLayout {
  moduleRoot: string;
  moduleExtension: '.js' | '.ts';
  supportRoot: string;
  vitestPackagePath: string;
  generatorXstatePackagePath: string;
  xstatePackagePath: string;
}

interface RuntimePackageManifest {
  name: string;
  dependencies: string[];
  optionalDependencies: string[];
}

interface RuntimePackageRecord {
  path: string[];
  name: string;
  hash: Hash;
}

/** Exact pre-execution generator/checker descriptors for DR-021 plans. */
export async function deterministicIdentityComponents(
  options: DeterministicIdentityOptions = {},
): Promise<DeterministicComponent[]> {
  const layout = resolveLayout(options);
  const vitestHash = await packageTreeHash(layout.vitestPackagePath);
  const generatorXstateHash = await packageTreeHash(
    layout.generatorXstatePackagePath,
  );
  const checkerXstateHash = await packageTreeHash(layout.xstatePackagePath);
  return [
    await component(
      'generator:entry',
      'generator',
      await moduleHashes(layout, ENTRY_MODULES),
    ),
    await component(
      'generator:verification',
      'generator',
      [
        ...(await moduleHashes(layout, VERIFICATION_GENERATOR_MODULES)),
        ...(await supportHashes(layout.supportRoot)),
      ],
      [{ name: 'xstate', hash: generatorXstateHash }],
    ),
    await component(
      'checker:load-integrity',
      'checker',
      await moduleHashes(layout, LOAD_INTEGRITY_CHECKER_MODULES),
    ),
    await component(
      'checker:verification',
      'checker',
      [
        ...(await moduleHashes(layout, VERIFICATION_CHECKER_MODULES)),
        ...(await supportHashes(layout.supportRoot)),
      ],
      [
        { name: 'vitest', hash: vitestHash },
        { name: 'xstate', hash: checkerXstateHash },
      ],
    ),
  ];
}

async function component(
  id: DeterministicComponent['id'],
  kind: DeterministicComponent['kind'],
  dependencies: NamedHash[],
  runtime: readonly NamedHash[] = [],
): Promise<DeterministicComponent> {
  dependencies.sort((left, right) => compareUtf8(left.name, right.name));
  return {
    id,
    kind,
    source: {
      kind: 'value',
      value: canonicalJson({ schema: SCHEMA, id, dependencies, runtime }),
    },
  };
}

async function moduleHashes(
  layout: ResolvedLayout,
  names: readonly string[],
): Promise<NamedHash[]> {
  return Promise.all(
    names.map(async (name) => ({
      name: `module:${name}`,
      hash: await hashFile(
        join(layout.moduleRoot, `${name}${layout.moduleExtension}`),
      ),
    })),
  );
}

async function supportHashes(supportRoot: string): Promise<NamedHash[]> {
  return Promise.all(
    SUPPORT_FILES.map(async (file) => {
      const content = await readFile(join(supportRoot, file), 'utf8');
      return {
        name: `support:${file}`,
        hash: hashBytes(
          new TextEncoder().encode(withoutSourceMapReference(content)),
        ),
      };
    }),
  );
}

function resolveLayout(options: DeterministicIdentityOptions): ResolvedLayout {
  const selfPath = fileURLToPath(import.meta.url);
  const selfDir = dirname(selfPath);
  const installed = extname(selfPath) === '.js';
  const moduleRoot = resolve(options.moduleRoot ?? selfDir);
  const moduleExtension =
    options.moduleExtension ?? (installed ? '.js' : '.ts');
  return {
    moduleRoot,
    moduleExtension,
    supportRoot: resolve(
      options.supportRoot ??
        (installed ? moduleRoot : join(selfDir, '../dist')),
    ),
    vitestPackagePath: resolve(
      options.vitestPackagePath ??
        createRequire(import.meta.url).resolve('vitest/package.json'),
    ),
    generatorXstatePackagePath: resolve(
      options.generatorXstatePackagePath ??
        createRequire(import.meta.url).resolve('xstate/package.json'),
    ),
    xstatePackagePath: resolve(
      options.xstatePackagePath ??
        createRequire(import.meta.url).resolve('xstate/package.json'),
    ),
  };
}

async function packageTreeHash(packagePath: string): Promise<Hash> {
  const records: RuntimePackageRecord[] = [];
  const visited = new Set<string>();
  await collectRuntimePackage(resolve(packagePath), [], records, visited);
  records.sort((left, right) =>
    compareUtf8(canonicalJson(left.path), canonicalJson(right.path)),
  );
  return hashBytes(
    new TextEncoder().encode(
      canonicalJson({
        schema: 'sublang.slc.runtime-package-closure.v1',
        packages: records,
      }),
    ),
  );
}

async function collectRuntimePackage(
  packagePath: string,
  logicalPath: string[],
  records: RuntimePackageRecord[],
  visited: Set<string>,
): Promise<void> {
  const root = dirname(packagePath);
  if (visited.has(root)) return;
  visited.add(root);

  const manifest = await readRuntimePackageManifest(packagePath);
  const path = logicalPath.length === 0 ? [manifest.name] : logicalPath;
  records.push({
    path,
    name: manifest.name,
    hash: (await hashTree(root, { rejectSymlinks: true })) as Hash,
  });

  const optional = new Set(manifest.optionalDependencies);
  const dependencies = [...manifest.dependencies, ...optional].sort(
    compareUtf8,
  );
  for (const dependency of dependencies) {
    const resolved = await resolveInstalledPackage(root, dependency);
    if (resolved === null) {
      if (optional.has(dependency)) continue;
      throw new Error(
        `deterministic runtime package dependency is missing: ${[...path, dependency].join(' > ')}`,
      );
    }
    await collectRuntimePackage(
      resolved,
      [...path, dependency],
      records,
      visited,
    );
  }
}

async function readRuntimePackageManifest(
  packagePath: string,
): Promise<RuntimePackageManifest> {
  const value: unknown = JSON.parse(await readFile(packagePath, 'utf8'));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('name' in value) ||
    typeof value.name !== 'string' ||
    value.name.length === 0
  ) {
    throw new Error('deterministic runtime package has no name');
  }
  return {
    name: value.name,
    dependencies: dependencyNames(value, 'dependencies'),
    optionalDependencies: dependencyNames(value, 'optionalDependencies'),
  };
}

function dependencyNames(
  manifest: object,
  field: 'dependencies' | 'optionalDependencies',
): string[] {
  if (!(field in manifest)) return [];
  const value = (manifest as Record<string, unknown>)[field];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`deterministic runtime package ${field} is malformed`);
  }
  const names = Object.keys(value);
  for (const name of names) packageSegments(name);
  return names;
}

async function resolveInstalledPackage(
  fromRoot: string,
  dependency: string,
): Promise<string | null> {
  const segments = packageSegments(dependency);
  let current = fromRoot;
  while (true) {
    const candidate = join(
      current,
      'node_modules',
      ...segments,
      'package.json',
    );
    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error(
          `deterministic runtime package manifest is not a regular file: ${dependency}`,
        );
      }
      return candidate;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return null;
    current = parent;
  }
}

function packageSegments(name: string): string[] {
  if (
    name.length === 0 ||
    name.includes('\\') ||
    name.includes('\0') ||
    name === '.' ||
    name === '..'
  ) {
    throw new Error(`invalid deterministic runtime package name: ${name}`);
  }
  const segments = name.split('/');
  if (
    (name.startsWith('@') &&
      (segments.length !== 2 ||
        segments[0].length < 2 ||
        segments[1].length === 0)) ||
    (!name.startsWith('@') && segments.length !== 1) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`invalid deterministic runtime package name: ${name}`);
  }
  return segments;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

function withoutSourceMapReference(content: string): string {
  return content.replace(/\n\/\/# sourceMappingURL=[^\n]+\n?$/u, '\n');
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Production host identities for canonical build plans (DR-021; INCR-7). */

import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { delimiter, dirname, join, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AGENT_RUNTIME_TARGETS } from '@sublang/cligent/runtime-targets';
import {
  RUNTIME_ABI,
  SUPPORTED_ARTIFACT_SCHEMAS,
} from '@sublang/playbook/xstate-runtime';

import {
  canonicalJson,
  resolveReadLocator,
  type PackageRecord,
} from './build-record.js';
import type { BuildIdentityContext, FullBuildTopology } from './build-plan.js';
import type { AgentSelection } from './config.js';
import { runtimeContractForPin } from './config.js';
import { compareUtf8, hashBytes, hashFile, type Hash } from './hash.js';
import { hashTree } from './pin-currency.js';
import type { BuildIdentityProvider } from './runner.js';

const HOST_IDENTITY_SCHEMA = 'sublang.slc.host-executor.v1';
const PACKAGE_CLOSURE_SCHEMA = 'sublang.slc.host-package-closure.v1';
const moduleRoot = dirname(fileURLToPath(import.meta.url));
const packageManifest = resolve(moduleRoot, '../package.json');

const AGENT_RUNTIME_PACKAGES = {
  'claude-code': '@anthropic-ai/claude-agent-sdk',
  codex: '@openai/codex-sdk',
  gemini: null,
  opencode: '@opencode-ai/sdk',
} as const satisfies Record<AgentSelection['agent'], string | null>;

interface RuntimePackageManifest {
  name: string;
  version: string | null;
  dependencies: string[];
  optionalDependencies: string[];
  peerDependencies: string[];
  optionalPeerDependencies: string[];
}

interface RuntimePackageRecord {
  path: string[];
  name: string;
  hash: Hash;
}

interface AgentCliIdentity {
  command: string;
  package: string;
  kind: 'package-tree' | 'executable';
  identity: Hash;
}

/** @internal Filesystem overrides for hermetic identity tests. */
export interface BuildIdentityLayout {
  runtimeRoot?: string;
  slcPackagePath?: string;
  cligentPackagePath?: string;
  typescriptPackagePath?: string;
  agentRuntimePackagePath?: string | null;
  /** Exact executable override for hermetic CLI-backed adapter tests. */
  agentCliPath?: string;
  /** Exact Node executable override for hermetic identity tests. */
  nodeExecutablePath?: string;
}

export interface BuildIdentityOptions {
  selection: AgentSelection;
  stallTimeoutMs: number;
  layout?: BuildIdentityLayout;
}

/**
 * Creates the production identity provider captured beside its executors.
 *
 * The returned canonical values contain exact hashes of SLC's executing
 * source/dist tree and each selected runtime package closure. Versions remain
 * provenance only; no function source or package version stands in for bytes.
 */
export function createBuildIdentityProvider(
  options: BuildIdentityOptions,
): BuildIdentityProvider {
  const layout = resolveLayout(options);
  return async (topology) => {
    const [executors, packages] = await Promise.all([
      hostExecutorIdentities(options, layout),
      packageProvenance(topology, layout),
    ]);
    return {
      interpretedExecutor: { kind: 'value', value: executors.interpreted },
      compiledExecutor: { kind: 'value', value: executors.compiled },
      compiledProfile: runtimeContractForPin,
      packages,
      compatibility: playbookCompatibility(topology),
    } satisfies BuildIdentityContext;
  };
}

interface ResolvedLayout {
  runtimeRoot: string;
  slcPackagePath: string;
  cligentPackagePath: string;
  typescriptPackagePath: string;
  agentRuntimePackagePath: string | null;
  agentCliPath?: string;
  nodeExecutablePath: string;
}

function resolveLayout(options: BuildIdentityOptions): ResolvedLayout {
  const overrides = options.layout ?? {};
  const defaultAgentRuntime = resolveOptionalAgentRuntime(
    options.selection.agent,
  );
  return {
    runtimeRoot: resolve(overrides.runtimeRoot ?? moduleRoot),
    slcPackagePath: resolve(overrides.slcPackagePath ?? packageManifest),
    cligentPackagePath: resolve(
      overrides.cligentPackagePath ??
        resolvePackageManifest('@sublang/cligent', '@sublang/cligent'),
    ),
    typescriptPackagePath: resolve(
      overrides.typescriptPackagePath ??
        resolvePackageManifest('typescript', 'typescript'),
    ),
    agentRuntimePackagePath:
      overrides.agentRuntimePackagePath === null
        ? null
        : overrides.agentRuntimePackagePath !== undefined
          ? resolve(overrides.agentRuntimePackagePath)
          : defaultAgentRuntime === null
            ? null
            : resolve(defaultAgentRuntime),
    ...(overrides.agentCliPath === undefined
      ? {}
      : { agentCliPath: resolve(overrides.agentCliPath) }),
    nodeExecutablePath: resolve(
      overrides.nodeExecutablePath ?? process.execPath,
    ),
  };
}

async function hostExecutorIdentities(
  options: BuildIdentityOptions,
  layout: ResolvedLayout,
): Promise<{ interpreted: string; compiled: string }> {
  const [slc, cligent, agentRuntime, agentCli, node, typescript] =
    await Promise.all([
      exactTreeHash(layout.runtimeRoot),
      runtimePackageClosureHash(layout.cligentPackagePath),
      layout.agentRuntimePackagePath === null
        ? Promise.resolve(null)
        : runtimePackageClosureHash(layout.agentRuntimePackagePath),
      selectedAgentCliIdentity(options.selection.agent, layout.agentCliPath),
      executableHash(layout.nodeExecutablePath, 'node'),
      runtimePackageClosureHash(layout.typescriptPackagePath),
    ]);
  const common = {
    slc,
    cligent,
    agentRuntime,
    agentCli,
    node: { identity: node, platform: process.platform, arch: process.arch },
  };
  return {
    interpreted: hostExecutorValue('interpreted', options, {
      ...common,
      typescript: null,
    }),
    compiled: hostExecutorValue('compiled', options, {
      ...common,
      typescript,
    }),
  };
}

function hostExecutorValue(
  kind: 'interpreted' | 'compiled',
  options: BuildIdentityOptions,
  implementation: {
    slc: Hash;
    cligent: Hash;
    agentRuntime: Hash | null;
    agentCli: AgentCliIdentity | null;
    node: { identity: Hash; platform: NodeJS.Platform; arch: string };
    typescript: Hash | null;
  },
): string {
  return canonicalJson({
    schema: HOST_IDENTITY_SCHEMA,
    kind,
    implementation,
    configuration: {
      agent: options.selection.agent,
      model: options.selection.model ?? null,
      effort: options.selection.effort ?? null,
      permissions: { mode: 'auto' },
      maxTurns: null,
      stallTimeoutMs: options.stallTimeoutMs,
    },
  });
}

async function selectedAgentCliIdentity(
  agent: AgentSelection['agent'],
  override: string | undefined,
): Promise<AgentCliIdentity | null> {
  const runtimeName = agent === 'claude-code' ? 'claude' : agent;
  const targets = AGENT_RUNTIME_TARGETS[runtimeName].filter(
    (target) => target.kind === 'cli',
  );
  if (targets.length === 0) return null;
  if (targets.length !== 1) {
    throw new Error(`selected agent ${agent} has ambiguous CLI runtimes`);
  }
  const target = targets[0];
  const command = target.command;
  if (
    command === undefined ||
    command.length === 0 ||
    command.includes('/') ||
    command.includes('\\') ||
    command.includes(sep)
  ) {
    throw new Error(`selected agent ${agent} has an invalid CLI command`);
  }
  const selectedPath = override ?? resolveCommandOnPath(command);
  const executable = await executablePath(selectedPath, command);
  const manifest = findOwningManifest(dirname(executable), target.package);
  if (manifest !== null) {
    return {
      command,
      package: target.package,
      kind: 'package-tree',
      identity: await runtimePackageClosureHash(manifest),
    };
  }
  return {
    command,
    package: target.package,
    kind: 'executable',
    identity: await hashFile(executable),
  };
}

async function executableHash(path: string, label: string): Promise<Hash> {
  return hashFile(await executablePath(path, label));
}

async function executablePath(path: string, label: string): Promise<string> {
  try {
    accessSync(path, constants.X_OK);
  } catch {
    throw new Error(`host runtime executable is not executable: ${label}`);
  }
  const executable = await realpath(path);
  const info = await lstat(executable);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`host runtime executable is not a regular file: ${label}`);
  }
  return executable;
}

function resolveCommandOnPath(command: string): string {
  const search = process.env.PATH;
  if (search === undefined) {
    throw new Error(
      `selected agent runtime executable is missing from PATH: ${command}`,
    );
  }
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
          .split(delimiter)
          .filter((extension) => extension.length > 0)
      : [''];
  for (const entry of search.split(delimiter)) {
    const directory = resolve(entry === '' ? '.' : entry);
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Continue exactly as PATH lookup does when this entry is unusable.
      }
    }
  }
  throw new Error(
    `selected agent runtime executable is missing from PATH: ${command}`,
  );
}

async function packageProvenance(
  topology: FullBuildTopology,
  layout: ResolvedLayout,
): Promise<PackageRecord[]> {
  const slc = await readPackage(layout.slcPackagePath, '@sublang/slc');
  const pipeline = await packageForPath(
    topology.pipeline.dir,
    topology.pipelineName,
  );
  const packages: PackageRecord[] = [
    { role: 'slc', name: slc.name, version: slc.version },
    { role: 'pipeline', name: pipeline.name, version: pipeline.version },
  ];
  if (topology.invocation.kind === 'full-link') {
    const link = topology.invocation.link;
    if (link === null) throw new Error('full-link topology has no link record');
    const runtime = await packageForPath(
      resolveReadLocator(topology.artifactDir, link.target),
      topology.pipelineName,
    );
    packages.push({
      role: 'link-runtime',
      name: runtime.name,
      version: runtime.version,
    });
  }
  return packages;
}

function playbookCompatibility(
  topology: FullBuildTopology,
): NonNullable<BuildIdentityContext['compatibility']> {
  if (topology.pipelineName !== 'playbook') return [];
  const artifactSchema = Math.max(...SUPPORTED_ARTIFACT_SCHEMAS);
  if (!Number.isSafeInteger(artifactSchema) || artifactSchema < 1) {
    throw new Error('Playbook reports no supported artifact schema');
  }
  return [
    {
      name: 'playbook-artifact-schema',
      value: String(artifactSchema),
      currentness: 'gate',
    },
    {
      name: 'playbook-runtime-abi',
      value: String(RUNTIME_ABI),
      currentness: 'gate',
    },
  ];
}

async function exactTreeHash(path: string): Promise<Hash> {
  return (await hashTree(path, { rejectSymlinks: true })) as Hash;
}

async function runtimePackageClosureHash(packagePath: string): Promise<Hash> {
  const records: RuntimePackageRecord[] = [];
  const visited = new Set<string>();
  await collectRuntimePackage(resolve(packagePath), [], records, visited);
  records.sort((left, right) =>
    compareUtf8(canonicalJson(left.path), canonicalJson(right.path)),
  );
  return hashBytes(
    new TextEncoder().encode(
      canonicalJson({ schema: PACKAGE_CLOSURE_SCHEMA, packages: records }),
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
  records.push({ path, name: manifest.name, hash: await exactTreeHash(root) });

  const optional = new Set([
    ...manifest.optionalDependencies,
    ...manifest.optionalPeerDependencies,
  ]);
  const dependencies = [
    ...new Set([
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalPeerDependencies,
    ]),
  ].sort(compareUtf8);
  for (const dependency of dependencies) {
    const resolved = await resolveInstalledPackage(root, dependency);
    if (resolved === null) {
      if (optional.has(dependency)) continue;
      throw new Error(
        `host runtime dependency is missing: ${[...path, dependency].join(' > ')}`,
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
  path: string,
): Promise<RuntimePackageManifest> {
  const parsed = parsePackageManifest(await readFile(path, 'utf8'), path);
  const peerDependencies = dependencyNames(
    parsed.raw,
    'peerDependencies',
    path,
  );
  return {
    ...parsed,
    dependencies: dependencyNames(parsed.raw, 'dependencies', path),
    optionalDependencies: dependencyNames(
      parsed.raw,
      'optionalDependencies',
      path,
    ),
    peerDependencies,
    optionalPeerDependencies: optionalPeerDependencyNames(
      parsed.raw,
      peerDependencies,
      path,
    ),
  };
}

function dependencyNames(
  manifest: Record<string, unknown>,
  field: 'dependencies' | 'optionalDependencies' | 'peerDependencies',
  path: string,
): string[] {
  const value = manifest[field];
  if (value === undefined) return [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} ${field} is malformed`);
  }
  const names = Object.keys(value);
  for (const name of names) packageSegments(name);
  return names;
}

function optionalPeerDependencyNames(
  manifest: Record<string, unknown>,
  peerDependencies: readonly string[],
  path: string,
): string[] {
  const value = manifest.peerDependenciesMeta;
  if (value === undefined) return [];
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} peerDependenciesMeta is malformed`);
  }
  const peers = new Set(peerDependencies);
  const optional: string[] = [];
  for (const [name, metadata] of Object.entries(value)) {
    packageSegments(name);
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata)
    ) {
      throw new Error(`${path} peerDependenciesMeta.${name} is malformed`);
    }
    const fields = metadata as Record<string, unknown>;
    if (
      Object.keys(fields).some((field) => field !== 'optional') ||
      ('optional' in fields && typeof fields.optional !== 'boolean')
    ) {
      throw new Error(`${path} peerDependenciesMeta.${name} is malformed`);
    }
    if (fields.optional === true) {
      optional.push(name);
    } else if (!peers.has(name)) {
      throw new Error(
        `${path} peerDependenciesMeta names undeclared non-optional peer dependency ${name}`,
      );
    }
  }
  return optional;
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
          `host runtime package manifest is not a regular file: ${dependency}`,
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

function resolveOptionalAgentRuntime(
  agent: AgentSelection['agent'],
): string | null {
  const packageName = AGENT_RUNTIME_PACKAGES[agent];
  if (packageName === null) return null;
  try {
    return resolvePackageManifest(packageName, packageName);
  } catch {
    return null;
  }
}

function resolvePackageManifest(specifier: string, name: string): string {
  try {
    const entry = fileURLToPath(import.meta.resolve(specifier));
    const located = findOwningManifest(dirname(entry), name);
    if (located !== null) return located;
  } catch {
    // Some packages expose only subpaths. Fall back to Node's package search.
  }
  const segments = packageSegments(name);
  let current = moduleRoot;
  while (true) {
    const candidate = join(
      current,
      'node_modules',
      ...segments,
      'package.json',
    );
    if (manifestHasName(candidate, name)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`cannot locate package manifest for ${name}`);
}

function findOwningManifest(start: string, name: string): string | null {
  let current = start;
  while (true) {
    const candidate = join(current, 'package.json');
    if (manifestHasName(candidate, name)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function manifestHasName(path: string, name: string): boolean {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'name' in parsed &&
      parsed.name === name
    );
  } catch {
    return false;
  }
}

async function packageForPath(
  path: string,
  fallbackName: string,
): Promise<{ name: string; version: string | null }> {
  let current = resolve(path);
  try {
    if ((await lstat(current)).isFile()) current = dirname(current);
  } catch {
    current = dirname(current);
  }
  while (true) {
    const candidate = join(current, 'package.json');
    try {
      return await readPackage(candidate, fallbackName);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const parent = dirname(current);
    if (parent === current) return { name: fallbackName, version: null };
    current = parent;
  }
}

async function readPackage(
  path: string,
  fallbackName: string,
): Promise<{ name: string; version: string | null }> {
  const parsed = parsePackageManifest(await readFile(path, 'utf8'), path);
  return {
    name: parsed.name.length === 0 ? fallbackName : parsed.name,
    version: parsed.version,
  };
}

function parsePackageManifest(
  source: string,
  path: string,
): {
  name: string;
  version: string | null;
  raw: Record<string, unknown>;
} {
  const value: unknown = JSON.parse(source);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} is not a package manifest object`);
  }
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name : '';
  const version = typeof raw.version === 'string' ? raw.version : null;
  return { name, version, raw };
}

function packageSegments(name: string): string[] {
  if (name.startsWith('@')) {
    const segments = name.split('/');
    if (segments.length === 2 && segments.every((entry) => entry.length > 0)) {
      return segments;
    }
  } else if (name.length > 0 && !name.includes('/')) {
    return [name];
  }
  throw new Error(`invalid runtime package name: ${name}`);
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

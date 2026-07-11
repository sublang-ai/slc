// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Pin-currency engine: the per-phase verdict that drives compiled selection
 * (PIN-1..PIN-6, PIN-13; DR-007).
 *
 * Given a pipeline directory, {@link evaluatePins} loads `slc.pins.json` and, for
 * each pinned phase, combines the validator stages into a verdict: `current` when
 * every recorded input matches, `stale` (naming the changed input) when a hash or
 * the semantic-input closure no longer matches, and `malformed` (naming the
 * field) when a recorded hash, path, external input, or link-target identity is
 * structurally invalid or the pin file itself is unparseable. An absent
 * `slc.pins.json` yields no verdicts — every phase is unpinned. Validation is
 * deterministic and reads only committed bytes; it issues no network request. A
 * file link target is verified by exact-byte hash and a directory or package
 * target by a deterministic `sha256:` tree hash over its files' sorted relative
 * paths and contents. Beyond existing and matching its recorded hash, the
 * compiled artifact must resolve to the linked `playbook` format — a module
 * exposing the runtime factory — or the phase is stale (PIN-13). See
 * specs/dev/pinning.md.
 */

import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { hashBytes, hashFile, isHash } from './hash.js';
import { resolvesToPlaybook } from './phase-runner.js';
import { closureMatchesRecord } from './pin-closure.js';
import { resolvePinPath } from './pin-paths.js';
import {
  PinError,
  loadPinFile,
  type PinExternalInput,
  type PinFile,
  type PinFileRef,
  type PinLinkTarget,
  type PinRecord,
  type PinRuntimeDependency,
} from './pins.js';
import {
  isBarePackageSpecifier,
  resolveRuntimePackage,
} from './runtime-package.js';

/** A per-phase pin-currency verdict (DR-007). */
export type PinVerdict =
  | { status: 'current' }
  | { status: 'stale'; reason: string }
  | { status: 'malformed'; reason: string };

/** The result of evaluating a pipeline directory's pins (DR-007). */
export interface PinsResult {
  /** Resolved `slc.pins.json` path; `undefined` when absent (every phase unpinned). */
  path?: string;
  /** Per-phase verdicts keyed by phase name; `undefined` when the file is absent. */
  verdicts?: Record<string, PinVerdict>;
  /** File-level malformed diagnostic (unparseable or invalid file); when set, no phase is current. */
  malformed?: string;
}

/**
 * Evaluates every pin in `<pipelineDir>/slc.pins.json` (PIN-1..PIN-6).
 *
 * @returns `{}` when the file is absent (no pins), `{ malformed }` when the file
 *   is unparseable or invalid at the file level, or `{ path, verdicts }` with a
 *   per-phase verdict otherwise.
 */
export async function evaluatePins(pipelineDir: string): Promise<PinsResult> {
  let loaded;
  try {
    loaded = await loadPinFile(pipelineDir);
  } catch (error) {
    if (error instanceof PinError) {
      return { malformed: error.message };
    }
    throw error;
  }

  if (loaded.file === undefined) {
    return {};
  }

  const verdicts = await evaluatePinFile(pipelineDir, loaded.file);
  return { path: loaded.path, verdicts };
}

/** Evaluates every record and prevents one malformed record from coexisting with a current one. */
export async function evaluatePinFile(
  pipelineDir: string,
  file: PinFile,
): Promise<Record<string, PinVerdict>> {
  const verdicts: Record<string, PinVerdict> = {};
  for (const [phase, record] of Object.entries(file.pins)) {
    verdicts[phase] = await evaluatePin(pipelineDir, file, phase, record);
  }
  const malformedPhase = Object.entries(verdicts).find(
    ([, verdict]) => verdict.status === 'malformed',
  );
  if (malformedPhase !== undefined) {
    const [phase, verdict] = malformedPhase as [
      string,
      Extract<PinVerdict, { status: 'malformed' }>,
    ];
    const reason = `pin index contains malformed phase "${phase}": ${verdict.reason}`;
    for (const [name, candidate] of Object.entries(verdicts)) {
      if (candidate.status === 'current') {
        verdicts[name] = malformed(reason);
      }
    }
  }
  return verdicts;
}

/**
 * Evaluates one phase's pin record against the committed files (PIN-2..PIN-6,
 * PIN-13).
 *
 * Structural defects are reported as `malformed` before currency is judged, so a
 * record that is both malformed and stale reports `malformed`.
 */
export async function evaluatePin(
  pipelineDir: string,
  file: PinFile,
  phase: string,
  record: PinRecord,
): Promise<PinVerdict> {
  const boundary = file.pathBoundary.path;
  try {
    // Structural (malformed) checks first.
    for (const [field, ref] of recordedFileRefs(record)) {
      if (!isHash(ref.hash)) {
        return malformed(`${field} hash is not a sha256 hash`);
      }
    }
    if (!isHash(record.artifactBundle.hash)) {
      return malformed('artifactBundle hash is not a sha256 hash');
    }
    const phaseMalformed = phaseRecordMalformed(phase, record);
    if (phaseMalformed !== null) {
      return malformed(phaseMalformed);
    }
    const linkMalformed = linkTargetMalformed(record.linkTarget);
    if (linkMalformed !== null) {
      return malformed(linkMalformed);
    }
    const externalMalformed = externalInputsMalformed(record.externalInputs);
    if (externalMalformed !== null) {
      return malformed(externalMalformed);
    }
    for (let index = 0; index < record.runtimeDependencies.length; index++) {
      const dependencyMalformed = runtimeDependencyMalformed(
        record.runtimeDependencies[index],
        `runtimeDependencies[${index}]`,
      );
      if (dependencyMalformed !== null) return malformed(dependencyMalformed);
    }
    const bundleMalformed = artifactBundleMalformed(
      pipelineDir,
      boundary,
      record,
    );
    if (bundleMalformed !== null) {
      return malformed(bundleMalformed);
    }

    // Currency (stale) checks. resolvePinPath throws PinError for a bad path,
    // which the catch below maps to malformed (PIN-5).
    for (const [field, ref] of recordedFileRefs(record)) {
      const reason = await fileStale(pipelineDir, boundary, ref, field);
      if (reason !== null) {
        return stale(reason);
      }
    }
    const bundleReason = await treeStale(
      pipelineDir,
      boundary,
      record.artifactBundle,
      'artifactBundle',
    );
    if (bundleReason !== null) {
      return stale(bundleReason);
    }
    const bundleLayout = await artifactBundleLayoutIssue(
      resolvePinPath(
        pipelineDir,
        boundary,
        record.artifactBundle.path,
        'artifactBundle',
      ),
      resolvePinPath(pipelineDir, boundary, record.artifact.path, 'artifact'),
    );
    if (bundleLayout !== null) {
      return stale(bundleLayout);
    }
    // The hash-verified artifact must resolve to the linked `phase` format (PIN-13).
    const artifactFormat = await artifactFormatStale(
      pipelineDir,
      boundary,
      record.artifact,
    );
    if (artifactFormat !== null) {
      return stale(artifactFormat);
    }
    if (!(await closureMatchesRecord(pipelineDir, boundary, record))) {
      return stale(
        "the semantic-input closure differs from the definition's ## Pin Inputs",
      );
    }
    const linkStale = await linkTargetStale(
      pipelineDir,
      boundary,
      record.linkTarget,
    );
    if (linkStale !== null) {
      return stale(linkStale);
    }
    for (let index = 0; index < record.runtimeDependencies.length; index++) {
      const resolutionStale = runtimeDependencyResolutionStale(
        pipelineDir,
        boundary,
        record.artifact,
        record.runtimeDependencies[index],
        `runtimeDependencies[${index}]`,
      );
      if (resolutionStale !== null) return stale(resolutionStale);
      const dependencyStale = await linkTargetStale(
        pipelineDir,
        boundary,
        record.runtimeDependencies[index],
        `runtimeDependencies[${index}]`,
      );
      if (dependencyStale !== null) return stale(dependencyStale);
    }

    return { status: 'current' };
  } catch (error) {
    if (error instanceof PinError) {
      return malformed(error.message);
    }
    throw error;
  }
}

function phaseRecordMalformed(phase: string, record: PinRecord): string | null {
  const expectedDefinition = `${phase}.md`;
  const expectedBundle = `${phase}.slc`;
  const expectedArtifact = `${expectedBundle}/${phase}.playbook.ts`;
  if (record.definition.path !== expectedDefinition) {
    return `pin key "${phase}" requires definition path "${expectedDefinition}"`;
  }
  if (record.artifactBundle.path !== expectedBundle) {
    return `pin key "${phase}" requires artifactBundle path "${expectedBundle}"`;
  }
  if (record.artifact.path !== expectedArtifact) {
    return `pin key "${phase}" requires artifact path "${expectedArtifact}"`;
  }
  return null;
}

function* recordedFileRefs(record: PinRecord): Generator<[string, PinFileRef]> {
  yield ['definition', record.definition];
  yield ['artifact', record.artifact];
  for (const input of record.semanticInputs) {
    yield [`semanticInput ${input.path}`, input];
  }
}

async function fileStale(
  pipelineDir: string,
  boundary: string,
  ref: PinFileRef,
  field: string,
): Promise<string | null> {
  const resolved = resolvePinPath(pipelineDir, boundary, ref.path, field);
  const current = await hashFileOrNull(resolved);
  if (current === null) {
    return `${field} is missing or unreadable (${ref.path})`;
  }
  if (current !== ref.hash) {
    return `${field} changed (${ref.path})`;
  }
  return null;
}

async function treeStale(
  pipelineDir: string,
  boundary: string,
  ref: PinFileRef,
  field: string,
): Promise<string | null> {
  const resolved = resolvePinPath(pipelineDir, boundary, ref.path, field);
  let current: string;
  try {
    current = await hashTree(resolved, { rejectSymlinks: true });
  } catch {
    return `${field} is missing, unreadable, or contains an unsupported entry (${ref.path})`;
  }
  if (current !== ref.hash) {
    return `${field} changed (${ref.path})`;
  }
  return null;
}

function artifactBundleMalformed(
  pipelineDir: string,
  boundary: string,
  record: PinRecord,
): string | null {
  const artifact = resolvePinPath(
    pipelineDir,
    boundary,
    record.artifact.path,
    'artifact',
  );
  const bundle = resolvePinPath(
    pipelineDir,
    boundary,
    record.artifactBundle.path,
    'artifactBundle',
  );
  const rel = relative(bundle, artifact);
  return rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel) &&
    dirname(rel) === '.'
    ? null
    : 'artifact must be a direct child of artifactBundle';
}

/**
 * Checks the canonical reviewed bundle layout beside a linked playbook entry.
 * The tree hash binds every byte; these required siblings ensure that the tree
 * being reviewed is actually the runnable FSM/GEARS/verification bundle.
 */
export async function artifactBundleLayoutIssue(
  bundleRoot: string,
  artifactPath: string,
): Promise<string | null> {
  const entry = basename(artifactPath);
  if (!entry.endsWith('.playbook.ts')) {
    return `artifact is not a canonical .playbook.ts entry module (${entry})`;
  }
  const base = entry.slice(0, -'.playbook.ts'.length);
  const required = [
    `${base}.fsm.ts`,
    `${base}.gears.md`,
    `${base}.gears-fsm.test.ts`,
    `${base}.fsm.introspect.test.ts`,
    `${base}.prompt-contract.test.ts`,
    `${base}.fsm.coverage.test.ts`,
  ];
  for (const sibling of required) {
    try {
      const info = await lstat(join(bundleRoot, sibling));
      if (!info.isFile() || info.isSymbolicLink()) {
        return `artifactBundle required sibling is not a regular file (${sibling})`;
      }
    } catch {
      return `artifactBundle is missing required sibling (${sibling})`;
    }
  }
  return null;
}

/**
 * Returns a stale reason when the compiled artifact's bytes do not resolve to the
 * linked `playbook` format, or `null` when they do (PIN-13). The caller has already
 * verified the artifact exists and matches its recorded hash.
 */
async function artifactFormatStale(
  pipelineDir: string,
  boundary: string,
  artifact: PinFileRef,
): Promise<string | null> {
  const resolved = resolvePinPath(
    pipelineDir,
    boundary,
    artifact.path,
    'artifact',
  );
  let source: string;
  try {
    source = await readFile(resolved, 'utf8');
  } catch {
    return `artifact is unreadable (${artifact.path})`;
  }
  if (!resolved.endsWith('.playbook.ts')) {
    return `artifact is not a linked playbook .playbook.ts entry module (${artifact.path})`;
  }
  if (!resolvesToPlaybook(source)) {
    return `artifact does not resolve to the linked playbook format (${artifact.path})`;
  }
  return null;
}

function linkTargetMalformed(
  linkTarget: PinLinkTarget,
  field = 'linkTarget',
): string | null {
  // The validator's link-target identity is a sha256 content hash (file) or
  // sha256 tree hash (directory/package), so it must be `sha256:<hex>`.
  if (!isHash(linkTarget.identity)) {
    return `${field}.identity is not a sha256 hash`;
  }
  return null;
}

function runtimeDependencyMalformed(
  dependency: PinRuntimeDependency,
  field: string,
): string | null {
  const targetMalformed = linkTargetMalformed(dependency, field);
  if (targetMalformed !== null) return targetMalformed;
  if (
    dependency.kind === 'package' &&
    (typeof dependency.specifier !== 'string' ||
      !isBarePackageSpecifier(dependency.specifier))
  ) {
    return `${field}.specifier must be a bare package specifier`;
  }
  if (dependency.kind !== 'package' && dependency.specifier !== undefined) {
    return `${field}.specifier is only valid for a package dependency`;
  }
  return null;
}

function runtimeDependencyResolutionStale(
  pipelineDir: string,
  boundary: string,
  artifact: PinFileRef,
  dependency: PinRuntimeDependency,
  field: string,
): string | null {
  if (dependency.kind !== 'package' || dependency.specifier === undefined) {
    return null;
  }
  const artifactPath = resolvePinPath(
    pipelineDir,
    boundary,
    artifact.path,
    'artifact',
  );
  const recordedRoot = resolvePinPath(
    pipelineDir,
    boundary,
    dependency.locator,
    `${field}.locator`,
  );
  let selectedRoot: string;
  try {
    selectedRoot = resolveRuntimePackage(
      artifactPath,
      dependency.specifier,
    ).root;
  } catch {
    return `${field} import no longer resolves (${dependency.specifier})`;
  }
  return resolve(selectedRoot) === resolve(recordedRoot)
    ? null
    : `${field} resolution changed (${dependency.specifier})`;
}

async function linkTargetStale(
  pipelineDir: string,
  boundary: string,
  linkTarget: PinLinkTarget,
  field = 'linkTarget',
): Promise<string | null> {
  const resolved = resolvePinPath(
    pipelineDir,
    boundary,
    linkTarget.locator,
    `${field}.locator`,
  );
  const current =
    linkTarget.kind === 'file'
      ? await hashFileOrNull(resolved)
      : await hashTreeOrNull(resolved);
  if (current === null) {
    return `${field} is missing or unreadable (${linkTarget.locator})`;
  }
  if (current !== linkTarget.identity) {
    return `${field} changed (${linkTarget.locator})`;
  }
  return null;
}

function externalInputsMalformed(
  externalInputs: PinExternalInput[],
): string | null {
  for (let index = 0; index < externalInputs.length; index++) {
    const identity = externalInputs[index].identity;
    // A well-formed immutable content-addressed identity is the validator's own
    // sha256:<hex> form; broader digest schemes await a future DR (DR-007).
    if (typeof identity !== 'string' || !isHash(identity)) {
      return `externalInputs[${index}] must carry a well-formed immutable content-addressed identity (sha256:<hex>), not a mutable reference`;
    }
  }
  return null;
}

async function hashFileOrNull(resolved: string): Promise<string | null> {
  try {
    return await hashFile(resolved);
  } catch {
    return null;
  }
}

/**
 * Deterministic `sha256:` tree hash of a directory: every file's sorted relative
 * POSIX path and exact-byte content hash, so any added, removed, renamed, or
 * edited file changes the digest (DR-007).
 */
export interface TreeHashOptions {
  /** Artifact bundles reject links; generic directory/package identities record them. */
  rejectSymlinks?: boolean;
}

interface TreeRecord {
  path: string;
  serialized: string;
}

function canonicalJsonString(value: string): string {
  let serialized = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error('tree entry contains an unpaired Unicode surrogate');
    }
    if (character === '"' || character === '\\') {
      serialized += `\\${character}`;
    } else if (codePoint <= 0x1f) {
      serialized += `\\u${codePoint.toString(16).padStart(4, '0')}`;
    } else {
      serialized += character;
    }
  }
  return `${serialized}"`;
}

function serializeTreeRecord(
  kind: 'file' | 'symlink',
  path: string,
  identity: string,
): string {
  return `[${canonicalJsonString(kind)},${canonicalJsonString(path)},${canonicalJsonString(identity)}]`;
}

export async function hashTree(
  root: string,
  opts: TreeHashOptions = {},
): Promise<string> {
  const rootInfo = await lstat(root);
  const records: TreeRecord[] = [];
  if (rootInfo.isSymbolicLink()) {
    if (opts.rejectSymlinks === true) {
      throw new Error('tree root is a symbolic link');
    }
    records.push(await symlinkRecord(root, '.'));
  } else if (!rootInfo.isDirectory()) {
    throw new Error('tree root is not a real directory');
  }
  await collectTreeRecords(root, '', records, opts);
  records.sort((left, right) =>
    Buffer.compare(
      Buffer.from(left.path, 'utf8'),
      Buffer.from(right.path, 'utf8'),
    ),
  );
  return hashBytes(
    new TextEncoder().encode(
      records.map((record) => record.serialized).join('\n'),
    ),
  );
}

async function hashTreeOrNull(root: string): Promise<string | null> {
  try {
    return await hashTree(root);
  } catch {
    return null;
  }
}

async function collectTreeRecords(
  root: string,
  prefix: string,
  records: TreeRecord[],
  opts: TreeHashOptions,
): Promise<void> {
  const here = prefix ? join(root, ...prefix.split('/')) : root;
  const entries = await readdir(here, {
    withFileTypes: true,
    encoding: 'buffer',
  });
  for (const entry of entries) {
    const rawName = entry.name;
    const name = rawName.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(rawName)) {
      throw new Error('tree contains a filename that is not valid UTF-8');
    }
    const rel = prefix ? `${prefix}/${name}` : name;
    if (entry.isDirectory()) {
      await collectTreeRecords(root, rel, records, opts);
    } else if (entry.isFile()) {
      records.push({
        path: rel,
        serialized: serializeTreeRecord(
          'file',
          rel,
          await hashFile(join(root, ...rel.split('/'))),
        ),
      });
    } else if (entry.isSymbolicLink()) {
      if (opts.rejectSymlinks === true) {
        throw new Error(`tree contains a symbolic link: ${rel}`);
      }
      records.push(await symlinkRecord(join(root, ...rel.split('/')), rel));
    } else {
      throw new Error(`tree contains an unsupported entry: ${rel}`);
    }
  }
}

async function symlinkRecord(
  path: string,
  relativePath: string,
): Promise<TreeRecord> {
  const target = await readlink(path, { encoding: 'buffer' });
  return {
    path: relativePath,
    serialized: serializeTreeRecord(
      'symlink',
      relativePath,
      target.toString('hex'),
    ),
  };
}

function stale(reason: string): PinVerdict {
  return { status: 'stale', reason };
}

function malformed(reason: string): PinVerdict {
  return { status: 'malformed', reason };
}

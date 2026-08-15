// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Forward-only lineage promotion (DR-021 build lineage, INCR-8, INCR-27).
 *
 * The sealed staged candidate is the only recovery state. Promotion writes
 * one durable manifest into the stage root (atomic via temp+rename), applies
 * every non-record path as an ordered per-file temp+rename, removes obsolete
 * products behind exact prior-identity checks, and commits the build record
 * last as the lineage marker. Recovery finishes an intact sealed stage
 * forward to the complete candidate; anything else surfaces through the
 * ordinary conflict machinery. There is no journal, no prior-byte copy, and
 * no rollback branch — the prior and candidate records already carry every
 * hash recovery consults.
 */

import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

import type {
  OverlayManifest,
  OverlayObservation,
  SealedOverlay,
} from './build-overlay.js';
import { BUILD_RECORD_FILE, SOURCE_SNAPSHOT_FILE } from './build-record.js';
import { type Hash, hashBytes, hashFile, isHash } from './hash.js';

const MANIFEST_SCHEMA = 'sublang.slc.stage.v1' as const;
const MANIFEST_FILE = 'manifest.json';

export type PromotionCheckpointName =
  | 'manifest-published'
  | 'replaces-applied'
  | 'removes-applied'
  | 'record-committed';

export interface PromotionCheckpoint {
  readonly name: PromotionCheckpointName;
}

export type PromotionCheckpointHandler = (
  checkpoint: PromotionCheckpoint,
) => void | Promise<void>;

export type BuildPromotionErrorCode =
  | 'conflict'
  | 'interference'
  | 'invalid-stage'
  | 'io';

export class BuildPromotionError extends Error {
  readonly code: BuildPromotionErrorCode;

  constructor(code: BuildPromotionErrorCode, message: string) {
    super(message);
    this.name = 'BuildPromotionError';
    this.code = code;
  }
}

export interface PromoteLineageOptions {
  readonly overlay: SealedOverlay;
  readonly checkpoint?: PromotionCheckpointHandler;
}

export type PromotionRecoveryResult = 'nothing-pending' | 'candidate-completed';

export interface RecoverLineagePromotionOptions {
  readonly artifactDir: string;
  readonly pipeline: string;
  readonly checkpoint?: PromotionCheckpointHandler;
}

/** One durable manifest entry: enough to finish or refuse, never to roll back. */
interface ManifestReplace {
  readonly canonicalPath: string;
  readonly stagedPath: string;
  readonly prior: OverlayObservation;
  readonly candidateIdentity: Hash;
  readonly role: string;
}

interface ManifestRemove {
  readonly canonicalPath: string;
  readonly priorIdentity: Hash;
  readonly role: string;
}

/** One unchanged accepted member the committed record will still describe. */
interface ManifestRetain {
  readonly canonicalPath: string;
  readonly identity: Hash;
  readonly role: string;
}

interface StageManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  readonly artifactDir: string;
  readonly replace: readonly ManifestReplace[];
  readonly remove: readonly ManifestRemove[];
  readonly retain: readonly ManifestRetain[];
}

/**
 * Applies a sealed overlay to its canonical paths and commits the record
 * last. Ordering: durable manifest, non-metadata replaces (sorted), removes,
 * source snapshot, build record. Every destination is re-observed at the
 * point of use and the whole resulting inventory is verified before the
 * record commits, so a concurrent managed edit observed anywhere in that
 * window aborts as a conflict instead of being overwritten or silently
 * described by a stale record (INCR-8).
 */
export async function promoteLineage(
  options: PromoteLineageOptions,
): Promise<void> {
  const { overlay, checkpoint } = options;
  await overlay.assertReady();

  const manifest = toStageManifest(overlay);
  await writeAtomic(
    join(overlay.root, MANIFEST_FILE),
    JSON.stringify(manifest),
  );
  await at(checkpoint, 'manifest-published');

  const { body, snapshot, record } = splitReplaces(manifest.replace);
  for (const entry of body) {
    await guardedReplace(manifest, entry);
  }
  await at(checkpoint, 'replaces-applied');

  for (const entry of manifest.remove) {
    await assertRealInstallPath(manifest, entry.role, entry.canonicalPath);
    await applyRemove(entry);
  }
  await at(checkpoint, 'removes-applied');

  if (snapshot !== undefined) await guardedReplace(manifest, snapshot);
  if (record === undefined) {
    throw new BuildPromotionError(
      'invalid-stage',
      'sealed overlay carries no build-record replacement',
    );
  }
  await assertInventoryReady(manifest, record);
  await guardedReplace(manifest, record);
  await at(checkpoint, 'record-committed');

  const committed = await hashFile(record.canonicalPath);
  if (committed !== record.candidateIdentity) {
    throw new BuildPromotionError(
      'interference',
      `committed build record does not match the sealed candidate: ${record.canonicalPath}`,
    );
  }
  await rm(overlay.root, { recursive: true, force: true });
}

/**
 * Re-observes one destination immediately before installing: still at its
 * recorded prior installs, already at the candidate is idempotent, and
 * anything else is a concurrent managed edit that aborts without being
 * overwritten. The path's components must be real directories so the
 * rename cannot be redirected outside the bundle.
 */
async function guardedReplace(
  manifest: StageManifest,
  entry: ManifestReplace,
): Promise<void> {
  await assertRealInstallPath(manifest, entry.role, entry.canonicalPath);
  const state = await classifyReplace(entry);
  if (state === 'interference') {
    throw new BuildPromotionError(
      'conflict',
      `managed path changed concurrently: ${entry.canonicalPath}`,
    );
  }
  if (state === 'pending') await applyReplace(entry);
}

async function assertRealInstallPath(
  manifest: StageManifest,
  role: string,
  canonicalPath: string,
): Promise<void> {
  // The artifact directory itself is a managed location: swapped for a
  // symlink, it would redirect every direct-child install, so it must be a
  // real directory (or still absent, for a cold promotion to create). The
  // entry module's boundary is the user's project directory, which this
  // transaction does not manage and therefore does not judge.
  if (role !== 'entry') {
    let info;
    try {
      info = await lstat(manifest.artifactDir);
    } catch {
      info = undefined; // absent: created as a real directory on install
    }
    if (info !== undefined && (info.isSymbolicLink() || !info.isDirectory())) {
      throw new BuildPromotionError(
        'conflict',
        `artifact directory is not a real directory: ${manifest.artifactDir}`,
      );
    }
  }
  if (!(await realComponents(entryBoundary(manifest, role), canonicalPath))) {
    throw new BuildPromotionError(
      'conflict',
      `managed path traverses an unsafe component: ${canonicalPath}`,
    );
  }
}

/**
 * Verifies the complete resulting inventory — every replaced destination at
 * its candidate identity, every retained member still at its recorded
 * identity, and every obsolete destination still absent — immediately
 * before the record commits, so the marker never describes bytes that
 * drifted during application.
 */
async function assertInventoryReady(
  manifest: StageManifest,
  record: ManifestReplace,
): Promise<void> {
  // Component validation precedes each hash observation: the leaf lstat
  // does not follow the final component, but it does follow parents, so a
  // parent symlink introduced after application could otherwise present
  // matching bytes from outside the bundle.
  for (const entry of manifest.replace) {
    if (entry === record) continue;
    await assertRealInstallPath(manifest, entry.role, entry.canonicalPath);
    if ((await observeFile(entry.canonicalPath)) !== entry.candidateIdentity) {
      throw new BuildPromotionError(
        'conflict',
        `managed path changed before the record commit: ${entry.canonicalPath}`,
      );
    }
  }
  for (const entry of manifest.retain) {
    await assertRealInstallPath(manifest, entry.role, entry.canonicalPath);
    if ((await observeFile(entry.canonicalPath)) !== entry.identity) {
      throw new BuildPromotionError(
        'conflict',
        `retained path changed before the record commit: ${entry.canonicalPath}`,
      );
    }
  }
  // An obsolete destination stays managed by the still-accepted prior
  // lineage until the marker moves, so one recreated after its removal is a
  // concurrent managed change: conflict and leave it in place rather than
  // deleting it again or committing a record that silently drops it.
  for (const entry of manifest.remove) {
    await assertRealInstallPath(manifest, entry.role, entry.canonicalPath);
    if ((await observeFile(entry.canonicalPath)) !== undefined) {
      throw new BuildPromotionError(
        'conflict',
        `obsolete path reappeared before the record commit: ${entry.canonicalPath}`,
      );
    }
  }
}

/**
 * Finds pending sealed stages beside the artifact directory and finishes
 * each intact one forward to the complete candidate. A stage without a
 * durable manifest predates any canonical mutation and is removed. A stage
 * whose canonical paths match neither the recorded prior nor the candidate
 * has been externally mutated: the stage is removed and the mixed canonical
 * state is left for ordinary conflict classification.
 */
export async function recoverLineagePromotion(
  options: RecoverLineagePromotionOptions,
): Promise<PromotionRecoveryResult> {
  const { artifactDir, pipeline, checkpoint } = options;
  let result: PromotionRecoveryResult = 'nothing-pending';
  for (const stageRoot of await pendingStages(artifactDir)) {
    const manifest = await readManifest(stageRoot);
    if (manifest !== undefined && manifest.artifactDir !== artifactDir) {
      // Another bundle's stage name collision: not this recovery's to touch.
      continue;
    }
    if (
      manifest === undefined ||
      !manifestConfined(manifest, stageRoot, pipeline)
    ) {
      // Pre-promotion residue, or a manifest promoteLineage cannot have
      // written (every path it writes is confined to the stage and bundle):
      // no canonical mutation can have happened through it.
      await rm(stageRoot, { recursive: true, force: true });
      continue;
    }
    if (await finishForward(stageRoot, manifest, checkpoint)) {
      result = 'candidate-completed';
    }
  }
  return result;
}

async function finishForward(
  stageRoot: string,
  manifest: StageManifest,
  checkpoint: PromotionCheckpointHandler | undefined,
): Promise<boolean> {
  const { body, snapshot, record } = splitReplaces(manifest.replace);
  if (record === undefined) {
    await rm(stageRoot, { recursive: true, force: true });
    return false;
  }

  // Every path must sit at the recorded prior or already at the candidate;
  // anything else is external interference and voids the stage.
  const pending: ManifestReplace[] = [];
  for (const entry of [...body, ...(snapshot ? [snapshot] : []), record]) {
    const state = await classifyReplace(entry);
    if (state === 'interference') {
      await rm(stageRoot, { recursive: true, force: true });
      return false;
    }
    if (state === 'pending') pending.push(entry);
  }
  const removals: ManifestRemove[] = [];
  for (const entry of manifest.remove) {
    const state = await classifyRemove(entry);
    if (state === 'interference') {
      await rm(stageRoot, { recursive: true, force: true });
      return false;
    }
    if (state === 'pending') removals.push(entry);
  }
  // Retained members are part of the inventory the candidate record
  // describes: one that drifted between interruption and recovery would
  // survive beside a record carrying its old hash, so it voids the stage
  // exactly like any other interference.
  for (const entry of manifest.retain) {
    if ((await observeFile(entry.canonicalPath)) !== entry.identity) {
      await rm(stageRoot, { recursive: true, force: true });
      return false;
    }
  }

  // The stage counts as intact only while every still-pending candidate
  // hashes to its sealed identity; a truncated or altered staged file voids
  // the stage instead of being committed under a record that cannot
  // describe it (INCR-8's "intact sealed stage").
  for (const entry of pending) {
    if (!(await stagedCandidateIntact(entry))) {
      await rm(stageRoot, { recursive: true, force: true });
      return false;
    }
  }

  // Application mirrors the live path exactly — the same guardedReplace
  // that re-observes each destination at its point of use — so drift or an
  // unsafe component observed at any moment voids the stage rather than
  // being overwritten, and the whole inventory is verified before the
  // record commits.
  try {
    for (const entry of pending.filter((e) => e !== record && e !== snapshot)) {
      await guardedReplace(manifest, entry);
    }
    await at(checkpoint, 'replaces-applied');
    for (const entry of removals) {
      await assertRealInstallPath(manifest, entry.role, entry.canonicalPath);
      await applyRemove(entry);
    }
    await at(checkpoint, 'removes-applied');
    if (snapshot !== undefined && pending.includes(snapshot)) {
      await guardedReplace(manifest, snapshot);
    }
    await assertInventoryReady(manifest, record);
    if (pending.includes(record)) {
      await guardedReplace(manifest, record);
    }
  } catch (error) {
    if (error instanceof BuildPromotionError) {
      await rm(stageRoot, { recursive: true, force: true });
      return false;
    }
    throw error;
  }
  await at(checkpoint, 'record-committed');
  await rm(stageRoot, { recursive: true, force: true });
  return true;
}

function toStageManifest(overlay: SealedOverlay): StageManifest {
  const manifest: OverlayManifest = overlay.manifest;
  return {
    schema: MANIFEST_SCHEMA,
    artifactDir: canonicalArtifactDir(manifest),
    replace: manifest.replace.map((entry) => ({
      canonicalPath: entry.canonicalPath,
      stagedPath: entry.stagedPath,
      prior: entry.prior,
      candidateIdentity: entry.candidateIdentity,
      role: entry.role,
    })),
    remove: manifest.remove.map((entry) => ({
      canonicalPath: entry.canonicalPath,
      priorIdentity: entry.priorIdentity,
      role: entry.role,
    })),
    retain: manifest.retain.map((entry) => ({
      canonicalPath: entry.canonicalPath,
      identity: entry.identity,
      role: entry.role,
    })),
  };
}

function canonicalArtifactDir(manifest: OverlayManifest): string {
  const record = manifest.replace.find(
    (entry) => entry.role === 'build-record',
  );
  if (record === undefined) {
    throw new BuildPromotionError(
      'invalid-stage',
      'sealed overlay carries no build-record replacement',
    );
  }
  return dirname(record.canonicalPath);
}

function splitReplaces(entries: readonly ManifestReplace[]): {
  body: ManifestReplace[];
  snapshot: ManifestReplace | undefined;
  record: ManifestReplace | undefined;
} {
  const body: ManifestReplace[] = [];
  let snapshot: ManifestReplace | undefined;
  let record: ManifestReplace | undefined;
  for (const entry of entries) {
    if (entry.role === 'build-record') record = entry;
    else if (entry.role === 'source-snapshot') snapshot = entry;
    else body.push(entry);
  }
  body.sort((a, b) => (a.canonicalPath < b.canonicalPath ? -1 : 1));
  return { body, snapshot, record };
}

let tempSequence = 0;

/**
 * Reads one staged candidate and proves it still carries the sealed
 * identity. The bytes read here are the bytes installed, so a staged file
 * altered after sealing can never reach a canonical path.
 */
async function readStagedCandidate(
  entry: ManifestReplace,
): Promise<Uint8Array> {
  let info;
  try {
    info = await lstat(entry.stagedPath);
  } catch {
    throw new BuildPromotionError(
      'interference',
      `staged candidate is unreadable: ${entry.stagedPath}`,
    );
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BuildPromotionError(
      'interference',
      `staged candidate is not a regular file: ${entry.stagedPath}`,
    );
  }
  const bytes = await readFile(entry.stagedPath);
  if (hashBytes(bytes) !== entry.candidateIdentity) {
    throw new BuildPromotionError(
      'interference',
      `staged candidate does not match the sealed identity: ${entry.stagedPath}`,
    );
  }
  return bytes;
}

async function stagedCandidateIntact(entry: ManifestReplace): Promise<boolean> {
  try {
    await readStagedCandidate(entry);
    return true;
  } catch {
    return false;
  }
}

async function applyReplace(entry: ManifestReplace): Promise<void> {
  const bytes = await readStagedCandidate(entry);
  const dir = dirname(entry.canonicalPath);
  await mkdir(dir, { recursive: true });
  // A unique exclusive temp name cannot collide with an unrecorded file or
  // follow a planted symlink; the durable rename is the only touch on the
  // canonical path.
  const temp = join(
    dir,
    `.${basename(entry.canonicalPath)}.${process.pid}-${tempSequence++}.slc-tmp`,
  );
  // Cleanup only ever removes a temp this call created: a failed exclusive
  // open owns nothing, so a colliding pre-existing file is never deleted.
  const handle = await open(temp, 'wx');
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, entry.canonicalPath);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** True when `child` sits strictly inside `parent`. */
function confined(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === '' || isAbsolute(rel)) return false;
  // Reject only a real parent traversal; a legal name such as `..foo`
  // merely begins with two dots.
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * A manifest promoteLineage wrote stages only inside its own root, gives
 * each role its exact shape — the two metadata roles their reserved paths,
 * the entry role the one derived sibling path — and targets everything
 * else inside the bundle. Anything looser cannot be this transaction's
 * work and grants no replacement authority.
 */
function manifestConfined(
  manifest: StageManifest,
  stageRoot: string,
  pipeline: string,
): boolean {
  const artifactDir = manifest.artifactDir;
  const parent = dirname(artifactDir);
  const suffix = `.${pipeline}`;
  const bundleName = basename(artifactDir);
  const entryPath = bundleName.endsWith(suffix)
    ? join(parent, `${bundleName.slice(0, -suffix.length)}.ts`)
    : null;
  const canonicalAllowed = (role: string, path: string): boolean => {
    switch (role) {
      case 'build-record':
        return path === join(artifactDir, BUILD_RECORD_FILE);
      case 'source-snapshot':
        return path === join(artifactDir, SOURCE_SNAPSHOT_FILE);
      case 'entry':
        return entryPath !== null && path === entryPath;
      case 'semantic':
      case 'verification':
        return confined(artifactDir, path);
      default:
        return false;
    }
  };
  return (
    manifest.replace.every(
      (entry) =>
        confined(stageRoot, entry.stagedPath) &&
        canonicalAllowed(entry.role, entry.canonicalPath),
    ) &&
    // Promotion replaces lineage metadata but never removes it, so a remove
    // entry may carry only a product or entry role.
    manifest.remove.every(
      (entry) =>
        entry.role !== 'build-record' &&
        entry.role !== 'source-snapshot' &&
        canonicalAllowed(entry.role, entry.canonicalPath),
    ) &&
    manifest.retain.every((entry) =>
      canonicalAllowed(entry.role, entry.canonicalPath),
    )
  );
}

async function applyRemove(entry: ManifestRemove): Promise<void> {
  const current = await observeFile(entry.canonicalPath);
  if (current === undefined) return; // already removed
  if (current !== entry.priorIdentity) {
    throw new BuildPromotionError(
      'conflict',
      `obsolete product changed concurrently: ${entry.canonicalPath}`,
    );
  }
  await rm(entry.canonicalPath, { force: true });
}

type PathState = 'done' | 'pending' | 'interference';

async function classifyReplace(entry: ManifestReplace): Promise<PathState> {
  const current = await observeFile(entry.canonicalPath);
  if (current === entry.candidateIdentity) return 'done';
  if (matchesPrior(current, entry.prior)) return 'pending';
  return 'interference';
}

async function classifyRemove(entry: ManifestRemove): Promise<PathState> {
  const current = await observeFile(entry.canonicalPath);
  if (current === undefined) return 'done';
  if (current === entry.priorIdentity) return 'pending';
  return 'interference';
}

function matchesPrior(
  current: Hash | 'unsafe' | undefined,
  prior: OverlayObservation,
): boolean {
  if (prior.kind === 'absent') return current === undefined;
  return current === prior.identity;
}

/**
 * Observes one canonical path without following a symbolic link at it: a
 * link — even to byte-identical content — is a managed edit every
 * classification must surface, never silently accept (INCR-27), so it
 * observes as `unsafe`, which matches neither a prior nor a candidate.
 */
async function observeFile(path: string): Promise<Hash | 'unsafe' | undefined> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return undefined;
  }
  if (!info.isFile() || info.isSymbolicLink()) return 'unsafe';
  return hashFile(path);
}

/**
 * True when every path component strictly between `boundary` and the leaf
 * is a real directory (or still absent): a symbolic-link component would
 * redirect the installing rename outside the bundle.
 */
async function realComponents(
  boundary: string,
  path: string,
): Promise<boolean> {
  const components: string[] = [];
  let cursor = dirname(path);
  while (cursor !== boundary) {
    components.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) return false;
    cursor = parent;
  }
  for (const component of components) {
    let info;
    try {
      info = await lstat(component);
    } catch {
      continue; // absent: created later as a real directory
    }
    if (info.isSymbolicLink() || !info.isDirectory()) return false;
  }
  return true;
}

function entryBoundary(manifest: StageManifest, role: string): string {
  return role === 'entry'
    ? dirname(manifest.artifactDir)
    : manifest.artifactDir;
}

async function pendingStages(artifactDir: string): Promise<string[]> {
  const parent = dirname(artifactDir);
  const prefix = `.${basename(artifactDir)}.slc-stage-`;
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(parent, name));
}

async function readManifest(
  stageRoot: string,
): Promise<StageManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(stageRoot, MANIFEST_FILE), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return isStageManifest(parsed) ? parsed : undefined;
}

function isStageManifest(value: unknown): value is StageManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schema !== MANIFEST_SCHEMA) return false;
  if (typeof candidate.artifactDir !== 'string') return false;
  if (
    !Array.isArray(candidate.replace) ||
    !Array.isArray(candidate.remove) ||
    !Array.isArray(candidate.retain)
  ) {
    return false;
  }
  return (
    candidate.replace.every(isManifestReplace) &&
    candidate.remove.every(isManifestRemove) &&
    candidate.retain.every(isManifestRetain)
  );
}

function isManifestRetain(value: unknown): value is ManifestRetain {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.canonicalPath === 'string' &&
    typeof entry.role === 'string' &&
    typeof entry.identity === 'string' &&
    isHash(entry.identity)
  );
}

function isManifestReplace(value: unknown): value is ManifestReplace {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.canonicalPath === 'string' &&
    typeof entry.stagedPath === 'string' &&
    typeof entry.role === 'string' &&
    typeof entry.candidateIdentity === 'string' &&
    isHash(entry.candidateIdentity) &&
    isObservation(entry.prior)
  );
}

function isManifestRemove(value: unknown): value is ManifestRemove {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.canonicalPath === 'string' &&
    typeof entry.role === 'string' &&
    typeof entry.priorIdentity === 'string' &&
    isHash(entry.priorIdentity)
  );
}

function isObservation(value: unknown): value is OverlayObservation {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (entry.kind === 'absent') return true;
  return (
    (entry.kind === 'file' ||
      entry.kind === 'tree' ||
      entry.kind === 'value') &&
    typeof entry.identity === 'string' &&
    isHash(entry.identity)
  );
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temp = `${path}.tmp`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, path);
}

async function at(
  handler: PromotionCheckpointHandler | undefined,
  name: PromotionCheckpointName,
): Promise<void> {
  if (handler !== undefined) await handler({ name });
}

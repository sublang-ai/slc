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
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type {
  OverlayManifest,
  OverlayObservation,
  SealedOverlay,
} from './build-overlay.js';
import { type Hash, hashFile, isHash } from './hash.js';

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
}

interface StageManifest {
  readonly schema: typeof MANIFEST_SCHEMA;
  readonly artifactDir: string;
  readonly replace: readonly ManifestReplace[];
  readonly remove: readonly ManifestRemove[];
}

/**
 * Applies a sealed overlay to its canonical paths and commits the record
 * last. Ordering: durable manifest, non-metadata replaces (sorted), removes,
 * source snapshot, build record. A pre-mutation basis mismatch or a removal
 * whose current bytes differ from the recorded prior aborts as a conflict
 * with the stage retained for forward recovery.
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
    await applyReplace(entry);
  }
  await at(checkpoint, 'replaces-applied');

  for (const entry of manifest.remove) {
    await applyRemove(entry);
  }
  await at(checkpoint, 'removes-applied');

  if (snapshot !== undefined) await applyReplace(snapshot);
  if (record === undefined) {
    throw new BuildPromotionError(
      'invalid-stage',
      'sealed overlay carries no build-record replacement',
    );
  }
  await applyReplace(record);
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
  const { artifactDir, checkpoint } = options;
  let result: PromotionRecoveryResult = 'nothing-pending';
  for (const stageRoot of await pendingStages(artifactDir)) {
    const manifest = await readManifest(stageRoot);
    if (manifest === undefined || manifest.artifactDir !== artifactDir) {
      // Pre-promotion residue (or another bundle's stage name collision):
      // no canonical mutation can have happened through it.
      if (manifest === undefined) {
        await rm(stageRoot, { recursive: true, force: true });
      }
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

  for (const entry of pending.filter((e) => e !== record && e !== snapshot)) {
    await applyReplace(entry);
  }
  await at(checkpoint, 'replaces-applied');
  for (const entry of removals) {
    await applyRemove(entry);
  }
  await at(checkpoint, 'removes-applied');
  if (snapshot !== undefined && pending.includes(snapshot)) {
    await applyReplace(snapshot);
  }
  if (pending.includes(record)) {
    await applyReplace(record);
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

async function applyReplace(entry: ManifestReplace): Promise<void> {
  const dir = dirname(entry.canonicalPath);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(entry.canonicalPath)}.slc-tmp`);
  await copyFile(entry.stagedPath, temp);
  await rename(temp, entry.canonicalPath);
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
  current: Hash | undefined,
  prior: OverlayObservation,
): boolean {
  if (prior.kind === 'absent') return current === undefined;
  return current === prior.identity;
}

async function observeFile(path: string): Promise<Hash | undefined> {
  try {
    if (!(await stat(path)).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return hashFile(path);
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
  if (!Array.isArray(candidate.replace) || !Array.isArray(candidate.remove)) {
    return false;
  }
  return (
    candidate.replace.every(isManifestReplace) &&
    candidate.remove.every(isManifestRemove)
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

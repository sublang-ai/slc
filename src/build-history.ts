// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Versioned build history under `<art-dir>/.slc/` (DR-021, INCR-9..11).
 *
 * The store is memory, never authority: `loadBuildHistory` returns `null` on
 * any structural problem instead of throwing, and a copy is trusted only
 * after `verifiedCopy` re-hashes it. Recording writes a complete numbered
 * build directory — manifest plus verbatim copies of the source and every
 * recorded step output — before renaming a temporary file over `.slc/latest`,
 * so an interrupted recording leaves the prior build authoritative and an
 * orphaned build directory ignored. See specs/dev/incremental-compilation.md.
 */

import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { errorCode, isAbsentPathError } from './errors.js';
import { writeFileNoFollow } from './verify.js';
import { hashBytes, isHash, type Hash } from './hash.js';

/**
 * Reads a store member as a no-follow, nonblocking regular file, or `null`
 * for anything else — a symlink, directory, or FIFO in the store must read
 * as absent, never redirect a read or hang the compile (INCR-10).
 */
export async function readStoreFile(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch {
    return null;
  }
  try {
    if (!(await handle.stat()).isFile()) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/**
 * Reads an external input as a nonblocking regular file, following symbolic
 * links — sources may legitimately be symlinks — or `null` when the path is
 * not a readable regular file, so a FIFO swapped in by rejected work can
 * never hang publication (INCR-16).
 */
export async function readSourceBytes(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    if (!(await handle.stat()).isFile()) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** Reserved history directory name inside an artifact directory (DR-021). */
export const HISTORY_DIR = '.slc';

/**
 * Observes one host-managed directory component without following symlinks:
 * `dir` only for a real directory. A symbolic link at `.slc`, `builds`, a
 * build directory, or `.slc-verify` would route every read, unlink, and
 * write somewhere the host never chose (INCR-10, PHEXEC-39).
 */
export async function realDirState(
  path: string,
): Promise<'absent' | 'dir' | 'blocked'> {
  try {
    return (await lstat(path)).isDirectory() ? 'dir' : 'blocked';
  } catch (error) {
    return isAbsentPathError(error) ? 'absent' : 'blocked';
  }
}

/**
 * Ensures a host-managed directory exists as a real directory, creating it
 * when absent and refusing anything else — a file or symbolic link at the
 * path must never be traversed or replaced (PHEXEC-39).
 */
export async function ensureRealDir(path: string): Promise<void> {
  const state = await realDirState(path);
  if (state === 'dir') return;
  if (state === 'blocked') {
    throw new Error(
      `"${path}" is not a real directory; remove it to let slc manage the path`,
    );
  }
  await mkdir(path);
}

export const BUILD_MANIFEST_SCHEMA = 'sublang.slc.build.v1';

/** One recorded step: identity inputs, accepted output, and its stored copy. */
export interface StepHistoryRecord {
  kind: string;
  name: string;
  /** Artifact-directory-relative POSIX path of the step's target. */
  target: string;
  /** Ordered input identities: chained input, definition, declared inputs. */
  inputs: Hash[];
  /** Hash of the recorded target bytes. */
  output: Hash;
  /** Build-directory-relative POSIX path of the verbatim output copy. */
  copy: string;
}

export interface BuildManifest {
  schema: typeof BUILD_MANIFEST_SCHEMA;
  pipeline: string;
  source: {
    /** Artifact-directory-relative POSIX locator; may climb outward. */
    path: string;
    hash: Hash;
  };
  steps: StepHistoryRecord[];
}

/** A loaded build: its number, absolute directory, and validated manifest. */
export interface BuildHistory {
  build: number;
  dir: string;
  manifest: BuildManifest;
}

/** Name of the verbatim source copy inside a build directory. */
export const SOURCE_COPY = 'source';

/** Encodes an absolute path relative to the artifact directory, POSIX-style. */
export function encodeLocator(artDir: string, path: string): string {
  return relative(artDir, path).split(sep).join('/');
}

/** Resolves an artifact-directory-relative POSIX locator back to a path. */
export function resolveLocator(artDir: string, locator: string): string {
  return join(artDir, ...locator.split('/'));
}

/**
 * Loads the latest recorded build, or `null` when there is none or when any
 * structural expectation fails — history is advisory, so a bad store reads as
 * an absent one (INCR-10).
 */
export async function loadBuildHistory(
  artDir: string,
): Promise<BuildHistory | null> {
  const historyDir = join(artDir, HISTORY_DIR);
  // Every fixed store component must be a real directory: a symlinked
  // `.slc`, `builds`, or build directory would read another bundle's
  // history as this one's (INCR-10).
  if ((await realDirState(historyDir)) !== 'dir') return null;
  const marker = await readStoreFile(join(historyDir, 'latest'));
  if (marker === null) return null;
  const latest = marker.toString('utf8').trim();
  if (!/^\d{1,15}$/.test(latest)) return null;
  const build = Number(latest);
  if (build < 1) return null;
  if ((await realDirState(join(historyDir, 'builds'))) !== 'dir') return null;
  const dir = join(historyDir, 'builds', String(build));
  if ((await realDirState(dir)) !== 'dir') return null;
  const rawManifest = await readStoreFile(join(dir, 'manifest.json'));
  if (rawManifest === null) return null;
  let manifest: BuildManifest;
  try {
    const parsed = parseManifest(
      JSON.parse(rawManifest.toString('utf8')) as unknown,
    );
    if (parsed === null) return null;
    manifest = parsed;
  } catch {
    return null;
  }
  return { build, dir, manifest };
}

/**
 * Invalidates the history by removing `.slc/latest` — absence is the durable
 * statement that nothing is vouched for. Only a regular file can be an
 * active marker, so absence, a `.slc` that is not a directory, or a
 * directory or other non-regular entry at the marker path all count as
 * success — they already read as absent history. A recognized active marker
 * that cannot be removed propagates, because proceeding could let a later
 * run reuse bytes a failed executor left behind (INCR-30).
 */
export async function invalidateBuildHistory(artDir: string): Promise<void> {
  // A `.slc` that is not a real directory holds no marker of this bundle's
  // own: loading already reads it as absent, and unlinking through a
  // symlink would destroy another directory's marker (PHEXEC-39).
  if ((await realDirState(join(artDir, HISTORY_DIR))) !== 'dir') return;
  const marker = join(artDir, HISTORY_DIR, 'latest');
  try {
    await unlink(marker);
    return;
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return;
    // Only a confirmed non-regular entry counts as absence. An observation
    // that fails is indeterminate: the marker may still be active, so the
    // caller must fail closed rather than proceed under it.
    let observed;
    try {
      observed = await lstat(marker);
    } catch (observation) {
      throw errorCode(observation) === 'ENOENT' ? error : observation;
    }
    if (!observed.isFile()) return;
    throw error;
  }
}

/**
 * Returns the absolute path and bytes of a recorded copy after re-hashing,
 * or `null` when the copy is missing or no longer matches (INCR-10).
 */
export async function verifiedCopy(
  history: BuildHistory,
  copy: string,
  hash: Hash,
): Promise<{ path: string; bytes: Buffer } | null> {
  const parts = copy.split('/');
  // The store's intermediate components are host-managed like its roots: a
  // symlinked `outputs` reads as an absent copy, never a redirect (INCR-10).
  let cursor = history.dir;
  for (const part of parts.slice(0, -1)) {
    cursor = join(cursor, part);
    if ((await realDirState(cursor)) !== 'dir') return null;
  }
  const path = join(history.dir, ...parts);
  const bytes = await readStoreFile(path);
  if (bytes === null) return null;
  return hashBytes(bytes) === hash ? { path, bytes } : null;
}

/** What `recordBuild` stores for one step. */
export interface StepToRecord {
  kind: string;
  name: string;
  /** Absolute target path; recorded relative to the artifact directory. */
  target: string;
  inputs: Hash[];
  /**
   * The accepted bytes, materialized by the caller through the safe reader
   * and already verified against the identity captured at completion or
   * reuse — publication never rereads live paths (INCR-16).
   */
  bytes: Buffer;
}

/**
 * Records a complete build: chooses a number above `latest` and every
 * existing `builds/` entry, writes the manifest and verbatim copies, then
 * commits by renaming a temporary file over `latest` (INCR-11).
 */
export async function recordBuild(opts: {
  artDir: string;
  pipeline: string;
  /** Absolute source path, recorded as the manifest locator. */
  sourcePath: string;
  /** The source bytes, materialized by the caller. */
  sourceBytes: Buffer;
  steps: readonly StepToRecord[];
}): Promise<void> {
  // With nothing recordable, absence is the statement: no build directory,
  // no marker, no numbering churn (INCR-16).
  if (opts.steps.length === 0) return;
  const historyDir = join(opts.artDir, HISTORY_DIR);
  const buildsDir = join(historyDir, 'builds');
  await ensureRealDir(historyDir);
  await ensureRealDir(buildsDir);

  let next = 1;
  const marker = await readStoreFile(join(historyDir, 'latest'));
  if (marker !== null) {
    const latest = marker.toString('utf8').trim();
    if (/^\d{1,15}$/.test(latest)) next = Number(latest) + 1;
  }
  for (const entry of await readdir(buildsDir)) {
    if (/^\d{1,15}$/.test(entry)) next = Math.max(next, Number(entry) + 1);
  }

  const dir = join(buildsDir, String(next));
  await mkdir(join(dir, 'outputs'), { recursive: true });

  await writeFile(join(dir, SOURCE_COPY), opts.sourceBytes);

  const steps: StepHistoryRecord[] = [];
  for (const step of opts.steps) {
    const bytes = step.bytes;
    const target = encodeLocator(opts.artDir, step.target);
    const copy = `outputs/${target}`;
    await writeFile(join(dir, 'outputs', ...target.split('/')), bytes);
    steps.push({
      kind: step.kind,
      name: step.name,
      target,
      inputs: [...step.inputs],
      output: hashBytes(bytes),
      copy,
    });
  }

  const manifest: BuildManifest = {
    schema: BUILD_MANIFEST_SCHEMA,
    pipeline: opts.pipeline,
    source: {
      path: encodeLocator(opts.artDir, opts.sourcePath),
      hash: hashBytes(opts.sourceBytes),
    },
    steps,
  };
  await writeFile(
    join(dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // The temp marker is the one leaf written into a pre-existing directory,
  // and its name is predictable — the no-follow writer refuses a planted
  // symlink instead of truncating whatever it points at (PHEXEC-39). The
  // rename itself never follows its final component.
  const temp = join(historyDir, `latest.${process.pid}.${next}`);
  await writeFileNoFollow(temp, `${next}\n`);
  await rename(temp, join(historyDir, 'latest'));
}

function parseManifest(value: unknown): BuildManifest | null {
  if (!isRecord(value)) return null;
  if (value.schema !== BUILD_MANIFEST_SCHEMA) return null;
  if (typeof value.pipeline !== 'string' || value.pipeline.length === 0) {
    return null;
  }
  const source = value.source;
  if (!isRecord(source)) return null;
  if (!isLocator(source.path) || !isRecordedHash(source.hash)) return null;
  if (!Array.isArray(value.steps)) return null;
  const steps: StepHistoryRecord[] = [];
  for (const step of value.steps as unknown[]) {
    if (!isRecord(step)) return null;
    if (typeof step.kind !== 'string' || step.kind.length === 0) return null;
    if (typeof step.name !== 'string' || step.name.length === 0) return null;
    if (!isConfined(step.target)) return null;
    if (!Array.isArray(step.inputs)) return null;
    const inputs: Hash[] = [];
    for (const input of step.inputs as unknown[]) {
      if (!isRecordedHash(input)) return null;
      inputs.push(input);
    }
    if (!isRecordedHash(step.output)) return null;
    if (!isConfined(step.copy)) return null;
    steps.push({
      kind: step.kind,
      name: step.name,
      target: step.target,
      inputs,
      output: step.output,
      copy: step.copy,
    });
  }
  return {
    schema: BUILD_MANIFEST_SCHEMA,
    pipeline: value.pipeline,
    source: { path: source.path as string, hash: source.hash },
    steps,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A relative POSIX locator; outward `..` climbs are allowed for sources. */
function isLocator(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !isAbsolute(value)
  );
}

/** A locator confined below its base: no absolute root and no `..` segment. */
function isConfined(value: unknown): value is string {
  return (
    isLocator(value) && !value.split('/').some((segment) => segment === '..')
  );
}

function isRecordedHash(value: unknown): value is Hash {
  return typeof value === 'string' && isHash(value);
}

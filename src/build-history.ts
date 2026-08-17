// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Versioned build history under `<art-dir>/.slc/` (DR-021, INCR-9..11).
 *
 * The store is memory, never authority: `loadBuildHistory` returns `null` on
 * any structural problem instead of throwing, and a copy is trusted only
 * after `verifiedCopyPath` re-hashes it. Recording writes a complete numbered
 * build directory — manifest plus verbatim copies of the source and every
 * recorded step output — before renaming a temporary file over `.slc/latest`,
 * so an interrupted recording leaves the prior build authoritative and an
 * orphaned build directory ignored. See specs/dev/incremental-compilation.md.
 */

import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import { hashBytes, isHash, type Hash } from './hash.js';

/** Reserved history directory name inside an artifact directory (DR-021). */
export const HISTORY_DIR = '.slc';

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
  let build: number;
  try {
    const latest = (await readFile(join(historyDir, 'latest'), 'utf8')).trim();
    if (!/^\d{1,15}$/.test(latest)) return null;
    build = Number(latest);
  } catch {
    return null;
  }
  if (build < 1) return null;
  const dir = join(historyDir, 'builds', String(build));
  let manifest: BuildManifest;
  try {
    const raw: unknown = JSON.parse(
      await readFile(join(dir, 'manifest.json'), 'utf8'),
    );
    const parsed = parseManifest(raw);
    if (parsed === null) return null;
    manifest = parsed;
  } catch {
    return null;
  }
  return { build, dir, manifest };
}

/**
 * Invalidates the history by removing `.slc/latest` — absence is the durable
 * statement that nothing is vouched for. Absence already counts as success;
 * any other failure propagates, because proceeding with an active marker
 * could let a later run reuse bytes a failed executor left behind (INCR-30).
 */
export async function invalidateBuildHistory(artDir: string): Promise<void> {
  try {
    await unlink(join(artDir, HISTORY_DIR, 'latest'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Returns the absolute path of a recorded copy after re-hashing its bytes, or
 * `null` when the copy is missing or no longer matches (INCR-10).
 */
export async function verifiedCopyPath(
  history: BuildHistory,
  copy: string,
  hash: Hash,
): Promise<string | null> {
  const path = join(history.dir, ...copy.split('/'));
  try {
    const bytes = await readFile(path);
    return hashBytes(bytes) === hash ? path : null;
  } catch {
    return null;
  }
}

/** What `recordBuild` stores for one step. */
export interface StepToRecord {
  kind: string;
  name: string;
  /** Absolute target path; recorded relative to the artifact directory. */
  target: string;
  inputs: Hash[];
  /**
   * Absolute path whose bytes become the recorded copy: the live target for
   * an executed or reused step, or the prior build's copy for a step carried
   * forward past a failure (INCR-16).
   */
  copyFrom: string;
}

/**
 * Records a complete build: chooses a number above `latest` and every
 * existing `builds/` entry, writes the manifest and verbatim copies, then
 * commits by renaming a temporary file over `latest` (INCR-11).
 */
export async function recordBuild(opts: {
  artDir: string;
  pipeline: string;
  /** Absolute source path; its bytes are copied verbatim. */
  sourcePath: string;
  steps: readonly StepToRecord[];
}): Promise<void> {
  const historyDir = join(opts.artDir, HISTORY_DIR);
  const buildsDir = join(historyDir, 'builds');
  await mkdir(buildsDir, { recursive: true });

  let next = 1;
  try {
    const latest = (await readFile(join(historyDir, 'latest'), 'utf8')).trim();
    if (/^\d{1,15}$/.test(latest)) next = Number(latest) + 1;
  } catch {
    // No committed build yet.
  }
  for (const entry of await readdir(buildsDir)) {
    if (/^\d{1,15}$/.test(entry)) next = Math.max(next, Number(entry) + 1);
  }

  const dir = join(buildsDir, String(next));
  await mkdir(join(dir, 'outputs'), { recursive: true });

  const sourceBytes = await readFile(opts.sourcePath);
  await writeFile(join(dir, SOURCE_COPY), sourceBytes);

  const steps: StepHistoryRecord[] = [];
  for (const step of opts.steps) {
    const bytes = await readFile(step.copyFrom);
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
      hash: hashBytes(sourceBytes),
    },
    steps,
  };
  await writeFile(
    join(dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  const temp = join(historyDir, `latest.${process.pid}.${next}`);
  await writeFile(temp, `${next}\n`);
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

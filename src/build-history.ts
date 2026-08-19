// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Complete, versioned build snapshots for incremental compilation. */

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
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, sep } from 'node:path';

import { errorCode, isAbsentPathError } from './errors.js';
import { hashBytes, isHash, type Hash } from './hash.js';

export const HISTORY_DIR = '.slc';
export const BUILD_MANIFEST_SCHEMA = 'sublang.slc.build.v1';
export const SOURCE_COPY = 'source';

const OUTPUTS_DIR = 'outputs';
const MAX_BUILD_NUMBER = 999_999_999_999_999;
const BUILD_NUMBER = /^[1-9]\d{0,14}$/;

export interface StepHistoryRecord {
  kind: 'compile' | 'link';
  name: string;
  /** Artifact-directory-relative POSIX locator. */
  target: string;
  inputs: Hash[];
  output: Hash;
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

export interface BuildHistory {
  build: number;
  dir: string;
  manifest: BuildManifest;
}

export interface VerifiedInput {
  path: string;
  bytes: Buffer;
}

export interface StepToRecord {
  kind: 'compile' | 'link';
  name: string;
  /** Absolute target path. */
  target: string;
  inputs: readonly Hash[];
  /** Hash accepted by the runner before publication. */
  output: Hash;
  /** Bytes re-read by the runner immediately before publication. */
  bytes: Uint8Array;
}

/** Encodes an absolute path relative to the artifact directory. */
export function encodeLocator(artDir: string, path: string): string {
  return relative(artDir, path).split(sep).join('/');
}

/** Fixed path of a phase's recorded output copy. */
export function outputCopyPath(history: BuildHistory, index: number): string {
  return join(history.dir, OUTPUTS_DIR, String(index));
}

/**
 * Loads and verifies the complete active build. Any malformed directory,
 * marker, manifest, source copy, output copy, or hash makes history absent.
 */
export async function loadBuildHistory(
  artDir: string,
): Promise<BuildHistory | null> {
  try {
    const historyDir = join(artDir, HISTORY_DIR);
    const buildsDir = join(historyDir, 'builds');
    if (!(await isRealDirectory(historyDir))) return null;
    if (!(await isRealDirectory(buildsDir))) return null;

    const marker = await readPrivateFile(join(historyDir, 'latest'));
    if (marker === null) return null;
    const markerText = marker.toString('utf8');
    if (!/^[1-9]\d{0,14}\n?$/.test(markerText)) return null;
    const build = Number(
      markerText.endsWith('\n') ? markerText.slice(0, -1) : markerText,
    );

    const dir = join(buildsDir, String(build));
    if (!(await isRealDirectory(dir))) return null;
    if (!(await isRealDirectory(join(dir, OUTPUTS_DIR)))) return null;

    const manifestBytes = await readPrivateFile(join(dir, 'manifest.json'));
    if (manifestBytes === null) return null;
    const manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')));
    if (manifest === null) return null;

    const source = await readPrivateFile(join(dir, SOURCE_COPY));
    if (source === null || hashBytes(source) !== manifest.source.hash)
      return null;
    for (let index = 0; index < manifest.steps.length; index++) {
      const copy = await readPrivateFile(join(dir, OUTPUTS_DIR, String(index)));
      if (copy === null || hashBytes(copy) !== manifest.steps[index].output) {
        return null;
      }
    }
    return { build, dir, manifest };
  } catch {
    return null;
  }
}

/**
 * Re-verifies the recorded chained input immediately before Update mode uses
 * it. Step zero reads the source copy; later steps read the prior output copy.
 */
export async function verifiedInput(
  history: BuildHistory,
  stepIndex: number,
  expected: Hash,
): Promise<VerifiedInput | null> {
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) return null;
  const path =
    stepIndex === 0
      ? join(history.dir, SOURCE_COPY)
      : outputCopyPath(history, stepIndex - 1);
  const bytes = await readPrivateFile(path);
  return bytes !== null && hashBytes(bytes) === expected
    ? { path, bytes }
    : null;
}

/**
 * Removes the active marker before the first executor may write. A valid
 * active marker must be removable; malformed advisory state is never followed.
 */
export async function invalidateBuildHistory(
  artDir: string,
  active: boolean,
): Promise<void> {
  const historyDir = join(artDir, HISTORY_DIR);
  if (!(await isRealDirectory(historyDir))) {
    if (active)
      throw new Error('active build history directory is unavailable');
    return;
  }
  try {
    await unlink(join(historyDir, 'latest'));
  } catch (error) {
    if (isAbsentPathError(error)) return;
    if (active) throw error;
  }
}

/**
 * Publishes one complete snapshot and commits its number last. Callers pass
 * already-materialized source/output bytes, so publication never follows a
 * live phase target.
 */
export async function recordBuild(opts: {
  artDir: string;
  pipeline: string;
  sourcePath: string;
  sourceBytes: Uint8Array;
  steps: readonly StepToRecord[];
}): Promise<void> {
  if (opts.steps.length === 0) throw new Error('cannot record an empty build');

  const historyDir = join(opts.artDir, HISTORY_DIR);
  const buildsDir = join(historyDir, 'builds');
  await ensureRealDirectory(historyDir);
  await ensureRealDirectory(buildsDir);

  let next = 1;
  for (const entry of await readdir(buildsDir)) {
    if (BUILD_NUMBER.test(entry)) next = Math.max(next, Number(entry) + 1);
  }

  let dir: string | null = null;
  while (next <= MAX_BUILD_NUMBER) {
    const candidate = join(buildsDir, String(next));
    try {
      await mkdir(candidate);
      dir = candidate;
      break;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      next++;
    }
  }
  if (dir === null) throw new Error('build history number space is exhausted');

  await mkdir(join(dir, OUTPUTS_DIR));
  await writeFile(join(dir, SOURCE_COPY), opts.sourceBytes, { flag: 'wx' });

  const steps: StepHistoryRecord[] = [];
  for (let index = 0; index < opts.steps.length; index++) {
    const step = opts.steps[index];
    if (hashBytes(step.bytes) !== step.output) {
      throw new Error(
        `accepted output changed before recording: ${step.target}`,
      );
    }
    const target = encodeLocator(opts.artDir, step.target);
    if (!isConfinedLocator(target)) {
      throw new Error(
        `phase target is outside the artifact directory: ${step.target}`,
      );
    }
    await writeFile(join(dir, OUTPUTS_DIR, String(index)), step.bytes, {
      flag: 'wx',
    });
    steps.push({
      kind: step.kind,
      name: step.name,
      target,
      inputs: [...step.inputs],
      output: step.output,
    });
  }

  const sourcePath = encodeLocator(opts.artDir, opts.sourcePath);
  if (!isLocator(sourcePath)) {
    throw new Error(`invalid source locator: ${opts.sourcePath}`);
  }
  const manifest: BuildManifest = {
    schema: BUILD_MANIFEST_SCHEMA,
    pipeline: opts.pipeline,
    source: { path: sourcePath, hash: hashBytes(opts.sourceBytes) },
    steps,
  };
  await writeFile(
    join(dir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  );

  const marker = join(historyDir, `latest.${process.pid}.${randomUUID()}`);
  try {
    await writeFile(marker, `${next}\n`, { flag: 'wx' });
    await rename(marker, join(historyDir, 'latest'));
  } catch (error) {
    try {
      await unlink(marker);
    } catch {
      // The temporary marker may not have been created or may already be gone.
    }
    throw error;
  }
}

async function ensureRealDirectory(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
  if (!(await isRealDirectory(path))) {
    throw new Error(`build history path is not a real directory: ${path}`);
  }
}

async function isRealDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readPrivateFile(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

function parseManifest(value: unknown): BuildManifest | null {
  if (!exactRecord(value, ['schema', 'pipeline', 'source', 'steps']))
    return null;
  if (value.schema !== BUILD_MANIFEST_SCHEMA) return null;
  if (typeof value.pipeline !== 'string' || value.pipeline.length === 0)
    return null;
  if (!exactRecord(value.source, ['path', 'hash'])) return null;
  if (!isLocator(value.source.path) || !isRecordedHash(value.source.hash)) {
    return null;
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) return null;

  const seenTargets = new Set<string>();
  const steps: StepHistoryRecord[] = [];
  for (const item of value.steps) {
    if (!exactRecord(item, ['kind', 'name', 'target', 'inputs', 'output'])) {
      return null;
    }
    if (item.kind !== 'compile' && item.kind !== 'link') return null;
    if (typeof item.name !== 'string' || item.name.length === 0) return null;
    if (!isConfinedLocator(item.target) || seenTargets.has(item.target))
      return null;
    seenTargets.add(item.target);
    if (!Array.isArray(item.inputs) || item.inputs.length === 0) return null;
    const inputs: Hash[] = [];
    for (const input of item.inputs) {
      if (!isRecordedHash(input)) return null;
      inputs.push(input);
    }
    if (!isRecordedHash(item.output)) return null;
    steps.push({
      kind: item.kind,
      name: item.name,
      target: item.target,
      inputs,
      output: item.output,
    });
  }
  return {
    schema: BUILD_MANIFEST_SCHEMA,
    pipeline: value.pipeline,
    source: { path: value.source.path, hash: value.source.hash },
    steps,
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecordedHash(value: unknown): value is Hash {
  return typeof value === 'string' && isHash(value);
}

function isLocator(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    isAbsolute(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part.length > 0 && part !== '.');
}

function isConfinedLocator(value: unknown): value is string {
  return isLocator(value) && !value.split('/').includes('..');
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Pin-currency engine: the per-phase verdict that drives compiled selection
 * (PIN-1..PIN-6; DR-007).
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
 * paths and contents. It does not resolve the artifact to the linked `phase`
 * format — that awaits the compiled executor (DR-005) — so the artifact is
 * checked by existence and exact-byte hash only. See specs/dev/pinning.md.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { hashBytes, hashFile, isHash } from './hash.js';
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
} from './pins.js';

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

  const verdicts: Record<string, PinVerdict> = {};
  for (const [phase, record] of Object.entries(loaded.file.pins)) {
    verdicts[phase] = await evaluatePin(pipelineDir, loaded.file, record);
  }
  return { path: loaded.path, verdicts };
}

/**
 * Evaluates one phase's pin record against the committed files (PIN-2..PIN-6).
 *
 * Structural defects are reported as `malformed` before currency is judged, so a
 * record that is both malformed and stale reports `malformed`.
 */
export async function evaluatePin(
  pipelineDir: string,
  file: PinFile,
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
    const linkMalformed = linkTargetMalformed(record.linkTarget);
    if (linkMalformed !== null) {
      return malformed(linkMalformed);
    }
    const externalMalformed = externalInputsMalformed(record.externalInputs);
    if (externalMalformed !== null) {
      return malformed(externalMalformed);
    }

    // Currency (stale) checks. resolvePinPath throws PinError for a bad path,
    // which the catch below maps to malformed (PIN-5).
    for (const [field, ref] of recordedFileRefs(record)) {
      const reason = await fileStale(pipelineDir, boundary, ref, field);
      if (reason !== null) {
        return stale(reason);
      }
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

    return { status: 'current' };
  } catch (error) {
    if (error instanceof PinError) {
      return malformed(error.message);
    }
    throw error;
  }
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

function linkTargetMalformed(linkTarget: PinLinkTarget): string | null {
  // The validator's link-target identity is a sha256 content hash (file) or
  // sha256 tree hash (directory/package), so it must be `sha256:<hex>`.
  if (!isHash(linkTarget.identity)) {
    return 'linkTarget.identity is not a sha256 hash';
  }
  return null;
}

async function linkTargetStale(
  pipelineDir: string,
  boundary: string,
  linkTarget: PinLinkTarget,
): Promise<string | null> {
  const resolved = resolvePinPath(
    pipelineDir,
    boundary,
    linkTarget.locator,
    'linkTarget.locator',
  );
  const current =
    linkTarget.kind === 'file'
      ? await hashFileOrNull(resolved)
      : await hashTreeOrNull(resolved);
  if (current === null) {
    return `linkTarget is missing or unreadable (${linkTarget.locator})`;
  }
  if (current !== linkTarget.identity) {
    return `linkTarget changed (${linkTarget.locator})`;
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
export async function hashTree(root: string): Promise<string> {
  const files = (await listFiles(root, '')).sort();
  const lines: string[] = [];
  for (const rel of files) {
    lines.push(`${rel}\0${await hashFile(join(root, ...rel.split('/')))}`);
  }
  return hashBytes(new TextEncoder().encode(lines.join('\n')));
}

async function hashTreeOrNull(root: string): Promise<string | null> {
  try {
    return await hashTree(root);
  } catch {
    return null;
  }
}

async function listFiles(root: string, prefix: string): Promise<string[]> {
  const here = prefix ? join(root, ...prefix.split('/')) : root;
  const entries = await readdir(here, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, rel)));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files;
}

function stale(reason: string): PinVerdict {
  return { status: 'stale', reason };
}

function malformed(reason: string): PinVerdict {
  return { status: 'malformed', reason };
}

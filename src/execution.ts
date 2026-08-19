// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Execution boundary orchestrator and generic checks (DR-003).
 *
 * `runPhase` performs only generic mechanics (PHEXEC-1): it snapshots the
 * protected inputs, runs an injected {@link PhaseExecutor} (interpreted in
 * IR-001 Task 9, compiled later), then applies the generic checks — the target
 * exists and its extension matches the declared one (PHEXEC-4); the source,
 * objects, link target, and the chain's definition files are unchanged; and an
 * optional `revalidate` hook confirms the pipeline chain still infers, catching
 * added/removed phase files (PHEXEC-5). Input-mutating write-scope violations
 * are caught after any executor outcome (PHEXEC-3, PHEXEC-6). A `blocked` or
 * `error` result, a thrown executor, or any failed check becomes a failure
 * report naming the phase, target, and reasons (PHEXEC-7, PHEXEC-9).
 *
 * The executor honors PHEXEC-2 by treating the passed definition as the
 * semantic source of truth. Broader write-scope enforcement (sandbox or
 * allowlist) is a host concern per DR-003 and is left as a future capability.
 * See specs/dev/phase-execution.md.
 */

import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { errorCode, isAbsentPathError, messageOf } from './errors.js';

/** An opaque link option pair (PIPE-14), structurally compatible with the CLI's LinkOption. */
export interface LinkOptionPair {
  name: string;
  value: string;
}

/**
 * Host-supplied update-mode context for a compile step (DR-021, INCR-14).
 *
 * The existing target file is the previously accepted output; the executor is
 * asked to update it rather than regenerate from scratch. Purely an
 * optimization hint: acceptance authority is identical to a fresh compile.
 */
export interface UpdateContext {
  /** Absolute path of the prior accepted input, a read-only history copy. */
  priorInput: string;
  /**
   * Unified line diff of prior to current input; the empty string when the
   * chained input is byte-identical (another input changed), `null` when the
   * diff exceeded the host budget or cannot faithfully render the byte
   * change.
   */
  diff: string | null;
}

/**
 * Renders the host-owned update instruction shared by interpreted prompts and
 * compiled performing prompts (INCR-15).
 */
export function updateContextLines(update: UpdateContext): string[] {
  const diff =
    update.diff === null
      ? [
          '- the input changes could not be rendered as a line diff (too large, or below line resolution); compare the prior and current inputs directly;',
        ]
      : update.diff === ''
        ? [
            '- the input file is byte-identical to the prior input; the definition or another declared input changed instead;',
          ]
        : [
            '- the input changes, as a unified diff of prior to current input:',
            '--- BEGIN INPUT DIFF ---',
            update.diff,
            '--- END INPUT DIFF ---',
          ];
  return [
    'Incremental update — the artifact to write already holds the accepted output of a previous run (possibly with deliberate manual refinements):',
    `- the prior input is available read-only at: ${update.priorInput};`,
    ...diff,
    '- update the existing artifact under the definition: apply what the input changes imply, preserve everything unaffected including refinements, and keep the artifact complete and consistent;',
    '- if the existing artifact is missing or unusable under the definition, produce a fresh complete artifact instead.',
  ];
}

/** What a phase execution is asked to produce: a compile target or a linked artifact. */
export type ExecuteRequest =
  | {
      kind: 'compile';
      /** Path to the phase definition, the semantic source of truth (PHEXEC-2). */
      definitionPath: string;
      source: string;
      target: string;
      /**
       * Read-only reference documents the definition tells the executor to
       * consult — e.g. the entry-phase definition a generic normalize step
       * rewrites the source toward (DR-013). Protected like definitions.
       */
      references?: readonly string[];
      /** Update-mode context; absent for a fresh compile (DR-021, INCR-14). */
      update?: UpdateContext;
    }
  | {
      kind: 'link';
      /** Path to the `link.md` definition, the semantic source of truth (PHEXEC-2). */
      definitionPath: string;
      objects: string[];
      linkTarget: string;
      options: LinkOptionPair[];
      linked: string;
    };

/** Terminal status an executor reports for a phase run. */
export type ExecutorStatus = 'ok' | 'blocked' | 'error';

/** The outcome an executor returns, with diagnostics drained for every status. */
export interface ExecutorResult {
  status: ExecutorStatus;
  diagnostics: string[];
}

/** Runs one phase or link execution; implemented by the interpreted/compiled executors. */
export interface PhaseExecutor {
  run(request: ExecuteRequest, signal: AbortSignal): Promise<ExecutorResult>;
}

/** A failure naming the phase, target path, and reasons (PHEXEC-9). */
export interface FailureReport {
  phase: string;
  target: string;
  reasons: string[];
  /**
   * Protected paths observed changed during the run — rejected work whose
   * results must never be recorded or carried as trusted (INCR-34).
   */
  changedPaths?: string[];
}

/** The result of a generic-checked phase run. */
export type PhaseResult =
  | { ok: true; target: string; diagnostics: string[] }
  | { ok: false; report: FailureReport };

/**
 * Runs a single phase through the execution boundary: generic mechanics only,
 * plus the DR-003 generic checks and blocked protocol (PHEXEC-1, PHEXEC-4..9).
 */
export async function runPhase(opts: {
  request: ExecuteRequest;
  phase: string;
  targetExt: string;
  executor: PhaseExecutor;
  /** Other chain definition files to protect; the executing phase's is always protected. */
  definitions?: readonly string[];
  /**
   * Additional protected read-only paths — the definition's declared
   * semantic inputs, which the request does not carry (PHEXEC-39).
   */
  protect?: readonly string[];
  /** Re-checks that the pipeline chain still infers; throws when it no longer does (PHEXEC-5). */
  revalidate?: () => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<PhaseResult> {
  const { request, phase, targetExt, executor } = opts;
  const signal = opts.signal ?? new AbortController().signal;
  const target = request.kind === 'compile' ? request.target : request.linked;
  const inputs =
    request.kind === 'compile'
      ? [
          request.source,
          ...(request.references ?? []),
          ...(request.update === undefined ? [] : [request.update.priorInput]),
        ]
      : [...request.objects, request.linkTarget];
  const definitions = [request.definitionPath, ...(opts.definitions ?? [])];
  const protectedPaths = [
    ...new Set([...inputs, ...definitions, ...(opts.protect ?? [])]),
  ];

  // A target that is physically the same file as a protected input — the
  // same resolved path, a symbolic-link alias, or a hard link — would let
  // the executor destroy the input before the after-run check could notice
  // (DR-003, PHEXEC-39). Refuse before any executor write.
  const unsafe = await unsafeSinkReason(target, protectedPaths);
  if (unsafe !== null) {
    return failure(phase, target, [unsafe]);
  }

  const before = await snapshot(protectedPaths);
  // Every protected path must be fully observable before the executor may
  // run: two indeterminate observations compare equal without proving
  // anything, so an unobservable input or planned target fails closed here
  // rather than letting a mutation pass unseen (PHEXEC-39).
  const unobservable = protectedPaths.filter(
    (path) => before.get(path)?.indeterminate === true,
  );
  if (unobservable.length > 0) {
    return failure(
      phase,
      target,
      unobservable.map(
        (path) =>
          `protected path "${path}" cannot be fully observed (${before.get(path)?.id}); refusing to run the executor`,
      ),
    );
  }
  const targetBefore = await writeEvidence(target);

  const reasons: string[] = [];
  let result: ExecutorResult | null = null;
  try {
    result = await executor.run(request, signal);
  } catch (error) {
    reasons.push(`executor threw: ${messageOf(error)}`);
  }

  if (result !== null && result.status !== 'ok') {
    reasons.push(...reasonsFor(result));
  }

  if (result?.status === 'ok') {
    const produced = await regularFileState(target);
    if (produced === 'absent') {
      reasons.push(`expected target "${target}" was not written`);
    } else if (produced !== 'file') {
      reasons.push(
        `target "${target}" is not a private regular file (symbolic link, non-regular, or hard-linked)`,
      );
    } else if (extname(target) !== targetExt) {
      reasons.push(
        `target "${target}" extension does not match the declared "${targetExt}"`,
      );
    } else if (
      targetBefore !== null &&
      targetBefore === (await writeEvidence(target))
    ) {
      // A pre-existing target the executor never rewrote is a textual
      // success without production — the compiled transport already detects
      // this, and update mode makes it reachable for every phase (PHEXEC-4).
      reasons.push(
        `target "${target}" already existed and was not written by this run`,
      );
    }
  }

  // Protected inputs and chain definitions are re-checked after any outcome, so
  // a mutation is caught even when the executor blocks, errors, or throws
  // (PHEXEC-5, PHEXEC-6).
  const after = await snapshot(protectedPaths);
  const changedPaths: string[] = [];
  for (const path of protectedPaths) {
    // A complete before-observation against an indeterminate after is a
    // change: the ids differ, so a path an executor made unobservable is
    // treated as mutated, never as unchanged (PHEXEC-39).
    if (before.get(path)?.id !== after.get(path)?.id) {
      changedPaths.push(path);
      reasons.push(`protected path "${path}" changed during the run`);
    }
  }

  if (opts.revalidate) {
    try {
      await opts.revalidate();
    } catch (error) {
      reasons.push(`pipeline chain is no longer valid: ${messageOf(error)}`);
    }
  }

  if (reasons.length > 0) {
    const report = failure(phase, target, reasons);
    if (!report.ok && changedPaths.length > 0) {
      report.report.changedPaths = changedPaths;
    }
    return report;
  }
  return { ok: true, target, diagnostics: result?.diagnostics ?? [] };
}

/** One no-follow view of a target path (PHEXEC-39). */
export type RegularFileState = 'absent' | 'file' | 'unsafe';

/**
 * Observes a path without following a leaf symlink: `file` only for a
 * private regular file with a single link — a directory, FIFO, socket,
 * symlink, or hard-linked file is `unsafe`, so neither reuse nor a
 * postcondition can accept a leaf whose write would land elsewhere or whose
 * bytes another name shares (PHEXEC-39).
 */
export async function regularFileState(
  path: string,
): Promise<RegularFileState> {
  try {
    const info = await lstat(path);
    return info.isFile() && info.nlink === 1 ? 'file' : 'unsafe';
  } catch (error) {
    return isAbsentPathError(error) ? 'absent' : 'unsafe';
  }
}

/**
 * Returns the reason a target is an unsafe sink, or `null`.
 *
 * A symbolic-link target is refused outright — writing through it lands on an
 * arbitrary file the checks cannot see. An existing target compares by
 * device and inode against every protected input, which also catches hard
 * links; a not-yet-created target compares its parent-resolved path against
 * each input's resolved path; and a target inside a protected directory
 * (a directory link target) is refused by containment (PHEXEC-39).
 */
async function unsafeSinkReason(
  target: string,
  protectedPaths: readonly string[],
): Promise<string | null> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink()) {
      return `target "${target}" is a symbolic link; refusing to write through it`;
    }
    if (!info.isFile()) {
      return `target "${target}" exists and is not a regular file; refusing to write it`;
    }
    if (info.nlink > 1) {
      return `target "${target}" is hard-linked; refusing to write through it`;
    }
  } catch {
    // Absent target: fine, it will be created.
  }
  let targetInode: string | null = null;
  let plannedPath: string | null = null;
  try {
    const info = await stat(target);
    targetInode = `${info.dev}:${info.ino}`;
  } catch {
    // Not yet created.
  }
  try {
    plannedPath = join(await realpath(dirname(target)), basename(target));
  } catch {
    // The parent does not resolve; the write itself will fail.
  }
  if (targetInode === null && plannedPath === null) return null;
  for (const path of protectedPaths) {
    let info: Stats;
    try {
      info = await stat(path);
    } catch {
      // An absent input cannot be destroyed.
      continue;
    }
    if (targetInode !== null && `${info.dev}:${info.ino}` === targetInode) {
      return `target "${target}" is the same file as protected input "${path}"; refusing to overwrite it`;
    }
    if (plannedPath !== null) {
      try {
        const resolved = await realpath(path);
        if (targetInode === null && resolved === plannedPath) {
          return `target "${target}" is the same file as protected input "${path}"; refusing to overwrite it`;
        }
        if (info.isDirectory() && plannedPath.startsWith(`${resolved}/`)) {
          return `target "${target}" is inside protected directory "${path}"; refusing to write into it`;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * A change-detection identity for the target: inode, size, and nanosecond
 * mtime. Identical before and after an `ok` run means the executor produced
 * nothing (PHEXEC-4); `null` means the target did not exist.
 */
async function writeEvidence(path: string): Promise<string | null> {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.ino}:${info.size}:${info.mtimeNs}`;
  } catch {
    return null;
  }
}

/** Renders a failure report as a multi-line diagnostic string (PHEXEC-9). */
export function formatFailureReport(report: FailureReport): string {
  const lines = [`slc: phase "${report.phase}" failed at "${report.target}"`];
  for (const reason of report.reasons) {
    lines.push(`  - ${reason}`);
  }
  return lines.join('\n');
}

function reasonsFor(result: ExecutorResult): string[] {
  if (result.diagnostics.length > 0) {
    return result.diagnostics;
  }
  return [`phase reported ${result.status} without diagnostics`];
}

function failure(
  phase: string,
  target: string,
  reasons: string[],
): PhaseResult {
  return { ok: false, report: { phase, target, reasons } };
}

/**
 * One observation of a protected path: its identity string, and whether the
 * observation is complete. An identity whose bytes could not be read is
 * `indeterminate` — comparing two indeterminate observations proves nothing,
 * so the phase must fail closed rather than run over it (PHEXEC-39).
 */
interface PathObservation {
  id: string;
  indeterminate: boolean;
}

async function snapshot(
  paths: readonly string[],
): Promise<Map<string, PathObservation>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await pathIdentity(path)] as const),
  );
  return new Map(entries);
}

/**
 * Returns a deterministic identity for one protected path. The kind prefix
 * keeps a missing path, a file, and a directory distinct; directory identities
 * cover every nested entry so modifying a directory link target cannot pass the
 * DR-003 before/after check merely because `readFile(directory)` fails. An
 * observation failure keeps the structure already seen — inode, link count —
 * but marks the whole observation indeterminate.
 */
async function pathIdentity(path: string): Promise<PathObservation> {
  try {
    const rootInfo = await lstat(path);
    if (rootInfo.isSymbolicLink()) {
      const target = await readlink(path);
      const followed = await followedPathIdentity(path);
      return {
        id: `symlink:${JSON.stringify(target)}:${followed.id}`,
        indeterminate: followed.indeterminate,
      };
    }
    return await identityForInfo(path, rootInfo);
  } catch (error) {
    if (isAbsentPathError(error))
      return { id: 'missing', indeterminate: false };
    return { id: `unreadable:${errorCode(error)}`, indeterminate: true };
  }
}

async function followedPathIdentity(path: string): Promise<PathObservation> {
  try {
    return await identityForInfo(path, await stat(path));
  } catch (error) {
    if (isAbsentPathError(error))
      return { id: 'missing', indeterminate: false };
    return { id: `unreadable:${errorCode(error)}`, indeterminate: true };
  }
}

async function identityForInfo(
  path: string,
  info: Stats,
): Promise<PathObservation> {
  if (info.isFile()) {
    // Content alone is not identity: a hard-link swap to byte-identical
    // content changes what the path IS without changing what it says
    // (PHEXEC-39).
    try {
      return {
        id: `file:${info.ino}:${info.nlink}:${await fileDigest(path)}`,
        indeterminate: false,
      };
    } catch (error) {
      return {
        id: `file:${info.ino}:${info.nlink}:unreadable:${errorCode(error)}`,
        indeterminate: true,
      };
    }
  }
  if (info.isDirectory()) {
    try {
      return {
        id: `directory:${await treeDigest(path)}`,
        indeterminate: false,
      };
    } catch (error) {
      return {
        id: `directory:unreadable:${errorCode(error)}`,
        indeterminate: true,
      };
    }
  }
  return {
    id: `other:${info.mode}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`,
    indeterminate: false,
  };
}

async function fileDigest(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/** Exact-content identity for a directory, including empty directories and links. */
async function treeDigest(root: string): Promise<string> {
  const records: string[][] = [];
  await collectTreeRecords(root, '', records);
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

async function collectTreeRecords(
  root: string,
  prefix: string,
  records: string[][],
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));

  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      records.push(['directory', relative]);
      await collectTreeRecords(path, relative, records);
    } else if (entry.isFile()) {
      // Structural like the top-level file identity: a nested hard-link
      // swap to byte-identical content must change the record (PHEXEC-39).
      const info = await lstat(path);
      records.push([
        'file',
        relative,
        `${info.ino}:${info.nlink}:${await fileDigest(path)}`,
      ]);
    } else if (entry.isSymbolicLink()) {
      records.push(['symlink', relative, await readlink(path)]);
    } else {
      const info = await lstat(path);
      records.push([
        'other',
        relative,
        String(info.mode),
        String(info.size),
        String(info.mtimeMs),
        String(info.ctimeMs),
      ]);
    }
  }
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

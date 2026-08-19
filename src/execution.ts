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
 * semantic source of truth. The host refuses target/input aliases and verifies
 * protected inputs afterward; sandboxing arbitrary unrelated writes remains a
 * host capability outside this boundary.
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
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import { errorCode, isAbsentPathError, messageOf } from './errors.js';

/** An opaque link option pair (PIPE-14), structurally compatible with the CLI's LinkOption. */
export interface LinkOptionPair {
  name: string;
  value: string;
}

/**
 * Host-supplied update-mode context for a compile step (DR-021, INCR-15).
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
   * chained input is byte-identical (another input changed), and `null` when a
   * useful line diff is unavailable.
   */
  diff: string | null;
}

/**
 * Renders the host-owned update instruction shared by interpreted prompts and
 * compiled performing prompts (INCR-16).
 */
export function updateContextLines(
  update: UpdateContext,
  target: string,
): string[] {
  const diff =
    update.diff === null
      ? [
          '- a useful line diff is unavailable; compare the prior and current inputs directly;',
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
    `- the existing output to update is: ${target};`,
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
      /** Update-mode context; absent for a fresh compile (DR-021, INCR-15). */
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
}

/** The result of a generic-checked phase run. */
export type PhaseResult =
  | { ok: true; target: string; diagnostics: string[] }
  | { ok: false; report: FailureReport };

/** Options for validating one planned host or executor write target. */
export interface SafeTargetOptions {
  /** Permit SLC's own deterministic files inside `.slc-verify`. */
  allowVerifierOutput?: boolean;
}

/**
 * Refuses an unsafe planned write without running an executor. This is shared
 * by phase targets and the runner's deterministic completion outputs.
 */
export async function assertSafeTarget(
  target: string,
  protectedPaths: readonly string[],
  opts: SafeTargetOptions = {},
): Promise<void> {
  await inspectTarget(target, protectedPaths, opts);
}

/** Whether two writable/readable path spellings currently name one file. */
export async function pathsAlias(
  left: string,
  right: string,
): Promise<boolean> {
  const leftPath = await prospectiveRealPath(resolve(left));
  const rightPath = await prospectiveRealPath(resolve(right));
  if (leftPath === rightPath) return true;
  try {
    const [leftInfo, rightInfo] = await Promise.all([stat(left), stat(right)]);
    return leftInfo.dev === rightInfo.dev && leftInfo.ino === rightInfo.ino;
  } catch (error) {
    if (isAbsentPathError(error)) return false;
    throw error;
  }
}

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
  /** Other semantic inputs read under the definition, protected but not transported. */
  protectedInputs?: readonly string[];
  /** Other planned paths that the target must not alias, but this phase does not read. */
  aliasInputs?: readonly string[];
  /** Host state transition that must succeed immediately before executor work. */
  beforeExecute?: () => void | Promise<void>;
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
    ...new Set([...inputs, ...definitions, ...(opts.protectedInputs ?? [])]),
  ];
  const targetProtectedPaths = [
    ...new Set([...protectedPaths, ...(opts.aliasInputs ?? [])]),
  ];

  let targetBefore: TargetObservation;
  try {
    targetBefore = await inspectTarget(target, targetProtectedPaths);
  } catch (error) {
    return failure(phase, target, [messageOf(error)]);
  }

  const before = await snapshot(protectedPaths);

  if (opts.beforeExecute) {
    try {
      await opts.beforeExecute();
    } catch (error) {
      return failure(phase, target, [messageOf(error)]);
    }
  }

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
    if (extname(target) !== targetExt) {
      reasons.push(
        `target "${target}" extension does not match the declared "${targetExt}"`,
      );
    } else {
      try {
        const targetAfter = await inspectTarget(target, targetProtectedPaths);
        if (!targetAfter.exists) {
          reasons.push(`expected target "${target}" was not written`);
        } else if (targetBefore.path !== targetAfter.path) {
          reasons.push(
            `target "${target}" changed physical location during the run`,
          );
        }
      } catch (error) {
        reasons.push(messageOf(error));
      }
    }
  }

  // Protected inputs and chain definitions are re-checked after any outcome, so
  // a mutation is caught even when the executor blocks, errors, or throws
  // (PHEXEC-5, PHEXEC-6).
  const after = await snapshot(protectedPaths);
  for (const path of protectedPaths) {
    if (before.get(path) !== after.get(path)) {
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
    return failure(phase, target, reasons);
  }
  return { ok: true, target, diagnostics: result?.diagnostics ?? [] };
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

async function snapshot(
  paths: readonly string[],
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await pathIdentity(path)] as const),
  );
  return new Map(entries);
}

/**
 * Returns a deterministic identity for one protected path. The kind prefix
 * keeps a missing path, a file, and a directory distinct; directory identities
 * cover every nested entry so modifying a directory link target cannot pass the
 * DR-003 before/after check merely because `readFile(directory)` fails.
 */
async function pathIdentity(path: string): Promise<string> {
  try {
    const rootInfo = await lstat(path);
    if (rootInfo.isSymbolicLink()) {
      const target = await readlink(path);
      return `symlink:${JSON.stringify(target)}:${await followedPathIdentity(path)}`;
    }
    return identityForInfo(path, rootInfo);
  } catch (error) {
    if (isAbsentPathError(error)) return 'missing';
    return `unreadable:${errorCode(error)}`;
  }
}

async function followedPathIdentity(path: string): Promise<string> {
  try {
    return await identityForInfo(path, await stat(path));
  } catch (error) {
    if (isAbsentPathError(error)) return 'missing';
    return `unreadable:${errorCode(error)}`;
  }
}

async function identityForInfo(path: string, info: Stats): Promise<string> {
  if (info.isFile()) return `file:${await fileDigest(path)}`;
  if (info.isDirectory()) return `directory:${await treeDigest(path)}`;
  return `other:${info.mode}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
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
      records.push(['file', relative, await fileDigest(path)]);
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

interface TargetObservation {
  /** Canonical existing path, or canonical prospective path for an absent leaf. */
  path: string;
  /** Whether the target is a private regular file rather than absent. */
  exists: boolean;
}

/**
 * Establishes the one pre/post target rule used by every executor: the target
 * is outside host-owned namespaces, does not alias a read input, and is absent
 * or a private regular file. An existing target may remain byte-identical when
 * the executor accepts that no semantic output change is needed.
 */
async function inspectTarget(
  target: string,
  protectedPaths: readonly string[],
  opts: SafeTargetOptions = {},
): Promise<TargetObservation> {
  const lexical = resolve(target);
  rejectReservedTarget(lexical, target, opts);

  let exists = false;
  let targetInfo: Stats | null = null;
  try {
    targetInfo = await lstat(lexical);
    if (targetInfo.isSymbolicLink()) {
      throw new Error(`target "${target}" is a symbolic link`);
    }
    if (!targetInfo.isFile()) {
      throw new Error(`target "${target}" is not a regular file`);
    }
    if (targetInfo.nlink !== 1) {
      throw new Error(`target "${target}" has multiple hard links`);
    }
    exists = true;
  } catch (error) {
    if (!isAbsentPathError(error)) throw error;
  }

  const physical = await prospectiveRealPath(lexical);
  rejectReservedTarget(physical, target, opts);
  for (const input of protectedPaths) {
    const conflict = await aliasesProtectedPath(
      physical,
      targetInfo,
      resolve(input),
    );
    if (conflict) {
      throw new Error(`target "${target}" aliases protected input "${input}"`);
    }
  }
  return { path: physical, exists };
}

async function aliasesProtectedPath(
  targetPath: string,
  targetInfo: Stats | null,
  input: string,
): Promise<boolean> {
  let inputInfo: Stats | null = null;
  try {
    inputInfo = await stat(input);
  } catch (error) {
    if (!isAbsentPathError(error)) throw error;
  }
  const inputPath = await prospectiveRealPath(input);
  if (targetPath === inputPath) return true;
  if (inputInfo?.isDirectory() && isWithin(inputPath, targetPath)) return true;
  return (
    targetInfo !== null &&
    inputInfo !== null &&
    targetInfo.dev === inputInfo.dev &&
    targetInfo.ino === inputInfo.ino
  );
}

/** Resolves a missing leaf through its nearest real directory ancestor. */
async function prospectiveRealPath(path: string): Promise<string> {
  const suffix: string[] = [];
  let cursor = path;
  while (true) {
    try {
      const resolved = await realpath(cursor);
      if (suffix.length > 0 && !(await stat(resolved)).isDirectory()) {
        throw new Error(`target parent "${cursor}" is not a directory`);
      }
      return resolve(resolved, ...suffix.reverse());
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
    }

    // `realpath` reports ENOENT for both an absent path and a dangling link.
    // An existing unresolved link is not a safe ancestor to write through.
    try {
      await lstat(cursor);
      throw new Error(`target path "${cursor}" cannot be resolved safely`);
    } catch (error) {
      if (!isAbsentPathError(error)) throw error;
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error(
        `target path "${path}" has no existing directory ancestor`,
      );
    }
    suffix.push(basename(cursor));
    cursor = parent;
  }
}

function rejectReservedTarget(
  path: string,
  display: string,
  opts: SafeTargetOptions,
): void {
  const parts = resolve(path).split(sep);
  if (
    parts.includes('.slc') ||
    (!opts.allowVerifierOutput && parts.includes('.slc-verify'))
  ) {
    throw new Error(`target "${display}" enters a host-owned slc directory`);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel !== '' &&
    rel !== '..' &&
    !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel)
  );
}

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
import { lstat, readFile, readdir, readlink, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

/** An opaque link option pair (PIPE-14), structurally compatible with the CLI's LinkOption. */
export interface LinkOptionPair {
  name: string;
  value: string;
}

/** What a phase execution is asked to produce: a compile target or a linked artifact. */
export type ExecuteRequest =
  | {
      kind: 'compile';
      /** Path to the phase definition, the semantic source of truth (PHEXEC-2). */
      definitionPath: string;
      source: string;
      target: string;
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
  /** Re-checks that the pipeline chain still infers; throws when it no longer does (PHEXEC-5). */
  revalidate?: () => void | Promise<void>;
  signal?: AbortSignal;
}): Promise<PhaseResult> {
  const { request, phase, targetExt, executor } = opts;
  const signal = opts.signal ?? new AbortController().signal;
  const target = request.kind === 'compile' ? request.target : request.linked;
  const inputs =
    request.kind === 'compile'
      ? [request.source]
      : [...request.objects, request.linkTarget];
  const definitions = [request.definitionPath, ...(opts.definitions ?? [])];
  const protectedPaths = [...new Set([...inputs, ...definitions])];

  const before = await snapshot(protectedPaths);

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
    if (!(await exists(target))) {
      reasons.push(`expected target "${target}" was not written`);
    } else if (extname(target) !== targetExt) {
      reasons.push(
        `target "${target}" extension does not match the declared "${targetExt}"`,
      );
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
    if (isMissing(error)) return 'missing';
    return `unreadable:${errorCode(error)}`;
  }
}

async function followedPathIdentity(path: string): Promise<string> {
  try {
    return await identityForInfo(path, await stat(path));
  } catch (error) {
    if (isMissing(error)) return 'missing';
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

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'unknown';
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

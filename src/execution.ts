// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Execution boundary orchestrator and generic checks (DR-003).
 *
 * `runPhase` performs only generic mechanics (PHEXEC-1): it snapshots the
 * protected inputs, runs an injected {@link PhaseExecutor} (interpreted in
 * IR-001 Task 9, compiled later), then applies the generic checks — the target
 * exists and its extension matches the declared one (PHEXEC-4), and the source,
 * objects, link target, and phase/link definition are unchanged (PHEXEC-5),
 * which also catches the input-mutating write-scope violations (PHEXEC-3,
 * PHEXEC-6). A `blocked` or `error` result, or any failed check, becomes a
 * failure report naming the phase, target, and reasons (PHEXEC-7, PHEXEC-9).
 *
 * The executor honors PHEXEC-2 by treating the passed definition as the
 * semantic source of truth. Broader write-scope enforcement (sandbox or
 * allowlist) is a host concern per DR-003 and is left as a future capability.
 * See specs/dev/phase-execution.md.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

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
      options: Record<string, string>;
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
  signal?: AbortSignal;
}): Promise<PhaseResult> {
  const { request, phase, targetExt, executor } = opts;
  const signal = opts.signal ?? new AbortController().signal;
  const target = request.kind === 'compile' ? request.target : request.linked;
  const protectedPaths =
    request.kind === 'compile'
      ? [request.source, request.definitionPath]
      : [...request.objects, request.linkTarget, request.definitionPath];

  const before = await snapshot(protectedPaths);

  let result: ExecutorResult;
  try {
    result = await executor.run(request, signal);
  } catch (error) {
    return failure(phase, target, [`executor threw: ${messageOf(error)}`]);
  }

  if (result.status !== 'ok') {
    return failure(phase, target, reasonsFor(result));
  }

  const reasons: string[] = [];
  if (!(await exists(target))) {
    reasons.push(`expected target "${target}" was not written`);
  } else if (extname(target) !== targetExt) {
    reasons.push(
      `target "${target}" extension does not match the declared "${targetExt}"`,
    );
  }

  const after = await snapshot(protectedPaths);
  for (const path of protectedPaths) {
    if (before.get(path) !== after.get(path)) {
      reasons.push(`protected input "${path}" changed during the run`);
    }
  }

  if (reasons.length > 0) {
    return failure(phase, target, reasons);
  }
  return { ok: true, target, diagnostics: result.diagnostics };
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
): Promise<Map<string, string | null>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await hashFile(path)] as const),
  );
  return new Map(entries);
}

async function hashFile(path: string): Promise<string | null> {
  try {
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  } catch {
    return null;
  }
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

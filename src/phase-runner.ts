// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * SLC phase-runner facade for compiled phase artifacts (PHEXEC-23, PHEXEC-24;
 * DR-005).
 *
 * A compiled `phase` artifact exposes a stable facade: a no-argument
 * {@link CreatePhaseRunner} factory whose {@link PhaseRunner.run} is handed the
 * {@link PhaseInput} (workspace paths, not contents), the host {@link RunnerPorts}
 * — Playbook's source-owned ports plus SLC's {@link FileCapability} — and an
 * `AbortSignal`, and returns a {@link PhaseResult}: a terminal `ok`/`blocked`/
 * `error` status with diagnostics drained for every status. `slc` maps that result
 * onto the DR-003 protocol with {@link mapPhaseResult}: `ok` proceeds to the
 * generic checks, `blocked` is the BLOCKED outcome, and `error` stops the pipeline
 * like a failed generic check.
 *
 * `PlaybookPorts` is the Playbook-owned contract; DR-005 binds SLC to it rather
 * than restating the port shape. It is imported here from the published
 * `@sublang/playbook/code/playbook` reference realization until Playbook exposes a
 * generic package surface (its `./runtime` entry), at which point this import
 * should move there. See specs/dev/phase-execution.md.
 */

import type { PlaybookPorts } from '@sublang/playbook/code/playbook';

import type { ExecutorResult } from './execution.js';
import type { FileCapability } from './file-capability.js';

/** What a compiled phase artifact is asked to produce: a compile target or a linked artifact (DR-005). */
export type PhaseInput =
  | { kind: 'compile'; source: string; target: string }
  | {
      kind: 'link';
      objects: string[];
      linkTarget: string;
      options: Record<string, string>;
      linked: string;
    };

/** A compiled phase's terminal outcome, with diagnostics drained for every status (DR-005). */
export interface PhaseResult {
  status: 'ok' | 'blocked' | 'error';
  diagnostics: string[];
}

/** The host capabilities a compiled phase receives: Playbook's ports plus SLC's file capability (DR-005, DR-008). */
export type RunnerPorts = PlaybookPorts & FileCapability;

/** The stable SLC phase-runner facade a compiled `phase` artifact exposes (DR-005). */
export interface PhaseRunner {
  run(
    input: PhaseInput,
    ports: RunnerPorts,
    signal: AbortSignal,
  ): Promise<PhaseResult>;
}

/** The default export of a compiled `phase` module: a no-options runner factory (DR-005). */
export type CreatePhaseRunner = () => PhaseRunner;

/**
 * Maps a compiled phase's {@link PhaseResult} onto the DR-003 execution-boundary
 * outcome consumed by `runPhase` (PHEXEC-24).
 *
 * The facade result (owned by the DR-005 artifact contract) and the executor
 * result (owned by the DR-003 boundary) are distinct types, so the compiled
 * executor crosses the boundary through this seam rather than casting: `ok`
 * proceeds to the generic checks, `blocked` is the BLOCKED outcome, and `error`
 * stops the pipeline like a failed generic check, with diagnostics surfaced for
 * every status.
 */
export function mapPhaseResult(result: PhaseResult): ExecutorResult {
  return { status: result.status, diagnostics: result.diagnostics };
}

/**
 * The `phase` linked format's entry point: a module's default export is the
 * {@link CreatePhaseRunner} factory named `createPhaseRunner` (DR-005).
 */
const PHASE_DEFAULT_EXPORT =
  /export\s+default\s+(?:async\s+)?(?:function\s+)?createPhaseRunner\b/;

/**
 * Reports whether a compiled artifact's source resolves to the linked `phase`
 * format: a module exposing the phase-runner facade as a `createPhaseRunner`
 * default export (DR-005). This is the static byte-level recognition the
 * pin-currency validator uses; the loader confirms the contract at run time.
 */
export function resolvesToPhase(source: string): boolean {
  return PHASE_DEFAULT_EXPORT.test(source);
}

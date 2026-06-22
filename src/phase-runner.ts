// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * SLC phase-runner facade for compiled `playbook` artifacts (PHEXEC-23,
 * PHEXEC-24; DR-005).
 *
 * A compiled `playbook` artifact default-exports a `PlaybookRuntimeFactory`
 * (`createPlaybookRuntime`). `slc` drives it host-side — `init` with a
 * `PlaybookPorts` adapter, one `handleBossInput` turn seeded from the
 * {@link PhaseInput}, then `dispose` — and derives a {@link PhaseResult}
 * (`ok`/`blocked`/`error`) that {@link mapPhaseResult} maps onto the DR-003
 * protocol: `ok` proceeds to the generic checks, `blocked` is the BLOCKED
 * outcome, and `error` stops the pipeline like a failed generic check.
 *
 * The non-interactive driving lives in the compiled executor; this module owns
 * the shared facade types, the static `playbook`-format recognition the
 * pin-currency validator uses, and the provisional seeding of a phase request
 * into the runtime's single Boss turn. See specs/dev/phase-execution.md.
 */

import type { ExecutorResult } from './execution.js';

/** What a compiled phase is asked to produce: a compile target or a linked artifact (DR-005). */
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
 * The `playbook` linked format's entry point: a module's default export is the
 * `PlaybookRuntimeFactory` named `createPlaybookRuntime` (DR-005).
 */
const PLAYBOOK_DEFAULT_EXPORT =
  /export\s+default\s+(?:async\s+)?(?:function\s+)?createPlaybookRuntime\b/;

/**
 * Reports whether a compiled artifact's source resolves to the linked `playbook`
 * format: a module exposing a `createPlaybookRuntime` default export (DR-005).
 * This is the static byte-level recognition the pin-currency validator uses; the
 * loader confirms the contract at run time.
 */
export function resolvesToPlaybook(source: string): boolean {
  return PLAYBOOK_DEFAULT_EXPORT.test(source);
}

/**
 * Seeds a phase request into the single non-interactive Boss turn `slc` hands
 * the runtime through `handleBossInput` (DR-005).
 *
 * PROVISIONAL: the concrete SLC-to-runtime seeding contract — how a `PhaseInput`
 * becomes the Boss text a runtime classifies — is pinned down by the first
 * reviewed `playbook` artifact. Until then `slc` passes the run's workspace
 * paths as JSON so a runtime's agents can act on them.
 */
export function seedPhaseTurn(input: PhaseInput): string {
  return JSON.stringify(input);
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// slc link artifact
// FSM path: ./link.fsm.ts
// Player binding: none (no delegated-player states)
// Adjudication strategy: LLM-judge per direct-Captain state (default)
// Boss-event mapping: LLM-judge classification. The FSM's `BOSS_REQUEST` entry
//   event carries no textual payload field, so no deterministic textual entry
//   event applies; it is declared as a classifier-selectable directive.
//   `BOSS_INTERRUPT` (target `link`) and the runtime-owned `BOSS_REPLY` are
//   derived by the shared factory from the FSM.
// Abort strategy: natural rejection (the captain invoke's onError lands the
//   machine quiescent in `failed`; control-plane failures reject the boundary).
//
// This is a thin link artifact: the FSM-interpreter machinery ships once in the
// shared `createXStatePlaybookRuntime(machine, spec)` factory. This module hands
// its FSM and a small per-playbook spec to that factory and adds no interpreter
// machinery of its own.

import { linkMachine } from './link.fsm.ts';

import type { PlaybookRuntimeFactory } from '@sublang/playbook/runtime';

import {
  createXStatePlaybookRuntime,
  defaultComposeCaptainPrompt,
  defaultComposePlayerPrompt,
  type PlaybookCaptainInput,
  type PlaybookPlayerInput,
  type XStatePlaybookRuntimeSpec,
} from '@sublang/playbook/xstate-runtime';

export type {
  CaptainCallOptions,
  CaptainResult,
  JsonValue,
  NormalizedError,
  PlaybookCallRequest,
  PlaybookCallResult,
  PlaybookCallStart,
  PlaybookPorts,
  PlaybookRunResult,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
  PlaybookSession,
  PlaybookState,
  PlaybookStateValue,
  PlaybookTraceEvent,
  PlayerCallOptions,
  PlayerResult,
} from '@sublang/playbook/runtime';

// The single LINK-1 prompt establishes no runtime-value placeholders, declares
// no players, and the machine makes no dynamic playbook call and no script
// call, so the linked runtime needs no per-run options.
export type PlaybookRuntimeOptions = Record<string, never>;

/**
 * Validate and JSON-snapshot the caller's per-run options. This playbook
 * declares none, so any own key is undeclared and rejected; `undefined` and an
 * empty object both bind an immutable empty options record.
 */
function snapshotOptions(value: unknown): PlaybookRuntimeOptions {
  if (value === undefined) return {};
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value as Record<string, unknown>).length > 0
  ) {
    throw new TypeError(
      'link playbook runtime accepts no options; received unexpected value',
    );
  }
  return {};
}

const spec: XStatePlaybookRuntimeSpec<PlaybookRuntimeOptions> = {
  label: 'link',
  // DR-022: compatibility values current at link time. `artifactSchema` is the
  // thin-module format this artifact was emitted in, and `runtimeAbi` is the
  // installed shared engine's RUNTIME_ABI self-report (verified present in its
  // SUPPORTED_ARTIFACT_SCHEMAS). The loading engine rechecks this and fails
  // construction on skew.
  compat: { artifactSchema: 1, runtimeAbi: 1 },
  snapshotOptions,
  // `BOSS_REQUEST` carries no textual payload field, so it cannot be a
  // deterministic textual entry event; it is offered to the classifier as a
  // fresh directive. Its contract is erased under TypeScript, so it is declared
  // here. The factory derives `BOSS_INTERRUPT` and the runtime-owned
  // `BOSS_REPLY` from the machine.
  bossEvents: [{ type: 'BOSS_REQUEST' }],
  // The FSM Boss-union payload string fields the transition-event descriptor
  // copies for telemetry (`targetId` on BOSS_INTERRUPT; `answer`/`questionId` on
  // BOSS_REPLY). These names are erased from the machine under TypeScript.
  transitionEventFields: ['targetId', 'answer', 'questionId'],
  // The LINK-1 domain body cites `<stateId>` as documentation — the script
  // status line and trace schema it specifies — not as a placeholder of this
  // playbook, but `CaptainInput` always carries `stateId`, so the canonical
  // token→field mapping would rewrite the normative body line. Map the token
  // to a field no input supplies so the line stays verbatim (slc/link.md
  // §Captain prompt composition, prompt integrity).
  placeholderFields: { stateId: 'stateIdDocumentationToken' },
  // The single captain-invoking state that can suspend for a Boss reply. The
  // machine's `awaitBossReply` also carries an empty-reply arm to `failed`,
  // which is not a resume target, so the precise resumable set is pinned here.
  resumableStateIds: new Set(['link']),
};

const createPlaybookRuntime: PlaybookRuntimeFactory<PlaybookRuntimeOptions> =
  createXStatePlaybookRuntime(linkMachine, spec);

export default createPlaybookRuntime;

// Pure composition helpers for compilation-correctness tests (slc/link.md
// §Output). This playbook overrides neither composer; these expose the shared
// defaults bound to the spec's placeholder exceptions, exactly as the factory
// wires them: continuation preamble + presence-based placeholder substitution.
export const _internal = {
  composePlayerPrompt: (input: PlaybookPlayerInput): string =>
    defaultComposePlayerPrompt(input, spec.placeholderFields),
  composeCaptainPrompt: (input: PlaybookCaptainInput): string =>
    defaultComposeCaptainPrompt(input, spec.placeholderFields),
};

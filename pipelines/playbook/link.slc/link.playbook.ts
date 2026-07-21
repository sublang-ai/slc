// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// slc link artifact
// FSM path: ./link.fsm.ts
// Player binding: none (no delegated-player states; the sole actor is the
//   direct Captain, which bypasses player binding and is served by
//   PlaybookPorts.callCaptain)
// Adjudication strategy: LLM-judge per direct-Captain state (default)
// Boss-event mapping: LLM-judge classification. The FSM's `COMPILE` entry event
//   carries no textual payload field, so no deterministic textual entry event
//   applies; it is declared as a classifier-selectable directive. `BOSS_INTERRUPT`
//   (targets ready/compile/failed) and the runtime-owned `BOSS_REPLY`/`NO_ACTION`
//   are derived by the shared factory from the FSM.
// Abort strategy: natural rejection (the captain invoke's onError lands the
//   machine quiescent in `failed`; control-plane failures reject the boundary).
//
// This is a thin link artifact: the FSM-interpreter machinery (actor wiring,
// boundary tracing, Boss-event classification, Captain adjudication, Boss-reply
// suspension, session lifecycle, abort handling, snapshot/restore) ships once in
// the shared `createXStatePlaybookRuntime(machine, spec)` factory. This module
// hands its FSM and a small per-playbook spec to that factory and adds no
// interpreter machinery of its own. It imports no `xstate`, `p-queue`, or
// `node:child_process`, holds no host types, never talks to LLMs directly (it
// speaks only `PlaybookPorts`), and does not modify the FSM or re-derive Captain
// prompts, result keys, or guard semantics.

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

// Single shared contract: re-export the names consumers import rather than
// redefining them, so every linked playbook shares one contract definition
// (slc/link.md §Output).
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
// no players, and the machine makes no dynamic playbook call and no script call,
// so the linked runtime needs no per-run options.
export type PlaybookRuntimeOptions = Record<string, never>;

/**
 * Validate and JSON-snapshot the caller's per-run options (slc/link.md §Output).
 * This playbook declares none, so any own key is undeclared and rejected;
 * `undefined` and an empty object both bind an immutable empty options record.
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

// Everything the factory cannot read from the FSM artifact's own data
// (slc/link.md §Output). Options validation, actor provisioning, prompt
// composition, classification, adjudication, statuses, and the abort strategy
// are the factory's generic defaults, which implement the behavioral sections
// of the link spec.
const spec: XStatePlaybookRuntimeSpec<PlaybookRuntimeOptions> = {
  label: 'link',
  snapshotOptions,
  // `COMPILE` carries no textual payload field, so it cannot be a deterministic
  // textual entry event; it is offered to the classifier as a fresh directive.
  // Its contract is erased under TypeScript, so it is declared here. The factory
  // derives `BOSS_INTERRUPT` and the runtime-owned `BOSS_REPLY` from the machine.
  bossEvents: [{ type: 'COMPILE' }],
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
  // machine's `awaitBossReply` also carries an empty-reply arm to `failed`, which
  // is not a resume target, so the precise resumable set is pinned here.
  resumableStateIds: new Set(['compile']),
};

/**
 * The per-playbook runtime factory: `(options) => PlaybookRuntime`. The shared
 * engine interprets the `link` FSM under the slc/link.md contract.
 */
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// GEARS-to-FSM artifact for the `gears2fsm` playbook.
// Compiled from gears2fsm.gears.md (G2F-1).
// Object artifact only: it defines the machine, the typed Captain actor
// contract, and typed inputs. It binds no runner and supplies no concrete
// Captain implementation; the runner provides `captain` via `.provide(...)`.

import { assign, fromPromise, setup } from 'xstate';

// ---------------------------------------------------------------------------
// Actor contract
// ---------------------------------------------------------------------------

/**
 * A clarifying question the acting agent raised that only Boss can answer.
 * `questionId` and `resumeStateId` both equal the suspended working leaf's
 * stable `stateId`; `player` is the literal `Captain` for a direct-Captain
 * state.
 */
export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

/**
 * Input handed to the Captain actor for one invocation.
 * `result` keys are the valid guard names this invocation may return; they are
 * authoritative *per state*, not a global union. There is no `player` field: a
 * direct-Captain state never carries an invented `Captain` player binding.
 */
export interface CaptainInput {
  stateId: string;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  /** Present on resume so the runtime can compose the continuation prompt. */
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

/**
 * Discriminated Captain result: one literal `guard` member per authored result
 * key plus the universal `needsBossReply`, each carrying exactly the payload its
 * guard requires. A catch-all `guard: string` shape would be malformed.
 */
export type CaptainOutput =
  | { guard: 'compiled' }
  | { guard: 'rejected' }
  | { guard: 'needsBossReply'; question: string };

// ---------------------------------------------------------------------------
// Machine context / events / input
// ---------------------------------------------------------------------------

export interface Gears2fsmContext {
  /** Inspection-only snapshot of the last Captain result. Never branched on. */
  lastResult?: CaptainOutput;
  /** Inspection-only capture of the last error that routed to `failed`. */
  lastError?: unknown;
  /** Set while suspended in `awaitBossReply`. */
  pendingBossQuestion?: PendingBossQuestion;
  /** Boss's answer, carried into the resumed state's continuation prompt. */
  bossReply?: string;
}

/**
 * Boss surfaces:
 * - `COMPILE` — typed entry event on idle/recoverable states that starts a
 *   fresh transformation; the source declares no per-run parameters, so it
 *   carries no payload.
 * - `BOSS_INTERRUPT` — pre-emptive jump into an active state by stable id.
 * - `BOSS_REPLY` — Boss's answer to a suspended acting-agent question; the
 *   scalar form fills the sole pending id when `questionId` is omitted.
 */
export type Gears2fsmEvent =
  | { type: 'COMPILE' }
  | { type: 'BOSS_INTERRUPT'; targetId: string }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

/**
 * Per-run parameters copied into context at start-up. The single G2F-1 prompt
 * establishes no runtime-value placeholders, declares no players, and the
 * machine makes no dynamic playbook call, so no fields are required here.
 */
export type Gears2fsmInput = Record<string, never>;

// ---------------------------------------------------------------------------
// Standard adjudicator-facing description for the Boss-reply suspension path.
// Carries the load-bearing substring `Output shall include \`question:` so the
// runtime's adjudicator requires `question` in the JSON reply.
// ---------------------------------------------------------------------------

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// ---------------------------------------------------------------------------
// State-id registries for the Boss-control helpers.
// ---------------------------------------------------------------------------

/** Jumpable targets for `BOSS_INTERRUPT` (active work + quiescent sinks). */
const INTERRUPT_IDS = ['ready', 'compile', 'failed'] as const;

/** Every captain-invoking state can suspend for a Boss reply and resume. */
const RESUMABLE_IDS = ['compile'] as const;

// ---------------------------------------------------------------------------
// Boss-control transition helpers (emitted, not hand-written per state).
// ---------------------------------------------------------------------------

/**
 * Parameterless registered action names, usable as bare-string references; kept
 * as literals so helpers never widen to `string`. (`setPendingBossQuestion`
 * takes params and is referenced only via the `{ type, params }` object form.)
 */
type SimpleActionName =
  | 'startTransform'
  | 'captureBossReply'
  | 'clearBossReplyContext'
  | 'recordEmptyReply';

/**
 * One guarded `BOSS_INTERRUPT` arm per jumpable state, targeting `#<id>` with
 * `reenter: true` so the invoked actor restarts cleanly. Optional `extraActions`
 * run before the jump (used on `awaitBossReply` to clear pending context).
 */
function bossInterrupts(
  ids: readonly string[],
  extraActions: readonly SimpleActionName[] = [],
) {
  return {
    BOSS_INTERRUPT: ids.map((id) => ({
      guard: { type: 'isInterruptTarget' as const, params: { id } },
      target: `#${id}`,
      reenter: true,
      actions: [...extraActions],
    })),
  };
}

/**
 * One `BOSS_REPLY` arm per registered captain-invoking state, guarded on the
 * pending question's `resumeStateId` and targeting `#<id>` with `reenter: true`.
 * `captureBossReply` records the answer so the resumed state's `invoke.input`
 * carries it; pending context is intentionally NOT cleared on the resume arm.
 */
function resumableStates(ids: readonly string[]) {
  return {
    BOSS_REPLY: ids.map((id) => ({
      guard: { type: 'isResumeTarget' as const, params: { id } },
      target: `#${id}`,
      reenter: true,
      actions: ['captureBossReply' as const],
    })),
  };
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const gears2fsmMachine = setup({
  types: {
    context: {} as Gears2fsmContext,
    events: {} as Gears2fsmEvent,
    input: {} as Gears2fsmInput,
  },
  actors: {
    // Typed placeholder: the runner must supply the real Captain via `.provide`.
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    isInterruptTarget: ({ event }, params: { id: string }) =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === params.id,
    isResumeTarget: ({ context, event }, params: { id: string }) =>
      event.type === 'BOSS_REPLY' &&
      event.answer.trim().length > 0 &&
      context.pendingBossQuestion?.resumeStateId === params.id,
    isEmptyBossReply: ({ event }) =>
      event.type === 'BOSS_REPLY' && event.answer.trim().length === 0,
  },
  actions: {
    /** Start a fresh Boss-initiated turn: reset inspection scratch. */
    startTransform: assign({
      lastResult: () => undefined,
      lastError: () => undefined,
    }),
    /** Suspend: record the pending question; clear any stale Boss answer. */
    setPendingBossQuestion: assign((_args, params: PendingBossQuestion) => ({
      pendingBossQuestion: params,
      bossReply: undefined,
    })),
    /** Capture Boss's answer for the continuation prompt on resume. */
    captureBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
    }),
    /** Drop pending-question context on any non-resume exit / normal outcome. */
    clearBossReplyContext: assign({
      pendingBossQuestion: () => undefined,
      bossReply: () => undefined,
    }),
    /** Record a malformed empty Boss reply for inspection in `failed`. */
    recordEmptyReply: assign({
      lastError: () =>
        new Error('BOSS_REPLY received an empty or whitespace-only answer.'),
    }),
  },
}).createMachine({
  id: 'gears2fsm',
  initial: 'ready',
  context: (): Gears2fsmContext => ({
    lastResult: undefined,
    lastError: undefined,
    pendingBossQuestion: undefined,
    bossReply: undefined,
  }),
  // Root-level Boss interrupts: reachable from any active state.
  on: {
    ...bossInterrupts(INTERRUPT_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Idle; waiting for Boss to request a GEARS-to-FSM transformation.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Idle; waiting for Boss to request a GEARS-to-FSM transformation.',
        },
      },
      on: {
        COMPILE: {
          target: '#compile',
          actions: ['startTransform', 'clearBossReplyContext'],
        },
      },
    },

    compile: {
      id: 'compile',
      description:
        'Captain compiles the source GEARS spec items into an XState v5 finite-state-machine object artifact.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'compile',
          description:
            'Captain compiles the source GEARS spec items into an XState v5 finite-state-machine object artifact.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'compile',
          sourceItem: 'G2F-1',
          prompt: [
            "Transform the source's normative GEARS spec items into an XState v5 finite state machine.",
            'Produce an object artifact only: define the machine, actor contracts, and typed inputs, but do not bind a runner or supply concrete runtime implementations.',
            "Use XState v5's `setup(...)` then `.createMachine(...)`.",
            'Restrict the artifact to erasable TypeScript syntax — type annotations that strip cleanly, with no constructor parameter properties, `enum`s, or namespaces — so a host running under type stripping loads it directly.',
            "Pass the repository's strict `noUnusedLocals` and `noUnusedParameters` checks: make helper signatures and XState callbacks omit values they do not read; for example, a fresh-context helper that uses only `bossIntent` shall not also accept an unused `context`, and an assign callback that reads only `event` shall destructure only `event`.",
            "Declare only `context`, `events`, machine `input`, and machine `output` in the `types` block; never emit `types: { actors: ... }`, because XState v5's `SetupTypes` has no `actors` property and that invalid form prevents registered action and actor names from type-checking.",
            "Declare a distinct typed actor contract in `setup(...)`'s top-level `actors` map for every actor kind the GEARS artifact uses, using typed actor logic such as `fromPromise<Output, Input>(...)`: `captain` for direct work performed by Captain; `player` for work Captain delegates to a named player; `playbook` for a nested playbook call; and `script` for a deterministic shell script an optimizer-introduced script item runs without any agent.",
            'Do not declare, register, export, or import an actor kind the GEARS artifact does not use; a playbook with direct Captain work and nested calls but no delegated player therefore has `captain` and `playbook` contracts only.',
            'Because XState may expose output from heterogeneous invoked actors as `unknown` in shared guards and actions, make generated helpers accept an unknown event and narrow its `output` or `error` structurally to the declared actor contract before reading fields, and do not rely on unchecked `event.output` inference.',
            'Make helpers that construct transition arrays preserve guard, action, and target literals with `as const`, `satisfies`, or typed action/guard functions rather than widening registered names to plain `string`.',
            "Do not import a runner or bake in concrete actor implementations; make each actor placeholder fail explicitly (for example, throw `'captain actor must be provided by the runner'`).",
            'Where the source artifact begins with an SPDX comment block, preserve its license and copyright text before the imports using valid TypeScript line comments, and never copy Markdown HTML comment delimiters into a TypeScript target.',
            "Declare `CaptainInput` as a typed object with at least `stateId` (the stable id of the invoking working leaf), `sourceItem` (the GEARS item ID this state realizes), `prompt` (the source item's full final prompt, verbatim), and `result` (a record whose keys are the valid guard names this invocation may return).",
            'Declare `PlayerInput` as a typed object with at least `stateId`, `player` (the player Captain is to invoke), `sourceItem`, `prompt`, and `result`, with the same field meanings.',
            "Declare `ScriptInput` as a typed object with at least `stateId`, `sourceItem`, `command` (the script item's blockquote text, verbatim after Markdown unescaping), and `result` (a record whose keys are the item's two declared guard names, first the zero-exit guard, then the nonzero-exit guard).",
            'Declare `ScriptOutput` as a discriminated union with one literal `guard` member per declared result key and a required `exitStatus: number` property; the script contract carries no prose output, so downstream prompts shall not depend on text a script produces.',
            'Declare `CaptainOutput` and `PlayerOutput` as discriminated unions, each with one literal `guard` member per authored result key and every payload field required by that result as a required property; a catch-all `guard: string` interface with optional look-alike fields is not a discriminated contract and is malformed.',
            'Export the machine input plus every Captain, player, and playbook actor input/output type the linker must provide, so the linked module imports those exact types and does not redeclare near-duplicates that can drift in optional fields, dynamic-call metadata, question ids, or child result shapes.',
            "Give any recursive JSON value type in the artifact exactly the shared boundary's readonly variance — `type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };` — and use that readonly type for nested-playbook output, completed-result evidence, plans, context, and machine output rather than a mutable array/record near-duplicate, so the linker need not cast or copy around a variance mismatch.",
            'Back every runtime-value placeholder that Source establishes in a direct-Captain or delegated-player prompt with a typed actor-input field populated from typed machine context, so the linker can substitute the exact runtime value; treat angle-bracketed metavariables quoted inside domain instructions (for example the literal `<model>` in a commit-message format) as ordinary prompt text rather than runtime-value placeholders.',
            "For the generic Captain forms, wire `<boss-intent>` from `bossIntent`, `<enabled-playbooks>` from `enabledPlaybooks`, `<remaining-plan>` from `remainingPlan`, and `<completed-call-results>` from `completedCallResults`; retain any other placeholder's semantic typed field established by Source (for example `<#>` from `irNumber`); and make the sole blockquote placeholder of a dynamic nested-playbook item the child `textContext` field instead.",
            'Never leave a placeholder literal, replace it with an empty default because its field was omitted, or make the linker recover it from untyped context.',
            "Make the generic Captain's `enabledPlaybooks` field an immutable array of exact entries `{ id: string, command: string, intent: string }`, not an array of ids or an open record; its dynamic-call guard checks `entry.id`, while the linked runtime validates, snapshots, and deterministically renders all three fields.",
            "Specify and interpret guard names per state, not as a global union, because a global union encourages name reuse with divergent semantics and couples unrelated states; shared helpers may accept `string`, but each state's `invoke.input.result` is the authoritative local contract.",
            "For an acting GEARS item, derive the result contract only from the ordered bullets under the item's out-of-blockquote `Results:` label; match every declared guard name to `[A-Za-z_$][A-Za-z0-9_$]*`; preserve every guard name, order, and description verbatim; reject a missing, duplicate, blank, or malformed declaration; and do not infer a result contract from acting-prompt prose or transition implementation.",
            'Treat an acting item that declares no `Results:` label as having exactly one outcome, and give such a state the default single-outcome contract: one result `done` with the fixed description `The acting agent completed the behavior.`, plus the universal `needsBossReply` below.',
            'Allow a single-outcome item to instead carry exactly one authored `Results:` bullet when a later prompt consumes its output, deriving the one-guard contract from that bullet; never apply the default to an item carrying a `Results:` label; and never let the default license inferring any richer contract from prose.',
            'Make the default `done` transition self-driving: target the next workflow obligation, or a `final` state when the item is the last one.',
            "Make the item's blockquote alone become `invoke.input.prompt`; the `Results:` label and bullets shall never enter that prompt.",
            'Make each result description name every additional output field its accepting guard requires, using exact case-sensitive property names — for example, a delegation or continuing-call description names `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`; a direct or final response names `response`; and an authored question names `question` — treating a vague description such as "selected the next call" as malformed when its guard also requires structured fields, since deterministic verification synthesizes valid actor output from this local result contract and shall not infer hidden guard payloads from guard source text.',
            'For the default generic Captain decide-call-observe pattern, treat the local guard discriminants as a stable compiler contract rather than names to invent: initial routing uses `question` with required `question` and `delegation` with required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`, and has no direct or terminal result; post-child reassessment uses `final` with required `response`, `followUpQuestion` with required `question`, and `continuing` with required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`.',
            'Additionally give both direct-Captain decide-call-observe states the universal `needsBossReply` result, and make their guards and actions use those exact case-sensitive names so the compiled adjudication contract remains stable.',
            'For each state, declare a stable `id` (for `#id` targeting and Boss interrupts), an intuitive state key (the property name under `states: { ... }`), a one-line `description` (for inspector tools and documentation), and JSON-safe `meta: { playbook: { stateId, description } }` repeating its stable id and description so linked runtimes can discover active public identities through `snapshot.getMeta()` without private XState nodes.',
            'If a state invokes the direct `captain` actor, carry `invoke.input` with `sourceItem`, `prompt`, and `result`; if it invokes the delegated `player` actor, additionally carry `player`; if it invokes the `script` actor, carry `invoke.input` with `stateId`, `sourceItem`, `command`, and `result`, with no `prompt` and no `player`.',
            "Put the source item ID in `invoke.input.sourceItem`, not in a comment, to keep the GEARS-to-state mapping machine-readable; make a delegated state's `invoke.input.player` match its source item's named player; and never invent a `Captain` player binding for a direct Captain state.",
            'Tag every invoking working leaf — sequential or parallel, whatever its actor kind — `playbook.busy`, because the shared quiescence helper derives busyness strictly from active-state tags and an untagged working leaf reads as quiescent while its call is still in flight.',
            "Make the machine's initial state a quiescent idle hub with no `invoke` — typically `ready` — that accepts the Boss entry events and carries the `playbook.parked` tag because it can return control to Boss; because Captain- and player-invoking work begins only on a Boss-originated event, constructing and starting the machine performs no agent call.",
            "Have each direct Captain or delegated player actor return a discriminated result with `guard` set to one of `input.result`'s keys, and have guards on `onDone` transitions inspect `event.output.guard` to route.",
            "Map each Source spec item to exactly one state in Target, with that state's `invoke.input.sourceItem` set to the item's ID and `invoke.input.prompt` carrying the item's prompt verbatim.",
            "Map an item written as direct Captain work to exactly one `captain` invocation; an item that prompts or relays to a named player to exactly one `player` invocation; a nested-call item to exactly one `playbook` invocation; and a script item (`Captain shall run:`) to exactly one `script` invocation whose `input.command` carries the blockquote verbatim and whose `result` preserves the item's two guards in declared order.",
            'Do not infer one actor kind from a runtime player name and do not encode Captain as a player.',
            'Treat a script state as not agent-invoking: do not add `needsBossReply` to its result map and do not register it with `resumableStates(ids)`.',
            "Make a script state's success guard target the next workflow step and its failure guard route to `failed` unless the source items define a different recovery.",
            'Because each spec item already carries the full final prompt for one state behavior with no duplicate lines, do not concatenate prompts across items, re-compose them, or silently dedupe.',
            'Treat a spec item that still contains duplicate prompt lines as malformed, and reject or flag it rather than silently propagating the duplication into `invoke.input.prompt`.',
            "Compile items carrying the same `Parallel group: <id>` metadata into one compound state with `type: 'parallel'` and one region per item.",
            'Require each parallel member to be a delegated-player item, and treat a direct-Captain or nested-call member as malformed because those actor kinds share one Captain control lane or one pending-child slot.',
            "Make each region contain a delegated-player working leaf and a local final state, with the working leaf retaining the item's stable state id, `sourceItem`, player, prompt, and result contract.",
            'Make the parallel parent use `onDone` as the join, which XState takes only after every region reaches final.',
            'Make each branch assign only its own staged result, and make the join promote all staged results atomically before later work begins, so branch completion order cannot change downstream inputs.',
            'Forbid transitions between sibling regions.',
            'Tag parallel working leaves `playbook.busy`.',
            'For a branch that supports Boss-reply suspension, use a local waiting leaf tagged `playbook.parked` rather than exiting the parallel parent, and make `BOSS_REPLY` identify and reenter only the waiting branch.',
            'If several branch questions are pending, make the event carry a stable question id and make the classifier not guess among them.',
            "Allow a fresh entry event or root interrupt to exit the complete parallel parent, and make it clear the parent's staged results and branch questions.",
            "Treat a fixed parallel parent as one jumpable unit: generate a stable id and root `BOSS_INTERRUPT` target for the parallel parent, not for any working leaf inside its regions; branch working ids remain valid internal resume targets for their branch-local `BOSS_REPLY` and shall not appear in the interrupt target union or classifier catalog, which prevents a nominal one-branch jump from implicitly entering or restarting the parent's other regions.",
            'Make an invoke error exit to the root failure state, allowing XState to stop the sibling invocations automatically.',
            'Compile an item whose behavior is a literal or dynamic `Captain shall call playbook ...:` to a state that invokes a typed `playbook` actor, not the `captain` or `player` actor.',
            'Declare `PlaybookInput` in the setup types with stable `stateId`, target `playbookId`, composed `text`, and optional `sourceItem`.',
            "Treat the playbook actor's successful output as the child's JSON-safe machine output itself (or `undefined`), not a second wrapper carrying a synthetic status or `output` field, so `invoke.onDone` records `event.output` as the successful child output while aborted and error call results reject the actor and reach `invoke.onError`.",
            'Supply a failing placeholder for `playbook`, just as for `captain` and `player`; the linked runtime provides the actor implementation.',
            'For a literal call, keep `playbookId` as the literal target and `text` as the composed GEARS blockquote.',
            "For a dynamic call written ``Captain shall call playbook selected by `<target-field>`:``, declare the named target field and the blockquote's text field as typed string fields in FSM context, and require the dynamic `PlaybookInput` variant to carry string-valued `playbookIdContext` and `textContext` metadata fields.",
            "Make the dynamic call's `invoke.input` read the runtime `playbookId` and `text` from those exact context fields and also carry static metadata: `stateId`, `sourceItem`, `playbookId` read from the target context field, `text` read from the text context field, `playbookIdContext` as the string literal naming the target context field, and `textContext` as the string literal naming the text context field.",
            "Treat `playbookIdContext` and `textContext` as naming context fields that never contain runtime target or text values; emit them as explicit string literals so conformance tools can verify context wiring without evaluating or parsing the `invoke.input` function's source; make the evaluated `playbookId` and `text` each be strings drawn from the context field named by its corresponding metadata property; and let literal calls omit these dynamic metadata properties and retain their existing behavior.",
            "Tag the call state `playbook.suspended`, route `invoke.onDone` from child output and `invoke.onError` from child failure, and keep the child call state-scoped so leaving the call state stops the invoked actor and aborts the host call through XState's invocation signal.",
            'Do not allocate runtime call ids, construct child sessions, retain runtime promises, or route Boss text to the child.',
            'When Source explicitly continues one downstream behavior after a child success, abort, or failure, make both `invoke.onDone` and `invoke.onError` record the corresponding JSON-safe child result and target that downstream behavior; use the generic `failed` state as the default only when Source declares no recovery or reassessment path for a rejected child.',
            "Make that recovering `onError` an ordered transition array whose first arm uses a typed structural guard accepting only an `Error` carrying a validated public child `result` with `status: 'aborted' | 'error'` and only then appends sanitized child evidence and continues, and whose fallback arm retains the control error normalized as JSON-safe `{ name, message, stack? }` in `lastError` and routes to `failed` without appending a completed child result while the linked runtime alone retains the original error in its out-of-machine latch.",
            'Treat non-abort port rejection, malformed port data, JSON, identity, bridge, and other control-plane errors as not authored child outcomes even though XState delivers both kinds through `invoke.onError`.',
            "Where the rejected error structurally carries the runtime's normalized child result, have the error action inspect whether its status was `aborted` or `error` and not collapse both into an invented success/failure enum; the FSM may inspect that public structural data without importing the runner or constructing runtime call identities.",
            "For a workflow that reassesses child results, use a typed JSON-safe record such as `{ playbookId, status: 'ok', output }` on `onDone` and `{ playbookId, status: 'aborted' | 'error', error }` on `onError`.",
            'Because the runtime rejection is an `Error` with a public `result` property, make normalization inspect `result.status` and `result.error` before applying a generic `Error` normalizer, and persist only the current context target id, the status, and a compact `{ name, message }` error — never the whole runtime result, child session id, child state, call identity, or stack.',
            'Give an abort without an error a compact generic abort description, and keep the current target id available in typed context until the sanitized record has been created.',
            'On success, persist only `event.output`, the actual child machine output returned by the bridge, not a runtime call-result envelope; when that optional output is absent, omit the `output` property from the completed-result record rather than storing `undefined`.',
            'Because the outer trusted error is an actual `Error` instance and not a plain JSON object, have the structural guard inspect its public `.result` property directly, then validate only that nested result before sanitizing it, without requiring the outer error itself to pass a plain-object/JSON guard.',
            "Validate that nested public result's status-specific required members and target identity: `playbookId` shall equal the current selected target, an `error` result shall carry a normalized error, and every optional member that is present shall have the public contract's declared shape.",
            "Treat a look-alike such as `{ status: 'error' }` as malformed control data rather than an authored child failure, sending it to the fallback `failed` arm without appending evidence, and do not fabricate missing identity or error members merely because the status string happens to be recognized.",
            "Treat the public result's declared optional `childSessionId` and `state` members as valid when their shapes satisfy the shared contract — validate and then discard them when building compact Captain evidence rather than treating them as undeclared extras — and likewise validate the public normalized error's declared optional string `stack` and omit it from the compact `{ name, message }` evidence rather than rejecting an otherwise valid authored child result.",
            'Apply the public union exactly: an `aborted` or `error` result shall reject an `output` member; `childSessionId`, when present, shall be non-empty; `error` shall contain only non-empty `name`, string `message`, and optional string `stack`; and `state`, when present, shall validate every declared `PlaybookState` member and reject unknown or missing members; treating an arbitrary JSON-safe object as a valid `state`, or checking only that these members have broad string/object types, is not complete public-result validation.',
            'In other words, have the guard validate the complete public result it received while the action retains only the current selected playbook id, status, and compact error; do not implement evidence minimization by accepting only the three keys that survive that projection.',
            'Before entering a dynamic call, reject an empty target and empty input text, any target equal to `selfPlaybookId`, and any target that Source requires to belong to an input catalog but that catalog does not contain; perform rejection before invoking the `playbook` actor, while the host remains responsible for its independent registry validation.',
            'Where Source forbids repeating an equivalent completed or failed call without new information, keep a private deterministic history of target-and-input signatures and reject a continuation whose target and complete input exactly match a prior call; encode each signature as the collision-free `JSON.stringify([playbookId, text])` tuple of exact JavaScript strings, not delimiter concatenation, and append it before invocation so success, abort, and authored failure all count; keep that history out of any Captain or player prompt; and treat a revised input containing new information as a different call.',
            "Treat the exact machine check as a safety floor while the acting Captain remains responsible for Source's broader semantic equivalence policy.",
            "Put that validation on the guarded transition into the call state, and make the call state's `invoke.input` mapper a pure read of the already-validated typed context fields that does not call an assertion helper or throw while XState resolves actor input, so state restoration, inspection, and scripted coverage do not crash outside the invocation's `onError` boundary.",
            'For the default Captain decide-call-observe loop, make the delegation and continuing `onDone` arms transition directly into the invoking call state; give each arm a single guard that validates its applicable actor-output and context constraints — both validate JSON shape, catalog membership, self-target, and duplicate history, while strict plan shrink applies only to `continuing` — and have its actions store the selected target/input and append the signature before state entry; do not interpose an eventless preparation or validation state between the Captain actor and the call state.',
            'Make context fields used to drive guards or compose prompts typed and named; do not branch on untyped properties of `lastResult`; keep persistent routing decisions in typed context fields; and use `lastResult` for inspection only.',
            'Where Source declares a finite ordered plan, represent it as a typed readonly JSON-safe array and validate that shape on the actor-output transition, since an unconstrained `JsonValue` does not establish that a plan is ordered or finite.',
            'Where a decide-call-observe loop carries the calls after the selected next call as `remainingPlan`, make its continuing-call guard additionally require the new plan to be strictly shorter than the current plan, so that although the Captain may revise or remove remaining entries as evidence arrives it cannot grow or retain the same-length plan indefinitely, and the initial finite array bounds the number of sequential child calls without an arbitrary runtime call limit.',
            'Pass only the specific extracted fields the player needs, and never dump `JSON.stringify(lastResult)` or any opaque blob, which leaks internal `guard` strings, wastes tokens, and confuses the LLM.',
            "Flow player bindings and per-run parameters in via the machine's `input` and copy them into context at start-up; do not bake in player bindings, model names, or per-run values.",
            'Keep host-owned configuration such as an enabled-playbook catalog as immutable machine input/context for the session, and never let Boss events or actor outputs carry, replace, append to, or otherwise overwrite that catalog.',
            'Give every machine with a dynamic call its own registered or authored playbook id as immutable machine input/context named `selfPlaybookId`, make its dynamic-call guard reject that target, and never reuse the leaf-level `stateId` name — reserved for actor invocation identity — for a playbook id.',
            'Make JSON-safe context and output records omit absent optional members instead of creating own properties whose value is `undefined`.',
            'Make JSON validation accept only null, booleans, finite numbers, strings, arrays, and plain own enumerable data-property objects, and reject cycles, non-plain instances (`Error`, `Date`, `Map`, and class instances), accessors, symbol keys, sparse/undefined values, `NaN`, and infinities rather than silently changing them during serialization.',
            'Require an accepted array to have prototype exactly `Array.prototype`, no holes, symbols, accessors, or extra own string properties, and enumerable own data descriptors for every canonical index, with its standard non-enumerable `length` descriptor the sole exception; that `length` data descriptor shall be non-configurable and carry the exact array length, while its `writable` flag may be `true` on an ordinary array or `false` after the shared runtime recursively freezes a validated boundary value; `Reflect.ownKeys(array)` shall contain exactly `length + 1` keys — the `length` property and every canonical index from `0` through `length - 1` — and a digit string whose numeric value is not less than `length` is an extra property, not an array index.',
            'Require an accepted record to have prototype exactly `Object.prototype` or `null`, with every key returned by `Reflect.ownKeys` a string whose own descriptor is enumerable and a data descriptor.',
            'Make cycle detection track only the active recursion path and remove a container on unwind, so a shared acyclic array or record is valid while an actual back-edge is rejected.',
            'Fire a transition on an event — typically `onDone` (actor completed) — and, when multiple are possible, let a synchronous guard pick the path.',
            'Persist relevant typed fields from `event.output` to context via `assign` so downstream prompts can read them.',
            'Make transitions self-driving when source items define the next obligation, and route to an idle hub only for recovery, unrecoverable Boss input, or one-shot entry events — not the happy path.',
            "Make a review/approval state's success outcome target the next workflow step, not idle back to a hub, because returning to Boss on success forces manual stepping and is a defect.",
            'Do not have a state following an approval enter a fresh approval of the same content, which adds latency and risks ping-pong loops; a state may route through approval once when its input came from an unreviewed branch (for example, a re-do without an intervening review).',
            'When the source has a feedback cycle, make all phases that need feedback reuse it rather than duplicating it per phase, and allow phases to set typed routing fields so terminal outcomes return to the originating branch.',
            'Accept Boss input through three surfaces: pre-emptive interrupts on active states, typed entry events on idle or recoverable states, and Boss replies to player questions that suspended the FSM in a dedicated wait state.',
            'Allow Boss to interrupt any active state that can itself receive a Boss turn; give every jumpable state a stable `id`; treat a final state as not jumpable; and treat a `playbook.suspended` call state with an outstanding child as not a Boss interrupt target, because the host routes Boss input to the active child leaf and resumes the parent only from the matching child result.',
            "Handle the runtime's `{ type: 'BOSS_INTERRUPT', targetId: '<id>' }` at the root machine with one guarded transition per jumpable state targeting `#<id>` with `reenter: true`, so invoked actors restart cleanly, and emit a `bossInterrupts(ids)` helper rather than hand-writing one transition per state.",
            "Make each generated interrupt arm guard both the selected `targetId` and every typed context precondition required to enter that target safely, never jumping into a working or reassessment state with missing intent, prior result, plan, or other required context, and never inventing defaults merely to make an interrupt target executable; XState automatically stops the current state's invoked actor on transition.",
            "Where the default Captain's routing state accepts a fresh intent while another state or Boss-reply wait is active, make its `BOSS_INTERRUPT` event carry a required non-empty `bossIntent`, and make the guarded routing arm copy that value, clear the prior plan, child evidence, exact-call history, selected call, response, error, and consumed question/reply context, then reenter routing without restarting the old intent or retaining a stale pending question.",
            "For this default Captain, make `routing` the sole `BOSS_INTERRUPT` target — a fresh directive always returns to routing and shall not jump directly into reassessment or the Boss-reply wait — and require the typed event union and classifier contract to be exactly `targetId: 'routing'` plus the fresh `bossIntent`.",
            'Distinguish the two entry surfaces: `BOSS_INTERRUPT` jumps into an active machine, pre-empting whichever state is running, while Boss entry events start or resume from idle or recoverable states when Boss-supplied parameters cannot be inferred from machine state alone.',
            'Type entry events alongside `BOSS_INTERRUPT` and populate context via a dedicated action whose copy action does not clear per-run parameters the event omits — an absent optional field falls back to the existing (input-seeded) context value.',
            'Do not collapse the two surfaces: `BOSS_INTERRUPT` always carries its target id and may additionally carry typed Boss-supplied fields such as an intent or IR number only where Source requires the pre-empted target to consume them, and a parameterless entry event may collapse to interrupt-style routing only when state-jump and context-update semantics are identical.',
            'Do not make entry events root-level transitions from every active state unless the workflow supports pre-emption; place them on idle and recoverable states (for example, `failed`).',
            'When a captain- or player-invoking state needs a Boss decision the acting agent cannot supply alone, suspend that task in a quiescent wait state and resume the same task with the Q+A in the next prompt, as a third Boss surface alongside `BOSS_INTERRUPT` and Boss entry events; every captain- and player-invoking state supports this path.',
            "Add no source-level opt-in annotation and no `needsBossReply` result metadata in GEARS output for this path; preserve the GEARS blockquote as the state's domain `prompt` body and inject no Boss-question instruction into `invoke.input.prompt`.",
            "For every captain- and player-invoking state, add `needsBossReply` to the state's `invoke.input.result` map with the standard adjudicator-facing description: `The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.`",
            'Because the standard annotated backtick form names the exact `question` property, the linker\'s required-field extractor interprets only the identifier before the colon as the JSON field name, and the linked runtime composes player prompts per link.md "Player prompt composition" without adding a player-visible Boss-question instruction.',
            'Make the question record `{ questionId, resumeStateId, sourceItem, player, question }`, with `questionId` and `resumeStateId` both equal to the stable working-leaf `stateId`.',
            "Draw `questionId`, `resumeStateId`, and `sourceItem` from the suspended working leaf's stable invocation metadata; draw `player` from a delegated `PlayerInput`, or use the literal `Captain` for a direct-Captain state; and draw only `question` from adjudicated actor output.",
            "For a machine with at most one active Captain or player task, allow the scalar form: an `awaitBossReply` state with stable `id: 'awaitBossReply'`, tag `playbook.parked`, and description `Waiting for Boss to answer the acting agent's question.`; a `BOSS_REPLY` event carrying `{ answer: string; questionId?: string }`; context fields `pendingBossQuestion?: PendingBossQuestion` and `bossReply?: string`; and `resumableStates(ids)`, `setPendingBossQuestion`, and `clearBossReplyContext` helpers with the existing single-question behavior.",
            'For a machine with parallel delegated-player tasks, use the keyed form: one local waiting leaf per branch tagged `playbook.parked`; a `BOSS_REPLY` event carrying `{ questionId: string; answer: string }`; context fields `pendingBossQuestions: Partial<Record<ResumableStateId, PendingBossQuestion>>` and `bossReplies: Partial<Record<ResumableStateId, string>>`; and helpers that set, answer, and clear only the named branch record, while exiting the complete parallel group for a fresh directive or interrupt clears every record owned by that group.',
            'Where exactly one question is pending, allow a linked runtime to accept a classifier reply that omits `questionId` and fill that sole id; where several questions are pending, require `questionId` in the classifier prompt and event and reject an omitted or unknown id without moving the FSM.',
            'Treat the scalar `awaitBossReply` state and every local branch wait as quiescent for the runtime drive boundary, allowing a fresh root entry event or interrupt to abandon the relevant pending question data before starting new work; do not make the wait state or branch-wait leaf an interrupt target, since re-entering it after the interrupt clears its pending question would create an unresumable parked state; and keep its recorded working leaf as the sole `BOSS_REPLY` resume destination.',
            'Make a captain- or player-invoking state\'s `invoke.input` function carry the pending question and reply selected for that working leaf as singular `pendingBossQuestion` and `bossReply` fields, regardless of the scalar or keyed context representation, so prompt composition has one stable contract; when both fields are present the linked runtime composes the continuation preamble and labelled Q&A blocks per link.md "Player prompt composition", and the FSM artifact bakes no continuation preamble into the GEARS-derived `prompt` body.',
            "Route the following malformed states to `failed`: Captain or player output has `guard: 'needsBossReply'` but no `question` field; Captain or player output declares `needsBossReply` from a state without a registered scalar or branch-local resume route; `BOSS_REPLY` fired with empty or whitespace-only `answer`; or a keyed `BOSS_REPLY` names no pending question.",
            'Give every `invoke` an `onError` handler with a fallback routing to a dedicated `failed` state that captures the error in `context.lastError` for inspection, allowing a nested playbook invoke to place its validated authored-child recovery arm before that fallback.',
            "Make `failed` not `final`: tag it `playbook.parked`, retain enough typed context for Boss recovery, and accept the workflow's recovery entry or interrupt surface, so the parked tag distinguishes a recoverable failure from a busy state and the host retains the session instead of treating the outcome as an unhandled runtime error.",
            "Declare at least one `type: 'final'` state (typically `done`) reachable on completion, since a never-terminating machine leaves the runner no completion signal.",
            "Where Source declares a JSON-safe terminal result, declare that output in the setup types and derive it from typed context through XState's machine `output` function, because a final-state transition alone does not satisfy a declared output contract.",
            'Make fields that Source requires in every terminal output required in the TypeScript output type — a declared `{ response }` result compiles as `{ response: string }`, not `{ response?: string }` — and guard out reaching the final state without a non-empty response before the machine output is constructed.',
          ].join('\n'),
          result: {
            compiled:
              'Captain emitted the target XState v5 machine object artifact as specified.',
            rejected:
              'Captain rejected or flagged a malformed source item rather than propagating it into the target.',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
        }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              typeof event.output.question === 'string' &&
              event.output.question.trim().length > 0,
            target: '#awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: ({ event }): PendingBossQuestion => ({
                questionId: 'compile',
                resumeStateId: 'compile',
                sourceItem: 'G2F-1',
                player: 'Captain',
                question:
                  event.output.guard === 'needsBossReply'
                    ? event.output.question
                    : '',
              }),
            },
          },
          {
            guard: ({ event }) => event.output.guard === 'needsBossReply',
            target: '#failed',
            actions: [
              assign({
                lastResult: ({ event }) => event.output,
                lastError: () =>
                  new Error(
                    'Captain returned needsBossReply without a question.',
                  ),
              }),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'compiled',
            target: '#done',
            actions: [
              assign({ lastResult: ({ event }) => event.output }),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'rejected',
            target: '#done',
            actions: [
              assign({ lastResult: ({ event }) => event.output }),
              'clearBossReplyContext',
            ],
          },
          {
            target: '#failed',
            actions: [
              assign({
                lastResult: ({ event }) => event.output,
                lastError: ({ event }) =>
                  new Error(
                    `Captain returned an undeclared guard: ${event.output.guard}`,
                  ),
              }),
              'clearBossReplyContext',
            ],
          },
        ],
        onError: {
          target: '#failed',
          actions: assign({ lastError: ({ event }) => event.error }),
        },
      },
    },

    awaitBossReply: {
      id: 'awaitBossReply',
      description: "Waiting for Boss to answer the acting agent's question.",
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'awaitBossReply',
          description:
            "Waiting for Boss to answer the acting agent's question.",
        },
      },
      on: {
        BOSS_REPLY: [
          {
            guard: 'isEmptyBossReply',
            target: '#failed',
            actions: ['recordEmptyReply', 'clearBossReplyContext'],
          },
          ...resumableStates(RESUMABLE_IDS).BOSS_REPLY,
        ],
        // A Boss interrupt while waiting abandons the pending question.
        ...bossInterrupts(INTERRUPT_IDS, ['clearBossReplyContext']),
        // A fresh Boss directive while waiting starts a fresh turn.
        COMPILE: {
          target: '#compile',
          actions: ['startTransform', 'clearBossReplyContext'],
        },
      },
    },

    failed: {
      id: 'failed',
      description:
        'The Captain call errored or produced malformed output; Boss may recover.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'The Captain call errored or produced malformed output; Boss may recover.',
        },
      },
      // Recoverable: Boss may restart here, or interrupt out via root handler.
      on: {
        COMPILE: {
          target: '#compile',
          actions: ['startTransform', 'clearBossReplyContext'],
        },
      },
    },

    done: {
      id: 'done',
      type: 'final',
      description:
        'The GEARS-to-FSM compilation concluded: artifact emitted, or a malformed source item rejected.',
      meta: {
        playbook: {
          stateId: 'done',
          description:
            'The GEARS-to-FSM compilation concluded: artifact emitted, or a malformed source item rejected.',
        },
      },
    },
  },
});

export default gears2fsmMachine;

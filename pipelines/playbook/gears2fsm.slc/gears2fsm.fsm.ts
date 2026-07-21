// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// GEARS-to-FSM object artifact for the `gears2fsm` playbook phase.
// Compiled from gears2fsm.gears.md (item GEARS2FSM-1).
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
 * Discriminated Captain result. GEARS2FSM-1 carries no `Results:` label, so its
 * local contract is the default single outcome `done` plus the universal
 * `needsBossReply`. A catch-all `guard: string` shape would be malformed.
 */
export type CaptainOutput =
  | { guard: 'done' }
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
 * Per-run parameters copied into context at start-up. The single GEARS2FSM-1
 * prompt establishes no runtime-value placeholders, declares no players, and
 * the machine makes no dynamic playbook call, so no fields are required here.
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
        'Captain carries out the GEARS-to-FSM transformation specified by item GEARS2FSM-1.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'compile',
          description:
            'Captain carries out the GEARS-to-FSM transformation specified by item GEARS2FSM-1.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'compile',
          sourceItem: 'GEARS2FSM-1',
          prompt: [
            'Transform the normative GEARS spec items produced by the first phase into an XState v5 finite state machine.',
            'Emit an object artifact only: define the machine, actor contracts, and typed inputs; do not bind a runner or supply concrete runtime implementations.',
            'Setup:',
            "Use XState v5's `setup(...)` then `.createMachine(...)`.",
            'Restrict the artifact to erasable TypeScript syntax — type annotations that strip cleanly, no constructor parameter properties, `enum`s, or namespaces — so a host running under type stripping loads it directly.',
            "Pass the repository's strict `noUnusedLocals` and `noUnusedParameters` checks; helper signatures and XState callbacks shall omit values they do not read (a fresh-context helper that uses only `bossIntent` shall not also accept an unused `context`; an assign callback that reads only `event` shall destructure only `event`).",
            "The `types` block shall declare only `context`, `events`, machine `input`, and machine `output`; XState v5's `SetupTypes` has no `actors` property, so emitting `types: { actors: ... }` is invalid and prevents registered action and actor names from type-checking.",
            "Declare a distinct typed actor contract in `setup(...)`'s top-level `actors` map for every actor kind the GEARS artifact uses, using typed actor logic such as `fromPromise<Output, Input>(...)`: `captain` for direct work performed by Captain; `player` for work Captain delegates to a named player; `playbook` for a nested playbook call; and `script` for a deterministic shell script an optimizer-introduced script item runs without any agent.",
            'Do not declare, register, export, or import an actor kind the GEARS artifact does not use (a playbook with direct Captain work and nested calls but no delegated player has `captain` and `playbook` contracts only).',
            'Since XState may expose output from heterogeneous invoked actors as `unknown` in shared guards and actions, generated helpers shall accept an unknown event and narrow its `output` or `error` structurally to the declared actor contract before reading fields; they shall not rely on unchecked `event.output` inference.',
            'Helpers that construct transition arrays shall preserve guard, action, and target literals with `as const`, `satisfies`, or typed action/guard functions rather than widening registered names to plain `string`.',
            "Do not import a runner or bake in concrete actor implementations; each actor placeholder shall fail explicitly (for example, throw `'captain actor must be provided by the runner'`).",
            'Where the Source artifact begins with an SPDX comment block, preserve its license and copyright text before the imports using valid TypeScript line comments; never copy Markdown HTML comment delimiters into a TypeScript target.',
            "`CaptainInput` shall be a typed object with at least: `stateId` (the stable id of the invoking working leaf); `sourceItem` (the GEARS item ID this state realizes); `prompt` (the source item's full final prompt, verbatim); and `result` (a record whose keys are the valid guard names this invocation may return).",
            '`PlayerInput` shall be a typed object with at least: `stateId`; `player` (the player Captain is to invoke); `sourceItem`; `prompt`; and `result` (a record whose keys are the valid guard names this invocation may return).',
            "`ScriptInput` shall be a typed object with at least: `stateId`; `sourceItem`; `command` (the script item's blockquote text, verbatim after Markdown unescaping); and `result` (a record whose keys are the item's two declared guard names, first the zero-exit guard, then the nonzero-exit guard).",
            '`ScriptOutput` shall be a discriminated union with one literal `guard` member per declared result key and a required `exitStatus: number` property; a script carries no prose output and downstream prompts shall not depend on text a script produces.',
            '`CaptainOutput` and `PlayerOutput` shall each be a discriminated union with one literal `guard` member per authored result key and every payload field required by that result as a required property; a catch-all `guard: string` interface with optional look-alike fields is not a discriminated contract and is malformed.',
            'Export the machine input plus every Captain, player, and playbook actor input/output type the linker must provide; the linked module imports those exact types and shall not redeclare near-duplicates that can drift in optional fields, dynamic-call metadata, question ids, or child result shapes.',
            "Any recursive JSON value type shall exactly preserve the shared boundary's readonly variance, using `JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }`.",
            'Nested-playbook output, completed-result evidence, plans, context, and machine output shall use that readonly type rather than a mutable array/record near-duplicate; the linker shall not cast or copy around a variance mismatch.',
            'Every runtime-value placeholder established by Source in a direct-Captain or delegated-player prompt shall be backed by a typed actor-input field populated from typed machine context, so the linker can substitute it with the exact runtime value.',
            'Angle-bracketed metavariables quoted inside domain instructions (for example the literal `<model>` in a commit-message format) remain ordinary prompt text and are not runtime-value placeholders.',
            'For the generic Captain forms, wire `<boss-intent>` from `bossIntent`, `<enabled-playbooks>` from `enabledPlaybooks`, `<remaining-plan>` from `remainingPlan`, and `<completed-call-results>` from `completedCallResults`.',
            'Other placeholders shall retain the semantic typed field established by Source (for example `<#>` from `irNumber`).',
            'Leaving a placeholder literal, replacing it with an empty default because its field was omitted, or making the linker recover it from untyped context is malformed.',
            'The sole blockquote placeholder of a dynamic nested-playbook item is instead the child `textContext` field specified for nested playbook calls.',
            "The generic Captain's `enabledPlaybooks` field shall be an immutable array of exact entries `{ id: string, command: string, intent: string }`, not an array of ids or an open record; its dynamic-call guard checks `entry.id`, while the linked runtime validates, snapshots, and deterministically renders all three fields.",
            'Result contracts:',
            "Guard names shall be specified and interpreted per state, not as a global union (a global union encourages name reuse with divergent semantics and couples unrelated states); shared helpers may accept `string`, but each state's `invoke.input.result` is the authoritative local contract.",
            "For an acting GEARS item, derive that contract only from the ordered bullets under the item's out-of-blockquote `Results:` label; every declared guard name shall match `[A-Za-z_$][A-Za-z0-9_$]*`.",
            'Preserve every guard name, order, and description verbatim; reject a missing, duplicate, blank, or malformed declaration; do not infer a result contract from acting-prompt prose or transition implementation.',
            'An acting item that declares no `Results:` label has exactly one outcome; give such a state the default single-outcome contract: one result `done` with the fixed description `The acting agent completed the behavior.`, plus the universal `needsBossReply`.',
            'A single-outcome item may instead carry exactly one authored `Results:` bullet when a later prompt consumes its output; derive the one-guard contract from that bullet as usual.',
            'The `done` transition is self-driving: it targets the next workflow obligation, or a `final` state when the item is the last one.',
            'The default single-outcome contract never applies to an item carrying a `Results:` label and does not license inferring any richer contract from prose.',
            "The item's blockquote alone becomes `invoke.input.prompt`; the `Results:` label and bullets shall never enter that prompt.",
            'Each result description shall name every additional output field its accepting guard requires, using the exact case-sensitive property names (for example, a delegation or continuing-call description names `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`; a direct or final response names `response`; an authored question names `question`); a vague description such as "selected the next call" is malformed when its guard also requires structured fields.',
            'Deterministic verification synthesizes valid actor output from the local result contract and shall not infer hidden guard payloads from guard source text.',
            'For the default generic Captain decide-call-observe pattern, the local guard discriminants are a stable compiler contract, not names to invent: initial routing uses `question` (required `question`) and `delegation` (required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`), and has no direct or terminal result; post-child reassessment uses `final` (required `response`), `followUpQuestion` (required `question`), and `continuing` (required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`).',
            'Both direct-Captain states additionally receive the universal `needsBossReply` result; their guards and actions shall use those exact case-sensitive names so the compiled adjudication contract remains stable.',
            'States:',
            'Each state shall declare: a stable `id` (for `#id` targeting and Boss interrupts); an intuitive state key (the property name under `states: { ... }`); a one-line `description` (for inspector tools and documentation); JSON-safe `meta: { playbook: { stateId, description } }` repeating its stable id and description so linked runtimes can discover active public identities through `snapshot.getMeta()` without private XState nodes; and the actor-kind-appropriate `invoke.input`.',
            'If it invokes the direct `captain` actor: `invoke.input` carries `sourceItem`, `prompt`, and `result`.',
            'If it invokes the delegated `player` actor: `invoke.input` additionally carries `player`.',
            'If it invokes the `script` actor: `invoke.input` carries `stateId`, `sourceItem`, `command`, and `result` — no `prompt` and no `player`.',
            'The source item ID shall live in `invoke.input.sourceItem`, not in a comment, to keep the GEARS-to-state mapping machine-readable.',
            "A delegated state's `invoke.input.player` shall match its source item's named player; a direct Captain state shall not invent a `Captain` player binding.",
            'Every invoking working leaf — sequential or parallel, whatever its actor kind — shall carry the tag `playbook.busy`, because the shared quiescence helper derives busyness strictly from active-state tags.',
            "The machine's initial state shall be a quiescent idle hub (no `invoke`) — typically `ready` — that accepts the Boss entry events and carries the `playbook.parked` tag because it can return control to Boss.",
            'Captain- and player-invoking work begins only on a Boss-originated event, so constructing and starting the machine performs no agent call.',
            "Each direct Captain or delegated player actor returns a discriminated result with `guard` set to one of `input.result`'s keys; guards on `onDone` transitions inspect `event.output.guard` to route.",
            'Mapping:',
            "Each Source spec item shall map to exactly one state in Target; a state's `invoke.input.sourceItem` shall be that item's ID and `invoke.input.prompt` shall carry the item's prompt verbatim.",
            "An item written as direct Captain work maps to exactly one `captain` invocation; an item that prompts or relays to a named player maps to exactly one `player` invocation; a nested-call item maps to exactly one `playbook` invocation; a script item (`Captain shall run:`) maps to exactly one `script` invocation whose `input.command` carries the blockquote verbatim and whose `result` preserves the item's two guards in declared order.",
            'Do not infer one actor kind from a runtime player name or encode Captain as a player.',
            "A script state is not agent-invoking: do not add `needsBossReply` to a script state's result map and do not register it with `resumableStates(ids)`.",
            "A script state's success guard shall target the next workflow step and its failure guard shall route to `failed` unless the source items define a different recovery.",
            'Each spec item already carries the full final prompt for one state behavior, with no duplicate lines; do not concatenate prompts across items, re-compose them, or silently dedupe.',
            'A spec item that still contains duplicate prompt lines is malformed; reject or flag it rather than silently propagate the duplication into `invoke.input.prompt`.',
            'Parallel groups:',
            "Items carrying the same `Parallel group: <id>` metadata shall compile into one compound state with `type: 'parallel'` and one region per item.",
            'Each member shall be a delegated-player item; a direct-Captain or nested-call member is malformed because those actor kinds share one Captain control lane or one pending-child slot.',
            "Each region shall contain a delegated-player working leaf and a local final state; the working leaf retains the item's stable state id, `sourceItem`, player, prompt, and result contract.",
            'The parallel parent shall use `onDone` as the join, which XState takes only after every region reaches final.',
            'Each branch shall assign only its own staged result; the join shall promote all staged results atomically before later work begins, so branch completion order cannot change downstream inputs; transitions between sibling regions are forbidden.',
            'Working leaves shall carry tag `playbook.busy`.',
            'A branch that supports Boss-reply suspension shall use a local waiting leaf tagged `playbook.parked` rather than exit the parallel parent; `BOSS_REPLY` shall identify and reenter only the waiting branch.',
            'If several branch questions are pending, the event shall carry a stable question id and the classifier shall not guess among them.',
            'A fresh entry event or root interrupt may exit the complete parallel parent and shall clear its staged results and branch questions.',
            'Treat a fixed parallel parent as one jumpable unit: generate a stable id and root `BOSS_INTERRUPT` target for the parallel parent, not for any working leaf inside its regions.',
            "Branch working ids remain valid internal resume targets for their branch-local `BOSS_REPLY`; they shall not appear in the interrupt target union or classifier catalog, preventing a nominal one-branch jump from implicitly entering or restarting the parallel parent's other regions.",
            'An invoke error shall exit to the root failure state, allowing XState to stop the sibling invocations automatically.',
            'Nested playbook calls:',
            'An item whose behavior is a literal or dynamic `Captain shall call playbook ...:` shall compile to a state that invokes a typed `playbook` actor, not the `captain` or `player` actor.',
            'Declare `PlaybookInput` with stable `stateId`, target `playbookId`, composed `text`, and optional `sourceItem`.',
            "The playbook actor's successful output is the child's JSON-safe machine output itself (or `undefined`), not a second wrapper carrying a synthetic status or `output` field; `invoke.onDone` shall record `event.output` as the successful child output; aborted and error call results reject the actor and reach `invoke.onError`.",
            'Supply a failing placeholder for `playbook`, just as for `captain` and `player`; the linked runtime provides the actor implementation.',
            'A literal call retains the existing representation: `playbookId` is the literal target and `text` is the composed GEARS blockquote.',
            "A dynamic call written ``Captain shall call playbook selected by `<target-field>`:`` shall declare the named target field and the blockquote's text field as typed string fields in FSM context.",
            "The dynamic `PlaybookInput` variant shall require string-valued `playbookIdContext` and `textContext` metadata fields; its `invoke.input` shall read the runtime values from those exact context fields and also carry the static metadata (for example, `stateId`, `sourceItem`, `playbookId: context.nextPlaybookId`, `text: context.nextPlaybookInput`, `playbookIdContext: 'nextPlaybookId'`, `textContext: 'nextPlaybookInput'`).",
            "`playbookIdContext` and `textContext` name context fields and never contain runtime target or text values; emit them as explicit string literals so conformance tools can verify context wiring without evaluating or parsing the `invoke.input` function's source; the evaluated `playbookId` and `text` shall each be strings and shall come from the context field named by its corresponding metadata property.",
            'Literal calls need not carry these dynamic metadata properties and retain their existing behavior.',
            'The call state shall carry tag `playbook.suspended` and shall route `invoke.onDone` from child output and `invoke.onError` from child failure.',
            "The child call shall remain state-scoped: leaving the call state stops the invoked actor and aborts the host call through XState's invocation signal.",
            'The FSM shall not allocate runtime call ids, construct child sessions, retain runtime promises, or route Boss text to the child.',
            'When Source explicitly continues one downstream behavior after a child success, abort, or failure, both `invoke.onDone` and `invoke.onError` shall record the corresponding JSON-safe child result and target that downstream behavior; the generic `failed` state is the default only when Source declares no recovery or reassessment path for a rejected child.',
            "That recovering `onError` shall be an ordered transition array: its first arm shall use a typed structural guard that accepts only an `Error` carrying a validated public child `result` with `status: 'aborted' | 'error'`, and only that arm appends sanitized child evidence and continues; a fallback arm shall retain the control error normalized as JSON-safe `{ name, message, stack? }` in `lastError` and route to `failed` without appending a completed child result, while the linked runtime alone retains the original error in its out-of-machine latch.",
            'Non-abort port rejection, malformed port data, JSON, identity, bridge, and other control-plane errors are not authored child outcomes even though XState delivers both kinds through `invoke.onError`.',
            "Where the rejected error structurally carries the runtime's normalized child result, the error action shall inspect whether its status was `aborted` or `error`; it shall not collapse both into an invented success/failure enum; the FSM may inspect that public structural data without importing the runner or constructing runtime call identities.",
            "For a workflow that reassesses child results, use a typed JSON-safe record such as `{ playbookId, status: 'ok', output }` on `onDone` and `{ playbookId, status: 'aborted' | 'error', error }` on `onError`; because the runtime rejection is an `Error` with a public `result` property, normalization shall inspect `result.status` and `result.error` before applying a generic `Error` normalizer; it shall persist only the current context target id, the status, and a compact `{ name, message }` error, never the whole runtime result, child session id, child state, call identity, or stack.",
            'An abort without an error gets a compact generic abort description; the current target id remains available in typed context until the sanitized record has been created; on success, persist only `event.output`, which is the actual child machine output returned by the bridge, not a runtime call-result envelope; when that optional output is absent, omit the `output` property from the completed-result record rather than storing `undefined`.',
            'The outer trusted error is an actual `Error` instance and therefore is not a plain JSON object; the structural guard shall inspect its public `.result` property directly, then validate only that nested result before sanitizing it, and shall not require the outer error itself to pass a plain-object/JSON guard.',
            "Validation of that nested public result includes its status-specific required members and target identity: `playbookId` shall equal the current selected target, an `error` result shall carry a normalized error, and every optional member that is present shall have the public contract's declared shape; a look-alike such as `{ status: 'error' }` is malformed control data, not an authored child failure, and shall take the fallback `failed` arm without appending evidence; do not fabricate missing identity or error members merely because the status string happens to be recognized.",
            "The public result's declared optional `childSessionId` and `state` members are valid when their shapes satisfy the shared contract; validate and then discard them when building compact Captain evidence; they are not undeclared extras.",
            'The public normalized error may carry its declared optional string `stack`; validate it and omit it from the compact `{ name, message }` evidence rather than rejecting an otherwise valid authored child result.',
            'Apply the public union exactly: an `aborted` or `error` result shall reject an `output` member; `childSessionId`, when present, shall be non-empty; `error` shall contain only non-empty `name`, string `message`, and optional string `stack`; and `state`, when present, shall validate every declared `PlaybookState` member and reject unknown or missing members; treating an arbitrary JSON-safe object as a valid `state`, or checking only that these members have broad string/object types, is not complete public-result validation.',
            'In other words, the guard validates the complete public result it received, while the action retains only the current selected playbook id, status, and compact error; do not implement evidence minimization by accepting only the three keys that survive that projection.',
            'Before entering a dynamic call, reject an empty target and empty input text, any target equal to `selfPlaybookId`, and any target that Source requires to belong to an input catalog but that catalog does not contain; rejection shall occur before invoking the `playbook` actor; the host remains responsible for its independent registry validation.',
            "Where Source forbids repeating an equivalent completed or failed call without new information, keep a private deterministic history of target-and-input signatures and reject a continuation whose target and complete input exactly match a prior call; encode each signature as the collision-free `JSON.stringify([playbookId, text])` tuple of exact JavaScript strings, not delimiter concatenation, and append it before invocation so success, abort, and authored failure all count; that history shall not be included in a Captain or player prompt; a revised input containing new information is a different call; the exact machine check is a safety floor and the acting Captain remains responsible for Source's broader semantic equivalence policy.",
            "That validation belongs on the guarded transition into the call state; the call state's `invoke.input` mapper shall be a pure read of the already-validated typed context fields and shall not call an assertion helper or throw while XState resolves actor input, keeping state restoration, inspection, and scripted coverage from crashing outside the invocation's `onError` boundary.",
            "For the default Captain decide-call-observe loop, the delegation and continuing `onDone` arms shall transition directly into the invoking call state; each arm's single guard validates its applicable actor-output and context constraints (both validate JSON shape, catalog membership, self-target, and duplicate history, while strict plan shrink applies only to `continuing`), and its actions store the selected target/input and append the signature before state entry; do not interpose an eventless preparation or validation state between the Captain actor and the call state.",
            'Context and prompts:',
            'Context fields used to drive guards or compose prompts shall be typed and named; do not branch on untyped properties of `lastResult`; persistent routing decisions belong in typed context fields (`lastResult` is for inspection only).',
            'Where Source declares a finite ordered plan, represent it as a typed readonly JSON-safe array and validate that shape on the actor-output transition; an unconstrained `JsonValue` does not establish that a plan is ordered or finite.',
            'Where a decide-call-observe loop carries the calls after the selected next call as `remainingPlan`, its continuing-call guard shall additionally require the new plan to be strictly shorter than the current plan; the Captain may revise or remove remaining entries as evidence arrives but cannot grow or retain the same-length plan indefinitely, so the initial finite array bounds the number of sequential child calls without an arbitrary runtime call limit.',
            'Prompts shall pass only the specific extracted fields the player needs; do not dump `JSON.stringify(lastResult)` or any opaque blob, which leaks internal `guard` strings, wastes tokens, and confuses the LLM.',
            "Player bindings and per-run parameters shall flow in via the machine's `input` and be copied into context at start-up; do not bake in player bindings, model names, or per-run values.",
            'Host-owned configuration such as an enabled-playbook catalog shall remain immutable machine input/context for the session; Boss events and actor outputs shall not carry, replace, append to, or otherwise overwrite that catalog.',
            'Every machine with a dynamic call shall receive its own registered or authored playbook id as immutable machine input/context named `selfPlaybookId`, and its dynamic-call guard shall reject that target; the leaf-level `stateId` name is reserved for actor invocation identity and shall not be reused for a playbook id.',
            'JSON-safe context and output records shall omit absent optional members instead of creating own properties whose value is `undefined`.',
            'JSON validation shall accept only null, booleans, finite numbers, strings, arrays, and plain own enumerable data-property objects; it shall reject cycles, non-plain instances (`Error`, `Date`, `Map`, and class instances), accessors, symbol keys, sparse/undefined values, `NaN`, and infinities rather than silently changing them during serialization.',
            'An accepted array shall have prototype exactly `Array.prototype`, no holes, symbols, accessors, or extra own string properties, and enumerable own data descriptors for every canonical index; its standard non-enumerable `length` descriptor is the sole exception, which shall be non-configurable and carry the exact array length, but whose `writable` flag may be either `true` on an ordinary array or `false` after the shared runtime recursively freezes a validated boundary value; `Reflect.ownKeys(array)` shall contain exactly `length + 1` keys (the `length` property and every canonical index from `0` through `length - 1`); a digit string whose numeric value is not less than `length` is an extra property, not an array index.',
            'An accepted record shall have prototype exactly `Object.prototype` or `null`, and every key returned by `Reflect.ownKeys` shall be a string whose own descriptor is enumerable and a data descriptor.',
            'Cycle detection shall track only the active recursion path and remove a container on unwind, so a shared acyclic array or record is valid while an actual back-edge is rejected.',
            'Transitions:',
            'A transition fires on an event — typically `onDone` (actor completed); when multiple are possible, a synchronous guard picks the path.',
            'Transitions shall persist relevant typed fields from `event.output` to context via `assign` so downstream prompts can read them.',
            'Transitions shall be self-driving when source items define the next obligation; routing to an idle hub is for recovery, unrecoverable Boss input, or one-shot entry events — not the happy path.',
            "Auto-advance on approval: a review/approval state's success outcome shall target the next workflow step, not idle back to a hub; returning to Boss on success is a defect that forces manual stepping.",
            'Do not re-validate what already passed: a state following an approval shall not enter a fresh approval of the same content, which adds latency and risks ping-pong loops; a state may route through approval once when its input came from an unreviewed branch (e.g., re-do without an intervening review).',
            'One feedback cycle across phases: when the source has a feedback cycle, all phases that need feedback shall reuse it, not duplicate it per phase; phases may set typed routing fields so terminal outcomes return to the originating branch.',
            'Boss control:',
            'Boss input enters the machine through three surfaces: pre-emptive interrupts on active states, typed entry events on idle or recoverable states, and Boss replies to player questions that suspended the FSM in a dedicated wait state.',
            'Boss interrupts: Boss may interrupt any active state that can itself receive a Boss turn; every jumpable state shall have a stable `id`; a final state is not jumpable; a `playbook.suspended` call state with an outstanding child is also not a Boss interrupt target, because the host routes Boss input to the active child leaf and resumes the parent only from the matching child result.',
            "The runtime sends `{ type: 'BOSS_INTERRUPT', targetId: '<id>' }`; the root machine handles it with one guarded transition per jumpable state targeting `#<id>` with `reenter: true`, so invoked actors restart cleanly; emit a `bossInterrupts(ids)` helper rather than hand-writing one transition per state.",
            'Each generated arm shall guard both the selected `targetId` and every typed context precondition required to enter that target safely; it shall not jump into a working or reassessment state with missing intent, prior result, plan, or other required context, and shall not invent defaults merely to make an interrupt target executable.',
            "XState automatically stops the current state's invoked actor on transition.",
            "Where the default Captain's routing state accepts a fresh intent while another state or Boss-reply wait is active, its `BOSS_INTERRUPT` event shall carry a required non-empty `bossIntent`; the guarded routing arm shall copy that value, clear the prior plan, child evidence, exact-call history, selected call, response, error, and consumed question/reply context, then reenter routing; it shall not restart the old intent or retain a stale pending question.",
            "For this default Captain, `routing` is the sole `BOSS_INTERRUPT` target; a fresh directive always returns to routing and shall not jump directly into reassessment or the Boss-reply wait; the typed event union and classifier contract shall require exactly `targetId: 'routing'` plus the fresh `bossIntent`.",
            "Boss entry events vs. `BOSS_INTERRUPT`: `BOSS_INTERRUPT` jumps into an active machine, pre-empting whichever state is running; Boss entry events start or resume from idle or recoverable states when Boss-supplied parameters cannot be inferred from machine state alone; entry events shall be typed alongside `BOSS_INTERRUPT` and populate context via a dedicated action; an entry event's copy action shall not clear per-run parameters the event omits (an absent optional field falls back to the existing input-seeded context value).",
            'The two surfaces shall not be collapsed; `BOSS_INTERRUPT` always carries its target id and may additionally carry typed Boss-supplied fields such as an intent or IR number only where Source requires the pre-empted target to consume them; a parameterless entry event may collapse to interrupt-style routing only when state-jump and context-update semantics are identical.',
            'Entry events shall not be root-level transitions from every active state unless the workflow supports pre-emption; they belong on idle and recoverable states (e.g., `failed`).',
            'Boss-reply suspension: when a captain- or player-invoking state needs a Boss decision the acting agent cannot supply alone, suspend that task in a quiescent wait state and resume the same task with the Q+A in the next prompt; this is a third Boss surface alongside `BOSS_INTERRUPT` and Boss entry events.',
            'Every captain- and player-invoking state supports this path; there is no source-level opt-in annotation and no `needsBossReply` result metadata in GEARS output.',
            "Preserve the GEARS blockquote as the state's domain `prompt` body and do not inject any Boss-question instruction into `invoke.input.prompt`.",
            "For every captain- and player-invoking state, add `needsBossReply` to the state's `invoke.input.result` map with the standard adjudicator-facing description: `The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.`",
            'The standard annotated backtick form names the exact `question` property; the linker\'s required-field extractor shall interpret only the identifier before the colon as the JSON field name; the linked runtime composes player prompts per link.md "Player prompt composition" without adding a player-visible Boss-question instruction.',
            "The question record shall be `{ questionId, resumeStateId, sourceItem, player, question }`; `questionId` and `resumeStateId` shall both equal the stable working-leaf `stateId`; `questionId`, `resumeStateId`, and `sourceItem` shall come from the suspended working leaf's stable invocation metadata; `player` shall come from a delegated `PlayerInput`, or be the literal `Captain` for a direct-Captain state; only `question` shall come from adjudicated actor output.",
            "A machine with at most one active Captain or player task may use the scalar form: an `awaitBossReply` state with stable `id: 'awaitBossReply'`, tag `playbook.parked`, and description `Waiting for Boss to answer the acting agent's question.`; a `BOSS_REPLY` event carrying `{ answer: string; questionId?: string }`; context fields `pendingBossQuestion?: PendingBossQuestion` and `bossReply?: string`; and `resumableStates(ids)`, `setPendingBossQuestion`, and `clearBossReplyContext` helpers with the existing single-question behavior.",
            'A machine with parallel delegated-player tasks shall use the keyed form: one local waiting leaf per branch, tagged `playbook.parked`; a `BOSS_REPLY` event carrying `{ questionId: string; answer: string }`; context fields `pendingBossQuestions: Partial<Record<ResumableStateId, PendingBossQuestion>>` and `bossReplies: Partial<Record<ResumableStateId, string>>`; and helpers that set, answer, and clear only the named branch record, where exiting the complete parallel group for a fresh directive or interrupt clears every record owned by that group.',
            'Where exactly one question is pending, a linked runtime may accept a classifier reply that omits `questionId` and fill that sole id; where several questions are pending, the classifier prompt and event shall require `questionId` and shall reject an omitted or unknown id without moving the FSM.',
            'The scalar `awaitBossReply` state and every local branch wait are quiescent for the runtime drive boundary and shall allow a fresh root entry event or interrupt to abandon the relevant pending question data before starting new work.',
            'The wait state or branch-wait leaf itself shall not be an interrupt target, because re-entering it after the interrupt clears its pending question would create an unresumable parked state; its recorded working leaf remains the sole `BOSS_REPLY` resume destination.',
            'A captain- or player-invoking state\'s `invoke.input` function shall carry the pending question and reply selected for that working leaf as singular `pendingBossQuestion` and `bossReply` fields, regardless of the scalar or keyed context representation, so prompt composition has one stable contract; when both fields are present, the linked runtime composes the continuation preamble and labelled Q&A blocks per link.md "Player prompt composition"; the FSM artifact shall not bake the continuation preamble into the GEARS-derived `prompt` body.',
            "The following malformed states shall route to `failed`: Captain or player output has `guard: 'needsBossReply'` but no `question` field; Captain or player output declares `needsBossReply` from a state without a registered scalar or branch-local resume route; `BOSS_REPLY` fired with empty or whitespace-only `answer`; a keyed `BOSS_REPLY` names no pending question.",
            'Errors and termination:',
            'Every `invoke` shall declare an `onError` handler with a fallback routing to a dedicated `failed` state and capturing the error in `context.lastError` for inspection; a nested playbook invoke may place its validated authored-child recovery arm before that fallback.',
            "`failed` is not `final`: it shall carry tag `playbook.parked`, retain enough typed context for Boss recovery, and accept the workflow's recovery entry or interrupt surface, so the parked tag distinguishes a recoverable failure from a busy state and the host retains the session instead of treating the outcome as an unhandled runtime error.",
            "Every machine shall declare at least one `type: 'final'` state (typically `done`) reachable on completion; a never-terminating machine is a defect because the runner has no completion signal.",
            "Where Source declares a JSON-safe terminal result, the setup types shall declare that output and the root machine shall derive it from typed context through XState's machine `output` function; a final-state transition alone does not satisfy a declared output contract.",
            'Fields that Source requires in every terminal output shall be required in the TypeScript output type (a declared `{ response }` result shall compile as `{ response: string }`, not `{ response?: string }`); reaching the final state without a non-empty response shall be guarded out before the machine output is constructed.',
          ].join('\n'),
          result: {
            done: 'The acting agent completed the behavior.',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          ...(context.pendingBossQuestion !== undefined
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          {
            // needsBossReply with a usable question: suspend and resume the same task.
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
                sourceItem: 'GEARS2FSM-1',
                player: 'Captain',
                question:
                  event.output.guard === 'needsBossReply'
                    ? event.output.question
                    : '',
              }),
            },
          },
          {
            // Malformed: needsBossReply without a question -> failed.
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
            // Single-outcome success: self-driving to the terminal state.
            guard: ({ event }) => event.output.guard === 'done',
            target: '#done',
            actions: [
              assign({ lastResult: ({ event }) => event.output }),
              'clearBossReplyContext',
            ],
          },
          {
            // Any undeclared guard is malformed output -> failed.
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
      description: 'The GEARS-to-FSM transformation concluded.',
      meta: {
        playbook: {
          stateId: 'done',
          description: 'The GEARS-to-FSM transformation concluded.',
        },
      },
    },
  },
});

export default gears2fsmMachine;

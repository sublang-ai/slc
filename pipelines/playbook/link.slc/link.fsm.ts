// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

//
// XState v5 finite state machine compiled from the GEARS package
// `link.gears.md` (single Captain-acting item LINK-1).
//
// Object artifact only: it defines the machine, the typed `captain` actor
// contract, and typed inputs. It binds no runner and supplies no concrete
// Captain implementation — the runner must provide the `captain` actor.
//
// LINK-1 declares no `Results:` label, so it carries the default
// single-outcome contract: one result `done` plus the universal
// `needsBossReply`. `done` is the workflow's last obligation, so it targets a
// `type: 'final'` state.
//

import { setup, assign, fromPromise, type DoneActorEvent } from 'xstate';

// ---------------------------------------------------------------------------
// Actor contract
// ---------------------------------------------------------------------------

/** A clarifying question the acting agent raised that only Boss can answer. */
export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

/**
 * Input handed to the direct `captain` actor for a captain-invoking state.
 * Guard names are specified and interpreted per state via `result`; they are
 * not a global union. A direct Captain state carries no `player` binding.
 */
export interface CaptainInput {
  /** Stable id of the invoking working leaf. */
  stateId: string;
  /** The GEARS item ID this state realizes. */
  sourceItem: string;
  /** The source item's full final prompt, verbatim. */
  prompt: string;
  /** A record whose keys are the valid guard names this invocation may return. */
  result: Record<string, string>;
  /** Backs the `<fsm-artifact>` prompt placeholder with its exact runtime value. */
  fsmArtifact: string;
  /** Present only when resuming after a Boss reply, for continuation-prompt composition. */
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

/**
 * Discriminated result Captain returns; `guard` is one of the state's `result`
 * keys. `needsBossReply` additionally carries the extracted `question`.
 */
export type CaptainOutput =
  | { guard: 'done' }
  | { guard: 'needsBossReply'; question: string };

// ---------------------------------------------------------------------------
// Machine types
// ---------------------------------------------------------------------------

export interface LinkContext {
  /** FSM artifact path (the transformation source); backs `<fsm-artifact>`. */
  fsmArtifact: string;
  /** PlaybookRuntime module path (the transformation target). */
  target: string;
  /** Last Captain result — inspection only; never branched on for routing. */
  lastResult?: CaptainOutput;
  /** Last Captain error — inspection only (the runtime normalizes it). */
  lastError?: unknown;
  /** Set while suspended in `awaitBossReply`. */
  pendingBossQuestion?: PendingBossQuestion;
  /** Boss's answer, set on the resume arm and read by the resumed state's input. */
  bossReply?: string;
}

export type LinkEvent =
  | { type: 'LINK_REQUEST'; fsmArtifact: string; target: string }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

export interface LinkInput {
  fsmArtifact?: string;
  target?: string;
}

// ---------------------------------------------------------------------------
// Verbatim prompt for LINK-1 (the item's full final prompt; no duplicate lines)
// ---------------------------------------------------------------------------

const LINK_1_PROMPT: string = [
  'Compile the source FSM artifact <fsm-artifact> into a `PlaybookRuntime`: a host-agnostic runner module in TypeScript that drives the FSM, classifies Boss input into typed events, runs direct-Captain / delegated-player / nested-playbook actors, executes deterministic script actors locally without any agent, adjudicates Captain and player output into FSM guards, and surfaces transitions as status/telemetry.',
  'Accept as linker inputs: the FSM artifact path; a player binding mapping GEARS players to opaque `playerId` strings (default: each player to its lowercased name, e.g. `Coder` \u2192 `coder`, recorded in the emitted header); an adjudication strategy (default: LLM-judge per state) and a Boss-event mapping (default: free-text judge classification); both strategies are host-agnostic.',
  "The host's identity does not enter compilation; the emitted module runs unchanged under any host that implements `PlaybookPorts`.",
  'The runtime is invoked only through the stable `PlaybookPorts` contract; a presentation layer implements the six ports once and inherits every playbook.',
  "Hosts are out of scope: each host has an adapter that loads a `PlaybookRuntime` module and supplies the host's primitives as `PlaybookPorts`; the adapter speaks only `PlaybookPorts` and shall not leak host types back into the runtime.",
  'Do not modify the FSM artifact and do not re-derive Captain prompts, result keys, or guard semantics \u2014 those are fixed by the FSM.',
  'Emit exactly one TypeScript module.',
  '',
  'PlaybookRuntime contract:',
  'Default-export `createPlaybookRuntime(options: PlaybookRuntimeOptions): PlaybookRuntime`, conforming to `PlaybookRuntimeFactory<PlaybookRuntimeOptions>`.',
  '`PlaybookRuntime` exposes `init(session: PlaybookSession): Promise<void>`, `handleBossInput({ text, signal }): Promise<PlaybookRunResult>`, `resumePlaybookCall({ callId, result, signal }): Promise<PlaybookRunResult>`, and `dispose(): Promise<void>`.',
  '`init` receives the host-owned playbook session identity and ports, constructs the XState actor with FSM `input` derived from `options`, and starts the actor.',
  'The runtime owns the actor for its lifetime; `handleBossInput` runs one turn; `dispose` stops the actor and drains pending port emissions.',
  'Validate non-empty session, playbook, and root ids; a safe non-negative integer `depth`; root identity (`depth === 0` and `rootSessionId === sessionId` with no parent fields); and child identity (`depth > 0` with non-empty `parentSessionId` and `parentCallId`); a child `sessionId` shall differ from both its `rootSessionId` and `parentSessionId`.',
  "Copy the identity scalars and port references into the runtime's own immutable record rather than retaining the caller's mutable session object.",
  'Run outcomes are exact: `no-action` means no FSM event was sent; `quiescent` means a non-failure parked/idle state; `failed` means a recoverable FSM failure state; `terminal` means top-level final with optional JSON `output`; `aborted` means the turn signal ended work; `suspended` means exactly one `pendingCall` is active.',
  'Control-plane exceptions reject the runtime method rather than masquerade as a recoverable workflow `failed` result.',
  'Emit a typed `PlaybookRuntimeOptions` interface per playbook, derived from every required FSM input field (e.g. `CodingInput`) not supplied by `PlaybookSession` or another linker-owned source; carry only per-run knobs such as identity strings (e.g. model names substituted into prompt placeholders) and strategy overrides.',
  'A required immutable `enabledPlaybooks` catalog stays a required readonly runtime option passed through to machine input; do not invent an empty catalog and do not require it baked into a CLI link option (CLI link options are compile-time inputs; the runtime options interface is derived independently).',
  'Bake the player binding into the emitted runtime by default; a linker may also expose it via `PlaybookRuntimeOptions` for per-run remapping; the runtime ships with a deterministic binding it applies at every `callPlayer` site.',
  '',
  'PlaybookPorts contract:',
  'The runtime speaks only `PlaybookPorts`: `callPlayer(playerId, prompt, signal, options)`, `callCaptain(prompt, signal, options)`, `callJudge(prompt, signal)`, `callPlaybook(request, signal)`, `emitStatus(message, data?)`, and `emitTelemetry({ topic, payload })`; it never speaks to LLMs directly and never touches host types beyond `PlaybookPorts`.',
  "`PlayerResult` mirrors cligent's status, resume token, final text, and error fields; treat `status !== 'ok'` as a player failure and route it through the FSM error path.",
  "For authored workflow direct-Captain calls, pass `{ visibility: 'visible', resume: false, allowedTools: [] }` so XState context (not an agent conversation) owns workflow continuity and the acting Captain cannot investigate through tools.",
  '`CaptainResult` carries no resume token or player-continuation selection; a non-`ok` result, or an `ok` result without `finalText`, rejects the actor through the FSM error path.',
  "Outside a signal-driven abort, invalid direct-Captain results are latched control-plane failures: let the actor take `onError`, drive it to quiescence, drain ordered emissions, then reject the public method with the original failure; never translate either case into a recoverable `{ outcome: 'failed' }` result; if the combined signal has aborted, an aborted host result follows the ordinary abort settlement instead.",
  'Own a map from resolved player id to its latest non-empty `resumeToken`; before reading a resolved direct-Captain or delegated-player result, validate, detach, and freeze it through `validateCaptainResult` or `validatePlayerResult` (exact shape: only the declared status and optional string fields; JSON-unsafe members reject); validation happens before adopting a resume token or reading final text.',
  'The first call to each player in a session passes `{ resume: false }`; later calls pass the exact stored token; after a resolved call, replace the token when the result carries one or clear it when absent before interpreting `status`; a rejected call with no result leaves the prior token unchanged.',
  'After awaiting a host Captain or player promise, re-check the combined invocation/public-boundary signal before validating the result, adopting a resume token, or emitting a successful finish; a host promise that ignores cancellation and resolves late is paired as aborted and shall not mutate continuity or masquerade as success.',
  'The resume-token map survives actor reconstruction within one runtime and is discarded at `dispose`.',
  'Keep an in-flight set keyed by resolved player id and reject a second concurrent call to the same id before crossing the host port; calls to distinct resolved player ids may overlap.',
  "`callJudge` returns free-form text parsed per the state's adjudication strategy; one port serves both classifier and adjudicator, varying only in prompt.",
  'Route concurrent `callJudge` attempts through one abort-aware local FIFO; after the host promise resolves, require a string reply and re-check the combined signal before tracing or parsing success.',
  "Serialize `callCaptain` and `callJudge` together through one shared abort-aware concurrency-one FIFO (the single-flight Captain lane), even when distinct player ports overlap; a direct Captain call's subsequent adjudication enters that same queue only after the visible call has settled; do not hold one queue lease while requesting the other port.",
  'Use one shared `PQueue({ concurrency: 1 })` for the individual host `callCaptain` and `callJudge` promises; do not pass an invocation or public-boundary signal as `PQueue.add(..., { signal })`; instead check the combined signal inside the queued task before crossing the host port, await the host promise without releasing the queue lease, and check the signal again afterward.',
  "`callPlaybook` starts a function-style child call: supply the caller's stable call id and the XState invocation's lifetime signal; the host drives the child's initial text and resolves the port with either an immediate settled result or a suspended child session; suspension is resumed later through `resumePlaybookCall`; the port promise shall not remain pending across Boss turns.",
  '`emitStatus` is human-readable and `emitTelemetry` is structured; both are async, ordered, awaited, and never dropped; await each emission before issuing the next.',
  '',
  'Playbook trace:',
  'Emit a boundary-complete, ordered trace through `emitTelemetry` topic `playbook.trace`; each payload carries `schemaVersion: 2`, the immutable session identity and causality, a contiguous one-based `sequence`, a Unix-millisecond `timestamp`, a trace `type`, event `payload`, and the runtime-local `turnId` / paired `callId` where applicable.',
  'Trace types: `session.started`, `boss.input.received`, `judge.call.started`, `judge.call.finished`, `player.call.started`, `player.call.finished`, `captain.call.started`, `captain.call.finished`, `playbook.call.started`, `playbook.call.finished`, `fsm.transition`, `status.emitted`, `boss.input.settled`, `session.disposed`.',
  'Call pairs carry exact prompts and replies, normalized failures, actor and state identity, and their boundary-specific options.',
  '`session.started` and `session.disposed` carry their descriptor as top-level `state` and its singular `stateId` when present.',
  "Every judge start and finish carries the working snapshot's singular `stateId` when one exists (classification uses the current descriptor, adjudication uses the invoking actor input; the default Captain always has a singular id, a parallel snapshot may omit it); every judge finish also carries `status: 'ok' | 'aborted' | 'error'`.",
  'Every `status.emitted` carries the described top-level `state` and its singular `stateId` when present, plus its message and optional data; consumers shall not have to recover state identity from a nested ad hoc object.',
  "Judge results use `reply`; player start and finish payloads both carry the selected `resume`; Captain start and finish payloads both carry the exact composed prompt, `visibility: 'visible'`, the direct invocation's `stateId` and `sourceItem`, and no player resume selection or resume token; judge `purpose` is `boss-input-classification`, `player-output-adjudication`, or `captain-output-adjudication`; every error uses `{ name, message, stack? }` rather than a raw string or `Error` instance.",
  "The Captain finish payload preserves the exact `CaptainResult` status and final text when present, carrying any failure in normalized form; an `ok` result without `finalText` retains status `ok` but also carries the normalized missing-text failure that makes the actor reject; if the Captain port rejects before returning a result, the finish carries explicit `status: 'aborted'` when the combined signal has aborted or `status: 'error'` otherwise; a finish boundary never omits status merely because there was no structured host result.",
  'The pair obligation applies when a port promise rejects or throws: emit and drain one normalized finish boundary before propagating the failure; no started call boundary is left without its matching finished boundary.',
  'If a started-boundary sink records the event and then rejects, make one best-effort normalized error-finish attempt with the same call id and then reject the original start error; do not retry either event or let a failure of that finish attempt replace the start error.',
  'When a call boundary carries `callId`, that id is unique within the runtime session; a stable FSM `stateId` is identity metadata in the payload, not a call id, and shall not be reused as one across repeated invocations.',
  'Omit optional trace and run-result members when absent; do not create own `turnId`, `callId`, parent identity, output, or error properties with value `undefined` and then rely on JSON serialization to drop them.',
  'A `boss.input.settled` payload projects the complete structured run result: its outcome is one of the `PlaybookRunResult` discriminants (never an invented `error` outcome) and it includes `state`, singular `stateId`, `pendingCall`, `output`, and normalized `error` whenever the matching result arm carries them.',
  "One runtime-owned concurrency-one emission queue serializes every trace, human status, and state telemetry call; sequence allocation and enqueueing occur atomically; every public method drains that queue before resolving or rejecting; a state-transition emission queued on entry is observed before the invoked boundary's `*.started` event even when a host delays `emitTelemetry`.",
  'Use `PQueue({ concurrency: 1 })` from `p-queue` for this ordering and drain it with `onIdle()` rather than recreating a promise-queue implementation per artifact.',
  "An XState inspection callback synchronously enqueues the transition trace, state telemetry, status trace, and human status in that order before it returns; `emitStatus` likewise enqueues its trace and port emission in the same synchronous call; do not enqueue state telemetry or the status port from a `trace(...).then(...)` continuation, because the queue can become momentarily idle and let an invoked actor's `await drain()` overtake those dependent enqueues.",
  'All validation happens before these synchronous enqueues; later sink failures are caught into the appropriate latch without changing their queue position.',
  'FSM trace events carry the same transition, pending-question, and normalized-error fields as state telemetry.',
  'Trace emissions are awaited and sequenced before the boundary operation or human status / state telemetry they describe.',
  'Every event in one session carries the same root/parent/depth identity.',
  "A parent call start precedes its child `session.started`; the child's `session.disposed` precedes the parent call finish; parallel call finishes may occur in either order, so consumers pair by call id and order by sequence.",
  'This trace covers everything observable through `PlaybookRuntime`; host-specific adapter streaming remains in the host record stream; trace payloads never become Boss-visible status or prompt text.',
  '',
  'Player binding:',
  'Each delegated GEARS state names exactly one player (`player` actor `invoke.input.player`); map every named player to a `playerId` string used in `callPlayer(playerId, \u2026)`; the host adapter routes that opaque string to its concrete primitive.',
  "Every direct-Captain and delegated-player invocation carries its working leaf's explicit `stateId`; use that field for call identity and do not infer one leaf from a structured root snapshot.",
  'Direct `captain` actor states bypass player binding and call `callCaptain`; do not synthesize a player id named `captain` for them.',
  "Resolve composite/alias players (e.g. `Committer = Coder | Reviewer`) per source item by inspecting the `PlayerInput` fields populated at that state: if only one `<playerName>Player` field is present, bind that player; if multiple, prefer the first-listed alternative in alias declaration order; if none, fall back to the alias's first alternative; resolution is deterministic and recorded in the emitted module.",
  "Do not invent player identifiers beyond the recorded default binding and do not collapse aliases at the FSM level: composite players keep their `player: 'Committer'` value on `PlayerInput`; resolution decides only the `callPlayer` invocation.",
  '',
  'Player prompt composition:',
  "Compose the actual player prompt from the state's `PlayerInput`; `input.prompt` is the GEARS-derived domain prompt body and shall not be mutated, re-flowed, or used to store framework control instructions.",
  'May prepend structured labelled blocks from typed `PlayerInput` fields (e.g. `Boss intent:`, `Review items:`, `Rebuttals:`, `Task description:`) outside the domain prompt body.',
  "Do not inject a player-visible Boss-question instruction; Boss-question detection is adjudicator-facing, from the state's `needsBossReply` result description, not from extra prompt text.",
  'When `PlayerInput` carries both `pendingBossQuestion` and `bossReply`, prepend the continuation preamble and labelled Q&A blocks before ordinary structured blocks and before the domain prompt body, using exactly this framework text: `You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.`, a blank line, `Boss question:` then `<pendingBossQuestion.question>`, a blank line, `Boss reply:` then `<bossReply>`, then a blank line.',
  'The continuation preamble is framework text supplied by the runtime; it is not part of the GEARS blockquote and shall not appear in `invoke.input.prompt`.',
  'Retain the blank line after the Boss reply before the next structured block or domain prompt, producing exactly two newline characters at that boundary (when joining an array with `"\\n"`, use two trailing empty strings after `bossReply`; equivalently append `"\\n\\n"` exactly once).',
  '',
  'Captain prompt composition:',
  "Compose a direct Captain prompt from the state's `CaptainInput` under the same prompt-integrity rules: `input.prompt` remains the verbatim GEARS domain body while specific typed fields may be supplied as labelled blocks substituted for their declared placeholders; do not introduce a player binding or player resume instruction.",
  'String fields substitute verbatim; arrays and objects (the sanitized enabled-playbook catalog, remaining plan, completed child results) are validated JSON-safe and rendered as deterministic JSON, never coerced through default string conversion or exposing untyped context.',
  'Deterministic rendering sorts object keys lexicographically at every depth while preserving array order, so equivalent JSON values produce the same prompt independent of host property insertion order.',
  'At construction, validate a structured host-owned catalog against its declared exact entry shape, copy it, and freeze it recursively so later caller mutation or extra properties cannot alter a prompt or machine decision; for the default Captain catalog, every entry has exactly the own enumerable data keys `id`, `command`, and `intent`, all three non-empty strings, with unique `id` values; empty values, duplicate ids, extra keys, accessors, non-plain objects, and non-JSON data reject runtime construction rather than being silently repaired or discarded.',
  "When a direct Captain task resumes from its own Boss question, prepend the same continuation preamble and labelled Q&A blocks; pass the complete composed prompt once to `callCaptain` with `{ visibility: 'visible', resume: false, allowedTools: [] }`; do not expose the subsequent adjudicator prompt or structured judge reply through that visible call.",
  "The composed prompt contains only the GEARS blockquote, typed runtime evidence blocks, and the continuation preamble; do not append the state's result map, guard names, result-property schema, adjudication request, workspace context, or tool instructions.",
  "Replace every known placeholder whose matching typed field is present in the supplied input; do not choose one exclusive replacement set from `stateId`, source-item identity, or another variant discriminator; construct the replacement table from field presence alone (populate `<remaining-plan>` when `remainingPlan` is supplied and `<completed-call-results>` when `completedCallResults` is supplied, regardless of the input's `stateId` or `sourceItem`); a branch such as `if (input.stateId === 'reassessment')` around either replacement is nonconformant.",
  '',
  'Boss-event mapping:',
  "The FSM's `events` union enumerates every Boss-originated event; the runtime receives Boss input as a free-form string (`handleBossInput.text`).",
  "Where the current ready or reconstructed-terminal machine accepts exactly one ordinary textual entry event and no Boss question is pending, send that event deterministically and attach the exact original text to its declared textual payload field without invoking `callJudge`; the default Captain's ready entry is `{ type: 'BOSS_INTENT', bossIntent: turn.text }`.",
  "All other non-empty turns use `callJudge` only to choose one of the FSM's event kinds and non-text routing fields, or no FSM action; the classifier prompt includes the exact, unmodified `turn.text` in a clearly labelled Boss-message block so the judge can distinguish an answer, a fresh directive, and no action; including it does not authorize rewriting the runtime-owned textual payload fields.",
  'For `BOSS_INTENT` and `BOSS_INTERRUPT`, attach the exact original text as `bossIntent`; for `BOSS_REPLY`, attach the exact original text as `answer`; the classifier prompt neither requests nor accepts a copy of those fields, and classifier-authored paraphrases never become machine context.',
  'Empty or whitespace-only text produces no event, judge call, Captain call, player call, status emission, or FSM transition; its received and settled session-trace events are still emitted.',
  "The classifier prompt demands JSON against the FSM's typed event union and any state-specific Boss input contract, including non-text routing payload fields required for each event but excluding the runtime-owned textual fields; fields the event union declares optional stay optional in the classifier contract and parser (do not promote them to required).",
  'Parse the judge reply tolerantly before validating the event: recover the intended JSON object from surrounding prose or a Markdown fence, ignore earlier non-JSON bracketed prose, remove a trailing comma before a closing brace or bracket, and complete a truncated unterminated string or unclosed object/array; when several values are recoverable, choose the first object in document order, preferring a strict parse at each candidate position before repairing that same candidate.',
  "For each opening-brace position, first scan strings and nesting to find that candidate's earliest balanced closing boundary; both the strict parse and the trailing-comma repair operate on only that bounded substring; if no closing boundary exists, repair may complete the unterminated suffix; never repair the entire remaining document after a balanced candidate; advance to the next opening brace only after strict and repaired parsing of the current bounded candidate both fail, so an earlier repairable object wins over every later strict object.",
  'When no object is recoverable or the recovered event/payload is invalid, emit exactly one status and send no FSM event; a malformed classification is recoverable control input, not a public boundary rejection.',
  'If a recovered `BOSS_REPLY` names no currently-pending question, treat it as a malformed classification: emit the one recovery status, send no event, leave the actor unchanged, and return `no-action` after emissions drain.',
  'Host-owned runtime options, player bindings, and enabled-playbook catalogs are not Boss-event payload; the classifier schema and parser shall not invite or accept them, and classified prose never overwrites their machine context.',
  'Every recovered classifier object has exactly `type` plus the declared non-text routing keys for its selected event arm; extra own keys (including a classifier-authored `bossIntent` or `answer`) reject the classification; the parser shall not accept and discard injected catalog, option, state, or routing fields.',
  "`NO_ACTION` is exactly `{ type: 'NO_ACTION' }`; a valid `NO_ACTION` returns `no-action` without an invalid-classification status and leaves the actor untouched (a successful classifier choice, not the same result as malformed or unrecoverable output).",
  'After any successful classifier call drains, re-check the active Boss signal before reconstructing a terminal actor or sending the selected event; if it aborted while the classifier finish emission was pending, return and trace the same structured `aborted` result against the unchanged actor.',
  'When the FSM supports a Boss-reply suspension state, the prompt inspects the actor snapshot context and includes each exact pending Boss question, question id, and asking player so the judge can distinguish a reply from a fresh directive; with one pending question, a classified `BOSS_REPLY` that omits its optional id is filled with that sole id; with several pending questions, the classifier requires a known id; a reply re-enters only its recorded resume state and preserves the original intent, plan, prior child results, and Q+A continuation context.',
  'The classifier-facing pending-question block contains only `questionId`, `player`, and `question`; internal `resumeStateId`, source-item identity, and other machine-routing fields remain authoritative in snapshot context and are not serialized into the judge prompt.',
  'Allowed fresh directives while parked include every applicable root entry event and `BOSS_INTERRUPT`; accepting one abandons and clears the pending question and reply context before new work begins.',
  'The runtime shall not define slash-prefix commands for states or features inside the playbook; the `/command` namespace is reserved for host-level or playbook-selection UX before a turn reaches `handleBossInput`; text beginning with `/` forwarded to `handleBossInput` is treated as ordinary Boss text and mapped through the same deterministic-or-classified rules.',
  'Hosts resolve host-level concerns before choosing a runtime; once they call `handleBossInput`, they pass Boss content as text and do not pre-classify in-playbook FSM events or rely on slash forms as a runtime protocol.',
  "`BOSS_INTERRUPT` (or the FSM's equivalent explicit-state-jump event) is reached only by the judge choosing it and supplying its required target payload; it is not an abort surface (aborts go through the abort signal and the abort strategies); hosts where the abort signal is terminal shall not route abort to `BOSS_INTERRUPT`.",
  '',
  'Captain adjudication:',
  "After a direct Captain or delegated player call returns, coerce `result.finalText` into one of the per-state `invoke.input.result` keys and extract any payload fields the state's `result` description names as required.",
  "Required-field extraction recognizes both an exact backticked property name such as `question` and the standard annotated form `question: <verbatim question text>`; in either form only `question` is the JSON property name; extraction is limited to the description's explicit `Output shall include` clause (or equivalent typed output metadata); backticked prose before that clause names statuses, guards, or concepts such as `ok`, `aborted`, and `error` that are not output properties and never become required judge fields.",
  "For a direct Captain result, `question` and `response` are human-presentation fields owned by the visible call, not authored by the hidden judge; the adjudicator selects the guard and supplies only other structural fields required by that guard; after validating the selection, inject the exact non-empty `CaptainResult.finalText` as the selected output's `question` or `response`; reject a judge reply that supplies either presentation field as an undeclared extra key.",
  'Delegated-player adjudication retains extraction of every required field from the judge reply, including a player-authored Boss question.',
  'The adjudicator uses the same document-order tolerant JSON recovery as the Boss classifier; unlike invalid classification, a reply from which no object can be recovered, an undeclared guard, or a missing required field is a control-plane error and shall throw after the invocation reaches its FSM error path and ordered emissions drain.',
  "LLM-judge (default strategy): construct a fresh `callJudge` prompt that names the source item's actor (and delegated player where applicable), includes the actor's verbatim output, lists the `result` keys with their descriptions, and demands a JSON `{ guard, \u2026structuralPayloadFields }` answer keyed to exactly one declared guard, excluding the runtime-owned direct-Captain `question` and `response` fields; the judge prompt does not interpret, paraphrase, or alter the FSM's `result` text \u2014 it carries the description verbatim.",
  'Marker-parse (delegated-player alternative strategy): a deterministic parser that scans the player output for a terminal control line such as `FSM-RESULT: { "guard": "...", ... }`, useful when player adapters emit structured trailers and the operator wants to avoid the extra LLM call.',
  'A linker may select different strategies per delegated-player state; the default is LLM-judge for every state; direct-Captain states use the LLM judge so their visible prose stays human-readable and carries no marker or control JSON, and their adjudicator call uses purpose `captain-output-adjudication` and remains hidden at the host adapter.',
  'When the direct Captain result selects a terminal `response`, the exact already-visible `CaptainResult.finalText` is the machine response and Boss presentation; do not make a second visible Captain call or expose the hidden structured adjudication merely to present the same response.',
  'The adjudicator fails loudly on a guard the state does not declare, a missing required payload field, and an empty/malformed response; keep the three distinguishable in the thrown error (malformed JSON recovery identifies the missing JSON object, an unknown selection identifies an undeclared guard, an incomplete selection identifies the missing required field); a generic "no declared guard selected" error for all three is nonconformant.',
  "Adjudicator failures are control-plane errors: propagate them by throwing out of `handleBossInput` after attempting cleanup; the host surfaces the throw on its control-plane channel; the host's player-result channels are reserved for failures the player itself produced (emitted when `callPlayer` resolves with `status !== 'ok'`); Captain call failures stay on the Captain/control boundary and are not reported as player failures.",
  "Because XState still needs the invoked promise to settle, latch an adjudicator, actor-output JSON-validation, or nested-boundary control error outside machine context, allow the invocation's `onError` path to reach quiescence, drain all emissions, and then reject the public runtime method with that original error; never return such a failure as a recoverable `{ outcome: 'failed' }` result.",
  "The first latched non-abort control error takes precedence over a coincident boundary-signal abort; read and clear the latch only in the public boundary's `finally` cleanup after XState and emissions have settled, so it cannot leak into a later turn or be erased before rejection.",
  'An `AbortError`-named transport, validation, or trace-sink failure is still a non-abort control error unless it is causally identical to the applicable signal reason; error names never change original-error or first-latch precedence.',
  'When a host port or structured-result validator fails after a call-start boundary, latch the original error before attempting the required finish trace; if the finish sink records the event and then rejects, do not emit a second finish and do not let the sink failure replace the earlier control error; retain the sink failure only as independent cleanup evidence.',
  '',
  'Script execution:',
  'Where the FSM declares the typed `script` actor, provide its implementation inside the module; a script invocation runs without any agent \u2014 no `callPlayer`, `callCaptain`, or `callJudge` call and no adjudication.',
  "The provided script actor executes `input.command` verbatim through the platform's POSIX shell (`sh -c`), with the working directory from `PlaybookRuntimeOptions.cwd` when the caller supplies it else the process working directory; declare the optional `cwd` option whenever the FSM contains a script state.",
  "Resolve deterministically from the child's exit status: status zero resolves `{ guard: <first declared guard>, exitStatus: 0 }`; any nonzero status resolves the second declared guard with that status; guard selection is mechanical and never routed through the judge.",
  "Reject only when the command cannot be spawned at all, routing through the state's ordinary `onError` path.",
  "Honor the active turn's abort signal by terminating the child process and rejecting per the abort strategies.",
  'After the child settles and before the invocation resolves, emit one status line `Executed script for <stateId> (exit <status>).` and one telemetry event under topic `playbook.script` with payload `{ stateId, sourceItem, exitStatus }`, through the ordinary serialized emission channel.',
  'Script execution emits no `*.call.*` trace pair (the surrounding FSM transition trace and the `playbook.script` telemetry are its record); script stdout and stderr are not workflow data and shall not enter machine context, prompts, or trace payloads.',
  '',
  'Nested playbook bridge:',
  'Where the FSM declares the typed `playbook` actor, provide it with the shared `createNestedPlaybookBridge(...).actorLogic`; do not regenerate a second pending-call, identity-validation, or abort-cleanup substrate inside each linked artifact.',
  'Instantiate the generic bridge with the FSM-exported `PlaybookInput` type so `.provide(...)` receives the exact declared actor input; construct one bridge per runtime and wire every integration hook: `nextCallId` (allocate ids), `getBoundarySignal` (return the currently active public-boundary signal), `bindResumeSignal` (bind `resumePlaybookCall.signal` before settling the deferred actor), `emitStarted` / `emitFinished` (enqueue the exact start/finish trace), `drain` (drain the global emission queue), `onControlPlaneError` (latch the original control error), and `onBackgroundError` (retain a cleanup/observer failure for the next public boundary or disposal rejection); do not leave these optional hooks unwired merely because their properties are optional.',
  "On invocation the bridge allocates a runtime-local call id, traces the start, and calls `callPlaybook` with the composed target/text and the bridge signal combined from the XState invocation lifetime, the active public boundary, and the bridge's own disposal controller.",
  "For a literal invocation, target and text retain their existing static/composed values; for a dynamic invocation, use the evaluated `PlaybookInput.playbookId` and `PlaybookInput.text`, require both to be strings with non-empty target and text, and preserve the exact resolved values in the request and trace; preserve the FSM's static `playbookIdContext` and `textContext` metadata for conformance; do not parse function source, treat either metadata name as the runtime value, or freeze a dynamic call to the value observed during artifact inspection.",
  "If the port returns `state: 'settled'`, validate the result, emit and drain `playbook.call.finished`, then resolve successful output or reject an aborted/error result; if it returns `state: 'suspended'`, record one pending call and await a runtime-owned deferred result; only after that pending record exists may the drive boundary treat the call state's `playbook.suspended` tag as quiescent; one runtime supports at most one pending child call, and a second shall reject.",
  'The pending record retains the call-start `turnId`; a resumed finish and every parent transition, Captain reassessment, and status caused by that return use this retained id, not an absent or newly allocated current-turn value; the finish callback receives or closes over that stored id rather than read a mutable global turn id at resume time.',
  'Strictly validate the start discriminant, non-empty suspended child session id, settled target identity, optional state descriptor, normalized error, and JSON-safe output; a malformed start, malformed result, identity mismatch, or non-JSON value is a control-plane error; once a start trace exists, every thrown port, validation failure, immediate result, suspension resume, invocation abort, and disposal path emits and drains exactly one matching finish trace; malformed data neither creates a pending identity nor is reassessed as ordinary child evidence.',
  'Detach and recursively freeze a validated start/result before tracing it or delivering it to the FSM, so caller mutation after port resolution cannot alter identity, evidence, or trace payloads; a non-abort `callPlaybook` throw/rejection is a control-plane failure (pair its finish, latch and rethrow the original error, take the FSM fallback error path); a rejection caused by the combined abort signal remains an authored `aborted` child result.',
  'The optional output field may be absent from an otherwise valid successful child result; omit an absent or `undefined` output instead of attempting to snapshot it.',
  "When cancellation wins while the host's opening promise is still pending, retain and drain that exact promise before emitting the matching finish boundary; ignore an abort-reason rejection from it, surface any other late rejection as a control-plane cleanup failure, and recover a child session identity from a late resolved start when available; pass the host port directly to the shared bridge rather than recreate this opening-promise drainage locally.",
  'Aborting a public turn during that opening promise aborts the combined bridge signal, waits for opening cleanup and the paired finish, lets the promise actor reach its `onError` quiescent state, and only then returns an aborted run result; do not hang waiting for a child-resume path that was never registered nor return while the opening promise or finish emission remains live.',
  'The pending record retains a one-shot invocation-signal listener; if the call state is stopped, that listener settles and clears the deferred call as an aborted `NestedPlaybookCallError`, drains the matching finish boundary after host abort cleanup, and makes a later nested invocation possible; do not leave a permanently pending record merely because XState stopped observing the promise actor.',
  '`resumePlaybookCall` accepts only the matching pending call id, target playbook id, and child session id; binds its new turn signal for work resumed in the parent; emits and drains the call-finish trace; settles the bridge deferred; and uses XState `waitFor` to drive the parent to its next quiescent, suspended, failed, aborted, or terminal result.',
  'An `ok` result resolves the actor and reaches `invoke.onDone`; `aborted` and `error` results reject it and reach `invoke.onError`; the rejection is an `Error` whose public readonly `result` property is the exact normalized `PlaybookCallResult` (do not throw the result object directly or discard its status); unknown, duplicate, or stale call ids reject without changing actor state; the finish trace precedes any parent FSM transition caused by the child return.',
  'The host independently validates every evaluated target against its enabled registry; linker-time metadata is not authorization to call a target.',
  'Disposal settles an outstanding call as aborted and drains its finish trace before `session.disposed`; if registered child abort cleanup rejects, emit the paired finish with an error result and reject `abortPending` or disposal with that original cleanup error, and do not swallow the failure merely because the promise actor also observes a `NestedPlaybookCallError`; parent disposal still drains, emits its one `session.disposed` boundary, and clears the bound session before rejecting with the preserved cleanup error; child output and errors must be JSON-safe (a non-JSON-safe result is a control-plane error).',
  '',
  'Session lifecycle:',
  'Reject use before `init`, a second active turn or resume, and re-initializing a live session; `handleBossInput` and `resumePlaybookCall` share one active-turn sentinel (neither overlaps the other, disposal shall not race a live boundary, and a dispose requested during an active public boundary rejects without beginning teardown); idle concurrent dispose requests share one disposal promise, later calls after disposal return that settled outcome without emitting another boundary, and once disposal begins no new turn or resume may start.',
  "Disposal requested during initialization retains one teardown promise, waits for initialization's success or failure cleanup, and emits at most one `session.disposed` boundary; disposal before initialization is terminal and coalesced (later initialization rejects and every later disposal call returns the first retained promise).",
  "Represent in-flight initialization with a cleanup-complete latch resolved by `init`'s outer `finally` (after successful startup or the complete failed-start cleanup); do not expose the fallible inner startup promise as that latch; put session validation and snapshotting, bridge/actor construction, initial state reads, and startup emissions inside that guarded outer `try` so none throws before the latch's `finally` can resolve; a rejected session identity must not leave later disposal waiting forever.",
  'The generated `dispose` method shall not be declared `async` (an async wrapper returns a distinct promise and breaks identity coalescing); return the retained teardown promise directly and use `Promise.reject(...)` for precondition failures.',
  "In `init`, bind the immutable `PlaybookSession`, emit `session.started` with the initial normalized state descriptor, and construct the XState actor with FSM `input` derived from `options`; the actor is session-scoped, not turn-scoped; use XState v5's public actor inspection `@xstate.snapshot` for the root actor so each transition's triggering event and snapshot surface via `emitStatus`/`emitTelemetry` before the next event fires (do not consult private actor nodes or infer the event later); filter inspection events by `inspectionEvent.actorRef === rootActor`, not merely the actor-system root id, so promise-child snapshots are not emitted as root FSM transitions.",
  'The inspection callback only validates and synchronously enqueues emission work, catching validation/enqueue failures into the control/background-error latch; it lets no exception escape and calls no async port directly; its transition `event` field is a detached JSON-safe descriptor (never the raw XState inspection event) that preserves the string `type` (or `unknown` when absent), copies only declared Boss-union payload fields and a validated actor `output`, and normalizes an `error` member; omit `input`, `actorId`, system/ref data, and every other XState-internal field even when JSON-safe (so `xstate.init.input` cannot leak the host catalog); do not call `snapshotJsonValue(event)` on an `xstate.error.actor.*` event that contains a raw `Error`.',
  'Construct the actor without starting it, read its public initial snapshot, emit and drain `session.started`, and only then call `actor.start()`; the initial inspection-driven transition/status emissions shall not precede the session-start trace; have any actor-construction helper return the actor and assign it at the call site (TypeScript does not narrow a captured optional actor variable from assignment hidden inside a helper); retain a non-optional local actor reference across terminal reconstruction and event sending.',
  'An actor-construction helper may read the already-bound immutable session directly for machine input such as `session.playbookId`, but it shall not call a lifecycle assertion that also requires the actor to exist (the actor does not exist until that helper returns).',
  "Generated code shall pass the repository's full strict `tsc` build with no unused helper or destructured parameter, not only a transpile-only or target-local syntax check.",
  'For the default Captain runtime, the initial quiescent `ready` snapshot may emit the ordinary structured transition trace and telemetry but is not a Boss-relevant transition and emits no human status; any initial transition-trace or telemetry sink failure is part of `init` (initialization rejects, stops the actor, and performs the failed-start cleanup rather than swallowing it as a later background error).',
  "Where the FSM input declares `selfPlaybookId`, seed it from the immutable `session.playbookId`; do not expose a caller option or reuse a working leaf's `stateId` as the self-call identity.",
  'If initialization fails after attempting `session.started`, stop the actor, abort/drain nested and host work, make one best-effort `session.disposed` attempt before clearing the bound session, and preserve the original initialization error if cleanup or disposal emission also fails; suppress root inspection emissions before stopping the failed actor (XState emits a stop snapshot that shall not retry a transition/status sink that already failed initialization); reset the inspection gate, queues, error latches, prior state, and all per-session sequence counters so a permitted retry starts with trace sequence `1`.',
  'Per `handleBossInput`: (1) allocate a runtime-local turn id and trace the exact Boss text; (2) map `turn.text` through the Boss-event mapping (deterministic exact entry where applicable, classification otherwise) \u2014 if mapping produces no event, return after draining port emissions; if the classifier port rejects, emit and drain the Boss-settled error boundary, send no event, leave the actor unchanged (including a terminal actor), and reject the original error, but if that rejection is caused by the active Boss abort signal return and trace the same structured `aborted` result instead of `no-action`; if the port resolves but its reply cannot be recovered or validated, emit the one recovery status, send no event, leave the actor unchanged, and return `no-action` after the ordinary settled boundary drains; (3) only after classification produces a real event, if the actor is in a `final` state dispose and reconstruct it (final is terminal; `NO_ACTION`, classifier rejection, and malformed classification leave a terminal actor untouched); (4) bind the active public-boundary signal and send the classified event; (5) drive to quiescence, providing each invoked actor by kind \u2014 for `player` build a player prompt, call `callPlayer`, adjudicate, and resolve; for `captain` build a direct Captain prompt, call `callCaptain` visibly, adjudicate through the shared hidden judge path, and resolve; for `playbook` use the nested playbook bridge; for `script` use script execution with no port call and no adjudication \u2014 with parallel regions running distinct resolved players independently while Captain and judge work stay serialized by the shared host queue, using XState `waitFor` over public tags/status until no `playbook.busy` state is active, a registered child call is suspended, or the actor is terminal/error, passing `pendingCalls: nestedBridge` so a suspended tag is quiescent only after its child identity exists, and under natural rejection not passing the already-aborted public turn signal as wait cancellation; (6) return a structured `PlaybookRunResult` after all in-flight calls and ordered emissions caused by the turn drain.',
  "Per `resumePlaybookCall`, follow the nested playbook bridge and return the same structured run-result boundary without classifying new Boss text; drain the transition/status/telemetry queue before returning; do not allocate a new Boss-input `turnId` (retain the original call-start turn id for its matching finish and the parent continuation caused by that return); every success and exceptional path drains ordered emissions, selects the first latched non-abort control error before considering abort, and clears its boundary latches in `finally`; a resume is not a Boss-input turn and emits neither `boss.input.received` nor `boss.input.settled` (the structured result is the method return, and reusing the originating turn id on the child finish and continuation emissions does not create a second Boss trace pair); this quiescence-and-drain path is mandatory even when `nestedBridge.resume(...)` rejects (capture that operation error, let the promise actor's `onError` transition settle, and select the first latched control error only after all ordered emissions have drained).",
  'In `dispose`, capture the final public state and stop the root actor before settling or aborting a suspended nested bridge (so the bridge rejection cannot reenter the FSM and start new actor work during disposal); then drain pending port emissions and every in-flight Captain/player/judge/child opening, emit `session.disposed` with the final descriptor, and discard player resume tokens; host child abort cleanup and child `session.disposed` drain before the parent call finish, which drains before parent `session.disposed`; use cleanup/finally structure so a bridge or emission failure cannot skip the parent disposal boundary or leave the runtime bound.',
  'Surface the actor\'s `lastError` via `emitStatus` when the machine enters its `failed` state; for the default Captain runtime an initial `ready` state and a terminal `done` state emit no human status (the terminal response is already visible Captain prose and a synthetic "entered done" message would present it twice), while structured transition trace and telemetry still apply to both.',
  "Every provided actor boundary first drains the queued state-entry transition/status/telemetry caused by entering its working leaf (so a call's `*.started` trace cannot overtake the transition that explains it); every public runtime method drains that queue before it resolves or rejects; this initial `await drain()` is required inside each provided `fromPromise` body, because XState may begin that body before publishing the root snapshot and the await yields so the synchronous inspection callback can enqueue the entering transition first.",
  "If a `*.call.started` trace records and then its sink rejects, no host call may begin; still enqueue exactly one synthetic paired `*.call.finished` trace with `status: 'error'` preserving the original call id, turn id, actor visibility, state/source identity, and prompt or request metadata from the start boundary; then follow the same latched control-error, FSM settlement, and ordered-drain path as any other call-start failure, and do not let the synthetic finish replace the original sink error.",
  '',
  'Parked-session snapshot (optional):',
  'A linked runtime may implement the optional durable-session capability of `@sublang/playbook/runtime` \u2014 `exportSnapshot()` and `restore(session, snapshot)` (DR-014); a runtime that implements either member shall implement both.',
  "`exportSnapshot()` returns `undefined` unless at a safe capture point (initialized, not disposing or disposed, no active `handleBossInput`/`resumePlaybookCall` boundary, no pending nested playbook call, and the root actor at a quiescent state with actor status `active`); at a safe point it returns a JSON-safe `PlaybookRuntimeSnapshot` carrying `schemaVersion` literal `1`, `playbookId` (the bound session's), `machine` (the root actor's `getPersistedSnapshot()` passed through the shared JSON detachment with any raw `Error` context such as `lastError` normalized to `{ name, message, stack? }`; opaque to hosts), `playerResumeTokens` (the resume-token map as a plain object), `sequences` (the live `trace`, `turn`, `judgeCall`, `playerCall`, and `playbookCall` counters), `state` (the current normalized descriptor), and `pendingBossQuestions` (a list of `{ questionId, player, question, sourceItem? }`, empty when the parked state awaits no reply).",
  "`restore(session, snapshot)` is an alternative to `init` under the same lifecycle guards: reject when already initialized, disposing, or disposed, and validate `snapshot.schemaVersion` and that `snapshot.playbookId` equals `session.playbookId` before touching state; the host supplies the same immutable `PlaybookSession` identity the snapshot was exported under and recreates the runtime through the same factory with equivalent options (the runtime does not diff options; module identity is the host's check); bind the session, restore the resume-token map, sequence counters, and prior-state descriptor from the snapshot, construct the actor with the persisted `machine` snapshot, and start it with root inspection emissions suppressed so rehydration emits no `session.started` trace, no transition trace, and no human status (the session already started, and the next public boundary continues the contiguous sequence); after start, a restored actor whose status is not `active` or whose state descriptor cannot be normalized fails `restore` through the same failed-start cleanup path as `init`; a restore failure leaves the runtime unbound so `dispose` remains callable and terminal.",
  '',
  'Abort:',
  '`handleBossInput.signal` is the abort surface; honor it at every `callPlayer`/`callCaptain`/`callJudge` and at every poll between transitions.',
  'Each provided Captain, player, judge, or nested-playbook boundary receives a signal combined from its XState invocation-lifetime signal and the currently active `handleBossInput` or `resumePlaybookCall` signal (e.g. with `combineAbortSignals`); classify a rejection as cancellation by causal identity with the applicable signal reason, not by an `AbortError` name or by observing only that the signal is also aborted; a distinct transport or sink failure that occurs after abort remains a non-abort control error and takes precedence.',
  'On abort, do not merely race the imperative wait and return while an invocation remains live: let the selected rejection path settle and drive the actor to a quiescent state before returning from the turn; no trace, status, state, or call completion caused by that turn may appear after the public method returns.',
  "Three strategies are permitted, selected per FSM: Natural rejection \u2014 the Captain or player actor ends the invocation by rejecting and the FSM routes it through `onError` to a quiescent sink (the cancelled port call may itself reject or resolve with `{ status: 'aborted' | 'error' }` that the runtime converts into an actor rejection; the contract is on the actor boundary, not the port promise; preferred when every invoking state's `onError` lands somewhere quiescent).",
  "Synthetic pre-emption to a quiescent target \u2014 send the FSM's pre-emption event (e.g. `BOSS_INTERRUPT { targetId: <state> }`) with a target that is itself quiescent (typically `ready` or `failed`); do not pick the active state, because gears2fsm prescribes `reenter: true` for `bossInterrupts`, so re-entering the active state restarts its `invoke` and spawns a fresh agent call.",
  'Programmatic stop \u2014 `actor.stop()` and report the turn as aborted via `emitStatus`, reserved for FSMs with neither `onError` wiring nor a pre-emption event.',
  "Whether the host's outer abort is recoverable or terminal is the host's concern; the runtime exits `handleBossInput` cleanly either way and the host decides whether to call `dispose` afterward.",
  '',
  'Status and telemetry:',
  'Emit at minimum one `emitStatus` per Boss-relevant transition (default: emit on every transition and let the host filter; hosts may bind a stricter rule) and one `emitTelemetry` per state transition under a namespaced topic (recommended `playbook.fsm.state`) with structured `from`, `to`, `event`, `previousState`, and `state` fields; descriptors carry the JSON-safe XState value, active stable ids from public state metadata, tags, status, and quiescence, and do not inspect private XState nodes.',
  "The telemetry payload additionally carries the exact pending Boss question or keyed questions selected from public snapshot context and normalizes any transition error without retaining a raw `Error` instance; do not reduce the payload to the current state (`from` and `previousState` are the authoritative prior descriptor while `to` and `state` are the new descriptor; on the first observed transition use the initialized state as both when no earlier transition exists); snapshot and recursively freeze the complete described payload independently from the state retained as `previousState` so an observer cannot mutate a later transition's authoritative `from` state; observers consume telemetry and the runtime never interprets the topic.",
  "Player prompts and adjudicator JSON may additionally ride the host's own record channels when present; the `playbook.trace` copies are the host-agnostic runtime-boundary record required above.",
  '',
  'Output module requirements:',
  "Emit one TypeScript module that imports the FSM artifact by relative path with an extension-bearing runtime specifier \u2014 the NodeNext-compatible `.js` specifier (e.g. `./code.fsm.js`) when the linked TypeScript ships JavaScript siblings, never a `.ts` specifier the package's Node versions cannot load; an explicitly source-only host may retain `.ts` only when it supports direct TypeScript loading and ships no JavaScript build.",
  'Restrict the module to erasable TypeScript syntax (type annotations that strip cleanly, no constructor parameter properties, `enum`s, or namespaces) so a host under type stripping loads it directly.',
  "Import XState's actor primitives (`createActor`, `fromPromise`, `setup`'s `.provide`).",
  'Import `PQueue` from `p-queue` for the single serialized emission channel.',
  "Import the FSM's exported machine/actor input and output types and use those exact types in `.provide(...)`; do not redeclare look-alike Captain, player, playbook, question, or output contracts beside the linked runtime.",
  'Import the applicable shared helpers from the extension-bearing `xstate-runtime.js` sibling of the resolved shared `--link` contract module, relativized from the emitted artifact exactly as the contract import is; every runtime uses `assertJsonSafe`, `snapshotJsonValue`, `snapshotPlaybookSession`, `normalizeError`, `normalizePlaybookSnapshot`, and `waitForPlaybookQuiescence`, and additionally imports `combineAbortSignals`, result validators, and `createNestedPlaybookBridge` only when its actor and composition paths need them; use those helpers instead of weaker local JSON, error, snapshot, nested-call, or imperative-wait implementations.',
  'Export `createPlaybookRuntime` and the typed `PlaybookRuntimeOptions` interface for that playbook.',
  'Expose, under an `_internal` export, the pure helpers verification needs \u2014 at least the player-prompt and Captain-prompt composers (`composePlayerPrompt` and `composeCaptainPrompt`) \u2014 so compilation-correctness tests can exercise composition without a host.',
  'Hold no host-specific types and no host primitive calls: speak only `PlaybookPorts` for every agent and host concern; the sole exception is `node:child_process`, imported only when the FSM declares a `script` actor.',
  'Record the linker inputs (FSM path, player binding, strategies) in a top-of-file header comment so the file is reproducible from the same inputs.',
  'Source the contract types (`PlayerResult`, `PlayerCallOptions`, `CaptainResult`, `CaptainCallOptions`, `PlaybookPorts`, `PlaybookSession`, `PlaybookTraceEvent`, `PlaybookCallRequest`, `PlaybookCallResult`, `PlaybookCallStart`, `PlaybookStateValue`, `PlaybookState`, `PlaybookRunResult`, `PlaybookRuntime`, `PlaybookRuntimeFactory`) from a single shared type-only module instead of redefining them, and re-export the names its consumers import, so every linked playbook shares one contract definition and the dependency runs one way from each linked module to the shared contract.',
  'When a co-located integration test for the linked runtime already exists, run it before reporting success and treat any failure as a generation failure; do not delete, skip, or weaken that suite to make a new artifact pass.',
  'Internal trace/status helpers may accept `unknown`, validate it with the same JSON-safety rules as the public boundary, and only then emit a `JsonValue`; they shall not require nominally typed public interfaces (`NormalizedError`, `PlaybookState`, `PlaybookCallRequest`, `PlaybookCallResult`) to satisfy a `JsonValue` index signature at compile time, nor silence that mismatch with an unchecked cast.',
  "Prompt placeholder substitution makes one callback-based pass over the original template; replacement strings are literal, so placeholder-looking text inside Boss/catalog/plan/result values and JavaScript replacement tokens such as `$&`, `$$`, dollar-backtick, and `$'` are not interpreted or substituted again.",
  '',
  'Out of scope:',
  'Do not define player prompts, result keys, or guard semantics \u2014 those belong in the GEARS source and the FSM artifact.',
  'Do not implement host adapters, host configuration, or presentation layouts \u2014 only constrain the `PlaybookPorts` contract they satisfy.',
  'Do not add trace persistence, multiple Boss-selected root engagements, recursive playbook calls, multi-Boss orchestration, or visualizer rendering; a host may persist the emitted trace but the runtime does not rehydrate a disposed actor from it; parked-session durability is in scope only through the optional snapshot surface above; new behavior in any of these areas requires a separate slc spec.',
].join('\n');

/**
 * Standard adjudicator-facing description for the `needsBossReply` guard.
 * Carries the load-bearing substring ``Output shall include `question:`` so the
 * runtime's adjudicator requires `question` in the JSON reply.
 */
const NEEDS_BOSS_REPLY_DESCRIPTION: string =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// ---------------------------------------------------------------------------
// Small typed accessors for actor-lifecycle events (kept local to this file)
// ---------------------------------------------------------------------------

function outputOf(event: unknown): CaptainOutput {
  return (event as DoneActorEvent<CaptainOutput>).output;
}

function errorOf(event: unknown): unknown {
  return (event as { error?: unknown }).error;
}

// ---------------------------------------------------------------------------
// Boss-surface helper (emitted once, reused per registered id)
// ---------------------------------------------------------------------------

/** Every captain-invoking state id registered for Boss-reply resume. */
const RESUMABLE_STATE_IDS = ['linking'] as const;

/**
 * One BOSS_REPLY resume arm per registered captain-invoking state, guarded on
 * `context.pendingBossQuestion?.resumeStateId === '<id>'` and targeting `#<id>`
 * with `reenter: true`. Captures the Boss answer into `bossReply` and keeps
 * `pendingBossQuestion` so the resumed state can compose its continuation.
 */
function resumableStates(ids: readonly string[]) {
  return ids.map((id) => ({
    guard: { type: 'isResumeTarget' as const, params: { id } },
    target: `#${id}`,
    reenter: true as const,
    actions: ['applyBossReply'] as const,
  }));
}

// ---------------------------------------------------------------------------
// Setup: types, the placeholder Captain actor, guards, and actions
// ---------------------------------------------------------------------------

/**
 * Placeholder Captain actor. It has the typed CaptainInput -> CaptainOutput
 * contract but no concrete implementation: it fails explicitly so a runner that
 * forgets to provide the real actor cannot silently no-op.
 */
const captainPlaceholder = fromPromise<CaptainOutput, CaptainInput>(
  async () => {
    throw new Error('captain actor must be provided by the runner');
  },
);

const machineSetup = setup({
  types: {
    context: {} as LinkContext,
    events: {} as LinkEvent,
    input: {} as LinkInput,
  },
  actors: {
    captain: captainPlaceholder,
  },
  guards: {
    isDone: ({ event }) => outputOf(event).guard === 'done',
    isNeedsBossReply: ({ event }) => outputOf(event).guard === 'needsBossReply',
    isNeedsBossReplyWithQuestion: ({ event }) => {
      const output = outputOf(event);
      if (output.guard !== 'needsBossReply') return false;
      const question: unknown = (output as { question?: unknown }).question;
      return typeof question === 'string' && question.trim().length > 0;
    },
    isEmptyAnswer: ({ event }) =>
      event.type === 'BOSS_REPLY' && event.answer.trim().length === 0,
    isResumeTarget: ({ context }, params: { id: string }) =>
      context.pendingBossQuestion?.resumeStateId === params.id,
  },
  actions: {
    // Populate context from a Boss entry event (dedicated action).
    applyBossEntry: assign(({ event }) => {
      if (event.type !== 'LINK_REQUEST') return {};
      return { fsmArtifact: event.fsmArtifact, target: event.target };
    }),
    // Capture the Boss answer for the resumed state's continuation prompt.
    applyBossReply: assign(({ event }) => {
      if (event.type !== 'BOSS_REPLY') return {};
      return { bossReply: event.answer };
    }),
    // Persist the discriminated result for inspection only.
    rememberResult: assign({
      lastResult: ({ event }) => outputOf(event),
    }),
    rememberCaptainError: assign({
      lastError: ({ event }) => errorOf(event),
    }),
    // Suspend for a Boss reply: record the pending question and clear any prior answer.
    setPendingBossQuestion: assign(
      (
        { event },
        params: { stateId: string; sourceItem: string; player: string },
      ) => {
        const output = outputOf(event);
        const question: unknown = (output as { question?: unknown }).question;
        return {
          pendingBossQuestion: {
            questionId: params.stateId,
            resumeStateId: params.stateId,
            sourceItem: params.sourceItem,
            player: params.player,
            question: typeof question === 'string' ? question : '',
          },
          bossReply: undefined,
        };
      },
    ),
    // Abandon any pending Boss question.
    clearBossReplyContext: assign({
      pendingBossQuestion: () => undefined,
      bossReply: () => undefined,
    }),
  },
});

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const linkMachine = machineSetup.createMachine({
  id: 'link',
  initial: 'ready',
  context: ({ input }) => ({
    fsmArtifact: input.fsmArtifact ?? '',
    target: input.target ?? '',
  }),
  states: {
    // Quiescent idle hub — no invoke, so construction/start performs no Captain call.
    ready: {
      id: 'ready',
      description:
        'Quiescent idle hub; waits for a Boss transformation request before any Captain call.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Quiescent idle hub; waits for a Boss transformation request before any Captain call.',
        },
      },
      on: {
        LINK_REQUEST: { target: '#linking', actions: 'applyBossEntry' },
      },
    },

    // The single captain-invoking state; realizes GEARS item LINK-1.
    linking: {
      id: 'linking',
      description:
        'Captain carries out the FSM-to-Runtime linking specified by LINK-1.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'linking',
          description:
            'Captain carries out the FSM-to-Runtime linking specified by LINK-1.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'linking',
          sourceItem: 'LINK-1',
          prompt: LINK_1_PROMPT,
          result: {
            done: 'The acting agent completed the behavior.',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          fsmArtifact: context.fsmArtifact,
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          // Valid Boss-reply suspension: needsBossReply carrying a question.
          {
            guard: 'isNeedsBossReplyWithQuestion',
            target: '#awaitBossReply',
            actions: [
              'rememberResult',
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'linking',
                  sourceItem: 'LINK-1',
                  player: 'Captain',
                },
              },
            ],
          },
          // Malformed: needsBossReply without a question -> failed.
          {
            guard: 'isNeedsBossReply',
            target: '#failed',
            actions: ['rememberResult', 'clearBossReplyContext'],
          },
          // Success: linking complete -> terminate.
          {
            guard: 'isDone',
            target: '#done',
            actions: ['rememberResult', 'clearBossReplyContext'],
          },
          // Any other guard is out of contract (malformed) -> failed.
          {
            target: '#failed',
            actions: ['rememberResult', 'clearBossReplyContext'],
          },
        ],
        onError: {
          target: '#failed',
          actions: ['rememberCaptainError', 'clearBossReplyContext'],
        },
      },
    },

    // Third Boss surface: suspend here until Boss answers, then resume the same state.
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
          // Empty or whitespace-only answer is malformed -> failed.
          {
            guard: 'isEmptyAnswer',
            target: '#failed',
            actions: 'clearBossReplyContext',
          },
          // Resume the suspended captain-invoking state with the Q+A available.
          ...resumableStates(RESUMABLE_STATE_IDS),
        ],
        // A fresh Boss directive starts a new turn and clears stale context.
        LINK_REQUEST: {
          target: '#linking',
          actions: ['clearBossReplyContext', 'applyBossEntry'],
        },
      },
    },

    // Recoverable error hub: not final; Boss may recover via a fresh request.
    failed: {
      id: 'failed',
      description:
        'A Captain invocation or Boss reply failed; recoverable via a fresh Boss request.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'A Captain invocation or Boss reply failed; recoverable via a fresh Boss request.',
        },
      },
      on: {
        LINK_REQUEST: { target: '#linking', actions: 'applyBossEntry' },
      },
    },

    // Completion signal for the runner.
    done: {
      id: 'done',
      type: 'final',
      description: 'FSM-to-Runtime linking complete.',
      meta: {
        playbook: {
          stateId: 'done',
          description: 'FSM-to-Runtime linking complete.',
        },
      },
    },
  },
});

export { resumableStates };
export default linkMachine;

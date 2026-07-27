import { assign, fromPromise, setup } from 'xstate';

// This machine realizes the single GEARS item `GEARS2FSM-1`: a direct-Captain
// behavior that transforms normative GEARS spec items into an XState v5 finite
// state machine (an object-only machine artifact). The item carries no
// `Results:` label, so its state receives the default single-outcome contract
// (`done`) plus the universal `needsBossReply`. Only the `captain` actor kind is
// used, so no player, playbook, or script actor contract is declared.

// The machine takes no per-run parameters: the item's prompt establishes no
// runtime-value placeholder, so there is nothing for Boss or the runner to seed
// into context beyond the (empty) input.
export type GearsToFsmInput = Record<string, never>;

// The sole jumpable working leaf; a fresh Boss directive re-enters it.
export const BOSS_INTERRUPT_TARGETS = ['transform'] as const;
export type WorkingStateId = (typeof BOSS_INTERRUPT_TARGETS)[number];

// The captain-invoking working leaf is resumable after a Boss reply.
export const RESUMABLE_STATE_IDS = ['transform'] as const;
export type ResumableStateId = (typeof RESUMABLE_STATE_IDS)[number];

export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

// Typed input for the direct `captain` actor. `pendingBossQuestion` and
// `bossReply` are the singular per-leaf continuation fields the linker reads to
// compose the Boss-reply preamble; they are omitted when absent.
export interface CaptainInput {
  stateId: string;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

// Discriminated result contract: `done` (default single outcome) and the
// universal `needsBossReply`, which additionally requires `question`.
export type CaptainOutput =
  | { guard: 'done' }
  | { guard: 'needsBossReply'; question: string };

export type GearsToFsmEvent =
  | { type: 'BOSS_REQUEST' }
  | { type: 'BOSS_INTERRUPT'; targetId: WorkingStateId }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

interface NormalizedError {
  name: string;
  message: string;
}

interface GearsToFsmContext {
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: NormalizedError;
}

const TRANSFORM_STATE_ID = 'transform';
const SOURCE_ITEM = 'GEARS2FSM-1';

const DONE_RESULT_DESCRIPTION = 'The acting agent completed the behavior.';

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// The GEARS item's full final prompt, carried verbatim into invoke.input.prompt.
const TRANSFORM_PROMPT = [
  'Transform the normative GEARS spec items (source) into an XState v5 finite state machine, written as an XState v5 machine object artifact (target).',
  'Produce an object artifact only: define the machine, actor contracts, and typed inputs, but do not bind a runner or supply concrete runtime implementations.',
  "Use XState v5's `setup(...)` then `.createMachine(...)`.",
  'Restrict the artifact to erasable TypeScript syntax — type annotations that strip cleanly, no constructor parameter properties, `enum`s, or namespaces — so a host running under type stripping loads it directly.',
  "Pass the repository's strict `noUnusedLocals` and `noUnusedParameters` checks: have helper signatures and XState callbacks omit values they do not read (e.g., a fresh-context helper that uses only `bossIntent` shall not also accept an unused `context`, and an assign callback that reads only `event` shall destructure only `event`).",
  "Declare only `context`, `events`, machine `input`, and machine `output` in the `types` block; never emit `types: { actors: ... }`, since XState v5's `SetupTypes` has no `actors` property and emitting it is invalid and prevents registered action and actor names from type-checking.",
  "Declare a distinct typed actor contract in `setup(...)`'s top-level `actors` map for every actor kind the GEARS artifact uses, using typed actor logic such as `fromPromise<Output, Input>(...)`: `captain` for direct work performed by Captain; `player` for work Captain delegates to a named player; `playbook` for a nested playbook call; and `script` for a deterministic shell script an optimizer-introduced script item runs without any agent.",
  'Do not declare, register, export, or import an actor kind the GEARS artifact does not use (e.g., a playbook with direct Captain work and nested calls but no delegated player has `captain` and `playbook` contracts only).',
  'Have generated helpers accept an unknown event and narrow its `output` or `error` structurally to the declared actor contract before reading fields, since XState may expose heterogeneous invoked-actor output as `unknown` in shared guards and actions; do not rely on unchecked `event.output` inference.',
  'Have helpers that construct transition arrays preserve guard, action, and target literals with `as const`, `satisfies`, or typed action/guard functions rather than widening registered names to plain `string`.',
  "Do not import a runner or bake in concrete actor implementations; make each actor placeholder fail explicitly (for example, throw `'captain actor must be provided by the runner'`).",
  'Where the source artifact begins with an SPDX comment block, preserve its license and copyright text before the imports using valid TypeScript line comments; never copy Markdown HTML comment delimiters into a TypeScript target.',
  "Make `CaptainInput` a typed object with at least `stateId` (the stable id of the invoking working leaf), `sourceItem` (the GEARS item ID this state realizes), `prompt` (the source item's full final prompt, verbatim), and `result` (a record whose keys are the valid guard names this invocation may return).",
  "Make `PlayerInput` a typed object with at least `stateId` (the stable id of the invoking working leaf), `player` (the player Captain is to invoke), `sourceItem` (the GEARS item ID this state realizes), `prompt` (the source item's full final prompt, verbatim), and `result` (a record whose keys are the valid guard names this invocation may return).",
  "Make `ScriptInput` a typed object with at least `stateId` (the stable id of the invoking working leaf), `sourceItem` (the GEARS item ID this state realizes), `command` (the script item's blockquote text, verbatim after Markdown unescaping), and `result` (a record whose keys are the item's two declared guard names, first the zero-exit guard, then the nonzero-exit guard).",
  'Make `ScriptOutput` a discriminated union with one literal `guard` member per declared result key and a required `exitStatus: number` property; carry no prose output in the script contract, and let no downstream prompt depend on text a script produces.',
  'Make `CaptainOutput` and `PlayerOutput` each a discriminated union with one literal `guard` member per authored result key and every payload field required by that result as a required property; a catch-all `guard: string` interface with optional look-alike fields is not a discriminated contract and is malformed.',
  'Export the machine input plus every Captain, player, and playbook actor input/output type that the linker must provide; do not let the linked module redeclare near-duplicates that can drift in optional fields, dynamic-call metadata, question ids, or child result shapes.',
  "Make any recursive JSON value type exactly preserve the shared boundary's readonly variance: `type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };`.",
  'Use that readonly JSON type for nested-playbook output, completed-result evidence, plans, context, and machine output rather than a mutable array/record near-duplicate, so the linker need not cast or copy around a variance mismatch.',
  'Back every runtime-value placeholder that source established in a direct-Captain or delegated-player prompt with a typed actor-input field populated from typed machine context, so the linker can substitute it with the exact runtime value.',
  'Treat angle-bracketed metavariables quoted inside domain instructions (for example the literal `<model>` in a commit-message format) as ordinary prompt text, not runtime-value placeholders.',
  'For the generic Captain forms, wire `<boss-intent>` from `bossIntent`, `<enabled-playbooks>` from `enabledPlaybooks`, `<remaining-plan>` from `remainingPlan`, and `<completed-call-results>` from `completedCallResults`.',
  'Have other placeholders retain the semantic typed field established by source (for example `<#>` from `irNumber`); leaving a placeholder literal, replacing it with an empty default because its field was omitted, or making the linker recover it from untyped context is malformed.',
  'Make the sole blockquote placeholder of a dynamic nested-playbook item the child `textContext` field specified under nested playbook calls.',
  "Make the generic Captain's `enabledPlaybooks` field an immutable array of exact entries `{ id: string, command: string, intent: string }`, not an array of ids or an open record; its dynamic-call guard checks `entry.id`, while the linked runtime validates, snapshots, and deterministically renders all three fields.",
  'Specify and interpret guard names per state, not as a global union, since a global union encourages name reuse with divergent semantics and couples unrelated states.',
  "Let shared helpers accept `string`, but treat each state's `invoke.input.result` as the authoritative local contract.",
  "For an acting GEARS item, derive that contract only from the ordered bullets under the item's out-of-blockquote `Results:` label.",
  'Match every declared guard name to `[A-Za-z_$][A-Za-z0-9_$]*`.',
  'Preserve every guard name, order, and description verbatim; reject a missing, duplicate, blank, or malformed declaration; and do not infer a result contract from acting-prompt prose or transition implementation.',
  'Treat an acting item that declares no `Results:` label as having exactly one outcome, since text2gears emits result contracts only for behaviors with more than one outcome, or whose output a later item consumes.',
  'Give such a state the default single-outcome contract: one result `done` with the fixed description `The acting agent completed the behavior.`, plus the universal `needsBossReply`.',
  'Let a single-outcome item instead carry exactly one authored `Results:` bullet when a later prompt consumes its output, and derive the one-guard contract from that bullet as usual.',
  'Make the `done` transition self-driving: target the next workflow obligation, or a `final` state when the item is the last one.',
  'Never apply the default to an item carrying a `Results:` label, and do not license inferring any richer contract from prose.',
  "Make the item's blockquote alone become `invoke.input.prompt`; never let the `Results:` label and bullets enter that prompt.",
  'Have each result description name every additional output field its accepting guard requires, using the exact case-sensitive property names (e.g., a delegation or continuing-call description whose guard reads the planned child call says its output includes `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`; a direct or final response names `response`; and an authored question names `question`); a vague description such as "selected the next call" is malformed when its guard also requires structured fields.',
  'Let deterministic verification synthesize valid actor output from this local result contract, and do not infer hidden guard payloads from guard source text.',
  'For the default generic Captain decide-call-observe pattern, treat the local guard discriminants as a stable compiler contract, not names to invent: initial routing uses `question` with required `question` and `delegation` with required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`, and has no direct or terminal result; post-child reassessment uses `final` with required `response`, `followUpQuestion` with required `question`, and `continuing` with required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`.',
  'Give both direct-Captain states the universal `needsBossReply` result additionally, and use those exact case-sensitive names in their guards and actions so the compiled adjudication contract remains stable.',
  'Have each state declare a stable `id` (for `#id` targeting and Boss interrupts), an intuitive state key (the property name under `states: { ... }`), a one-line `description` (for inspector tools and documentation), and JSON-safe `meta: { playbook: { stateId, description } }` repeating its stable id and description so linked runtimes can discover active public identities through `snapshot.getMeta()` without private XState nodes.',
  'If a state invokes the direct `captain` actor, have `invoke.input` carry `sourceItem`, `prompt`, and `result`; if it invokes the delegated `player` actor, additionally carry `player`; if it invokes the `script` actor, have `invoke.input` carry `stateId`, `sourceItem`, `command`, and `result` — no `prompt` and no `player`.',
  'Put the source item ID in `invoke.input.sourceItem`, not in a comment, to keep the GEARS-to-state mapping machine-readable.',
  "Match a delegated state's `invoke.input.player` to its source item's named player, and do not let a direct Captain state invent a `Captain` player binding.",
  'Carry the tag `playbook.busy` on every invoking working leaf — sequential or parallel, whatever its actor kind — since the shared quiescence helper derives busyness strictly from active-state tags and an untagged working leaf reads as quiescent while its call is still in flight.',
  "Make the machine's initial state a quiescent idle hub with no `invoke` — typically `ready` — that accepts the Boss entry events and carries the `playbook.parked` tag because it can return control to Boss.",
  'Begin Captain- and player-invoking work only on a Boss-originated event, so constructing and starting the machine performs no agent call.',
  "Have each direct Captain or delegated player actor return a discriminated result with `guard` set to one of `input.result`'s keys, and have guards on `onDone` transitions inspect `event.output.guard` to route.",
  "Map each source spec item to exactly one state in target, setting that state's `invoke.input.sourceItem` to the item's ID and `invoke.input.prompt` to the item's prompt verbatim.",
  "Map an item written as direct Captain work to exactly one `captain` invocation, an item that prompts or relays to a named player to exactly one `player` invocation, a nested-call item to exactly one `playbook` invocation, and a script item (`Captain shall run:`) to exactly one `script` invocation whose `input.command` carries the blockquote verbatim and whose `result` preserves the item's two guards in declared order.",
  'Do not infer one actor kind from a runtime player name or encode Captain as a player.',
  "Treat a script state as not agent-invoking: do not add `needsBossReply` to a script state's result map, and do not register it with `resumableStates(ids)`.",
  "Target the next workflow step from a script state's success guard and route its failure guard to `failed` unless the source items define a different recovery.",
  'Do not concatenate prompts across items, re-compose them, or silently dedupe, since each spec item already carries the full final prompt for one state behavior with no duplicate lines.',
  'Reject or flag a spec item that still contains duplicate prompt lines rather than silently propagate the duplication into `invoke.input.prompt`.',
  "Compile items carrying the same `Parallel group: <id>` metadata into one compound state with `type: 'parallel'` and one region per item.",
  'Require each parallel member to be a delegated-player item, and treat a direct-Captain or nested-call member as malformed because those actor kinds share one Captain control lane or one pending-child slot.',
  "Give each region a delegated-player working leaf and a local final state, and have the working leaf retain the item's stable state id, `sourceItem`, player, prompt, and result contract.",
  "Use the parallel parent's `onDone` as the join, which XState takes only after every region reaches final.",
  'Have each branch assign only its own staged result, and have the join promote all staged results atomically before later work begins, so branch completion order cannot change downstream inputs.',
  'Forbid transitions between sibling regions.',
  'Have a branch that supports Boss-reply suspension use a local waiting leaf tagged `playbook.parked` rather than exit the parallel parent, and have `BOSS_REPLY` identify and reenter only the waiting branch.',
  'If several branch questions are pending, carry a stable question id on the event and do not let the classifier guess among them.',
  'Let a fresh entry event or root interrupt exit the complete parallel parent and clear its staged results and branch questions.',
  'Treat a fixed parallel parent as one jumpable unit: generate a stable id and root `BOSS_INTERRUPT` target for the parallel parent, not for any working leaf inside its regions.',
  "Keep branch working ids as valid internal resume targets for their branch-local `BOSS_REPLY`, but keep them out of the interrupt target union or classifier catalog, to prevent a nominal one-branch jump from implicitly entering or restarting the parallel parent's other regions.",
  'Exit an invoke error to the root failure state, allowing XState to stop the sibling invocations automatically.',
  'Compile an item whose behavior is a literal or dynamic `Captain shall call playbook ...:` to a state that invokes a typed `playbook` actor, not the `captain` or `player` actor.',
  'Declare `PlaybookInput` in the setup types with stable `stateId`, target `playbookId`, composed `text`, and optional `sourceItem`.',
  "Treat the playbook actor's successful output as the child's JSON-safe machine output itself (or `undefined`), not a second wrapper carrying a synthetic status or `output` field, so `invoke.onDone` records `event.output` as the successful child output.",
  'Reject the actor on aborted and error call results so they reach `invoke.onError`.',
  'Supply a failing placeholder for `playbook`, just as for `captain` and `player`, and let the linked runtime provide the actor implementation.',
  'For a literal call, keep the existing representation: `playbookId` is the literal target and `text` is the composed GEARS blockquote.',
  "For a dynamic call written ``Captain shall call playbook selected by `<target-field>`:``, declare the named target field and the blockquote's text field as typed string fields in FSM context.",
  "Require string-valued `playbookIdContext` and `textContext` metadata fields in the dynamic `PlaybookInput` variant; have its `invoke.input` read the runtime values from those exact context fields and also carry the static metadata `{ stateId: '<stable-state-id>', sourceItem: '<ITEM-A>', playbookId: context.nextPlaybookId, text: context.nextPlaybookInput, playbookIdContext: 'nextPlaybookId', textContext: 'nextPlaybookInput' }`.",
  "Treat `playbookIdContext` and `textContext` as naming context fields that never contain runtime target or text values, and emit them as explicit string literals so conformance tools can verify context wiring without evaluating or parsing the `invoke.input` function's source.",
  'Make the evaluated `playbookId` and `text` each strings coming from the context field named by its corresponding metadata property, and let literal calls omit these dynamic metadata properties and retain their existing behavior.',
  'Carry tag `playbook.suspended` on the call state, and route `invoke.onDone` from child output and `invoke.onError` from child failure.',
  "Keep the child call state-scoped: leaving the call state stops the invoked actor and aborts the host call through XState's invocation signal.",
  'Do not allocate runtime call ids, construct child sessions, retain runtime promises, or route Boss text to the child.',
  'When source explicitly continues one downstream behavior after a child success, abort, or failure, record the corresponding JSON-safe child result on both `invoke.onDone` and `invoke.onError` and target that downstream behavior, using the generic `failed` state only when source declares no recovery or reassessment path for a rejected child.',
  "Make that recovering `onError` an ordered transition array whose first arm uses a typed structural guard that accepts only an `Error` carrying a validated public child `result` with `status: 'aborted' | 'error'`, and only that arm appends sanitized child evidence and continues.",
  'Give the recovering `onError` a fallback arm that retains the control error normalized as JSON-safe `{ name, message, stack? }` in `lastError` and routes to `failed` without appending a completed child result, leaving the linked runtime alone to retain the original error in its out-of-machine latch.',
  'Treat non-abort port rejection, malformed port data, JSON, identity, bridge, and other control-plane errors as not authored child outcomes even though XState delivers both kinds through `invoke.onError`.',
  "Where the rejected error structurally carries the runtime's normalized child result, have the error action inspect whether its status was `aborted` or `error` rather than collapse both into an invented success/failure enum, inspecting that public structural data without importing the runner or constructing runtime call identities.",
  "For a workflow that reassesses child results, use a typed JSON-safe record such as `{ playbookId, status: 'ok', output }` on `onDone` and `{ playbookId, status: 'aborted' | 'error', error }` on `onError`.",
  'Because the runtime rejection is an `Error` with a public `result` property, inspect `result.status` and `result.error` before applying a generic `Error` normalizer, and persist only the current context target id, the status, and a compact `{ name, message }` error — never the whole runtime result, child session id, child state, call identity, or stack.',
  'Give an abort without an error a compact generic abort description, and keep the current target id available in typed context until the sanitized record has been created.',
  'On success, persist only `event.output`, which is the actual child machine output returned by the bridge, not a runtime call-result envelope; when that optional output is absent, omit the `output` property from the completed-result record rather than storing `undefined`.',
  'Treat the outer trusted error as an actual `Error` instance rather than a plain JSON object: have the structural guard inspect its public `.result` property directly, then validate only that nested result before sanitizing it, without requiring the outer error itself to pass a plain-object/JSON guard.',
  "Validate the nested public result's status-specific required members and target identity: `playbookId` shall equal the current selected target, an `error` result shall carry a normalized error, and every present optional member shall have the public contract's declared shape.",
  "Treat a look-alike such as `{ status: 'error' }` as malformed control data, not an authored child failure, and take the fallback `failed` arm without appending evidence; do not fabricate missing identity or error members merely because the status string is recognized.",
  "Treat the public result's declared optional `childSessionId` and `state` members as valid when their shapes satisfy the shared contract: validate and then discard them when building compact Captain evidence rather than treating them as undeclared extras.",
  "Validate the public normalized error's declared optional string `stack` and omit it from the compact `{ name, message }` evidence rather than reject an otherwise valid authored child result.",
  'Apply the public union exactly: an `aborted` or `error` result rejects an `output` member; a present `childSessionId` is non-empty; `error` contains only non-empty `name`, string `message`, and optional string `stack`; and a present `state` validates every declared `PlaybookState` member and rejects unknown or missing members — do not treat an arbitrary JSON-safe object as a valid `state` or check only that these members have broad string/object types.',
  'Have the guard validate the complete public result it received while the action retains only the current selected playbook id, status, and compact error; do not implement evidence minimization by accepting only the three keys that survive that projection.',
  'Before entering a dynamic call, reject an empty target and empty input text, any target equal to `selfPlaybookId`, and any target that source requires to belong to an input catalog but that catalog does not contain, performing the rejection before invoking the `playbook` actor; the host remains responsible for its independent registry validation.',
  'Where source forbids repeating an equivalent completed or failed call without new information, keep a private deterministic history of target-and-input signatures and reject a continuation whose target and complete input exactly match a prior call, encoding each signature as the collision-free `JSON.stringify([playbookId, text])` tuple of exact JavaScript strings, not delimiter concatenation, and appending it before invocation so success, abort, and authored failure all count.',
  "Keep that history out of any Captain or player prompt; treat a revised input containing new information as a different call; and treat the exact machine check as a safety floor while the acting Captain remains responsible for source's broader semantic equivalence policy.",
  "Put that validation on the guarded transition into the call state, and make the call state's `invoke.input` mapper a pure read of the already-validated typed context fields that does not call an assertion helper or throw while XState resolves actor input, so state restoration, inspection, and scripted coverage do not crash outside the invocation's `onError` boundary.",
  "For the default Captain decide-call-observe loop, transition the delegation and continuing `onDone` arms directly into the invoking call state, with each arm's single guard validating its applicable actor-output and context constraints (both validate JSON shape, catalog membership, self-target, and duplicate history, while strict plan shrink applies only to `continuing`) and its actions storing the selected target/input and appending the signature before state entry.",
  'Do not interpose an eventless preparation or validation state between the Captain actor and the call state, since it obscures the authored Captain entry edge from deterministic coverage and adds no XState safety beyond the guarded direct transition.',
  'Type and name context fields used to drive guards or compose prompts.',
  'Do not branch on untyped properties of `lastResult`; put persistent routing decisions in typed context fields and keep `lastResult` for inspection only.',
  'Where source declares a finite ordered plan, represent it as a typed readonly JSON-safe array and validate that shape on the actor-output transition, since an unconstrained `JsonValue` does not establish that a plan is ordered or finite.',
  'Where a decide-call-observe loop carries the calls after the selected next call as `remainingPlan`, require its continuing-call guard to additionally require the new plan to be strictly shorter than the current plan, so the initial finite array bounds the number of sequential child calls without an arbitrary runtime call limit while letting Captain revise or remove remaining entries.',
  'Pass only the specific extracted fields the player needs in prompts; do not dump `JSON.stringify(lastResult)` or any opaque blob, which leaks internal `guard` strings, wastes tokens, and confuses the LLM.',
  "Flow player bindings and per-run parameters in via the machine's `input` and copy them into context at start-up; do not bake in player bindings, model names, or per-run values.",
  'Keep host-owned configuration such as an enabled-playbook catalog as immutable machine input/context for the session, and never let Boss events or actor outputs carry, replace, append to, or otherwise overwrite that catalog.',
  'Give every machine with a dynamic call its own registered or authored playbook id as immutable machine input/context named `selfPlaybookId`, and have its dynamic-call guard reject that target; reserve the leaf-level `stateId` name for actor invocation identity and do not reuse it for a playbook id.',
  'Omit absent optional members from JSON-safe context and output records instead of creating own properties whose value is `undefined`.',
  'Accept in JSON validation only null, booleans, finite numbers, strings, arrays, and plain own enumerable data-property objects; reject cycles, non-plain instances (`Error`, `Date`, `Map`, and class instances), accessors, symbol keys, sparse/undefined values, `NaN`, and infinities rather than silently changing them during serialization.',
  'Require an accepted array to have prototype exactly `Array.prototype`, no holes, symbols, accessors, or extra own string properties, and enumerable own data descriptors for every canonical index, with its standard non-enumerable `length` descriptor the sole exception; that data descriptor shall be non-configurable and carry the exact array length, but its `writable` flag may be either `true` on an ordinary array or `false` after the shared runtime recursively freezes a validated boundary value.',
  'Require `Reflect.ownKeys(array)` to contain exactly `length + 1` keys — the `length` property and every canonical index from `0` through `length - 1` — and treat a digit string whose numeric value is not less than `length` as an extra property, not an array index.',
  'Require an accepted record to have prototype exactly `Object.prototype` or `null`, and every key returned by `Reflect.ownKeys` to be a string whose own descriptor is enumerable and a data descriptor.',
  'Track only the active recursion path in cycle detection and remove a container on unwind, so a shared acyclic array or record is valid while an actual back-edge is rejected.',
  'Fire a transition on an event — typically `onDone` (actor completed) — and let a synchronous guard pick the path when multiple are possible.',
  'Persist relevant typed fields from `event.output` to context via `assign` so downstream prompts can read them.',
  'Make transitions self-driving when source items define the next obligation, routing to an idle hub only for recovery, unrecoverable Boss input, or one-shot entry events — not the happy path.',
  "Target the next workflow step from a review/approval state's success outcome rather than idle back to a hub, since returning to Boss on success is a defect that forces manual stepping.",
  'Do not enter a fresh approval of the same content from a state following an approval, since it adds latency and risks ping-pong loops; a state may route through approval once when its input came from an unreviewed branch (e.g., re-do without an intervening review).',
  'When the source has a feedback cycle, reuse one feedback cycle across all phases that need feedback rather than duplicate it per phase, and let phases set typed routing fields so terminal outcomes return to the originating branch.',
  'Accept Boss input through three surfaces: pre-emptive interrupts on active states, typed entry events on idle or recoverable states, and Boss replies to player questions that suspended the FSM in a dedicated wait state.',
  'Let Boss interrupt any active state that can itself receive a Boss turn; give every jumpable state a stable `id`; treat a final state as not jumpable; and treat a `playbook.suspended` call state with an outstanding child as not a Boss interrupt target, since the host routes Boss input to the active child leaf and resumes the parent only from the matching child result.',
  "Handle the runtime's `{ type: 'BOSS_INTERRUPT', targetId: '<id>' }` at the root machine with one guarded transition per jumpable state targeting `#<id>` with `reenter: true` so invoked actors restart cleanly.",
  'Emit a `bossInterrupts(ids)` helper rather than hand-write one transition per state.',
  'Have each generated interrupt arm guard both the selected `targetId` and every typed context precondition required to enter that target safely; do not jump into a working or reassessment state with missing intent, prior result, plan, or other required context, and do not invent defaults merely to make an interrupt target executable.',
  "Rely on XState automatically stopping the current state's invoked actor on transition.",
  "Where the default Captain's routing state accepts a fresh intent while another state or Boss-reply wait is active, require its `BOSS_INTERRUPT` event to carry a required non-empty `bossIntent`, and have the guarded routing arm copy that value, clear the prior plan, child evidence, exact-call history, selected call, response, error, and consumed question/reply context, then reenter routing without restarting the old intent or retaining a stale pending question.",
  "For this default Captain, make `routing` the sole `BOSS_INTERRUPT` target so a fresh directive always returns to routing and never jumps directly into reassessment or the Boss-reply wait, and require the typed event union and classifier contract to require exactly `targetId: 'routing'` plus the fresh `bossIntent`.",
  'Distinguish Boss entry events from `BOSS_INTERRUPT`: `BOSS_INTERRUPT` jumps into an active machine pre-empting whichever state is running, while Boss entry events start or resume from idle or recoverable states when Boss-supplied parameters cannot be inferred from machine state alone.',
  "Type entry events alongside `BOSS_INTERRUPT` and populate context via a dedicated action, and do not let an entry event's copy action clear per-run parameters the event omits, letting an absent optional field fall back to the existing (input-seeded) context value.",
  'Do not collapse the two surfaces: let `BOSS_INTERRUPT` always carry its target id and additionally carry typed Boss-supplied fields such as an intent or IR number only where source requires the pre-empted target to consume them, and let a parameterless entry event collapse to interrupt-style routing only when state-jump and context-update semantics are identical.',
  'Do not make entry events root-level transitions from every active state unless the workflow supports pre-emption; place them on idle and recoverable states (e.g., `failed`).',
  'When a captain- or player-invoking state needs a Boss decision the acting agent cannot supply alone, suspend that task in a quiescent wait state and resume the same task with the Q+A in the next prompt, as a third Boss surface alongside `BOSS_INTERRUPT` and Boss entry events.',
  'Support this path for every captain- and player-invoking state, with no source-level opt-in annotation and no `needsBossReply` result metadata in GEARS output.',
  "Preserve the GEARS blockquote as the state's domain `prompt` body and do not inject any Boss-question instruction into `invoke.input.prompt`.",
  "For every captain- and player-invoking state, add `needsBossReply` to the state's `invoke.input.result` map with the standard adjudicator-facing description: `The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include ``question: <verbatim question text from the acting agent's prose>``.`",
  'Let the linker\'s required-field extractor interpret only the identifier before the colon in the standard annotated backtick form as the JSON field name (`question`), and have the linked runtime compose player prompts per link.md "Player prompt composition" without adding a player-visible Boss-question instruction.',
  'Make the question record `{ questionId, resumeStateId, sourceItem, player, question }`, with `questionId` and `resumeStateId` both equal to the stable working-leaf `stateId`.',
  "Source `questionId`, `resumeStateId`, and `sourceItem` from the suspended working leaf's stable invocation metadata; source `player` from a delegated `PlayerInput`, or use the literal `Captain` for a direct-Captain state; and source only `question` from adjudicated actor output.",
  "Let a machine with at most one active Captain or player task use the scalar form: an `awaitBossReply` state with stable `id: 'awaitBossReply'`, tag `playbook.parked`, and description `Waiting for Boss to answer the acting agent's question.`; a `BOSS_REPLY` event carrying `{ answer: string; questionId?: string }`; context fields `pendingBossQuestion?: PendingBossQuestion` and `bossReply?: string`; and `resumableStates(ids)`, `setPendingBossQuestion`, and `clearBossReplyContext` helpers with the existing single-question behavior.",
  'Have a machine with parallel delegated-player tasks use the keyed form: one local waiting leaf per branch tagged `playbook.parked`; a `BOSS_REPLY` event carrying `{ questionId: string; answer: string }`; context fields `pendingBossQuestions: Partial<Record<ResumableStateId, PendingBossQuestion>>` and `bossReplies: Partial<Record<ResumableStateId, string>>`; and helpers that set, answer, and clear only the named branch record, with exiting the complete parallel group for a fresh directive or interrupt clearing every record owned by that group.',
  'Where exactly one question is pending, allow a linked runtime to accept a classifier reply that omits `questionId` and fill that sole id; where several questions are pending, require `questionId` in the classifier prompt and event and reject an omitted or unknown id without moving the FSM.',
  'Treat the scalar `awaitBossReply` state and every local branch wait as quiescent for the runtime drive boundary, and let them allow a fresh root entry event or interrupt to abandon the relevant pending question data before starting new work.',
  'Do not make the wait state or branch-wait leaf itself an interrupt target, since re-entering it after the interrupt clears its pending question would create an unresumable parked state; keep its recorded working leaf the sole `BOSS_REPLY` resume destination.',
  "Have a captain- or player-invoking state's `invoke.input` function carry the pending question and reply selected for that working leaf as singular `pendingBossQuestion` and `bossReply` fields, regardless of the scalar or keyed context representation, so prompt composition has one stable contract.",
  'When both fields are present, let the linked runtime compose the continuation preamble and labelled Q&A blocks per link.md "Player prompt composition", and do not bake the continuation preamble into the GEARS-derived `prompt` body.',
  "Route the following malformed states to `failed`: Captain or player output has `guard: 'needsBossReply'` but no `question` field; Captain or player output declares `needsBossReply` from a state without a registered scalar or branch-local resume route; `BOSS_REPLY` fired with empty or whitespace-only `answer`; a keyed `BOSS_REPLY` names no pending question.",
  'Declare an `onError` handler on every `invoke` with a fallback routing to a dedicated `failed` state and capturing the error in `context.lastError` for inspection; a nested playbook invoke may place its validated authored-child recovery arm before that fallback.',
  "Make `failed` not `final`: carry tag `playbook.parked`, retain enough typed context for Boss recovery, and accept the workflow's recovery entry or interrupt surface, so the parked tag distinguishes a recoverable failure from a busy state and the host retains the session instead of treating the outcome as an unhandled runtime error.",
  "Declare at least one `type: 'final'` state (typically `done`) reachable on completion, since a never-terminating machine is a defect that leaves the runner with no completion signal.",
  "Where source declares a JSON-safe terminal result, declare that output in the setup types and derive it from typed context through XState's machine `output` function, since a final-state transition alone does not satisfy a declared output contract.",
  'Make fields that source requires in every terminal output required in the TypeScript output type (a declared `{ response }` result compiles as `{ response: string }`, not `{ response?: string }`), and guard out reaching the final state without a non-empty response before constructing the machine output.',
].join('\n');

// Resumable-state registry helper (scalar Boss-reply form).
export function resumableStates(
  ids: readonly ResumableStateId[],
): ReadonlySet<ResumableStateId> {
  return new Set(ids);
}

export const resumableStateIds = resumableStates(RESUMABLE_STATE_IDS);

// Structurally narrow a possibly-unknown done event's `output` to the captain
// guard discriminant rather than relying on unchecked `event.output` inference.
function readCaptainGuard(event: unknown): CaptainOutput['guard'] | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const output = (event as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) {
    return undefined;
  }
  const guard = (output as { guard?: unknown }).guard;
  if (guard === 'done' || guard === 'needsBossReply') {
    return guard;
  }
  return undefined;
}

// Structurally read the `question` payload from a possibly-unknown done event.
function readCaptainQuestion(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const output = (event as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) {
    return undefined;
  }
  const question = (output as { question?: unknown }).question;
  return typeof question === 'string' && question.length > 0
    ? question
    : undefined;
}

// Normalize an unknown invoke error into a compact JSON-safe record.
function toNormalizedError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    const message = (error as { message?: unknown }).message;
    return {
      name: typeof name === 'string' ? name : 'Error',
      message: typeof message === 'string' ? message : String(error),
    };
  }
  return { name: 'Error', message: String(error) };
}

// Emit one guarded, reentering root transition per jumpable state id rather
// than hand-writing them. Literals are preserved with `as const` so registered
// guard/action names and targets are not widened to plain `string`.
function bossInterrupts(ids: readonly WorkingStateId[]) {
  return ids.map((id) => ({
    guard: { type: 'bossInterruptTarget', params: { targetId: id } } as const,
    target: `#${id}` as const,
    reenter: true as const,
    actions: 'clearBossReplyContext' as const,
  }));
}

export const gears2fsmMachine = setup({
  types: {
    context: {} as GearsToFsmContext,
    events: {} as GearsToFsmEvent,
    input: {} as GearsToFsmInput,
  },
  actors: {
    // Object-only artifact: the runner must supply the real implementation.
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    bossInterruptTarget: (
      { event },
      params: { targetId: WorkingStateId },
    ): boolean =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === params.targetId,
    bossReplyPresent: ({ event }): boolean =>
      event.type === 'BOSS_REPLY' && event.answer.trim().length > 0,
  },
  actions: {
    setPendingBossQuestion: assign(({ event }) => {
      const pending: PendingBossQuestion = {
        questionId: TRANSFORM_STATE_ID,
        resumeStateId: TRANSFORM_STATE_ID,
        sourceItem: SOURCE_ITEM,
        player: 'Captain',
        question: readCaptainQuestion(event) ?? '',
      };
      return { pendingBossQuestion: pending, bossReply: undefined };
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
    recordBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
    }),
    rememberCaptainError: assign({
      lastError: ({ event }) =>
        toNormalizedError((event as { error?: unknown }).error),
    }),
    rememberMalformedOutput: assign({
      lastError: (): NormalizedError => ({
        name: 'MalformedCaptainOutput',
        message:
          'The captain actor returned output matching no declared guard, or declared needsBossReply without a question.',
      }),
    }),
    rememberMalformedReply: assign({
      lastError: (): NormalizedError => ({
        name: 'MalformedBossReply',
        message: 'BOSS_REPLY arrived with an empty or whitespace-only answer.',
      }),
    }),
  },
}).createMachine({
  id: 'gears2fsm',
  initial: 'ready',
  context: {},
  on: {
    BOSS_INTERRUPT: bossInterrupts(BOSS_INTERRUPT_TARGETS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Quiescent idle hub that waits for Boss to request the GEARS-to-FSM transformation.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Quiescent idle hub that waits for Boss to request the GEARS-to-FSM transformation.',
        },
      },
      on: {
        BOSS_REQUEST: { target: 'transform' },
      },
    },
    transform: {
      id: 'transform',
      description:
        'Captain transforms the GEARS spec items into an XState v5 machine object artifact.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'transform',
          description:
            'Captain transforms the GEARS spec items into an XState v5 machine object artifact.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => {
          const input: CaptainInput = {
            stateId: TRANSFORM_STATE_ID,
            sourceItem: SOURCE_ITEM,
            prompt: TRANSFORM_PROMPT,
            result: {
              done: DONE_RESULT_DESCRIPTION,
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
          };
          if (context.pendingBossQuestion !== undefined) {
            input.pendingBossQuestion = context.pendingBossQuestion;
          }
          if (context.bossReply !== undefined) {
            input.bossReply = context.bossReply;
          }
          return input;
        },
        onDone: [
          {
            guard: ({ event }) => readCaptainGuard(event) === 'done',
            target: '#done',
            actions: 'clearBossReplyContext',
          },
          {
            guard: ({ event }) =>
              readCaptainGuard(event) === 'needsBossReply' &&
              readCaptainQuestion(event) !== undefined,
            target: 'awaitBossReply',
            actions: 'setPendingBossQuestion',
          },
          { target: 'failed', actions: 'rememberMalformedOutput' },
        ],
        onError: { target: 'failed', actions: 'rememberCaptainError' },
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
            guard: 'bossReplyPresent',
            target: '#transform',
            reenter: true,
            actions: 'recordBossReply',
          },
          { target: 'failed', actions: 'rememberMalformedReply' },
        ],
      },
    },
    failed: {
      id: 'failed',
      description:
        'Recoverable failure state that retains context for Boss recovery.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'Recoverable failure state that retains context for Boss recovery.',
        },
      },
      on: {
        BOSS_REQUEST: { target: 'transform', actions: 'clearBossReplyContext' },
      },
    },
    done: {
      id: 'done',
      type: 'final',
      description:
        'Terminal state reached once the XState v5 machine object artifact is produced.',
      meta: {
        playbook: {
          stateId: 'done',
          description:
            'Terminal state reached once the XState v5 machine object artifact is produced.',
        },
      },
    },
  },
});

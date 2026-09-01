// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/* ------------------------------------------------------------------ *
 * Source item identity
 * ------------------------------------------------------------------ */

/** GEARS item this machine realizes. */
const G2F_1_SOURCE_ITEM = 'G2F-1';

/** Stable id of the working leaf that invokes Captain for G2F-1. */
const G2F_1_STATE_ID = 'transformSource';

/** G2F-1's full final prompt, verbatim from the GEARS blockquote. */
const G2F_1_PROMPT: string = [
  'Transform the named Source into the named Target: read the Source GEARS spec items and compose an XState v5 finite state machine object artifact.',
  'Target is an object artifact only: it defines the machine, actor contracts, and typed inputs, but shall not bind a runner or supply concrete runtime implementations.',
  "The artifact shall use XState v5's `setup(...)` then `.createMachine(...)`.",
  'The artifact shall restrict itself to erasable TypeScript syntax — type annotations that strip cleanly, no constructor parameter properties, `enum`s, or namespaces — so a host running under type stripping loads it directly.',
  "It shall also pass the repository's strict `noUnusedLocals` and `noUnusedParameters` checks.",
  'Helper signatures and XState callbacks shall omit values they do not read; for example, a fresh-context helper that uses only `bossIntent` shall not also accept an unused `context`, and an assign callback that reads only `event` shall destructure only `event`.',
  'The `types` block shall declare only `context`, `events`, machine `input`, and machine `output`.',
  "XState v5's `SetupTypes` has no `actors` property; emitting `types: { actors: ... }` is invalid and prevents registered action and actor names from type-checking.",
  "Declare a distinct typed actor contract in `setup(...)`'s top-level `actors` map for every actor kind the GEARS artifact uses, using typed actor logic such as `fromPromise<Output, Input>(...)`.",
  'Declare `captain` for direct work performed by Captain.',
  'Declare `player` for work Captain delegates to a named role.',
  'Declare `playbook` for a nested playbook call.',
  'Declare `script` for a deterministic shell script that an optimizer-introduced script item runs without any agent.',
  'Do not declare, register, export, or import an actor kind the GEARS artifact does not use; a playbook with direct Captain work and nested calls but no delegated player therefore has `captain` and `playbook` contracts only.',
  'XState may expose output from heterogeneous invoked actors as `unknown` in shared guards and actions.',
  'Generated helpers shall accept an unknown event and narrow its `output` or `error` structurally to the declared actor contract before reading fields; they shall not rely on unchecked `event.output` inference.',
  'Helpers that construct transition arrays shall preserve guard, action, and target literals with `as const`, `satisfies`, or typed action/guard functions rather than widening registered names to plain `string`.',
  'The artifact shall not import a runner or bake in concrete actor implementations.',
  "Each actor placeholder shall fail explicitly, for example by throwing `'captain actor must be provided by the runner'`.",
  'Where the Source artifact begins with an SPDX comment block, the generated artifact shall preserve its license and copyright text before the imports using valid TypeScript line comments.',
  'It shall never copy Markdown HTML comment delimiters into a TypeScript target.',
  "`CaptainInput` shall be a typed object with at least `stateId`, the stable id of the invoking working leaf; `sourceItem`, the GEARS item ID this state realizes; `prompt`, the source item's full final prompt, verbatim; and `result`, a record whose keys are the valid guard names this invocation may return.",
  "`PlayerInput` shall be a typed object with at least `stateId`, the stable id of the invoking working leaf; `role`, the canonical lowercase local id derived from the role Captain is to delegate; `sourceItem`, the GEARS item ID this state realizes; `prompt`, the source item's full final prompt, verbatim; and `result`, a record whose keys are the valid guard names this invocation may return.",
  "`ScriptInput` shall be a typed object with at least `stateId`, the stable id of the invoking working leaf; `sourceItem`, the GEARS item ID this state realizes; `command`, the script item's blockquote text, verbatim after Markdown unescaping; and `result`, a record whose keys are the item's two declared guard names, first the zero-exit guard, then the nonzero-exit guard.",
  '`ScriptOutput` shall be a discriminated union with one literal `guard` member per declared result key and a required `exitStatus: number` property.',
  'The script contract carries no prose output: downstream prompts shall not depend on text a script produces.',
  '`CaptainOutput` and `PlayerOutput` shall each be a discriminated union with one literal `guard` member per authored result key and every payload field required by that result as a required property.',
  'A catch-all `guard: string` interface with optional look-alike fields is not a discriminated contract and is malformed.',
  'The artifact shall export the machine input plus every Captain, player, and playbook actor input/output type that the linker must provide.',
  'The linked module imports those exact types; it shall not redeclare near-duplicates that can drift in optional fields, dynamic-call metadata, question ids, or child result shapes.',
  "Any recursive JSON value type in the artifact shall exactly preserve the shared boundary's readonly variance, as in `type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };`.",
  'Nested-playbook output, completed-result evidence, plans, context, and machine output shall use that readonly type rather than a mutable array/record near-duplicate.',
  'The linker shall not cast or copy around a variance mismatch.',
  'Every runtime-value placeholder established by Source in a direct-Captain or delegated-player prompt shall be backed by a typed actor-input field populated from typed machine context, so the linker can substitute it with the exact runtime value.',
  'Angle-bracketed metavariables quoted inside domain instructions, for example the literal `<model>` in a commit-message format, remain ordinary prompt text and are not runtime-value placeholders.',
  'For the generic Captain forms, wire `<boss-intent>` from `bossIntent`, `<enabled-playbooks>` from `enabledPlaybooks`, `<remaining-plan>` from `remainingPlan`, and `<completed-call-results>` from `completedCallResults`.',
  'Other placeholders shall retain the semantic typed field established by Source, for example `<#>` from `irNumber`.',
  'Leaving a placeholder literal, replacing it with an empty default because its field was omitted, or making the linker recover it from untyped context is malformed.',
  'The sole blockquote placeholder of a dynamic nested-playbook item is instead the child `textContext` field specified by the nested-playbook-call rules below.',
  "The generic Captain's `enabledPlaybooks` field shall be an immutable array of exact entries `{ id: string, command: string, intent: string }`, not an array of ids or an open record.",
  'Its dynamic-call guard checks `entry.id`, while the linked runtime validates, snapshots, and deterministically renders all three fields.',
  'Guard names shall be specified and interpreted per state, not as a global union.',
  'A global union encourages name reuse with divergent semantics and couples unrelated states.',
  "Shared helpers may accept `string`, but each state's `invoke.input.result` is the authoritative local contract.",
  "For an acting GEARS item, derive that contract only from the ordered bullets under the item's out-of-blockquote `Results:` label.",
  'Every declared guard name shall match `[A-Za-z_$][A-Za-z0-9_$]*`.',
  'Preserve every guard name, order, and description verbatim, reject a missing, duplicate, blank, or malformed declaration, and do not infer a result contract from acting-prompt prose or transition implementation.',
  'An acting item that declares no `Results:` label has exactly one outcome, because text2gears emits result contracts only for behaviors with more than one outcome, or whose output a later item consumes.',
  'Give such a state the default single-outcome contract: one result `done` with the fixed description `The acting agent completed the behavior.`, plus the universal `needsBossReply` below.',
  'A single-outcome item may instead carry exactly one authored `Results:` bullet when a later prompt consumes its output; derive the one-guard contract from that bullet as usual.',
  'The `done` transition is self-driving per the transition rules: it targets the next workflow obligation, or a `final` state when the item is the last one.',
  'The default never applies to an item carrying a `Results:` label, and it does not license inferring any richer contract from prose.',
  "The item's blockquote alone becomes `invoke.input.prompt`; the `Results:` label and bullets shall never enter that prompt.",
  'A `>` that remains at the start of a prompt line after removing the outer GEARS blockquote marker is literal quoted-context content and shall remain in `invoke.input.prompt` unchanged.',
  'Each result description shall name every additional output field its accepting guard requires, using the exact case-sensitive property names.',
  'For example, a delegation or continuing-call description whose guard reads the planned child call shall say that output includes `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`; a direct or final response shall name `response`; and an authored question shall name `question`.',
  'A vague description such as "selected the next call" is malformed when its guard also requires structured fields.',
  'Deterministic verification synthesizes valid actor output from this local result contract and shall not infer hidden guard payloads from guard source text.',
  'For the default generic Captain decide-call-observe pattern, the local guard discriminants are a stable compiler contract, not names the compiler may invent.',
  'Initial routing uses `question` with required `question` and `delegation` with required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`; it has no direct or terminal result.',
  'Post-child reassessment uses `final` with required `response`, `followUpQuestion` with required `question`, and `continuing` with required `remainingPlan`, `nextPlaybookId`, and `nextPlaybookInput`.',
  'Both direct-Captain states additionally receive the universal `needsBossReply` result.',
  'Their guards and actions shall use those exact case-sensitive names so the compiled adjudication contract remains stable.',
  "For a controller playbook — one whose Source declares DR-029's session-scoped controller policy: a session Captain that runs for the whole host session, receives every Boss turn, and operates the working playbooks from outside the engagement stack (DR-029) — apply the additive controller decision-state class below.",
  'The class joins the stable compiler contract beside the decide-call-observe vocabulary above; that vocabulary and the universal `needsBossReply` rule stay untouched for the artifacts that consume them.',
  "The controller machine shall be a session loop, not a finite errand: a quiescent conversational hub (tag `playbook.parked`) receives each Boss turn; the controller decision state decides it over the closed action set; a `respond` selection settles its turn in the decision call itself, its validated `text` being the turn's captain speech; an acting selection's host settlement becomes the outcome report grounding one closing-reply call; and the machine returns to the hub for the next turn.",
  "Returning to the hub after a settled turn completes the session loop's turn; it is not the idle-hub routing that the transition rules reserve for recovery.",
  "Because the hub receives every Boss turn, a controller state carries no Boss-reply suspension: do not add `needsBossReply` to a controller machine's `invoke.input.result` maps, because a clarifying question to Boss is a `respond` selection.",
  "The controller machine shall declare no terminal result output and shall keep exactly one reachable `type: 'final'` shutdown state entered only by the host's teardown event.",
  'The completion rule of the error-and-termination requirements applies unamended: its output clause binds only where Source declares a terminal result, which a controller Source does not.',
  "The controller decision state's direct-Captain result contract discriminates the closed action set of DR-029 as extended by DR-038.",
  "Its guard discriminants are a stable compiler contract, not names the compiler may invent — `respond`, `resume`, `start`, `switch`, `dismiss`, `deliver`, and `runtime` — with each guard's required payload fields.",
  '`respond` requires `text`.',
  '`resume` requires `playbookId` and carries no `input`.',
  '`start` and `switch` each require `playbookId` and `input`.',
  '`runtime` requires `actionId`.',
  '`dismiss` and `deliver` require none — a `deliver` result in particular carries no text payload: the host is authoritative for the delivered text, so the contract declares no field for it.',
  "The decision state's guards and actions shall use those exact case-sensitive names so the compiled controller contract remains stable.",
  'Each state shall declare a stable `id`, for `#id` targeting and Boss interrupts.',
  'Each state shall declare an intuitive state key, the property name under `states: { ... }`.',
  'Each state shall declare a one-line `description`, for inspector tools and documentation.',
  "Each state shall declare JSON-safe `meta: { playbook: { stateId, description, role? } }` naming the state's public playbook identity per the identity rule below and repeating its description, so linked runtimes can discover active public identities through `snapshot.getMeta()` without private XState nodes.",
  'A delegated-role state shall also carry the canonical lowercase source role id in `meta.playbook.role`; every other state shall omit `role`.',
  'A state that invokes the direct `captain` actor shall declare `invoke.input` carrying `sourceItem`, `prompt`, and `result`.',
  'A state that invokes the delegated `player` actor shall declare `invoke.input` additionally carrying the same source-derived `role` as `meta.playbook.role`.',
  'A state that invokes the `script` actor shall declare `invoke.input` carrying `stateId`, `sourceItem`, `command`, and `result` — no `prompt` and no `role`.',
  'The source item ID shall live in `invoke.input.sourceItem`, not in a comment, which keeps the GEARS-to-state mapping machine-readable.',
  "Outside a parallel group's regions, a state's `meta.playbook.stateId` shall equal its state key — the one identity a factory-backed linked runtime indexes by.",
  "A delegated state's `invoke.input.role` shall match the canonical lowercase id of its source item's named role.",
  'A direct Captain state shall not invent a `Captain` role binding.',
  'Every invoking working leaf — sequential or parallel, whatever its actor kind — shall carry the tag `playbook.busy`: the shared quiescence helper derives busyness strictly from active-state tags, so an untagged working leaf reads as quiescent while its call is still in flight.',
  "The machine's initial state shall be a quiescent idle hub with no `invoke` — typically `ready` — that accepts the Boss entry events and carries the `playbook.parked` tag because it can return control to Boss.",
  'Captain- and player-invoking work begins only on a Boss-originated event, so constructing and starting the machine performs no agent call.',
  "Each direct Captain or delegated player actor returns a discriminated result with `guard` set to one of `input.result`'s keys.",
  'Guards on `onDone` transitions inspect `event.output.guard` to route.',
  "A delegated-player invocation uses `src: 'player'` and a `PlayerInput` carrying that state's `stateId`, `role`, `sourceItem`, `prompt`, and `result`.",
  "For an item in which Captain acts directly, the corresponding invocation uses `src: 'captain'` and a `CaptainInput` with the same static mapping fields but no `role` field.",
  'Each Source spec item shall map to exactly one state in Target.',
  "A state's `invoke.input.sourceItem` shall be that item's ID, and `invoke.input.prompt` shall carry the item's prompt verbatim.",
  'An item written as direct Captain work shall map to exactly one `captain` invocation.',
  'An item that prompts or relays to a named role shall map to exactly one `player` invocation.',
  'A nested-call item shall map to exactly one `playbook` invocation.',
  "A script item, written `Captain shall run:`, shall map to exactly one `script` invocation whose `input.command` carries the blockquote verbatim and whose `result` preserves the item's two guards in declared order.",
  'Do not infer one actor kind from a runtime player name or encode Captain as a player.',
  "A script state is not agent-invoking: do not add `needsBossReply` to a script state's result map and do not register it with `resumableStates(ids)`.",
  "A script state's success guard shall target the next workflow step and its failure guard shall route to `failed` unless the source items define a different recovery.",
  'Per text2gears composition, each spec item already carries the full final prompt for one state behavior, with no duplicate lines.',
  'Do not concatenate prompts across items, re-compose them, or silently dedupe.',
  'A spec item that still contains duplicate prompt lines is malformed; reject or flag it rather than silently propagating the duplication into `invoke.input.prompt`.',
  "Items carrying the same `Parallel group: <id>` metadata shall compile into one compound state with `type: 'parallel'` and one region per item.",
  'Each member shall be a delegated-player item; a direct-Captain or nested-call member is malformed because those actor kinds share one Captain control lane or one pending-child slot.',
  "Each region shall contain a delegated-player working leaf and a local final state; the working leaf retains the item's stable state id, `sourceItem`, role, prompt, and result contract.",
  "The members' canonical role ids shall be pairwise distinct; a repeated role in one group is malformed.",
  'The parallel parent shall use `onDone` as the join, which XState takes only after every region reaches final.',
  "The artifact shall export `concurrentRoleSets` as a deeply readonly array containing one role-id array per parallel group in first-item source order, with each inner array following that group's item order.",
  'An artifact with no parallel group shall export an empty array.',
  'Each branch shall assign only its own staged result.',
  'The join shall promote all staged results atomically before later work begins, so branch completion order cannot change downstream inputs.',
  'Transitions between sibling regions are forbidden.',
  'Working leaves shall carry tag `playbook.busy`.',
  'A branch that supports Boss-reply suspension shall use a local waiting leaf tagged `playbook.parked` rather than exit the parallel parent; `BOSS_REPLY` shall identify and reenter only the waiting branch.',
  'If several branch questions are pending, the event shall carry a stable question id and the classifier shall not guess among them.',
  'A fresh entry event or root interrupt may exit the complete parallel parent and shall clear its staged results and branch questions.',
  'Treat a fixed parallel parent as one jumpable unit: generate a stable id and root `BOSS_INTERRUPT` target for the parallel parent, not for any working leaf inside its regions.',
  "Branch working ids remain valid internal resume targets for their branch-local `BOSS_REPLY`; they shall not appear in the interrupt target union or classifier catalog, which prevents a nominal one-branch jump from implicitly entering or restarting the parallel parent's other regions.",
  'An invoke error shall exit to the root failure state, allowing XState to stop the sibling invocations automatically.',
  'An item whose behavior is a literal or dynamic `Captain shall call playbook ...:` shall compile to a state that invokes a typed `playbook` actor, not the `captain` or `player` actor.',
  'The setup types shall declare `PlaybookInput` with stable `stateId`, target `playbookId`, composed `text`, and optional `sourceItem`.',
  "The playbook actor's successful output is the child's JSON-safe machine output itself (or `undefined`), not a second wrapper carrying a synthetic status or `output` field.",
  '`invoke.onDone` shall therefore record `event.output` as the successful child output.',
  'Aborted and error call results reject the actor and reach `invoke.onError`.',
  'The artifact shall supply a failing placeholder for `playbook`, just as it does for `captain` and `player`; the linked runtime provides the actor implementation.',
  'A literal call shall retain the existing representation: `playbookId` is the literal target and `text` is the composed GEARS blockquote.',
  "A dynamic call written ``Captain shall call playbook selected by `<target-field>`:`` shall declare the named target field and the blockquote's text field as typed string fields in FSM context.",
  'The dynamic `PlaybookInput` variant shall require string-valued `playbookIdContext` and `textContext` metadata fields.',
  "Its `invoke.input` shall read the runtime values from those exact context fields and shall also carry the static metadata `{ stateId: '<stable-state-id>', sourceItem: '<ITEM-A>', playbookId: context.nextPlaybookId, text: context.nextPlaybookInput, playbookIdContext: 'nextPlaybookId', textContext: 'nextPlaybookInput' }`.",
  '`playbookIdContext` and `textContext` name context fields; they never contain runtime target or text values.',
  "Emit them as explicit string literals so conformance tools can verify context wiring without evaluating or parsing the `invoke.input` function's source.",
  'The evaluated `playbookId` and `text` shall each be strings and shall come from the context field named by its corresponding metadata property.',
  'Literal calls need not carry these dynamic metadata properties and retain their existing behavior.',
  'The call state shall carry tag `playbook.suspended` and shall route `invoke.onDone` from child output and `invoke.onError` from child failure.',
  "The child call shall remain state-scoped: leaving the call state stops the invoked actor and aborts the host call through XState's invocation signal.",
  'The FSM shall not allocate runtime call ids, construct child sessions, retain runtime promises, or route Boss text to the child.',
  'When Source explicitly continues one downstream behavior after a child success, abort, or failure, both `invoke.onDone` and `invoke.onError` shall record the corresponding JSON-safe child result and target that downstream behavior.',
  'The generic `failed` state is the default only when Source declares no recovery or reassessment path for a rejected child.',
  'That recovering `onError` shall be an ordered transition array.',
  "Its first arm shall use a typed structural guard that accepts only an `Error` carrying a validated public child `result` with `status: 'aborted' | 'error'`; only that arm appends sanitized child evidence and continues.",
  'A fallback arm shall retain the control error normalized as JSON-safe `{ name, message, stack? }` in `lastError` and route to `failed` without appending a completed child result; the linked runtime alone retains the original error in its out-of-machine latch.',
  'Non-abort port rejection, malformed port data, JSON, identity, bridge, and other control-plane errors are not authored child outcomes even though XState delivers both kinds through `invoke.onError`.',
  "Where the rejected error structurally carries the runtime's normalized child result, the error action shall inspect whether its status was `aborted` or `error`; it shall not collapse both into an invented success/failure enum.",
  'The FSM may inspect that public structural data without importing the runner or constructing runtime call identities.',
  "For a workflow that reassesses child results, use a typed JSON-safe record such as `{ playbookId, status: 'ok', output }` on `onDone` and `{ playbookId, status: 'aborted' | 'error', error }` on `onError`.",
  'Because the runtime rejection is an `Error` with a public `result` property, normalization shall inspect `result.status` and `result.error` before applying a generic `Error` normalizer.',
  'It shall persist only the current context target id, the status, and a compact `{ name, message }` error; it shall never persist the whole runtime result, child session id, child state, call identity, or stack.',
  'An abort without an error gets a compact generic abort description.',
  'The current target id remains available in typed context until the sanitized record has been created.',
  'On success, persist only `event.output`, which is the actual child machine output returned by the bridge, not a runtime call-result envelope.',
  'When that optional output is absent, omit the `output` property from the completed-result record rather than storing `undefined`.',
  'The outer trusted error is an actual `Error` instance and therefore is not a plain JSON object.',
  'The structural guard shall inspect its public `.result` property directly, then validate only that nested result before sanitizing it; it shall not require the outer error itself to pass a plain-object/JSON guard.',
  "Validation of that nested public result includes its status-specific required members and target identity: `playbookId` shall equal the current selected target, an `error` result shall carry a normalized error, and every optional member that is present shall have the public contract's declared shape.",
  "A look-alike such as `{ status: 'error' }` is malformed control data, not an authored child failure, and shall take the fallback `failed` arm without appending evidence.",
  'The guard shall not fabricate missing identity or error members merely because the status string happens to be recognized.',
  "The public result's declared optional `childSessionId` and `state` members are valid when their shapes satisfy the shared contract; validate and then discard them when building compact Captain evidence, as they are not undeclared extras.",
  'Likewise, the public normalized error may carry its declared optional string `stack`; validate it and omit it from the compact `{ name, message }` evidence rather than rejecting an otherwise valid authored child result.',
  'Apply the public union exactly: an `aborted` or `error` result shall reject an `output` member; `childSessionId`, when present, shall be non-empty; `error` shall contain only non-empty `name`, string `message`, and optional string `stack`; and `state`, when present, shall validate every declared `PlaybookState` member and reject unknown or missing members.',
  'Treating an arbitrary JSON-safe object as a valid `state`, or checking only that these members have broad string/object types, is not complete public-result validation.',
  'In other words, the guard validates the complete public result it received, while the action retains only the current selected playbook id, status, and compact error.',
  'Do not implement evidence minimization by accepting only the three keys that survive that projection.',
  'Before entering a dynamic call, the machine shall reject an empty target and empty input text, any target equal to `selfPlaybookId`, and any target that Source requires to belong to an input catalog but that catalog does not contain.',
  'Rejection shall occur before invoking the `playbook` actor; the host remains responsible for its independent registry validation.',
  'Where Source forbids repeating an equivalent completed or failed call without new information, the machine shall also keep a private deterministic history of target-and-input signatures and reject a continuation whose target and complete input exactly match a prior call.',
  'Encode each signature as the collision-free `JSON.stringify([playbookId, text])` tuple of exact JavaScript strings, not delimiter concatenation, and append it before invocation so success, abort, and authored failure all count.',
  'That history shall not be included in a Captain or player prompt; a revised input containing new information is a different call.',
  "The exact machine check is a safety floor; the acting Captain remains responsible for Source's broader semantic equivalence policy.",
  'That validation belongs on the guarded transition into the call state.',
  "The call state's `invoke.input` mapper shall be a pure read of the already-validated typed context fields; it shall not call an assertion helper or throw while XState resolves actor input.",
  "This keeps state restoration, inspection, and scripted coverage from crashing outside the invocation's `onError` boundary.",
  'For the default Captain decide-call-observe loop, the delegation and continuing `onDone` arms shall transition directly into the invoking call state.',
  "Each arm's single guard validates its applicable actor-output and context constraints: both validate JSON shape, catalog membership, self-target, and duplicate history, while strict plan shrink applies only to `continuing`.",
  'Its actions store the selected target/input and append the signature before state entry.',
  'Do not interpose an eventless preparation or validation state between the Captain actor and the call state: it obscures the authored Captain entry edge from deterministic coverage and adds no XState safety beyond the guarded direct transition.',
  'Context fields used to drive guards or compose prompts shall be typed and named.',
  'Do not branch on untyped properties of `lastResult`; persistent routing decisions belong in typed context fields, and `lastResult` is for inspection only.',
  'Where Source declares a finite ordered plan, represent it as a typed readonly JSON-safe array and validate that shape on the actor-output transition; an unconstrained `JsonValue` does not establish that a plan is ordered or finite.',
  'Where a decide-call-observe loop carries the calls after the selected next call as `remainingPlan`, its continuing-call guard shall additionally require the new plan to be strictly shorter than the current plan.',
  'The Captain may revise or remove remaining entries as evidence arrives, but it cannot grow or retain the same-length plan indefinitely; the initial finite array therefore bounds the number of sequential child calls without an arbitrary runtime call limit.',
  'Prompts shall pass only the specific extracted fields the player needs.',
  'Do not dump `JSON.stringify(lastResult)` or any opaque blob: it leaks internal `guard` strings, wastes tokens, and confuses the LLM.',
  'Player bindings and prompt identities shall enter only through `PlaybookSession.roleBindings` at runtime call, prompt, and trace boundaries.',
  'The artifact shall not bake them into machine input, options, or context; model names and other host settings shall remain host policy rather than persisted FSM state.',
  'Host-owned configuration such as an enabled-playbook catalog shall remain immutable machine input/context for the session.',
  'Boss events and actor outputs shall not carry, replace, append to, or otherwise overwrite that catalog.',
  'Every machine with a dynamic call shall receive its own registered or authored playbook id as immutable machine input/context named `selfPlaybookId`, and its dynamic-call guard shall reject that target.',
  'The leaf-level `stateId` name is reserved for actor invocation identity and shall not be reused for a playbook id.',
  'JSON-safe context and output records shall omit absent optional members instead of creating own properties whose value is `undefined`.',
  'JSON validation shall accept only null, booleans, finite numbers, strings, arrays, and plain own enumerable data-property objects.',
  'It shall reject cycles, non-plain instances (`Error`, `Date`, `Map`, and class instances), accessors, symbol keys, sparse/undefined values, `NaN`, and infinities rather than silently changing them during serialization.',
  'An accepted array shall have prototype exactly `Array.prototype`, no holes, symbols, accessors, or extra own string properties, and enumerable own data descriptors for every canonical index; its standard non-enumerable `length` descriptor is the sole exception.',
  'That data descriptor shall be non-configurable and carry the exact array length, but its `writable` flag may be either `true` on an ordinary array or `false` after the shared runtime recursively freezes a validated boundary value.',
  '`Reflect.ownKeys(array)` shall contain exactly `length + 1` keys: the `length` property and every canonical index from `0` through `length - 1`.',
  'A digit string whose numeric value is not less than `length` is an extra property, not an array index.',
  'An accepted record shall have prototype exactly `Object.prototype` or `null`, and every key returned by `Reflect.ownKeys` shall be a string whose own descriptor is enumerable and a data descriptor.',
  'Cycle detection shall track only the active recursion path and remove a container on unwind, so a shared acyclic array or record is valid while an actual back-edge is rejected.',
  'A transition fires on an event — typically `onDone`, meaning the actor completed.',
  'When multiple are possible, a synchronous guard picks the path.',
  'Transitions shall persist relevant typed fields from `event.output` to context via `assign` so downstream prompts can read them.',
  'Transitions shall be self-driving when source items define the next obligation.',
  'Routing to an idle hub is for recovery, unrecoverable Boss input, or one-shot entry events — not the happy path.',
  "A review/approval state's success outcome shall target the next workflow step, not idle back to a hub; returning to Boss on success is a defect, because it forces manual stepping.",
  'A state following an approval shall not enter a fresh approval of the same content — that adds latency and risks ping-pong loops.',
  'A state may route through approval once when its input came from an unreviewed branch, for example a re-do without an intervening review.',
  'When the source has a feedback cycle, all phases that need feedback shall reuse it, not duplicate it per phase.',
  'Phases may set typed routing fields so terminal outcomes return to the originating branch.',
  'Boss input enters the machine through three surfaces: pre-emptive interrupts on active states, typed entry events on idle or recoverable states, and Boss replies to delegated-role questions that suspended the FSM in a dedicated wait state.',
  'Boss may interrupt any active state that can itself receive a Boss turn.',
  'Every jumpable state shall have a stable `id`.',
  'A final state is not jumpable.',
  'A `playbook.suspended` call state with an outstanding child is also not a Boss interrupt target: the host routes Boss input to the active child leaf and resumes the parent only from the matching child result.',
  "The runtime sends `{ type: 'BOSS_INTERRUPT', targetId: '<id>' }`; the root machine handles it with one guarded transition per jumpable state targeting `#<id>` with `reenter: true`, so invoked actors restart cleanly.",
  'Emit a `bossInterrupts(ids)` helper rather than hand-writing one transition per state.',
  'Each generated arm shall guard both the selected `targetId` and every typed context precondition required to enter that target safely.',
  'It shall not jump into a working or reassessment state with missing intent, prior result, plan, or other required context and shall not invent defaults merely to make an interrupt target executable.',
  'Control-action discovery probes these guards with optional textual fields omitted.',
  'Before applying a string operation such as `trim()`, a generated guard shall narrow the field to a string; a missing required textual field shall make the guard return false, never throw, so the control view remains total and omits an action whose payload the runtime cannot source.',
  "XState automatically stops the current state's invoked actor on transition.",
  "Where the default Captain's routing state accepts a fresh intent while another state or Boss-reply wait is active, its `BOSS_INTERRUPT` event shall carry a required non-empty `bossIntent`.",
  'The guarded routing arm shall copy that value, clear the prior plan, child evidence, exact-call history, selected call, response, error, and consumed question/reply context, then reenter routing.',
  'It shall not restart the old intent or retain a stale pending question.',
  'For this default Captain, `routing` is the sole `BOSS_INTERRUPT` target; a fresh directive always returns to routing and shall not jump directly into reassessment or the Boss-reply wait.',
  "The typed event union and classifier contract shall require exactly `targetId: 'routing'` plus the fresh `bossIntent`.",
  '`BOSS_INTERRUPT` jumps into an active machine, pre-empting whichever state is running.',
  'Boss entry events start or resume from idle or recoverable states when Boss-supplied parameters cannot be inferred from machine state alone.',
  'Entry events shall be typed alongside `BOSS_INTERRUPT` and populate context via a dedicated action.',
  "An entry event's copy action shall not clear per-run parameters the event omits: an absent optional field falls back to the existing, input-seeded context value.",
  'The two surfaces shall not be collapsed.',
  '`BOSS_INTERRUPT` always carries its target id and may additionally carry typed Boss-supplied fields such as an intent or IR number only where Source requires the pre-empted target to consume them; a parameterless entry event may collapse to interrupt-style routing only when state-jump and context-update semantics are identical.',
  'Entry events shall not be root-level transitions from every active state unless the workflow supports pre-emption; they belong on idle and recoverable states, for example `failed`.',
  'When a captain- or player-invoking state needs a Boss decision the acting agent cannot supply alone, the machine shall suspend that task in a quiescent wait state and resume the same task with the Q+A in the next prompt.',
  'This is a third Boss surface alongside `BOSS_INTERRUPT` and Boss entry events.',
  'Every captain- and player-invoking state supports this path, with one exception to apply, not infer: the states of a controller machine carry no Boss-reply suspension, because its hub already receives every Boss turn and a clarifying question to Boss is a `respond` selection over the closed action set.',
  'The rule below is therefore universal over workflow states and silent about that class; in particular, adding `needsBossReply` to the controller decision state would add an eighth outcome to a closed seven-action contract whose guard discriminants the setup requirements fix, and is nonconformant.',
  'There is no source-level opt-in annotation and no `needsBossReply` result metadata in GEARS output.',
  "Preserve the GEARS blockquote as the state's domain `prompt` body and do not inject any Boss-question instruction into `invoke.input.prompt`.",
  'This preservation includes every literal leading `>` carried inside the outer GEARS blockquote for quoted runtime context.',
  "For every captain- and player-invoking state outside a controller machine, add `needsBossReply` to the state's `invoke.input.result` map.",
  "Its description shall be the standard adjudicator-facing text: The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.",
  "The standard annotated backtick form names the exact `question` property; the linker's required-field extractor shall interpret only the identifier before the colon as the JSON field name.",
  "The linked runtime composes player prompts per the link phase's player prompt composition, without adding a player-visible Boss-question instruction.",
  "The question record shall be `{ questionId, resumeStateId, sourceItem, asker, question }`, where `asker` is exactly `{ kind: 'captain' }` or `{ kind: 'role', roleId }`.",
  '`questionId` and `resumeStateId` shall both equal the stable working-leaf `stateId`.',
  "`questionId`, `resumeStateId`, and `sourceItem` shall come from the suspended working leaf's stable invocation metadata.",
  'A delegated `PlayerInput` shall produce the role asker with its canonical local role id, while a direct-Captain state shall produce the Captain asker without inventing a role.',
  'Only `question` shall come from adjudicated actor output.',
  'A machine with at most one active Captain or player task may use the scalar form.',
  "The scalar form has an `awaitBossReply` state with stable `id: 'awaitBossReply'`, tag `playbook.parked`, and description `Waiting for Boss to answer the acting agent's question.`.",
  'The scalar form has a `BOSS_REPLY` event carrying `{ answer: string; questionId?: string }`.',
  'The scalar form has context fields `pendingBossQuestion?: PendingBossQuestion` and `bossReply?: string`.',
  'The scalar form has `resumableStates(ids)`, `setPendingBossQuestion`, and `clearBossReplyContext` helpers with the existing single-question behavior.',
  'A machine with parallel delegated-player tasks shall use the keyed form.',
  'The keyed form has one local waiting leaf per branch, tagged `playbook.parked`.',
  'The keyed form has a `BOSS_REPLY` event carrying `{ questionId: string; answer: string }`.',
  'The keyed form has context fields `pendingBossQuestions: Partial<Record<ResumableStateId, PendingBossQuestion>>` and `bossReplies: Partial<Record<ResumableStateId, string>>`.',
  'The keyed form has helpers that set, answer, and clear only the named branch record; exiting the complete parallel group for a fresh directive or interrupt clears every record owned by that group.',
  'Where exactly one question is pending, a linked runtime may accept a classifier reply that omits `questionId` and fill that sole id.',
  'Where several questions are pending, the classifier prompt and event shall require `questionId` and shall reject an omitted or unknown id without moving the FSM.',
  'The scalar `awaitBossReply` state and every local branch wait are quiescent for the runtime drive boundary.',
  'They shall allow a fresh root entry event or interrupt to abandon the relevant pending question data before starting new work.',
  'The wait state or branch-wait leaf itself shall not be an interrupt target: re-entering it after the interrupt clears its pending question would create an unresumable parked state.',
  'Its recorded working leaf remains the sole `BOSS_REPLY` resume destination.',
  "A captain- or player-invoking state's `invoke.input` function shall carry the pending question and reply selected for that working leaf as singular `pendingBossQuestion` and `bossReply` fields, regardless of the scalar or keyed context representation, so prompt composition has one stable contract.",
  "When both fields are present, the linked runtime shall compose the continuation preamble and labelled Q&A blocks per the link phase's player prompt composition.",
  'The FSM artifact shall not bake the continuation preamble into the GEARS-derived `prompt` body.',
  "Route to `failed`, per the error-and-termination requirements, the malformed state in which Captain or player output has `guard: 'needsBossReply'` but no `question` field.",
  'Route to `failed` the malformed state in which Captain or player output declares `needsBossReply` from a state without a registered scalar or branch-local resume route.',
  'Route to `failed` the malformed state in which `BOSS_REPLY` fired with empty or whitespace-only `answer`.',
  'Route to `failed` the malformed state in which a keyed `BOSS_REPLY` names no pending question.',
  'Every `invoke` shall declare an `onError` handler with a fallback routing to a dedicated `failed` state and capturing the error in `context.lastError` for inspection.',
  'A nested playbook invoke may place its validated authored-child recovery arm before that fallback as described in the nested-playbook-call requirements.',
  "`failed` is not `final`: it shall carry tag `playbook.parked`, retain enough typed context for Boss recovery, and accept the workflow's recovery entry or interrupt surface.",
  'The parked tag distinguishes a recoverable failure from a busy state so the host retains the session instead of treating the outcome as an unhandled runtime error.',
  "Every machine shall declare at least one `type: 'final'` state, typically `done`, reachable on completion.",
  'A never-terminating machine is a defect: the runner has no completion signal.',
  'At least one is a floor, not a ceiling.',
  "A final state's `description` is the machine's published terminal meaning: a host that cannot read the machine's output quotes that description to report what the run did.",
  'It shall therefore be true of every arm that enters the state and of no other terminal outcome.',
  "Where Source declares more than one terminal outcome — an approval that completes the workflow and a failure the workflow reports to its caller instead of parking — each outcome shall get its own `type: 'final'` state whose description names it.",
  'Routing an approval arm and a failure, abort, or invalid-result arm into one final state is a defect of the same kind as a wrong result field, because the quoting host cannot detect the difference.',
  'This constrains only published meaning: the declared machine `output` still derives its status and fields from typed context, so a caller that does read the output is unaffected.',
  "Where Source declares a JSON-safe terminal result, the setup types shall declare that output and the root machine shall derive it from typed context through XState's machine `output` function.",
  'A final-state transition alone does not satisfy a declared output contract.',
  'Fields that Source requires in every terminal output shall be required in the TypeScript output type.',
  'In particular, a declared `{ response }` result shall compile as `{ response: string }`, not `{ response?: string }`; reaching the final state without a non-empty response shall be guarded out before the machine output is constructed.',
].join('\n');

/* ------------------------------------------------------------------ *
 * Actor contracts
 * ------------------------------------------------------------------ */

/** Terminal outcomes G2F-1 declares. */
export type TransformationOutcome = 'compiled' | 'rejected';

/** Guard names valid for the G2F-1 Captain invocation. */
export type CaptainGuard = TransformationOutcome | 'needsBossReply';

/** Stable ids of working leaves a Boss reply may resume. */
export type ResumableStateId = 'transformSource';

/** Stable ids Boss may pre-empt with `BOSS_INTERRUPT`. */
export type BossInterruptTargetId = 'transformSource';

/** JSON-safe normalized error retained for Boss recovery. */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Asker of a pending Boss question. G2F-1 has no delegated role. */
export interface BossQuestionAsker {
  readonly kind: 'captain';
}

/** Question a working leaf surfaced for Boss, plus its resume route. */
export interface PendingBossQuestion {
  readonly questionId: string;
  readonly resumeStateId: ResumableStateId;
  readonly sourceItem: string;
  readonly asker: BossQuestionAsker;
  readonly question: string;
}

/** Typed input the runner's `captain` actor receives. */
export interface CaptainInput {
  readonly stateId: string;
  readonly sourceItem: string;
  readonly prompt: string;
  readonly result: Readonly<Record<CaptainGuard, string>>;
  readonly pendingBossQuestion?: PendingBossQuestion;
  readonly bossReply?: string;
}

/** Discriminated result the `captain` actor returns. */
export type CaptainOutput =
  | { readonly guard: 'compiled' }
  | { readonly guard: 'rejected' }
  | { readonly guard: 'needsBossReply'; readonly question: string };

/** Immutable machine input seeding the transformation request. */
export interface TransformationMachineInput {
  readonly sourcePath?: string;
  readonly targetPath?: string;
}

/** JSON-safe terminal output naming which declared outcome was reached. */
export interface TransformationMachineOutput {
  readonly status: TransformationOutcome;
}

/** Transformation request naming a `gears` source and an `fsm` target. */
interface TransformationRequest {
  readonly sourcePath?: string;
  readonly targetPath?: string;
}

interface TransformationContext {
  sourcePath?: string;
  targetPath?: string;
  outcome?: TransformationOutcome;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: SerializedError;
}

export type TransformationEvent =
  | { type: 'TRANSFORMATION_REQUEST'; sourcePath?: string; targetPath?: string }
  | {
      type: 'BOSS_INTERRUPT';
      targetId: BossInterruptTargetId;
      sourcePath?: string;
      targetPath?: string;
    }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

/**
 * G2F-1's local result contract: the authored guard names, order, and
 * descriptions verbatim, plus the universal `needsBossReply` result.
 */
const G2F_1_RESULT: Readonly<Record<CaptainGuard, string>> = {
  compiled:
    'Captain produced the Target XState v5 machine object artifact from the Source GEARS spec items as specified.',
  rejected:
    'Captain rejected or flagged the Source as malformed instead of compiling it — for example a missing, duplicate, blank, or malformed guard declaration, a spec item still carrying duplicate prompt lines, or a parallel group with a direct-Captain member, a nested-call member, or a repeated role.',
  needsBossReply:
    "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.",
};

/** One role-id array per parallel group; G2F-1 declares none. */
export const concurrentRoleSets: readonly (readonly string[])[] = [];

/* ------------------------------------------------------------------ *
 * Structural narrowing helpers
 *
 * XState may surface invoked-actor output as `unknown` in shared guards
 * and actions, so every helper accepts `unknown` and narrows structurally
 * before reading fields.
 * ------------------------------------------------------------------ */

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Narrow to a non-blank string; never applies `trim()` to a non-string. */
const readText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const describeUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }
  return 'Unknown error';
};

const normalizeError = (value: unknown): SerializedError => {
  if (value instanceof Error) {
    const stack = readText(value.stack);
    return {
      name: readText(value.name) ?? 'Error',
      message: value.message,
      ...(stack !== undefined ? { stack } : {}),
    };
  }
  if (isPlainRecord(value)) {
    const name = readText(value.name);
    const message = value.message;
    if (name !== undefined && typeof message === 'string') {
      const stack = readText(value.stack);
      return { name, message, ...(stack !== undefined ? { stack } : {}) };
    }
  }
  return { name: 'Error', message: describeUnknown(value) };
};

const readErrorFromEvent = (event: unknown): SerializedError =>
  isPlainRecord(event) ? normalizeError(event.error) : normalizeError(event);

const readCaptainOutput = (event: unknown): CaptainOutput | undefined => {
  if (!isPlainRecord(event)) return undefined;
  const output: unknown = event.output;
  if (!isPlainRecord(output)) return undefined;
  const guard: unknown = output.guard;
  if (guard === 'compiled') return { guard: 'compiled' };
  if (guard === 'rejected') return { guard: 'rejected' };
  if (guard === 'needsBossReply') {
    const question = readText(output.question);
    if (question !== undefined) return { guard: 'needsBossReply', question };
  }
  return undefined;
};

const readRequestFromEvent = (event: unknown): TransformationRequest => {
  if (!isPlainRecord(event)) return {};
  const sourcePath = readText(event.sourcePath);
  const targetPath = readText(event.targetPath);
  return {
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...(targetPath !== undefined ? { targetPath } : {}),
  };
};

/**
 * Resolve the request an event carries, falling back to the existing
 * (input-seeded) context value for each field the event omits.
 */
const resolveRequest = (
  context: TransformationContext,
  event: unknown,
): TransformationRequest => {
  const requested = readRequestFromEvent(event);
  const sourcePath = requested.sourcePath ?? readText(context.sourcePath);
  const targetPath = requested.targetPath ?? readText(context.targetPath);
  return {
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...(targetPath !== undefined ? { targetPath } : {}),
  };
};

const namesSourceAndTarget = (request: TransformationRequest): boolean =>
  request.sourcePath !== undefined && request.targetPath !== undefined;

const readTargetId = (event: unknown): string | undefined =>
  isPlainRecord(event) ? readText(event.targetId) : undefined;

const readBossReply = (
  event: unknown,
): { readonly answer: string; readonly questionId?: string } | undefined => {
  if (!isPlainRecord(event)) return undefined;
  const answer = readText(event.answer);
  if (answer === undefined) return undefined;
  const questionId = readText(event.questionId);
  return { answer, ...(questionId !== undefined ? { questionId } : {}) };
};

/* ------------------------------------------------------------------ *
 * Transition-array helpers
 *
 * Guard, action, and target literals are preserved rather than widened.
 * ------------------------------------------------------------------ */

const RESUMABLE_STATE_IDS = [
  'transformSource',
] as const satisfies readonly ResumableStateId[];

const BOSS_INTERRUPT_TARGET_IDS = [
  'transformSource',
] as const satisfies readonly BossInterruptTargetId[];

const resumableStates = (ids: readonly ResumableStateId[]) =>
  ids.map((id) => ({
    guard: { type: 'canResumeInto' as const, params: { stateId: id } },
    actions: 'storeBossReply' as const,
    target: `#${id}` as `#${ResumableStateId}`,
    reenter: true as const,
  }));

const bossInterrupts = (ids: readonly BossInterruptTargetId[]) =>
  ids.map((id) => ({
    guard: { type: 'isInterruptTarget' as const, params: { stateId: id } },
    actions: 'copyTransformationRequest' as const,
    target: `#${id}` as `#${BossInterruptTargetId}`,
    reenter: true as const,
  }));

/* ------------------------------------------------------------------ *
 * Machine
 * ------------------------------------------------------------------ */

export const gears2fsmMachine = setup({
  types: {
    context: {} as TransformationContext,
    events: {} as TransformationEvent,
    input: {} as TransformationMachineInput,
    output: {} as TransformationMachineOutput,
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    namesSourceAndTarget: ({ context, event }) =>
      namesSourceAndTarget(resolveRequest(context, event)),
    isInterruptTarget: (
      { context, event },
      params: { stateId: BossInterruptTargetId },
    ) => {
      if (readTargetId(event) !== params.stateId) return false;
      return namesSourceAndTarget(resolveRequest(context, event));
    },
    canResumeInto: (
      { context, event },
      params: { stateId: ResumableStateId },
    ) => {
      const pending = context.pendingBossQuestion;
      if (pending === undefined || pending.resumeStateId !== params.stateId) {
        return false;
      }
      const reply = readBossReply(event);
      if (reply === undefined) return false;
      return (
        reply.questionId === undefined ||
        reply.questionId === pending.questionId
      );
    },
    isCompiled: ({ event }) => readCaptainOutput(event)?.guard === 'compiled',
    isRejected: ({ event }) => readCaptainOutput(event)?.guard === 'rejected',
    needsBossReply: ({ event }) =>
      readCaptainOutput(event)?.guard === 'needsBossReply',
  },
  actions: {
    copyTransformationRequest: assign(
      ({ context, event }): Partial<TransformationContext> => {
        const request = resolveRequest(context, event);
        return {
          ...(request.sourcePath !== undefined
            ? { sourcePath: request.sourcePath }
            : {}),
          ...(request.targetPath !== undefined
            ? { targetPath: request.targetPath }
            : {}),
          outcome: undefined,
          lastError: undefined,
          pendingBossQuestion: undefined,
          bossReply: undefined,
        };
      },
    ),
    setPendingBossQuestion: assign(
      ({ event }): Partial<TransformationContext> => {
        const output = readCaptainOutput(event);
        if (output === undefined || output.guard !== 'needsBossReply')
          return {};
        return {
          pendingBossQuestion: {
            questionId: G2F_1_STATE_ID,
            resumeStateId: G2F_1_STATE_ID,
            sourceItem: G2F_1_SOURCE_ITEM,
            asker: { kind: 'captain' },
            question: output.question,
          },
          bossReply: undefined,
        };
      },
    ),
    storeBossReply: assign(({ event }): Partial<TransformationContext> => {
      const reply = readBossReply(event);
      if (reply === undefined) return {};
      return { bossReply: reply.answer };
    }),
    clearBossReplyContext: assign(
      (): Partial<TransformationContext> => ({
        pendingBossQuestion: undefined,
        bossReply: undefined,
      }),
    ),
    recordCompiled: assign(
      (): Partial<TransformationContext> => ({ outcome: 'compiled' }),
    ),
    recordRejected: assign(
      (): Partial<TransformationContext> => ({ outcome: 'rejected' }),
    ),
    rememberCaptainError: assign(
      ({ event }): Partial<TransformationContext> => ({
        lastError: readErrorFromEvent(event),
      }),
    ),
    rememberInvalidCaptainResult: assign(
      (): Partial<TransformationContext> => ({
        lastError: {
          name: 'MalformedCaptainResult',
          message:
            'Captain returned no result matching a guard declared by GEARS item G2F-1.',
        },
      }),
    ),
    rememberInvalidBossReply: assign(
      (): Partial<TransformationContext> => ({
        lastError: {
          name: 'MalformedBossReply',
          message:
            'BOSS_REPLY carried no usable answer for the pending question.',
        },
      }),
    ),
  },
}).createMachine({
  id: 'gears2fsm',
  context: ({ input }): TransformationContext => {
    const seed = input ?? {};
    const sourcePath = readText(seed.sourcePath);
    const targetPath = readText(seed.targetPath);
    return {
      ...(sourcePath !== undefined ? { sourcePath } : {}),
      ...(targetPath !== undefined ? { targetPath } : {}),
    };
  },
  initial: 'ready',
  on: {
    BOSS_INTERRUPT: bossInterrupts(BOSS_INTERRUPT_TARGET_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Idle hub awaiting a transformation request that names a gears source and an fsm target.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Idle hub awaiting a transformation request that names a gears source and an fsm target.',
        },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'namesSourceAndTarget',
          actions: 'copyTransformationRequest',
          target: 'transformSource',
        },
      },
    },
    transformSource: {
      id: 'transformSource',
      description:
        'Captain carries out the GEARS-to-FSM transformation as specified by item G2F-1.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'transformSource',
          description:
            'Captain carries out the GEARS-to-FSM transformation as specified by item G2F-1.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => {
          const pending =
            context.pendingBossQuestion !== undefined &&
            context.pendingBossQuestion.resumeStateId === G2F_1_STATE_ID
              ? context.pendingBossQuestion
              : undefined;
          const bossReply =
            pending !== undefined ? readText(context.bossReply) : undefined;
          return {
            stateId: G2F_1_STATE_ID,
            sourceItem: G2F_1_SOURCE_ITEM,
            prompt: G2F_1_PROMPT,
            result: G2F_1_RESULT,
            ...(pending !== undefined ? { pendingBossQuestion: pending } : {}),
            ...(bossReply !== undefined ? { bossReply } : {}),
          };
        },
        onDone: [
          {
            guard: 'needsBossReply',
            actions: 'setPendingBossQuestion',
            target: 'awaitBossReply',
          },
          {
            guard: 'isCompiled',
            actions: ['recordCompiled', 'clearBossReplyContext'],
            target: 'compiled',
          },
          {
            guard: 'isRejected',
            actions: ['recordRejected', 'clearBossReplyContext'],
            target: 'rejected',
          },
          {
            actions: ['rememberInvalidCaptainResult', 'clearBossReplyContext'],
            target: 'failed',
          },
        ],
        onError: {
          actions: ['rememberCaptainError', 'clearBossReplyContext'],
          target: 'failed',
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
          ...resumableStates(RESUMABLE_STATE_IDS),
          {
            actions: ['rememberInvalidBossReply', 'clearBossReplyContext'],
            target: 'failed',
          },
        ],
      },
    },
    failed: {
      id: 'failed',
      description:
        'The transformation stopped on an actor or control error and awaits Boss recovery.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'The transformation stopped on an actor or control error and awaits Boss recovery.',
        },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'namesSourceAndTarget',
          actions: 'copyTransformationRequest',
          target: 'transformSource',
        },
      },
    },
    compiled: {
      id: 'compiled',
      type: 'final',
      description:
        'Captain produced the target XState v5 machine object artifact from the source GEARS spec items as specified.',
      meta: {
        playbook: {
          stateId: 'compiled',
          description:
            'Captain produced the target XState v5 machine object artifact from the source GEARS spec items as specified.',
        },
      },
    },
    rejected: {
      id: 'rejected',
      type: 'final',
      description:
        'Captain rejected or flagged the source as malformed instead of compiling it.',
      meta: {
        playbook: {
          stateId: 'rejected',
          description:
            'Captain rejected or flagged the source as malformed instead of compiling it.',
        },
      },
    },
  },
  // Both reachable final states are entered only by an arm that first records
  // the adjudicated outcome, so the status always reflects typed context.
  output: ({ context }): TransformationMachineOutput => ({
    status: context.outcome === 'compiled' ? 'compiled' : 'rejected',
  }),
});

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# phase-execution: Phase Execution

## Intent

This package specifies the boundary between generic `slc` mechanics and phase-specific transformation, the generic checks and blocked protocol that guard a phase run, interpreted phase execution by a coding agent, and compiled phase execution through the phase-runner facade with pin-driven strategy selection under [DR-003](../decisions/003-slc-phase-execution.md), [DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), and [DR-007](../decisions/007-slc-phase-artifact-pinning.md).
The evolving runtime boundary is settled by [DR-010](../decisions/010-playbook-runtime-contract-evolution.md) and its immutable Playbook 1.0 adoption in [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
Playbook 10's roleless schema-3 host boundary is current: its contract follows [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), activated by [DR-027](../decisions/027-complete-playbook-10-activation.md).
Under [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), that schema-3 generation is selected by the installed engine's declared contract rather than by an exact release, and compiled execution relays the definition text at run time.
Direct Captain control-call isolation is extended by [DR-012](../decisions/012-playbook-routing-control-separation.md).
Generic pipeline mechanics are specified in the `pipeline` package.
Verification uses integration and system acceptance over the execution boundary, interpreted and compiled execution, and pin-driven selection, exercising the `slc` command with faked agent transports and fixture compiled artifacts.
Essential project-specific references are `slc`, this project's compiler CLI, and Cligent (`@sublang/cligent` [[1]]), the SDK through which `slc` reaches coding agents.

## External Behavior

### Execution boundary

#### phase-execution-1

The slc command shall perform only generic pipeline mechanics, and shall not contain phase-specific transformation rules, phase-specific prompt notes, or phase-specific semantic validators ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-2

Where executing an ordinary compile phase, the slc command shall treat the phase definition file as the semantic source of truth; where executing a link phase, the slc command shall treat the pipeline's `link.md` as the semantic source of truth ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-3

While executing, the executing phase shall write only its declared target or linked artifact, and shall not modify sources, phase or link definitions, specs, object artifacts, link targets, or unrelated files; scratch space that does not persist past the run is not such a write ([DR-003](../decisions/003-slc-phase-execution.md)).

### Generic checks

#### phase-execution-4

When a phase finishes, the slc command shall verify that the expected target artifact exists and that its extension matches the declared target extension ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-5

When a phase finishes, the slc command shall verify that the source, any object inputs, and the link target are unchanged from before the run and that the pipeline chain remains valid ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-6

When a write-scope violation is detected by any means, the slc command shall fail it like a failed generic check ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-39

When a phase is selected for execution, the slc command shall refuse before invoking its executor unless the declared target is outside exact `.slc` and `.slc-verify` path components, is absent or a single-link regular file, and does not alias the source, objects, link target, definitions, references, prior update input, declared local semantic-input paths from complete closure derivation [[pinning-17](pinning.md#pinning-17)] or incomplete protected-input discovery [[phase-execution-50](#phase-execution-50)], each inside its applicable boundary [[pinning-21](pinning.md#pinning-21)], pin index or local pin-validation input, or an installed verifier-support source the invocation will copy during deterministic completion; for the physical alias decision against each discovered protected input, it shall treat that input as non-aliasing where an existing non-directory or dangling symbolic link proves its prospective location impossible, shall continue to protect that blocking entry by physical identity, and shall refuse execution where any other observation or resolution failure prevents it from establishing non-aliasing; after an `ok` executor result, it shall require the target to be a single-link regular file at the physical location accepted before execution.

#### phase-execution-42

Where a full or full-link invocation will write a required deterministic entry, verifier-support, or conformance file after its phases, when the slc command plans the invocation, it shall refuse before invoking an executor unless each such output is absent or a single-link regular file and does not physically alias an invocation input, definition, declared local semantic-input paths from complete closure derivation [[pinning-17](pinning.md#pinning-17)] or incomplete protected-input discovery [[phase-execution-50](#phase-execution-50)], each inside its applicable boundary [[pinning-21](pinning.md#pinning-21)], pin index or local pin-validation input, phase target, or another deterministic output; SLC's own fixed verifier-support files may enter the managed `.slc-verify` directory but shall not alias their installed sources, an entry path that aliases the invocation's raw source shall be omitted with a diagnostic while the bundle compiles, and an unsafe optional introspection, prompt-contract, or coverage-test output shall be omitted through its existing diagnostic-only path.

#### phase-execution-50

Where pin validation permits execution of an unpinned phase but its complete local semantic-input closure [[pinning-17](pinning.md#pinning-17)] cannot be derived within its applicable boundary [[pinning-21](pinning.md#pinning-21)], when the slc command discovers protected inputs, it shall include every independently discoverable member that resolves inside that boundary in the protected-input set.

### Blocked protocol

#### phase-execution-7

When the source, object artifacts, link target, or options are malformed under the applicable definition, or the definition is incompatible with the inputs, the executing phase shall stop and report `BLOCKED` with concrete diagnostics instead of guessing through semantic incompatibility ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-8

While following its definition, the executing phase shall resolve only benign ambiguity that does not change domain semantics, and shall report any ambiguity it resolves ([DR-003](../decisions/003-slc-phase-execution.md)).

#### phase-execution-9

When the executing phase reports `BLOCKED` or a generic check fails, the slc command shall stop the pipeline and emit a failure report naming the phase, target path, and reasons ([DR-003](../decisions/003-slc-phase-execution.md)).

### Interpreted execution

#### phase-execution-10

The slc command shall be able to execute any phase by interpreting its definition directly, and interpreted execution shall be available for every phase without requiring compilation, an FSM, or linking ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).

#### phase-execution-11

When interpreting a phase, the slc command shall prompt a coding agent, reached through Cligent [[1]], with the phase or link definition and the phase inputs, and the agent shall perform the transformation and write the target ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).

#### phase-execution-12

Where no independent Reviewer is configured, when interpreting a phase, the slc command shall use exactly one agent invocation per phase; reviewed execution is governed instead by [[phase-execution-46](#phase-execution-46)] ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-022](../decisions/022-two-agent-reviewed-compilation.md)).

#### phase-execution-13

Where slc configuration selects an agent CLI and model, the slc command shall apply that selection as configuration and shall not let it change phase semantics ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).

#### phase-execution-14

When interpreting a phase, the slc command shall establish in the agent prompt a contract that ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)):

- the phase or link definition is authoritative;
- the agent writes only the requested target or linked artifact;
- the agent does not edit sources, phase or link definitions, specs, link targets, object artifacts, or unrelated files;
- the agent does not commit;
- the agent produces a complete artifact, not a sketch;
- the agent adds no domain semantics except those the source implies or the definition requires, and drops nothing the source states;
- the agent preserves verbatim content wherever the definition requires it;
- the agent verifies the produced artifact against the definition before finishing;
- the agent reports a concise summary and diagnostics, and follows the blocked protocol [[phase-execution-7](#phase-execution-7)].

#### phase-execution-15

When interpreting a phase, the slc command shall permit the agent to invoke the deterministic tools or commands the definition calls for and to read the content the definition cites or references, as part of following the definition, and shall treat that readable closure as the phase's semantic input closure ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).

#### phase-execution-46

Where an independent Reviewer is configured, when an agent call has no explicit `allowedTools` property and its Coder returns successful non-`BLOCKED` work, the slc command shall create a fresh Reviewer conversation for that performing call whose prompt permits only host-exposed read-only file/search capabilities, warns that shell/network may be unavailable, confines any exposed read-only shell to non-mutating inspection, forbids edits, writes, mutations, and commits, confines inspection to the request's workspace rather than prior or reference artifacts outside it, and guides the Reviewer to treat a twice-evidenced rejection as settled; it shall read the verdict from the end of the Reviewer reply — clean when the last non-blank line is exactly `NO_FINDINGS`, otherwise a findings block running from the last line that is exactly `FINDINGS:` to the end of the reply with consecutive top-level numbered findings and only indented continuation/evidence lines — ignoring narration before the verdict because a Reviewer may preface its verdict with rationale or an adapter may join progress commentary ahead of it, and treating a reply with neither form or a malformed findings block as malformed, relay findings to the Coder for evidenced disposition and minimal root-cause repair, and permit at most three Reviewer calls, succeeding on `NO_FINDINGS` but failing closed before another correction when the third well-formed verdict still reports findings and including those final well-formed Reviewer findings in the failure diagnostic alongside the latest usable Coder result; it shall take every successful correction's private envelope from the last complete top-level JSON object in the reply — bare or wholly enclosed by one lone unlabeled or `json` Markdown fence, with narration before that object ignored because an adapter may join an agent's progress commentary ahead of its final message, and with a reply carrying no complete object, another fence label, non-whitespace text after that object, or a second complete object separated from it by whitespace alone rejected — whose `dispositions` consecutively cover every current finding with its number, `accept` or `reject` decision, and nonblank reason and whose string `result` is the complete replacement in the original response format, validate and add those decoded fields to the explicit review transcript, replace only the Coder result text with decoded `result` before re-review or phase adjudication, and fail closed on a malformed envelope while retaining the preceding usable Coder result; it shall use a role's continuation token only when that role's immediately preceding result supplies one, include prior transcript in later Coder and Reviewer prompts as fallback, preserve the original cwd, models, and cancellation signal, fail closed with the Reviewer failure text on Reviewer failure, incompletion, or malformed verdict, return Coder error or incompletion without envelope parsing, treat `BLOCKED` only after decoding a successful correction's `result`, and bypass every call carrying explicit `allowedTools` unchanged ([DR-022](../decisions/022-two-agent-reviewed-compilation.md), [[phase-execution-31](#phase-execution-31)]).

### Compiled execution

#### phase-execution-23

Where a phase is executed by a compiled `playbook` artifact, the slc command shall drive it host-side through a stable phase-runner facade — construct the `PlaybookRuntime` the artifact's `createPlaybookRuntime` factory builds [[self-hosting-3](self-hosting.md#self-hosting-3)]; for `legacy`, initialize it directly with exactly `callPlayer`, `callJudge`, `emitStatus`, and `emitTelemetry`; for `session-v1`, initialize it with `{ sessionId, playbookId, ports }` carrying a globally unique id, the selected phase id, and exactly those four traced-session ports; for `composed-v2`, initialize it with a causal root `PlaybookSession` whose root id equals its globally unique session id, playbook id names the selected phase, depth is zero, parent identity is absent, and whose exact six ports additionally include `callCaptain` and `callPlaybook`; for `composed-v3`, construct the factory once through the roleless schema-3 phase-host boundary [[phase-execution-49](#phase-execution-49)] and initialize that same causal root with exactly the six composed ports; drive one non-interactive `handleBossInput` turn seeded from the phase input under an abort signal; then dispose it — without inferring or retrying another profile or calling optional adoption or control operations ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

#### phase-execution-24

When the slc command derives a compiled phase's terminal status, the slc command shall require `legacy` and `session-v1` turns to return `void` and map them by output delta plus failed-state telemetry; shall require `composed-v2` and `composed-v3` to return a valid profile-exact structured result made only of plain, accessor-free data with exact outcome-variant fields, literal state status, recursive state value, and finite JSON output, treating hostile accessors or proxies as invalid rather than letting validation throw; shall permit optional string `stateDescription` only on a `composed-v3` terminal result and require a `composed-v3` `unresolved-effect` result to contain exactly `outcome` and `state`; shall map `quiescent` or `terminal` with newly produced declared output to `ok`, `quiescent` or `terminal` without new output and `no-action` to `blocked`, and `failed`, `aborted`, invalid, absent, unexpectedly `suspended`, thrown, or valid `unresolved-effect` results to `error`; shall reject a structured result from either void profile instead of inferring another profile; shall proceed to generic checks on `ok`, treat `blocked` as the `BLOCKED` outcome, and stop like a failed generic check on `error`; and shall report a disposal failure unless a prior turn failure already determines the outcome ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-003](../decisions/003-slc-phase-execution.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

#### phase-execution-25

Where a compiled phase runs, the slc command shall back the `legacy`, `session-v1`, and `composed-v2` player ports and every profile's Captain and judge ports with coding agents reached through Cligent [[1]] per [DR-004](../decisions/004-slc-interpreted-phase-execution.md), apply per-player model selection as configuration without changing phase semantics, pass each explicit player `resume: false | string` selection and returned resume token unchanged, reject an omitted or invalid selection on `session-v1` and `composed-v2` before invoking the player while preserving legacy omission, make the roleless `composed-v3` player port reject deterministically without invoking an agent transport, accept only the required Captain visibility values and map a direct Captain call to its status, final text, or error without a player id or resume token, serialize Captain and judge calls together through one abort-aware FIFO, provide `callCaptain` and `callPlaybook` only in the composed profiles and settle each nested call with a deterministic unsupported-operation error because the phase host has no child stack, normalize any non-abort `null` or `undefined` rejection from a composed-profile host port to a deterministic `Error` before it reaches the immutable runtime while preserving every other rejection, stream human status and non-trace operational telemetry to the host's configured status sink as it occurs — without duplicating streamed lines into the run's diagnostics — otherwise collect it as drainable diagnostics, and exclude every `playbook.trace` payload from streamed lines and ordinary diagnostics alike ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md), [DR-019](../decisions/019-compile-progress-stall-watchdog.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

#### phase-execution-49

Where compiled execution selects the `composed-v3` runtime contract [[phase-execution-30](#phase-execution-30)], when the compiled phase executor constructs its runtime, the executor shall supply the exact roleless schema-3 phase-host construction and reject any use outside it ([DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)):

| Construction member | Required value and behavior |
| --- | --- |
| Factory | The linked module's callable default export carries an enumerable, non-writable, non-configurable own `compat` data property whose frozen exact own-data value is `{ artifactSchema: 3, runtimeAbi: 1 }`; a missing, accessor-backed, mutable, or different declaration fails before construction. |
| Factory argument | One plain accessor-free object with exactly `configuredOptions` and `hostCapabilities`; `configuredOptions` contains no host capability and is exactly `{ definition }`, offered first because every bundle compiled from a definition's compiled-execution section declares that option, or — only when the factory rejects that construction — the exact empty plain object in one further construction, so the factory's own options validation decides which of the two it binds and a current bundle is constructed once; a factory rejecting both fails the phase with both rejections named. |
| `definition` option | The exact bytes of the definition file the request names, read as UTF-8 text without normalization before the artifact loads — the one configured option a roleless meta-phase artifact may require, and never a member of the seeded Boss turn [[phase-execution-29](#phase-execution-29)]; an unreadable definition fails the phase as an error before the artifact loads. |
| `hostCapabilities` | One live plain accessor-free object constructed by the installed engine's published fail-closed host-capabilities facade, `@sublang/playbook/host-capabilities` — so the phase host owns no capability implementation — with exactly enumerable own data properties `repository` and `effectLedger`; neither member enters configured options, machine input, context, session snapshots, or diagnostics. |
| `repository` | An accessor-free plain live object with exactly enumerable own callable data properties `runExclusive` and `runDeferred`, each of which rejects with the facade's same deterministic no-governed-operation error without invoking a supplied operation. |
| `effectLedger` | An accessor-free plain live object with exactly enumerable own callable data properties `snapshot` and `writeAhead`; synchronous `snapshot()` returns the exact detached plain-data empty-ledger value `{ schemaVersion: 1, revision: 0, boundaries: [], logicalOperations: [] }`, and `writeAhead` rejects with the facade's deterministic no-effect-write error without mutation. |
| Unsupported construction or capability use | Because the phase host observes only the linked module, it neither loads nor infers a registry-side bespoke declaration: a missing or non-callable default export fails to load, and a callable default export without the required shared-factory compatibility fails compatibility validation; a compatible factory that requires authority, a configured option other than `definition`, or a delegated role, calls a repository operation or ledger write, exposes only the options-only session-Captain wrapper, or otherwise rejects both constructions fails the compiled phase as an error without agent transport, profile inference, a third construction, or initialization retry. |

#### phase-execution-31

Where a `composed-v2` or `composed-v3` compiled phase makes a direct Captain call, the slc command shall require own data properties `visibility: 'visible' | 'hidden'` and `resume: false`, reject a missing, accessor-backed, inherited, or different value before transport, and treat the tool restriction as source-owned per the linked artifact: an `allowedTools` property, when present, shall be an own explicitly empty array — rejected otherwise — and carried into the transported call, while an absent property carries no tool restriction so a transformation-performing Captain works through the host Captain's tools; when the same phase makes a hidden judge call, the slc command shall independently supply `resume: false` and that same empty allowlist so adjudication cannot resume the visible Captain conversation or gain tools; and because tool-restriction enforcement is a capability Cligent [[1]] publishes no metadata for, the slc command shall itself decide whether each requested empty allowlist reaches Cligent — sending it for an adapter with a provider-enforced tool-restriction surface, and omitting the tool-list option entirely for the `codex`, `kimi`, and `opencode` adapters, which refuse any tool-list value including the empty one, so that call keeps its fresh conversation and rests on the linked artifact's authored hidden-control prompt envelope, a documented reduction in enforcement rather than an equivalence [[2]] — while an unrecognized adapter still receives the empty allowlist and any non-empty restriction, never the host's way of expressing tool-free, crosses unsubstituted to fail closed ([DR-012](../decisions/012-playbook-routing-control-separation.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

#### phase-execution-27

When the slc command runs a phase, the slc command shall select its execution from the pin index: a phase with no pin — including when the pipeline has no pin file [[pinning-1](pinning.md#pinning-1)] or only unrelated stale records — interprets; the host-owned generic normalization step has no pipeline pin key and interprets even when the pipeline contains a same-named pass pin; a current pin [[pinning-2](pinning.md#pinning-2)] whose recorded definition locator identifies the same physical file as the selected phase definition runs the phase's compiled artifact, and fails the run closed when the definitions are physically distinct or it cannot run that artifact rather than interpreting it; a stale pin [[pinning-3](pinning.md#pinning-3)] for the selected phase stops the run with a diagnostic, never silently interpreting that phase; and any malformed pin record or unparseable pin file [[pinning-5](pinning.md#pinning-5)] stops the run before execution ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

#### phase-execution-30

Where the slc command configures compiled execution from a current pin, when it selects the runtime contract profile, the slc command shall select `legacy` only for absent link-target provenance or exact `@sublang/playbook@0.9.0` provenance, select the final six-port `composed-v2` profile only for exact `@sublang/playbook@0.10.0`, `@sublang/playbook@1.0.0`, `@sublang/playbook@2.0.0`, `@sublang/playbook@3.1.0`, or `@sublang/playbook@4.0.0` provenance, and for every other provenance select the roleless schema-3 `composed-v3` profile exactly when the pin's recorded link-target locator resolves inside an installed `@sublang/playbook` package whose `@sublang/playbook/xstate-runtime` engine declares `RUNTIME_ABI` `1` and `SUPPORTED_ARTIFACT_SCHEMAS` containing `3`, whatever that package's release version, the recorded provenance remaining evidence rather than the selector; it shall otherwise reject before loading the artifact or building an agent transport with a diagnostic naming the resolved package's declaration or its absence — a link target outside such a package, an engine that cannot be resolved or imported, another declared ABI, or a schema set without `3` — and shall neither infer the profile from callable runtime members nor retry a failed initialization under another profile ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md), [DR-018](../decisions/018-playbook-3-1-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)).

#### phase-execution-29

When the slc command seeds a compiled phase's non-interactive turn [[phase-execution-23](#phase-execution-23)], the slc command shall pass one Boss turn whose text states the request kind — compile or link — in prose and carries the full request as a single JSON line introduced by `Request: `, with the request's workspace paths resolved to absolute host paths and no other member — the definition the request names reaches an artifact only as its configured option [[phase-execution-49](#phase-execution-49)], never through the turn a classifier judge reads — so any compiled `playbook` artifact's classifier — or a deterministic consumer — recovers the exact phase input without host-specific parsing ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)).

#### phase-execution-33

Where a compile execution request carries read-only reference documents — e.g. the entry-phase definition a generic normalization step rewrites toward [[pipeline-34](pipeline.md#pipeline-34)] — the slc command shall present each reference beside the source in the interpreted agent contract and protect it like a definition, failing the run when a reference changed during execution ([DR-003](../decisions/003-slc-phase-execution.md), [DR-013](../decisions/013-normalize-and-pass-phases.md)).

#### phase-execution-34

Where a `composed-v2` or `composed-v3` compiled phase makes a transformation-performing direct Captain call — one whose source-owned options carry no `allowedTools` property [[phase-execution-31](#phase-execution-31)] — the slc command shall append the host workspace contract to the prompt it transports: the request's workspace inputs and artifact-to-write path resolved to absolute host paths [[phase-execution-29](#phase-execution-29)] and the interpreted contract's write-scope rules [[phase-execution-14](#phase-execution-14)], because the linked artifact composes only host-agnostic prompts while the host alone owns workspace specifics; the appended contract shall carry no guard names, result-property schema, or adjudicator instructions, and a routing-only Captain call (explicitly empty `allowedTools`) and every hidden judge call shall cross with their composed prompts unchanged ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-012](../decisions/012-playbook-routing-control-separation.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

### Agent-call watchdog

#### phase-execution-36

Where a positive stall timeout is configured, while any Coder, Reviewer, compiled player, Captain, or judge agent call is in flight, when the Cligent transport observes no agent event for the stall timeout, the slc command shall abort exactly that call through its abort plumbing and report it as a failed call with a diagnostic carrying the inactivity duration, unless the aborted call still yields a successful terminal outcome within the transport's post-abort drain, in which case that outcome stands so a completed call is never reported as a hang; a reported failure shall surface through the unchanged phase protocols as a failure report naming the phase and target, with no automatic transport retry or later review-loop call after the abort, and with fail-closed handling — never an interpreted fallback — for a pinned phase ([DR-019](../decisions/019-compile-progress-stall-watchdog.md), [[phase-execution-9](#phase-execution-9)], [[phase-execution-12](#phase-execution-12)], [[phase-execution-23](#phase-execution-23)], [[phase-execution-27](#phase-execution-27)], [[phase-execution-46](#phase-execution-46)]).

## Verification

### Interpreted-run acceptance

#### phase-execution-16

Where every phase is interpreted [[phase-execution-10](#phase-execution-10)] and no independent Reviewer is configured, when the slc command runs a full pipeline whose agent writes each declared target [[phase-execution-11](#phase-execution-11)], the slc command shall complete with exactly one agent invocation per phase [[phase-execution-12](#phase-execution-12)], the canonical artifacts present, and any ambiguity the agent reported surfaced in its diagnostics [[phase-execution-8](#phase-execution-8)].

#### phase-execution-17

While interpreting a phase, when the agent finishes without writing the declared target or writes a file whose extension differs from the declared one [[phase-execution-4](#phase-execution-4)], the slc command shall stop the pipeline and emit a failure report naming the phase and target [[phase-execution-9](#phase-execution-9)].

#### phase-execution-18

While interpreting a phase, when the agent modifies the source, an object input, the link target, or a phase or link definition [[phase-execution-3](#phase-execution-3)], the slc command shall fail the run with a report naming the changed path [[phase-execution-5](#phase-execution-5)], [[phase-execution-6](#phase-execution-6)].

#### phase-execution-19

While interpreting a phase, when the agent reports `BLOCKED` for malformed inputs or an incompatible definition [[phase-execution-7](#phase-execution-7)], the slc command shall stop the pipeline and emit a failure report carrying the blocked diagnostics [[phase-execution-9](#phase-execution-9)].

#### phase-execution-20

When the slc command interprets a phase, the agent prompt shall embed the phase or link definition verbatim as authoritative [[phase-execution-2](#phase-execution-2)], establish every clause of the agent contract [[phase-execution-14](#phase-execution-14)] together with permission to run definition-called tools and read cited content [[phase-execution-15](#phase-execution-15)], and add no phase-specific rules of slc's own [[phase-execution-1](#phase-execution-1)].

#### phase-execution-21

Where slc configuration selects an agent and model, when the slc command interprets a phase, the slc command shall pass that selection to the agent transport without it changing the phase definition or the produced artifact [[phase-execution-13](#phase-execution-13)].

#### phase-execution-22

While interpreting a phase, when the agent adds, removes, or renames a phase file so the pipeline chain no longer infers, the slc command shall fail the run with a diagnostic rather than report success [[phase-execution-5](#phase-execution-5)].

#### phase-execution-40

Where a phase target aliases a source, pin index, inline- or sidecar-declared local semantic input — including one independently discovered after another locator makes closure derivation incomplete, or an inline member independently discovered despite a structurally invalid sidecar [[phase-execution-50](#phase-execution-50)] — pinned local artifact or dependency, installed verifier-support source, or other protected input, has multiple hard links, or enters an exact `.slc` or `.slc-verify` component, when the slc command runs the phase, it shall refuse before invoking the executor and leave the protected bytes unchanged [[phase-execution-39](#phase-execution-39)].

#### phase-execution-41

While a phase target is absent or a single-link regular file, when its executor reports `ok`, the slc command shall accept an unchanged existing target or a byte-identical rewrite, but shall fail the phase when the target remains absent [[phase-execution-4](#phase-execution-4)], becomes non-regular, gains another hard link, or changes physical location [[phase-execution-39](#phase-execution-39)].

#### phase-execution-43

Where a required planned playbook entry, verifier-support file, or conformance test physically aliases the source, link target, an inline- or sidecar-declared semantic input, pin index or pinned local input, a phase target, another deterministic output, or an installed verifier-support source, when the user runs the full or full-link invocation, the slc command shall refuse before invoking an executor and shall leave the protected bytes unchanged [[phase-execution-42](#phase-execution-42)].

#### phase-execution-44

Where a raw playbook source physically aliases the deterministic `<basename>.ts` entry path, when the user runs the full-link invocation, the slc command shall compile the bundle, leave the raw source unchanged, omit the entry module, and report that omission as a diagnostic [[phase-execution-42](#phase-execution-42)].

#### phase-execution-45

Where a present pin records an unrelated phase whose local input path is impossible beneath an existing regular file or dangling symbolic link, and the selected unpinned fixture phase targets either an unrelated path or that existing regular-file blocker, when the slc command runs the selected phase, it shall invoke the interpreted executor for the unrelated target [[phase-execution-27](#phase-execution-27)]; for the blocker target, it shall refuse before invoking the executor and leave the blocker's bytes unchanged [[phase-execution-39](#phase-execution-39)].

#### phase-execution-47

Where reviewed execution uses faked Coder and Reviewer transports, when interpreted, configured compiled-player, or transformation-Captain work runs, each Reviewer prompt shall name only host-exposed read-only file/search capabilities, warn that shell/network may be unavailable, forbid mutation and commits, confine inspection to the request's workspace, and guide the Reviewer to settle a twice-evidenced rejection; `NO_FINDINGS` with surrounding whitespace or behind preceding narration shall return the final Coder text, consecutive top-level numbered findings with optional indented evidence — bare or behind preceding narration — shall cause at most two Coder corrections and three Reviewer calls using immediately preceding role tokens when available plus the complete explicit transcript, and findings on the third Reviewer call shall fail closed with a diagnostic containing the final well-formed Reviewer findings and latest usable Coder result; a valid private correction envelope — bare, lone-unlabeled-fence, or lone-`json`-fence, each also behind joined narration, including one whose `result` carries braces and escapes inside JSON strings — shall expose accepted and rejected dispositions only to the Reviewer and preserve the decoded original-format result exactly for phase adjudication, while prose after the object, two adjacent trailing objects, another fence label, multiple fences, an unindented Reviewer epilogue, or a missing, duplicate, wrongly numbered, malformed, or objectless successful correction shall fail closed with the preceding usable Coder result; explicit `allowedTools` control calls shall bypass review, initial Coder failure or `BLOCKED` and correction error or incompletion shall stop without review, an encoded correction `result` carrying `BLOCKED` shall preserve the blocked protocol, Reviewer failure, incompletion, malformed verdict, or thrown error shall fail closed with its diagnostic, cancellation and cwd/model selection shall cross every call unchanged, and separate performing calls shall use separate Reviewer conversations; whereas an incremental Reuse invocation supplied a reviewed executor shall invoke neither Coder nor Reviewer [[phase-execution-46](#phase-execution-46)].

#### phase-execution-48

Where a normalization fixture supplies the entry-phase definition as a read-only reference, when the slc command interprets the generic normalization step, the slc command shall present that reference beside the source in the agent prompt and protect it like a definition, so a fixture mutation of the reference fails the run with a diagnostic naming the changed path [[phase-execution-33](#phase-execution-33)].

### Compiled-run acceptance

#### phase-execution-26

Where phases are backed by `legacy`, `session-v1`, `composed-v2`, and roleless `composed-v3` fixture `playbook` artifacts driven only through the runtime boundary [[phase-execution-23](#phase-execution-23)], when the executor runs them, each runnable fixture shall receive one Boss turn whose prose names its request kind and whose single `Request: ` JSON line reproduces the full absolute-path request and no other member [[phase-execution-29](#phase-execution-29)]; `legacy` shall receive only four direct ports, `session-v1` shall receive its unique minimal session with exactly four ports, `composed-v2` shall receive its unique causal root session with exactly six ports, and a strict `composed-v3` fixture declaring no option shall observe the exact immutable schema-3/runtime-ABI-1 factory compatibility, shall reject the offered `{ definition }` and then observe the exact empty configured-options object in one further construction, and shall observe the exact plain two-member host-capability object, a plain repository exposing only rejecting `runExclusive` and `runDeferred`, and an effect ledger whose snapshot synchronously returns the exact detached empty-ledger value and whose writer rejects, without any capability entering machine input, snapshots, or diagnostics [[phase-execution-49](#phase-execution-49)]; a `composed-v3` fixture whose options validator declares `definition` shall receive, in its single construction, exactly `{ definition }` holding the compile or link definition's exact bytes — CRLF and non-ASCII text included — which it echoes into its target or linked artifact, an unreadable definition shall map to `error` before the artifact loads, and a profile taking no configured options shall run without reading the definition [[phase-execution-49](#phase-execution-49)]; a linked module lacking the required compatible shared-factory default export, a non-plain or extra capability record, an options-only session-Captain fixture, a fixture requiring authority, another option, or roles, and a fixture calling a repository operation, effect write, or player port shall fail before construction or transport as applicable — a rejecting factory observing exactly the `definition` and then the empty construction — and without initialization retry [[phase-execution-25](#phase-execution-25)], [[phase-execution-49](#phase-execution-49)]; the same runnable fixtures shall succeed inside and outside a Git worktree; `exportSnapshot`, `restore`, and `retainedGenerationMetadata` shall remain unobserved and optional `adopt`, `describe`, `apply`, and `unresolvedEffectEnvelopes` operations shall remain uncalled during the one turn and disposal [[phase-execution-23](#phase-execution-23)]; the two void profiles shall retain output-delta and failed-telemetry mapping and reject structured results, both composed profiles shall require their exact structured result, output-producing `quiescent` or `terminal` shall map to `ok`, outputless `quiescent` or `terminal` and `no-action` shall map to `blocked`, only a `composed-v3` terminal result may carry string `stateDescription`, and absent, cross-profile, accessor- or proxy-backed, non-JSON, malformed-state, `failed`, `aborted`, unexpectedly `suspended`, thrown, exact `{ outcome: 'unresolved-effect', state }`, or otherwise-successful but disposal-failing runs shall map to `error` [[phase-execution-24](#phase-execution-24)]; explicit false or token player resume selection and returned tokens shall cross the older-profile Cligent adapter unchanged, `session-v1` and `composed-v2` shall reject omitted or invalid selections before invoking the player, and `legacy` shall preserve omission; a direct Captain call shall cross without player identity or resume state and shall preserve its required visibility, status, final text, and error; concurrent Captain and judge calls shall be single-flight in one queue; nested calls shall fail deterministically; a non-abort nullish composed-profile host-port rejection shall surface as a thrown control-plane error rather than an authored `failed` result; and exact `playbook.trace` prompts, replies, errors, and resume tokens shall not occur in the returned diagnostics [[phase-execution-25](#phase-execution-25)].

#### phase-execution-28

When the slc command runs a fixture phase, a phase with no pin file or absent from a present pin file — including one with an unrelated stale record — shall interpret; a host-owned normalization step shall interpret while a same-named current pipeline pass pin selects compiled execution only for that pass; a current pin whose external definition is a physically distinct byte-identical file from the pipeline-selected definition shall fail closed without selecting either executor whether execution or incremental Reuse would otherwise be selected, while a current pin whose in-boundary definition locator is a symbolic link to the selected definition shall remain eligible for compiled selection; a current pin with absent or exact `@sublang/playbook@0.9.0` link-target provenance shall select the `legacy` compiled executor without interpreting, a current pin with exact `@sublang/playbook@0.10.0`, `@sublang/playbook@1.0.0`, `@sublang/playbook@2.0.0`, `@sublang/playbook@3.1.0`, or `@sublang/playbook@4.0.0` provenance shall select the six-port `composed-v2` executor without consulting its link target, a current pin with any other provenance — exact `@sublang/playbook@10.0.0`, a later `@sublang/playbook@12.0.0`, and an unreviewed `@sublang/playbook@9.0.0` alike — whose link target lies inside a fixture-installed `@sublang/playbook` package declaring `RUNTIME_ABI` `1` and `SUPPORTED_ARTIFACT_SCHEMAS` containing `3` shall select the roleless schema-3 `composed-v3` executor, and a current pin whose other provenance names a link target outside such a package — including `@sublang/playbook@1.3.0`, `@sublang/playbook@3.0.0`, and `@sublang/playbook@5.0.0` through `@sublang/playbook@9.0.0` beside a plain link target — or inside one whose engine cannot be resolved, declares another ABI, declares no schema `3`, or declares nothing, or a compiled artifact the selected host cannot run, shall fail closed naming the declaration or its absence without profile inference or initialization retry [[phase-execution-30](#phase-execution-30)], and a stale pin for the selected phase, any malformed pin record including for an unselected phase, or an unparseable pin file shall fail the run with a diagnostic and not interpret [[phase-execution-27](#phase-execution-27)].

#### phase-execution-32

Where a `composed-v2` or `composed-v3` fixture calls Captain with visible or hidden control work and then calls its hidden judge, when the SLC phase adapter runs it, each transported call shall carry `resume: false` and an explicitly empty allowed-tool list without sharing an agent conversation, and when the same fixture control calls run a configured agent's Cligent adapter, that adapter shall observe the empty allowed-tool list under a `claude-code` selection and no tool-list option at all under a `codex` selection while every other call setting stays identical, and a non-empty allowlist requested of that same `codex` transport shall reach its adapter unsubstituted; whereas any missing, inherited, accessor-backed, non-false resume, or nonempty allowed-tool option on the direct Captain call shall reject before the agent transport runs [[phase-execution-31](#phase-execution-31)].

#### phase-execution-37

Where a compiled fixture runtime emits status and operational telemetry mid-turn and the executor is configured with a status sink, when the executor runs the phase, each non-trace status line shall reach the sink before the run settles and shall not repeat in the returned diagnostics, exact `playbook.trace` payloads shall reach neither the sink nor the diagnostics, and the same fixture without a sink shall retain the drainable-diagnostics behavior [[phase-execution-25](#phase-execution-25)].

#### phase-execution-38

Where a faked Coder or Reviewer transport yields an initial event and then stalls under a short configured stall timeout, when the call runs through the phase transport or review wrapper, the slc command shall abort the stalled call once the timeout elapses, preserve a failure diagnostic carrying the inactivity duration, and make no automatic retry of that call [[phase-execution-36](#phase-execution-36)], [[phase-execution-12](#phase-execution-12)]; whereas where the aborted transport still yields a successful terminal event within the post-abort drain, the slc command shall report that success rather than a stall [[phase-execution-36](#phase-execution-36)].

#### phase-execution-35

Where a pinned `composed-v2` meta-phase artifact is driven through the compiled executor over a fake agent transport that captures transported prompts, when the seeded compile or link turn reaches the artifact's transformation-performing direct Captain call, the transported prompt shall carry the artifact's composed GEARS-derived body plus the host workspace contract naming the request's absolute workspace inputs and the absolute artifact-to-write path, and a captain that writes exactly that artifact shall map the run to `ok`; whereas a routing-only Captain call carrying an explicitly empty `allowedTools` and every hidden judge call shall receive its composed prompt unchanged [[phase-execution-34](#phase-execution-34)].

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"
[2]: https://github.com/sublang-ai/playbook/blob/main/specs/decisions/013-routing-only-captain-control.md#addendum-a1-prompt-level-isolation-for-adapters-without-tool-enforcement "Playbook DR-013 Addendum A1: prompt-level isolation for adapters without tool enforcement"

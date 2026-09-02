<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# verification: Compilation-Correctness Verification

## Intent

This package specifies how `slc` verifies that a compiled `playbook` artifact faithfully represents its source, per [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md) and the Playbook 1.0 actor and dynamic-call adoption of [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
A compiled routing workflow also separates source-owned result metadata from acting prose per [DR-012](../decisions/012-playbook-routing-control-separation.md).
Schema-3 checks use the Roles and runtime contracts of [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), current since the activation completed under [DR-027](../decisions/027-complete-playbook-10-activation.md); under [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), a later release is schema-3 evidence through its installed engine's declaration, and a bundle is retained across adoptions by the compiled-execution fidelity check.
A compiled artifact is judgment-produced, so `slc` re-checks it deterministically against the `gears` and `fsm` it was built from and emits that check as a test beside the artifacts under `<basename>.playbook/`, so each build re-verifies faithfulness.
The package covers GEARS↔FSM conformance, FSM introspection, prompt contracts, transition coverage, runtime equivalence, script actors, and emitted-module load integrity.
Verification exercises those deterministic checks against the manual reference artifacts `@sublang/playbook` ships, detects injected drift, and runs generated tests beside reserved-pipeline artifacts.
Essential project-specific references: `slc`, this project's compiler CLI; and `@sublang/playbook`, whose installed package provides the manual reference artifacts, compiler definitions, and linked runtime contract.

## External Behavior

### GEARS↔FSM conformance

#### verification-1

When checking a compiled `playbook` artifact's GEARS↔FSM conformance, the slc command shall recursively traverse nested and parallel state nodes, require every `gears` item to map to exactly one executable working leaf of its declared actor kind and every such leaf to reference an existing item, and apply all applicable conformance requirements ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Case | Required conformance |
| --- | --- |
| Every node in a structured machine | Carry a non-empty explicit state id and matching `meta.playbook.stateId`. |
| Direct-Captain leaf | Invoke `captain` and carry that same id plus the item's prompt body verbatim without `player` or `role` binding. |
| Schema-3 delegated-role leaf | Invoke `player`, carry `meta.playbook.role` and `invoke.input.role` equal to the source role's canonical lowercase local id, omit `invoke.input.player`, and preserve the role locally without encoding a concrete player or alias. |
| Schema-3 `Roles` declaration | Derive each local role id by lowercasing its source name, require it to match `[a-z][a-z0-9_-]*`, reject the reserved id `captain`, and reject removed aliases, repeated declarations, or distinct names that collide after derivation. |
| Immutable schema-1 delegated-player leaf | Invoke `player` and carry its source-declared player through the historical `invoke.input.player` contract without being relabelled as schema 3. |
| Literal nested-playbook leaf | Invoke `playbook` and carry the same id, literal target, and child-input body verbatim. |
| Dynamic nested-playbook leaf | Invoke `playbook`, carry the same id, preserve the GEARS target-field name and sole child-text placeholder as literal `playbookIdContext` and `textContext` metadata, and evaluate `playbookId` and `text` to independent sentinel values supplied through those exact named context fields without source-text inspection. |
| Schema-3 parallel group | Represent each simultaneously active region by its canonical role id, require those region ids to be pairwise distinct, and appear exactly once in the FSM's `concurrentRoleSets` export in source group and region order. |
| Schema-3 artifact with no parallel group | Export `concurrentRoleSets` as the exact empty array. |
| Schema-1 artifact whose FSM module independently exports `concurrentRoleSets` | Preserve schema-1 classification because the export is not artifact-schema evidence [[verification-21](#verification-21)]. |

#### verification-3

When checking a compiled `playbook` artifact's GEARS↔FSM conformance [[verification-1](#verification-1)], the slc command shall report a finding unless every direct-Captain or delegated-player FSM state outside a schema-3 controller machine [[verification-20](#verification-20)] declares the Boss-reply suspension key `needsBossReply` with a description containing the adjudicator contract substring ``Output shall include `question:``, with only the precisely diagnosed near-miss state exempt from that ordinary state requirement [[verification-22](#verification-22)], and every Captain- or player-invoking state inside a controller machine omits that compiler-owned key ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

#### verification-20

When a compilation-correctness check determines whether a machine uses the schema-3 controller contract, the check shall use one shared structural discriminator: after excluding compiler-owned `needsBossReply`, a Captain decision state's domain result keys are exactly `respond`, `resume`, `start`, `switch`, `dismiss`, `deliver`, and `runtime`, and a machine is a controller exactly when it contains such a state; GEARS prose, prompt blockquotes, and a proper subset or superset of those keys shall not independently select the controller contract ([DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

#### verification-21

When a compilation-correctness check selects the artifact schema used by generation-specific conformance, continuation, or runtime-profile probes, the check shall apply one fail-closed decision ([DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)):

| Evidence case | Required schema decision |
| --- | --- |
| A running full-link compile knows the concrete link target's owning package, or standalone review has the artifact's own matching pin whose currency validator reports current [[pinning-2](pinning.md#pinning-2)]. | In this verification-only schema decision, map exact `@sublang/playbook@0.10.0`, `@sublang/playbook@1.0.0`, `@sublang/playbook@2.0.0`, `@sublang/playbook@3.1.0`, and `@sublang/playbook@4.0.0` provenance to schema 1 and exact `@sublang/playbook@10.0.0` provenance to schema 3 as recorded; map any other provenance to schema 3 only through the declaration of the installed `@sublang/playbook` engine owning the full-link target or the current pin's recorded link-target locator — `RUNTIME_ABI` `1` with `SUPPORTED_ARTIFACT_SCHEMAS` containing `3`, whatever the release —, reporting an unsupported provenance when no declaration could be read and an unsupported contract naming the declaration otherwise; and never substitute the pin of a compiler phase that produced an intermediate artifact. |
| Standalone review finds an artifact pin record whose currency verdict is stale or malformed [[pinning-3](pinning.md#pinning-3)], [[pinning-5](pinning.md#pinning-5)]. | Exclude that record's provenance from the schema decision and decide from the artifact's other valid signals without replacing the pin validator's verdict. |
| The FSM contains historical `invoke.input.player` bindings and no schema-3 role binding or controller. | Supply a schema-1 actor-generation signal. |
| The FSM contains a schema-3 `invoke.input.role` binding or controller [[verification-20](#verification-20)] and no historical player binding. | Supply a schema-3 actor-generation signal. |
| The FSM contains both historical player and schema-3 role or controller structure. | Report conflicting actor-generation signals. |
| A linked callable factory has an own `compat` property. | Supply a schema-3 signal only for an enumerable, non-writable, non-configurable data property whose value is a frozen exact own-data `{ artifactSchema: 3, runtimeAbi: 1 }` record; otherwise report malformed compatibility. |
| One or more provenance, actor-generation, or exact factory-compatibility signals exist and every present signal is valid. | Select a schema only when all supplied signals agree, and report disagreement otherwise. |
| No provenance, actor-generation, or compatibility signal exists and the linked callable factory has no own `compat`. | Select the immutable historical schema-1 continuation shape. |
| A direct-Captain continuation has neither reviewed provenance, a generation-specific actor binding or controller, nor a linked callable factory. | Leave it unclassified and report the missing schema rather than guessing. |
| No schema signal exists and no direct-Captain continuation requires a generation-specific probe. | Leave the artifact unclassified without reporting a schema finding. |

#### verification-22

When a Captain result omits the ordinary Boss-reply key and differs from the closed controller set by exactly one missing or extra domain key, compilation-correctness checks shall apply the precise controller-contract near-miss outcome ([DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Scope | Required outcome |
| --- | --- |
| Near-miss state | Report the missing or extra domain key without selecting the valid controller contract or reporting that state's ordinary Boss-reply requirement [[verification-3](#verification-3)]. |
| Every other acting state in the machine | Apply its ordinary or valid-controller Boss-reply requirement independently [[verification-3](#verification-3)]. |
| Candidate machine surfaces | Do not report missing ordinary Boss-reply-wait or root `BOSS_INTERRUPT` surfaces solely because the near-miss result omits them [[verification-6](#verification-6)]. |

#### verification-13

Where a direct-Captain or delegated-player GEARS item declares a canonical `Results:` block, when checking a compiled `playbook` artifact's GEARS↔FSM conformance, the slc command shall parse its ordered single-line ``- `<guardName>`: <nonblank description>`` entries separately from the blockquoted acting prompt and report a finding unless the FSM state's ordered `result` entries equal them exactly after removing only compiler-owned `needsBossReply`; it shall also report a misplaced or malformed label, malformed or duplicate entries, an empty declared block, source-owned `needsBossReply`, or result metadata on a nested-playbook call item, while allowing immutable pre-decision GEARS artifacts to omit the block, and `<guardName>` shall match `[A-Za-z_$][A-Za-z0-9_$]*` ([DR-012](../decisions/012-playbook-routing-control-separation.md)).

### Test generation

#### verification-2

When the slc command handles a compiled `playbook` artifact relative to the canonical artifact placement [[pipeline-7](pipeline.md#pipeline-7)] and output override [[pipeline-8](pipeline.md#pipeline-8)], it shall apply the corresponding verification-test outcome ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)):

| Case | Verification-test outcome |
| --- | --- |
| The artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations. | Emit a test beside them, in `<basename>.playbook/`, that runs the GEARS↔FSM conformance check [[verification-1](#verification-1)] over the artifact's `gears` file and the machine its `fsm` module exports, so each build re-checks faithfulness. Every emitted TypeScript verification test imports sibling TypeScript FSM and linked-runtime artifacts through NodeNext `.js` module specifiers; where a generated test also reads an artifact as source text, it keeps a separate physical `.ts` filename for that file operation rather than reading the `.js` specifier. |
| `-o` relocates the `fsm` out of the canonical directory. | Emit no verification test. |

#### verification-4

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-8](pipeline.md#pipeline-8)], the slc command shall apply the applicable introspection-test outcome ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)):

| FSM module | Introspection-test outcome |
| --- | --- |
| The produced `fsm` can be imported for derivation. | Derive the machine's structural topology from the produced `fsm` — recursively including executable actor bindings and result keys, config paths, explicit and public metadata ids, compound or parallel type, tags, parent joins, every `onDone`/`onError`/local-event transition arm, quiescent and root event surfaces, and the `BOSS_INTERRUPT` jumpable set — and emit a test beside the artifacts that fails when the machine no longer matches that pinned topology while omitting the structured extension for an unchanged flat machine. |
| The produced `fsm` cannot be imported for derivation. | Report a diagnostic and emit no introspection test while leaving the run outcome unchanged. |

#### verification-5

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-8](pipeline.md#pipeline-8)], the slc command shall apply every applicable prompt-contract verification outcome ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Case | Prompt-contract verification outcome |
| --- | --- |
| The canonical `gears` and `fsm` artifacts are available. | Derive each direct-Captain and delegated-player state's prompt contract from the artifacts — its traced context reads, its sentinel-traced input wiring, and its prompt's placeholder tokens — and emit a test beside the artifacts that fails when the contract no longer matches. |
| A linked `<basename>.playbook.ts` beside the artifacts exposes its Captain and player prompt composers. | Additionally fail the emitted test when the matching composer stops substituting a placeholder it substituted at build time, stops preserving the complete prompt body — including authored quoted-context lines — verbatim as one contiguous ordered block, leaks the Boss-reply adjudicator contract into an acting-agent prompt, introduces a player or role binding or resume instruction into a direct-Captain prompt, resolves a schema-3 player-facing identity from a concrete player or alias instead of the matching canonical local role's invocation-scoped prompt-identity lookup, exposes such a concrete binding in composed text, composes continuation blocks on an ordinary turn, or composes a continuation turn without the exact preamble and labelled Q&A blocks before the body, while recognizing either a raw string sentinel or that same sentinel encoded as deterministic JSON for a typed structured value. Select the continuation generation through [[verification-21](#verification-21)]; probe schema-1 composers without occupying their historical placeholder-fields argument and carry the historical continuation `player`; probe schema-3 role identity with a callable lookup that exposes no placeholder-field properties and carry the schema-3 continuation `asker`; and pass the same question and reply through both scalar `pendingBossQuestion` / `bossReply` context and state-keyed `pendingBossQuestions[stateId]` / `bossReplies[stateId]` context so flat and parallel branch input mappers are verified. |
| A linked module exposes no matching composer. | Degrade to the artifact-only test with a diagnostic. |
| Emission-time derivation imports a NodeNext TypeScript linked module before its sibling FSM has been built. | Resolve the linked module's required runtime-safe `./<basename>.fsm.js` edge against the sibling `<basename>.fsm.ts` only in an ephemeral verification copy, preserve the linked source and its `.js` specifier unchanged, and still emit the matching composition checks. |

#### verification-6

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-8](pipeline.md#pipeline-8)], the slc command shall emit a transition-coverage test beside the artifacts that drives the machine with distinct scripted Captain, player, and playbook actors and applies the complete coverage contract ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)):

| Coverage case | Required outcome |
| --- | --- |
| Declared transition reachability | Fail when a declared transition is unreachable: every non-controller direct-Captain or delegated-player result key fires a transition out of its nested working leaf — `needsBossReply` suspending in the correct scalar or `playbook.parked` branch-local wait, an unknown branch question id leaving that wait unchanged, a nonblank reply resuming only the addressed question when multiple parallel questions are pending, and a blank reply not resuming the acting agent — every schema-3 controller decision result [[verification-20](#verification-20)] selects exactly one evaluated action arm distinct from every other controller result, enters that arm's declared target, and returns to the session hub or reaches its declared shutdown final without inventing a Boss-reply wait, every nested-playbook invocation drives successful scripted child output through each satisfiable declared `onDone` arm and scripted child rejection through its `onError` target, including a dynamic call after its target and text context have been populated, every parallel-parent `onDone` arm is exercised through bounded branch-result combinations or reported explicitly as unsupported, every other `onError` arm reaches its target, every nested `BOSS_INTERRUPT` target is enterable through public `meta.playbook.stateId` or actor input state id rather than a private config path, guard-free root entry events transition, and every guarded `onDone` arm is satisfiable under bounded probing seeded from public metadata ids, actor input ids, config ids, and artifact identifier literals. Also fail when the machine declares no final state, no `BOSS_INTERRUPT` root event, a non-controller machine declares no scalar or branch-local Boss-reply wait, a controller machine declares such a wait or contains a delegated-player, nested-playbook, or parallel working surface, a parallel group repeats one canonical role id across simultaneously active regions, or a recoverable `failed` state lacks tag `playbook.parked`, except that a one-key controller near-miss suppresses only its specified ordinary machine-surface findings [[verification-22](#verification-22)]. |
| Immutable artifact predating the atomic Playbook 1.0 reference refresh | Exempt a legacy flat `failed` state that carries no `meta.playbook` identity from the parked-tag check; require any metadata-bearing recoverable failure to use the current tagged contract. |
| An invocation input or transition-scoped actor start throws synchronously during bounded driving. | Return a state-specific coverage finding and attach an error observer to every settle probe so XState does not report the same failure outside the checker boundary. |
| Nested invocation or intentionally non-root-jumpable parallel branch leaves | Evaluate a nested invocation only after entering it with the machine's initialized or transition-produced context, rather than preflighting the input with an artificial empty context; for the parallel leaves, enter their public parallel parent and drive the distinct delegated-player actors in place. |
| A typed `BOSS_INTERRUPT` arm requires additional Boss-supplied payload fields. | Synthesize only missing top-level fields under bounded guard probing while preserving the real event type and public target id. |
| Bounded generated-test execution | Set a timeout derived from the checker's bounded settle, parallel-combination, and guard-probe budgets rather than relying on the test runner's default timeout; include the fields named by their result descriptions in structured Captain outputs; match dynamic call ids to a seeded enabled-playbook catalog exactly; and enter a dynamic call through the Captain transition that populates its context before driving child success or failure. |
| A `BOSS_INTERRUPT` arm has valid context preconditions that the machine's initial input alone cannot represent. | Bounded-probe missing and existing context fields plus missing Boss-supplied event fields, restore an XState persisted initial snapshot with satisfying context and no stale children, and drive the authored ordered transition using matching artifact identifiers and catalog, call, final-response, or accumulated-state sentinels; report an unsatisfiable guard or a transition that does not enter its target rather than accepting direct guard evaluation as coverage. |

#### verification-12

When a full reserved-pipeline run for the reserved `slc` or `playbook` identities [[self-hosting-2](self-hosting.md#self-hosting-2)], [[self-hosting-6](self-hosting.md#self-hosting-6)] emits compilation-correctness tests at canonical artifact locations [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-8](pipeline.md#pipeline-8)], the slc command shall apply the applicable support outcome ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)):

| Artifact generation | Support outcome |
| --- | --- |
| Current emitted bundle | First copy its built `verify`, `verify-coverage`, and `hash` JavaScript modules plus matching declarations into the artifact-local `.slc-verify/` directory, list every support file among the outputs, and make all four generated tests import `./.slc-verify/verify.js`; retain `xstate` as the copied checker's destination-resolved bare dependency already required by the FSM, and require no `@sublang/slc` installation in the destination project. |
| Immutable Playbook 0.9 bundle predating the atomic Playbook 1.0 reviewed-asset refresh | Continue accepting the layout without the new support directory during pin validation [[pinning-2](pinning.md#pinning-2)]. |

### Runtime equivalence

#### verification-10

When comparing produced and reference compiled outputs, the slc equivalence harness shall derive and compare each exact runtime contract profile through all applicable cases ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)):

| Profile case | Required derivation and comparison |
| --- | --- |
| `legacy`, `session-v1`, and `composed-v2` | Construct fresh runtimes, require the exact callable surface, initialize and drive one inert non-empty turn with exactly four ports for the first two profiles or exactly six ports including `callCaptain` and `callPlaybook` for `composed-v2`, require a void result from the first two and a profile-exact structured result plus callable `resumePlaybookCall` from `composed-v2`, and dispose every initialized probe. |
| `composed-v3` declaration | Require schema-3 selection to fail closed rather than fall through to a `composed-v2` probe under [[verification-21](#verification-21)]; require schema-3 link-target evidence under that verification-only decision — exact recorded schema-3 provenance or an installed engine declaring `RUNTIME_ABI` `1` with artifact schema `3`, whatever its release — and an own-data schema-3 registry carrying exactly `id`, `command`, `intent`, `artifactSchema`, `runtimeProfile`, `requiredRoleIds`, `concurrentRoleSets`, `validateOptions`, and `createRuntime`, plus only the host-supported optional `summaryPolicy`, with the same non-empty `id` and `command`; when present, require `summaryPolicy` to have exact own-data members `stateCountLabels`, `copyPasteGuardNames`, and `savedCountsLine`, with a plain string-valued label map, an exact string array, and a callable formatter without comparing formatter prose; for `{ kind: 'shared-factory', compat }`, require `compat` to be the same frozen object held by the factory's enumerable, non-writable, non-configurable own `compat` data property and to contain exactly `{ artifactSchema: 3, runtimeAbi: 1 }`; for `{ kind: 'bespoke', artifactSchema: 3 }`, require exactly those fields and no runtime-ABI or factory-compatibility claim; and reject an absent, extra, accessor-backed, mutable, mismatched, or cross-kind declaration without using either declaration to map another provenance. |
| `composed-v3` Captain-hosted registry construction | Before loading a shared registry, interpose a comparison-owned recording factory at its linked-module import so the candidate receives no writable observation channel; pass one comparison-supplied deterministic option slice through each registry's `validateOptions`, require both validators to accept it and return deeply equal plain JSON, and pass each exact validated value with a live `hostCapabilities` object as separate `createRuntime` arguments — using an absent slice and exact empty result only for entries whose configured-option schema is empty — while requiring the private observations to show that the entry calls its linked factory exactly once with the plain own-data `{ configuredOptions, hostCapabilities }` argument carrying those same two identities and directly returns that call's runtime; make the capability and each nested record plain and accessor-free with exactly enumerable own data; give authority exactly `playbookId`, `artifactSchema`, `cwd`, `sessionId`, `leaseOwnerToken`, `canonicalWorktree`, `requiredRoleIds`, and `concurrentRoleSets` matching the registry and an isolated temporary Git worktree; give repository exactly matching `identity` plus callable recording `observe`, `acquire`, `runExclusive`, `runCohort`, and `runDeferred`; and give the effect ledger exactly a synchronous `snapshot` returning detached `{ schemaVersion: 1, revision: 0, boundaries: [], logicalOperations: [] }` plus recording `writeAhead`. |
| `composed-v3` runtime probe | Initialize a fresh runtime with one causal-root session and exactly six ports, require callable `handleBossInput`, `resumePlaybookCall`, and `dispose`, and dispose it; for a roleless fixture, additionally drive one inert non-empty turn and fail if it invokes a player, repository operation, or ledger write; for a role-bearing fixture, perform no Boss turn in this profile probe and instead verify canonical local-role behavior through conformance, prompt-contract, and transition coverage [[verification-1](#verification-1)], [[verification-5](#verification-5)], [[verification-6](#verification-6)], so the profile probe neither simulates nor rejects a real schema-3 host's governed effects. |
| `composed-v3` result and optional surface | Require every driven result to be plain accessor-free data and exactly one of `{ outcome: 'quiescent' | 'no-action', state }`, `{ outcome: 'unresolved-effect', state }`, `{ outcome: 'failed' | 'aborted', state, error? }`, `{ outcome: 'terminal', state, stateDescription?, output? }` with string `stateDescription` only there, or `{ outcome: 'suspended', state, pendingCall }`; require `exportSnapshot` and `restore` to be callable together or absent together, callable `adopt` when present, a plain exact retained-generation record with string-array `unfinishedFinalStateIds` when present, callable `describe` and `apply` together or neither, and `unresolvedEffectEnvelopes()` when present to return only exact `{ kind: 'boundary', boundaryId }` or `{ kind: 'logical-operation', operationId }` string records; and use none of those optional members to select a profile. |
| Profile mismatch or semantic drift | Reject no match, multiple matches, a missing or non-callable required member, unsupported marker, marker/boundary conflict, or unequal produced and reference profiles, while allowing an immutable `runtimeContractProfile` export to resolve a deliberately multi-shape older runtime whose declared boundary passes; recursively recognize scalar or `playbook.parked` Boss-reply surfaces; key literal nested-call content by target playbook id and dynamic nested-call content by its context metadata; distinguish direct-Captain, delegated-role, historical delegated-player, and playbook actor bindings; and compare verbatim prompt or child-input lines, structured-machine conformance, and reachable transitions without requiring byte, item-partition, or state-name identity. |

### Compiled-execution fidelity

#### verification-23

When reviewing a compiled `playbook` artifact whose definition declares a closing `## Compiled execution` section, the slc command shall check compiled-execution fidelity deterministically and report a finding unless one direct-Captain GEARS item preserves the section verbatim ([DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)):

| Section content | Preserved form in the bundle's GEARS |
| --- | --- |
| The acting prompt: the section's first blockquote, with the blockquote marker removed and each line's Markdown backslash escapes resolved [[1]] — a backslash before an ASCII punctuation character stands for that character, so a Source-escaped `\<definition\>` is the plain `<definition>` a compiled artifact carries. | The item's acting prompt lines, equal line for line. |
| The result contract: the ``- `<guardName>`: <description>`` bullets following the section's `Results:` label. | The item's ordered `Results:` entries, equal in guard, description, and order, without a compiler-owned `needsBossReply`. |

- A definition without the section makes the check not applicable, reported as such without a finding.
- A section with no blockquote, no `Results:` label, no valid entry, a repeated guard, or a second such section is itself a finding.
- A finding names the drift: the nearest direct-Captain item's first differing prompt line, or the preserving item's differing results.

### Script actors

#### verification-15

When checking GEARS↔FSM conformance, the slc command shall recognize as the optimizer-introduced script kind every GEARS item with the literal `Captain shall run:` clause, a blockquoted static script, and exactly two exit-status `Results:` guards, and pair each script item with exactly one `script` actor state whose `command` carries the blockquote verbatim and whose result map preserves the item's two guards in declared order with no `needsBossReply`, reporting drift, an agent-actor realization of a script item, and a script state realizing a non-script item as findings ([DR-013](../decisions/013-normalize-and-pass-phases.md)).

#### verification-16

When checking FSM transition coverage, the slc command shall drive `script` actor states like other work states — resolving each declared exit-status guard — so an optimized artifact's transitions are covered as strictly as an unoptimized one's ([DR-013](../decisions/013-normalize-and-pass-phases.md)).

### Emitted-module load integrity

#### verification-18

When the slc command emits a `.ts` or `.js` module as a linked target after full or direct linking [[pipeline-15](pipeline.md#pipeline-15)], [[pipeline-18](pipeline.md#pipeline-18)] and generic post-link settlement [[pipeline-40](pipeline.md#pipeline-40)], or as a `playbook` entry module [[self-hosting-15](self-hosting.md#self-hosting-15)], it shall verify that every relative import specifier in the emitted module resolves exactly from the module's own location and shall fail the run with a diagnostic naming the module and each unresolvable specifier ([DR-023](../decisions/023-host-settled-link-object-imports.md)); a compile whose output cannot load is a failed compile, not a success with a latent runtime error, as exposed by the [[release-17](release.md#release-17)] acceptance gate when an interpreted link emitted `./<basename>.fsm.js` beside a `.ts`-only bundle.

## Verification

### Reference acceptance

#### verification-7

Where the installed `@sublang/playbook` provides the manual reference artifacts, when compilation-correctness acceptance runs, the checks shall produce the applicable outcome:

| Case | Required outcome |
| --- | --- |
| The conformance, introspection, prompt-contract, and transition-coverage checks run over the unchanged reference `gears`, `fsm`, and linked composers. | Report no finding from GEARS↔FSM conformance [[verification-1](#verification-1)], Boss-reply result conformance [[verification-3](#verification-3)], pinned introspection [[verification-4](#verification-4)], prompt contracts [[verification-5](#verification-5)], or transition coverage [[verification-6](#verification-6)]. |
| Reference drift is injected. | Report the corresponding drift: an inserted, deleted, split, or reordered prompt-body or quoted-context segment, a mutated Captain or player prompt, a concrete-player leak into schema-3 prompt identity, or a wrong canonical-role lookup [[verification-5](#verification-5)]; a direct Captain changed to a player or a delegated role/player changed to Captain, an invented or mis-bound canonical role, `invoke.input.player` substituted for schema-3 `role`, mismatched role metadata or concurrent-role sets, a dropped or mis-bound child playbook, mismatched `playbookIdContext` or `textContext` metadata, dynamic target or text wiring that does not return the named context sentinel, or a missing or mismatched explicit/public state id [[verification-1](#verification-1)]; a missing ordinary `needsBossReply` result or one invented for a controller-machine [[verification-20](#verification-20)] acting state [[verification-3](#verification-3)]; a changed hierarchy, type, tag, join, local wait, or pinned topology [[verification-4](#verification-4)]; or a recoverable failure state without `playbook.parked`, a synchronously throwing invocation input or actor start, a repeated parallel role, an invented controller Boss-reply wait, or an unreachable actor, controller action, nested `onDone`, nested `onError`, or other transition arm [[verification-6](#verification-6)]. Do not let an uncaught XState error escape the checker. |

### Emission acceptance

#### verification-8

Where a reserved pipeline's faked agents produce a conformant `gears` and `fsm` pair, when emitted-verification acceptance runs, the slc command shall produce the outcome for each applicable case:

| Case | Required outcome |
| --- | --- |
| A full run succeeds with the pair at its canonical locations. | Emit artifact-local checker support [[verification-12](#verification-12)] plus the conformance [[verification-2](#verification-2)], introspection [[verification-4](#verification-4)], prompt-contract [[verification-5](#verification-5)], and coverage [[verification-6](#verification-6)] tests beside the artifacts and list them among the outputs. |
| Generated tests address sibling TypeScript artifacts or read the FSM source. | Import sibling TypeScript artifacts through NodeNext `.js` specifiers while the coverage test reads the physical `.fsm.ts` source [[verification-2](#verification-2)]. |
| A linked TypeScript module imports its sibling FSM through the NodeNext-required `.js` specifier and exposes `composeCaptainPrompt`. | Run that composer check through an ephemeral TypeScript edge without changing the linked source and emit the direct-Captain composition checks [[verification-5](#verification-5)]. |
| A full-link run's concrete reviewed Playbook target selects a different schema from the compiled FSM phase's pin, its target is a later release whose installed engine declares `RUNTIME_ABI` `1` with artifact schema `3`, or a bare run retains a sibling linked factory. | Reconcile the concrete target when present — through its recorded provenance or its engine's declaration — the produced FSM, and the linked factory once, and bake the same schema decision and findings into the generated conformance and prompt tests, never the compiler phase's provenance [[verification-21](#verification-21)]. |
| A direct-Captain linked fixture has no pin, no generation-specific actor binding, and a callable compat-less factory. | Bake schema 1 and pass its historical continuation probe; with no linked factory either, report the missing schema [[verification-21](#verification-21)]. |
| Reviewed provenance, actor-generation structure, and linked-factory compatibility conflict, are malformed, or include a present unsupported provenance. | Report the schema decision finding and do not apply the compat-less fallback [[verification-21](#verification-21)]. |
| Standalone artifact review finds a pin record whose currency verdict is not current. | Exclude that record's provenance from the schema decision and review from the artifact's own valid signals without treating the non-current record as schema evidence [[verification-21](#verification-21)]. |
| The generated tests run from a temporary destination with `vitest` and the FSM's `xstate` dependency but no SLC package or sibling checkout. | Resolve the relative checker [[verification-12](#verification-12)], use a coverage timeout derived from the checker's bounded work rather than Vitest's default [[verification-6](#verification-6)], and pass the conformance [[verification-2](#verification-2)], introspection [[verification-4](#verification-4)], prompt-contract [[verification-5](#verification-5)], and coverage [[verification-6](#verification-6)] tests. |
| The produced `fsm` cannot be imported for derivation. | Still emit the checker support [[verification-12](#verification-12)] and conformance test [[verification-2](#verification-2)], report a diagnostic for each degraded introspection [[verification-4](#verification-4)], prompt-contract [[verification-5](#verification-5)], and coverage [[verification-6](#verification-6)] test, and leave the run successful. |

### Equivalence acceptance

#### verification-9

Where `slc playbook` output for the reference workflow may exist, when the equivalence harness compares it to the manual reference package, the harness shall produce the applicable outcome:

| Case | Required outcome |
| --- | --- |
| Produced output exists and is equivalent to the reference. | Accept the compilations: they have the same distinct direct-Captain, delegated-role or historical delegated-player, and playbook actor bindings; the same schema-3 canonical `role` metadata and concurrent-role sets or historical `player` bindings; the same controller or non-controller classification [[verification-20](#verification-20)]; the same literal target playbook ids and dynamic target/input context metadata; the same verbatim per-actor prompt or child-input line sets; each flat, structured, or controller `fsm` is conformant to its own `gears` with its applicable Boss surfaces declared and its transitions reachable [[verification-1](#verification-1)], [[verification-3](#verification-3)], [[verification-6](#verification-6)]; and each linked module plus applicable registry declaration honors the same exactly probed `legacy`, `session-v1`, six-port `composed-v2`, shared-factory `composed-v3`, or bespoke `composed-v3` runtime contract profile [[verification-10](#verification-10)], without requiring byte-identity, item-partition identity, or state-name identity. |
| The profiles or schema-3 implementation declarations differ, no exact boundary matches, multiple unmarked older boundaries match, a marker conflicts with the driven or callable boundary, or a required member or composed port is missing or non-callable. | Report the incompatibility [[verification-10](#verification-10)]. |
| No produced output exists. | Skip with a notice instead of failing. |

#### verification-11

Where synthetic artifacts contain distinct direct-Captain and delegated-role leaves with canonical schema-3 role metadata, optionless and nonempty-configured-option schema-3 registry fixtures, a separate immutable schema-1 delegated-player fixture, a structured prompt value rendered as deterministic JSON, a state-keyed branch continuation mapper, nested parallel regions with exact concurrent-role sets whose public parent alone is root-jumpable, public metadata ids distinct from config keys while matching explicit state ids, multiple branch-local Boss waits, a guarded parallel join, context-guarded interrupt targets whose initialized fields differ from satisfying accumulated fields, a literal nested-playbook actor, a typed interrupt requiring an additional Boss payload field, a dynamic nested-playbook actor with named target and text context, a valid controller decision fixture with no Boss-reply wait, and one-key missing and extra controller near-miss fixtures, when the conformance, introspection, prompt, coverage, and runtime-profile checks run, the checks shall recognize the JSON-rendered prompt sentinel, preserve quoted-context text, resolve player-facing identity only through the canonical role lookup, and verify scalar and state-keyed Boss question/reply continuation wiring [[verification-5](#verification-5)]; traverse every stable nested leaf without a missing-state false finding, accept the historical fixture's `invoke.input.player` without relabelling, and reject actor-kind swaps, `player` substituted for schema-3 `role`, canonical-role or concurrent-set drift, and dynamic metadata or sentinel-wiring drift [[verification-1](#verification-1)]; require ordinary acting states but no Captain- or player-invoking controller-machine state to carry `needsBossReply` [[verification-3](#verification-3)]; classify only the valid controller decision fixture, not either near miss, as a controller [[verification-20](#verification-20)]; report each controller near miss by its missing or extra action without selecting the controller contract or reporting ordinary wait and interrupt requirements [[verification-22](#verification-22)]; retain the existing flat representation for a flat control fixture [[verification-4](#verification-4)]; leave an unknown question id parked, prevent a blank reply from resuming the acting agent, address only the selected pending question, exercise reachable join arms and every controller action path under bounded probing without inventing a controller wait, restore satisfying context through an XState persisted snapshot and drive each guarded interrupt while rejecting unsatisfiable context guards, synthesize the typed interrupt payload and structured Captain delegation output against an exact enabled catalog, enter a dynamic child through the assigning Captain transition, evaluate nested input against initialized or transition-produced context, drive every satisfiable nested `onDone` and `onError` arm independently, and avoid generic interrupt findings for valid dynamic-call and final-state preconditions [[verification-6](#verification-6)]; and distinguish unmarked strict `legacy` and `session-v1` boundaries, recognize matching `legacy`, `session-v1`, resumable six-port `composed-v2`, shared-factory `composed-v3`, and bespoke `composed-v3` pairs using exact validated empty or nonempty configured options and exact plain live Captain-host capabilities, drive the roleless v3 fixtures without repository or ledger mutation while only initializing and disposing role-bearing profile fixtures, reject mismatched option validation, missing or mismatched shared compatibility, an ABI claim on bespoke output, non-plain or malformed capability records, every mixed pair and inconsistent marker, unpaired snapshot/restore or describe/apply members, non-callable adoption, malformed retained-generation metadata, and invalid unresolved-effect envelopes, key literal nested content by target playbook id, and key dynamic nested content by its context metadata [[verification-10](#verification-10)].

### Result-metadata acceptance

#### verification-14

Where synthetic GEARS may contain a canonical `Results:` block after an acting blockquote, when its FSM state and the conformance check process that block, the check shall produce the applicable outcome:

| Case | Required outcome |
| --- | --- |
| The FSM state contains the same domain guards plus compiler-owned `needsBossReply`. | Preserve the acting prompt without metadata, parse the source guards in declaration order, and report no finding [[verification-13](#verification-13)]. |
| A schema-3 controller decision state contains exactly its authored Results and no compiler-owned `needsBossReply`. | Recognize the state through the shared controller discriminator [[verification-20](#verification-20)], preserve the acting prompt without metadata, parse the source guards in declaration order, and report no finding [[verification-13](#verification-13)]. |
| The block has a misplaced or malformed label; malformed, empty, duplicate, source-owned `needsBossReply`, missing, extra, reordered, or description-drifted result entries; or appears on a nested-playbook call. | Produce a specific finding [[verification-13](#verification-13)]. |

### Compiled-execution fidelity acceptance

#### verification-24

Where synthetic definitions and GEARS exercise a preserved section beside unrelated items, a rewritten prompt line, a transcribed extra prompt line, reordered and missing results, a delegated-role item carrying the prompt, a malformed section, and a definition without the section, when the fidelity check runs, it shall accept only the preserving direct-Captain item, name each drift, report the malformed section, and report the sectionless definition not applicable [[verification-23](#verification-23)].

### Script acceptance

#### verification-17

When a GEARS package and FSM contain script behavior, the conformance and coverage checks shall produce the applicable outcome:

| Case | Required outcome |
| --- | --- |
| A script item is realized by a matching `script` actor state. | Pass conformance [[verification-15](#verification-15)] and coverage [[verification-16](#verification-16)]. |
| The command drifts, a guard is renamed or reordered, `needsBossReply` is added, or the item is realized by a Captain or player state. | Report the conformance drift [[verification-15](#verification-15)]. |

### Load-integrity acceptance

#### verification-19

Where a link phase writes a linked module, when the run completes after post-link settlement, the slc command shall produce the applicable load-integrity outcome:

| Relative imports | Required outcome |
| --- | --- |
| A relative import remains unresolved. | Exit non-zero with a diagnostic naming the module and the unresolvable specifier [[verification-18](#verification-18)]. |
| Every relative import is already in its settled form and resolves exactly beside the module. | Complete successfully without changing those imports [[verification-18](#verification-18)]. |

## References

[1]: https://spec.commonmark.org/0.31.2/#backslash-escapes "CommonMark Spec: backslash escapes"

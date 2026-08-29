<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# verification: Compilation-Correctness Verification

## Intent

This package specifies how `slc` verifies that a compiled `playbook` artifact faithfully represents its source, per [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md) and the Playbook 1.0 actor and dynamic-call adoption of [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
A compiled routing workflow also separates source-owned result metadata from acting prose per [DR-012](../decisions/012-playbook-routing-control-separation.md).
A compiled artifact is judgment-produced, so `slc` re-checks it deterministically against the `gears` and `fsm` it was built from and emits that check as a test beside the artifacts under `<basename>.playbook/`, so each build re-verifies faithfulness.
The package covers GEARS↔FSM conformance, FSM introspection, prompt contracts, transition coverage, runtime equivalence, script actors, and emitted-module load integrity.
Verification exercises those deterministic checks against the manual reference artifacts `@sublang/playbook` ships, detects injected drift, and runs generated tests beside reserved-pipeline artifacts.
Essential project-specific references: `slc`, this project's compiler CLI; and `@sublang/playbook`, whose installed package provides the manual reference artifacts, compiler definitions, and linked runtime contract.

## External Behavior

### GEARS↔FSM conformance

#### verification-1

When checking a compiled `playbook` artifact's GEARS↔FSM conformance, the slc command shall recursively traverse nested and parallel state nodes and report a finding unless every `gears` item maps to exactly one executable working leaf of its declared actor kind and every such leaf references a `gears` item that exists; every node in a structured machine shall carry a non-empty explicit state id and matching `meta.playbook.stateId`; a direct-Captain leaf shall invoke `captain` and carry that same id plus the item's prompt body verbatim without a player binding; a delegated-player leaf shall invoke `player` and additionally carry the item's declared player; a literal nested-playbook leaf shall invoke `playbook` and carry the same id, literal target, and child-input body verbatim; and a dynamic nested-playbook leaf shall invoke `playbook`, carry the same id, preserve the GEARS target-field name and sole child-text placeholder as literal `playbookIdContext` and `textContext` metadata, and evaluate `playbookId` and `text` to independent sentinel values supplied through those exact named context fields without source-text inspection ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)).

#### verification-3

When checking a compiled `playbook` artifact's GEARS↔FSM conformance [[verification-1](#verification-1)], the slc command shall report a finding for every direct-Captain or delegated-player FSM state whose `result` map does not declare the Boss-reply suspension key `needsBossReply`, or declares it with a description that lacks the adjudicator contract substring ``Output shall include `question:`` ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)).

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

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-8](pipeline.md#pipeline-8)], the slc command shall apply every applicable prompt-contract verification outcome ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)):

| Case | Prompt-contract verification outcome |
| --- | --- |
| The canonical `gears` and `fsm` artifacts are available. | Derive each direct-Captain and delegated-player state's prompt contract from the artifacts — its traced context reads, its sentinel-traced input wiring, and its prompt's placeholder tokens — and emit a test beside the artifacts that fails when the contract no longer matches. |
| A linked `<basename>.playbook.ts` beside the artifacts exposes its Captain and player prompt composers. | Additionally fail the emitted test when the matching composer stops substituting a placeholder it substituted at build time, stops preserving the complete prompt body verbatim as one contiguous ordered block, leaks the Boss-reply adjudicator contract into an acting-agent prompt, introduces a player binding or resume instruction into a direct-Captain prompt, composes continuation blocks on an ordinary turn, or composes a continuation turn without the exact preamble and labelled Q&A blocks before the body, while recognizing either a raw string sentinel or that same sentinel encoded as deterministic JSON for a typed structured value. Probe continuations with the same question and reply through both scalar `pendingBossQuestion` / `bossReply` context and state-keyed `pendingBossQuestions[stateId]` / `bossReplies[stateId]` context so flat and parallel branch input mappers are verified. |
| A linked module exposes no matching composer. | Degrade to the artifact-only test with a diagnostic. |
| Emission-time derivation imports a NodeNext TypeScript linked module before its sibling FSM has been built. | Resolve the linked module's required runtime-safe `./<basename>.fsm.js` edge against the sibling `<basename>.fsm.ts` only in an ephemeral verification copy, preserve the linked source and its `.js` specifier unchanged, and still emit the matching composition checks. |

#### verification-6

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations [[pipeline-7](pipeline.md#pipeline-7)], [[pipeline-8](pipeline.md#pipeline-8)], the slc command shall emit a transition-coverage test beside the artifacts that drives the machine with distinct scripted Captain, player, and playbook actors and applies the complete coverage contract ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)):

| Coverage case | Required outcome |
| --- | --- |
| Declared transition reachability | Fail when a declared transition is unreachable: every direct-Captain or delegated-player result key fires a transition out of its nested working leaf — `needsBossReply` suspending in the correct scalar or `playbook.parked` branch-local wait, an unknown branch question id leaving that wait unchanged, a nonblank reply resuming only the addressed question when multiple parallel questions are pending, and a blank reply not resuming the acting agent — every nested-playbook invocation drives successful scripted child output through each satisfiable declared `onDone` arm and scripted child rejection through its `onError` target, including a dynamic call after its target and text context have been populated, every parallel-parent `onDone` arm is exercised through bounded branch-result combinations or reported explicitly as unsupported, every other `onError` arm reaches its target, every nested `BOSS_INTERRUPT` target is enterable through public `meta.playbook.stateId` or actor input state id rather than a private config path, guard-free root entry events transition, and every guarded `onDone` arm is satisfiable under bounded probing seeded from public metadata ids, actor input ids, config ids, and artifact identifier literals. Also fail when the machine declares no final state, no `BOSS_INTERRUPT` root event, no scalar or branch-local Boss-reply wait, or a recoverable `failed` state without tag `playbook.parked`. |
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

When comparing produced and reference linked modules, the slc equivalence harness shall derive each exact runtime contract profile by constructing fresh runtimes, checking the required callable surface, initializing and driving an inert non-empty turn through the candidate `legacy`, `session-v1`, or `composed-v2` boundary, supplying exactly four ports to the first two profiles and exactly six ports including `callCaptain` and `callPlaybook` to `composed-v2`, requiring a void result from the first two profiles and a valid structured result plus callable `resumePlaybookCall` from the third, and disposing every initialized probe; it shall reject no-match, multi-match, missing or non-callable member, unsupported marker, and marker/boundary conflicts, while allowing an immutable `runtimeContractProfile` export to resolve a deliberately multi-shape runtime whose declared boundary passes; and it shall accept only identical produced and reference profiles — while recursively recognizing scalar or `playbook.parked` Boss-reply surfaces, keying literal nested-call content by target playbook id and dynamic nested-call content by its context metadata, distinguishing direct-Captain, delegated-player, and playbook actor bindings, and comparing verbatim prompt or child-input lines, structured-machine conformance, and reachable transitions without requiring byte, item-partition, or state-name identity ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)).

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
| Reference drift is injected. | Report the corresponding drift: an inserted, deleted, split, or reordered prompt-body segment or a mutated Captain or player prompt [[verification-5](#verification-5)]; a direct Captain changed to a player or a delegated player changed to Captain, an invented or mis-bound player, a dropped or mis-bound child playbook, mismatched `playbookIdContext` or `textContext` metadata, dynamic target or text wiring that does not return the named context sentinel, or a missing or mismatched explicit/public state id [[verification-1](#verification-1)]; a missing `needsBossReply` result [[verification-3](#verification-3)]; a changed hierarchy, type, tag, join, local wait, or pinned topology [[verification-4](#verification-4)]; or a recoverable failure state without `playbook.parked`, a synchronously throwing invocation input or actor start, or an unreachable actor, nested `onDone`, nested `onError`, or other transition arm [[verification-6](#verification-6)]. Do not let an uncaught XState error escape the checker. |

### Emission acceptance

#### verification-8

Where a reserved pipeline's faked agents produce a conformant `gears` and `fsm` pair, when emitted-verification acceptance runs, the slc command shall produce the outcome for each applicable case:

| Case | Required outcome |
| --- | --- |
| A full run succeeds with the pair at its canonical locations. | Emit artifact-local checker support [[verification-12](#verification-12)] plus the conformance [[verification-2](#verification-2)], introspection [[verification-4](#verification-4)], prompt-contract [[verification-5](#verification-5)], and coverage [[verification-6](#verification-6)] tests beside the artifacts and list them among the outputs. |
| Generated tests address sibling TypeScript artifacts or read the FSM source. | Import sibling TypeScript artifacts through NodeNext `.js` specifiers while the coverage test reads the physical `.fsm.ts` source [[verification-2](#verification-2)]. |
| A linked TypeScript module imports its sibling FSM through the NodeNext-required `.js` specifier and exposes `composeCaptainPrompt`. | Run that composer check through an ephemeral TypeScript edge without changing the linked source and emit the direct-Captain composition checks [[verification-5](#verification-5)]. |
| The generated tests run from a temporary destination with `vitest` and the FSM's `xstate` dependency but no SLC package or sibling checkout. | Resolve the relative checker [[verification-12](#verification-12)], use a coverage timeout derived from the checker's bounded work rather than Vitest's default [[verification-6](#verification-6)], and pass the conformance [[verification-2](#verification-2)], introspection [[verification-4](#verification-4)], prompt-contract [[verification-5](#verification-5)], and coverage [[verification-6](#verification-6)] tests. |
| The produced `fsm` cannot be imported for derivation. | Still emit the checker support [[verification-12](#verification-12)] and conformance test [[verification-2](#verification-2)], report a diagnostic for each degraded introspection [[verification-4](#verification-4)], prompt-contract [[verification-5](#verification-5)], and coverage [[verification-6](#verification-6)] test, and leave the run successful. |

### Equivalence acceptance

#### verification-9

Where `slc playbook` output for the reference workflow may exist, when the equivalence harness compares it to the manual reference package, the harness shall produce the applicable outcome:

| Case | Required outcome |
| --- | --- |
| Produced output exists and is equivalent to the reference. | Accept the compilations: they have the same distinct direct-Captain, delegated-player, and playbook actor bindings, the same player bindings, literal target playbook ids, and dynamic target/input context metadata, the same verbatim per-actor prompt or child-input line sets, each flat or structured `fsm` is conformant to its own `gears` with recursive Boss surfaces declared and its transitions reachable [[verification-1](#verification-1)], and each linked module honors the same exactly probed `legacy`, `session-v1`, or six-port `composed-v2` runtime contract profile [[verification-10](#verification-10)], without requiring byte-identity, item-partition identity, or state-name identity. |
| The profiles differ, no exact boundary matches, multiple unmarked boundaries match, a marker conflicts with the driven or callable boundary, or a required member or composed port is missing or non-callable. | Report the incompatibility [[verification-10](#verification-10)]. |
| No produced output exists. | Skip with a notice instead of failing. |

#### verification-11

Where synthetic artifacts contain distinct direct-Captain and delegated-player leaves, a structured prompt value rendered as deterministic JSON, a state-keyed branch continuation mapper, nested parallel regions whose public parent alone is root-jumpable, public metadata ids distinct from config keys while matching explicit state ids, multiple branch-local Boss waits, a guarded parallel join, context-guarded interrupt targets whose initialized fields differ from satisfying accumulated fields, a literal nested-playbook actor, a typed interrupt requiring an additional Boss payload field, and a dynamic nested-playbook actor with named target and text context, when the conformance, introspection, prompt, coverage, and runtime-profile checks run, the checks shall recognize the JSON-rendered prompt sentinel and verify scalar and state-keyed Boss question/reply continuation wiring [[verification-5](#verification-5)]; traverse every stable nested leaf without a missing-state false finding and reject actor-kind swaps and dynamic metadata or sentinel-wiring drift [[verification-1](#verification-1)]; retain the existing flat representation for a flat control fixture [[verification-4](#verification-4)]; leave an unknown question id parked, prevent a blank reply from resuming the acting agent, address only the selected pending question, exercise reachable join arms under bounded probing, restore satisfying context through an XState persisted snapshot and drive each guarded interrupt while rejecting unsatisfiable context guards, synthesize the typed interrupt payload and structured Captain delegation output against an exact enabled catalog, enter a dynamic child through the assigning Captain transition, evaluate nested input against initialized or transition-produced context, drive every satisfiable nested `onDone` and `onError` arm independently, and avoid generic interrupt findings for valid dynamic-call and final-state preconditions [[verification-6](#verification-6)]; and distinguish unmarked strict `legacy` and `session-v1` boundaries, recognize matching `legacy`, `session-v1`, and resumable six-port `composed-v2` runtime pairs, reject every mixed pair and inconsistent marker, key literal nested content by target playbook id, and key dynamic nested content by its context metadata [[verification-10](#verification-10)].

### Result-metadata acceptance

#### verification-14

Where synthetic GEARS may contain a canonical `Results:` block after an acting blockquote, when its FSM state and the conformance check process that block, the check shall produce the applicable outcome:

| Case | Required outcome |
| --- | --- |
| The FSM state contains the same domain guards plus compiler-owned `needsBossReply`. | Preserve the acting prompt without metadata, parse the source guards in declaration order, and report no finding [[verification-13](#verification-13)]. |
| The block has a misplaced or malformed label; malformed, empty, duplicate, source-owned `needsBossReply`, missing, extra, reordered, or description-drifted result entries; or appears on a nested-playbook call. | Produce a specific finding [[verification-13](#verification-13)]. |

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

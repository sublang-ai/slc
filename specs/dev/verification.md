<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# VERIFY: Compilation-Correctness Verification

## Intent

This package specifies how `slc` verifies that a compiled `playbook` artifact
faithfully represents its source, per
[DR-009](../decisions/009-slc-playbook-pipeline-compilation.md) and the Playbook
1.0 actor and dynamic-call adoption of
[DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
A compiled artifact is judgment-produced, so `slc` re-checks it deterministically
against the `gears` and `fsm` it was built from and emits that check as a test
beside the artifacts (under `<basename>.playbook/`) so each build re-verifies
faithfulness.
This package covers GEARS↔FSM conformance; further invariants (FSM introspection
counts, prompt-contract, and transition coverage) extend it.

Essential project-specific reference: `slc`, this project's compiler CLI.

## GEARS↔FSM conformance

### VERIFY-1

When checking a compiled `playbook` artifact's GEARS↔FSM conformance, the slc command shall recursively traverse nested and parallel state nodes and report a finding unless every `gears` item maps to exactly one executable working leaf of its declared actor kind and every such leaf references a `gears` item that exists; every node in a structured machine shall carry a non-empty explicit state id and matching `meta.playbook.stateId`; a direct-Captain leaf shall invoke `captain` and carry that same id plus the item's prompt body verbatim without a player binding; a delegated-player leaf shall invoke `player` and additionally carry the item's declared player; a literal nested-playbook leaf shall invoke `playbook` and carry the same id, literal target, and child-input body verbatim; and a dynamic nested-playbook leaf shall invoke `playbook`, carry the same id, preserve the GEARS target-field name and sole child-text placeholder as literal `playbookIdContext` and `textContext` metadata, and evaluate `playbookId` and `text` to independent sentinel values supplied through those exact named context fields without source-text inspection ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#actor-and-dynamic-call-verification)).

### VERIFY-3

When checking a compiled `playbook` artifact's GEARS↔FSM conformance ([VERIFY-1](#verify-1)), the slc command shall report a finding for every direct-Captain or delegated-player FSM state whose `result` map does not declare the Boss-reply suspension key `needsBossReply`, or declares it with a description that lacks the adjudicator contract substring ``Output shall include `question:`` ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#actor-and-dynamic-call-verification)).

## Test generation

### VERIFY-2

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall emit a test beside them, in `<basename>.playbook/`, that runs the GEARS↔FSM conformance check ([VERIFY-1](#verify-1)) over the artifact's `gears` file and the machine its `fsm` module exports, so each build re-checks faithfulness; when `-o` relocates the `fsm` out of that directory, the slc command shall emit no verification test ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).
Every emitted TypeScript verification test shall import sibling TypeScript FSM and linked-runtime artifacts through NodeNext `.js` module specifiers. Where a generated test also reads an artifact as source text, it shall keep a separate physical `.ts` filename for that file operation rather than read the `.js` specifier.

### VERIFY-4

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall derive the machine's structural topology from the produced `fsm` — recursively including executable actor bindings and result keys, config paths, explicit and public metadata ids, compound or parallel type, tags, parent joins, every `onDone`/`onError`/local-event transition arm, quiescent and root event surfaces, and the `BOSS_INTERRUPT` jumpable set — and emit a test beside the artifacts that fails when the machine no longer matches that pinned topology while omitting the structured extension for an unchanged flat machine; when the produced `fsm` module cannot be imported for derivation, the slc command shall report a diagnostic and emit no introspection test while leaving the run outcome unchanged ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### VERIFY-5

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall derive each direct-Captain and delegated-player state's prompt contract from the artifacts — its traced context reads, its sentinel-traced input wiring, and its prompt's placeholder tokens — and emit a test beside the artifacts that fails when the contract no longer matches; and where a linked `<basename>.playbook.ts` beside the artifacts exposes its Captain and player prompt composers, the emitted test shall additionally fail when the matching composer stops substituting a placeholder it substituted at build time, stops preserving the complete prompt body verbatim as one contiguous ordered block, leaks the Boss-reply adjudicator contract into an acting-agent prompt, introduces a player binding or resume instruction into a direct-Captain prompt, composes continuation blocks on an ordinary turn, or composes a continuation turn without the exact preamble and labelled Q&A blocks before the body, while a linked module exposing no matching composer degrades to the artifact-only test with a diagnostic. When emission-time derivation imports a NodeNext TypeScript linked module before its sibling FSM has been built, slc shall resolve that module's required runtime-safe `./<basename>.fsm.js` edge against the sibling `<basename>.fsm.ts` only in an ephemeral verification copy, preserve the linked source and its `.js` specifier unchanged, and still emit the matching composition checks ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#actor-and-dynamic-call-verification)).

### VERIFY-6

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall emit a transition-coverage test beside the artifacts that drives the machine with distinct scripted Captain, player, and playbook actors and fails when a declared transition is unreachable: every direct-Captain or delegated-player result key shall fire a transition out of its nested working leaf — `needsBossReply` suspending in the correct scalar or `playbook.parked` branch-local wait, an unknown branch question id leaving that wait unchanged, a nonblank reply resuming only the addressed question when multiple parallel questions are pending, and a blank reply not resuming the acting agent — every nested-playbook invocation shall drive successful scripted child output through each satisfiable declared `onDone` arm and scripted child rejection through its `onError` target, including a dynamic call after its target and text context have been populated, every parallel-parent `onDone` arm shall be exercised through bounded branch-result combinations or reported explicitly as unsupported, every other `onError` arm shall reach its target, every nested `BOSS_INTERRUPT` target shall be enterable through public `meta.playbook.stateId` or actor input state id rather than a private config path, guard-free root entry events shall transition, and every guarded `onDone` arm shall be satisfiable under bounded probing seeded from public metadata ids, actor input ids, config ids, and artifact identifier literals; the check shall also fail when the machine declares no final state, no `BOSS_INTERRUPT` root event, or no scalar or branch-local Boss-reply wait ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#actor-and-dynamic-call-verification)).
When an invocation input or transition-scoped actor start throws synchronously during that bounded driving, the checker shall return a state-specific coverage finding and shall attach an error observer to every settle probe so XState does not report the same failure outside the checker boundary.
The checker shall evaluate a nested invocation only after entering it with the machine's initialized or transition-produced context, rather than preflight the input with an artificial empty context; and where parallel branch leaves are intentionally not root-jumpable, it shall enter their public parallel parent and drive the distinct delegated-player actors in place.
The generated test shall set a timeout derived from the checker's bounded settle, parallel-combination, and guard-probe budgets rather than rely on the test runner's default timeout; structured Captain outputs shall include the fields named by their result descriptions, dynamic call ids shall match a seeded enabled-playbook catalog exactly, and a dynamic call shall be entered through the Captain transition that populates its context before child success or failure is driven.
Where a dynamic-call or final-state `BOSS_INTERRUPT` arm has valid context preconditions that cannot be represented by the machine's initial input alone, the checker shall evaluate the authored ordered guard with matching catalog, call, or final-response sentinels and shall not report the empty-initial-context jump as a generic unenterable target.

### VERIFY-12

When a full reserved-pipeline run emits compilation-correctness tests at canonical artifact locations, the slc command shall first copy its built `verify`, `verify-coverage`, and `hash` JavaScript modules plus matching declarations into the artifact-local `.slc-verify/` directory, list every support file among the outputs, and make all four generated tests import `./.slc-verify/verify.js`; the copied checker shall retain `xstate` as the destination-resolved bare dependency already required by the FSM and shall require no `@sublang/slc` installation in the destination project. Before the atomic Playbook 1.0 reviewed-asset refresh, the pin validator shall continue accepting the immutable Playbook 0.9 bundle layout without this new support directory ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md#verification-is-deterministic-and-artifact-derived), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#atomic-reviewed-asset-adoption)).

## Runtime equivalence

### VERIFY-10

When comparing produced and reference linked modules, the slc equivalence harness shall derive each exact runtime contract profile by constructing fresh runtimes, checking the required callable surface, initializing and driving an inert non-empty turn through the candidate `legacy`, `session-v1`, or `composed-v2` boundary, supplying exactly four ports to the first two profiles and exactly six ports including `callCaptain` and `callPlaybook` to `composed-v2`, requiring a void result from the first two profiles and a valid structured result plus callable `resumePlaybookCall` from the third, and disposing every initialized probe; it shall reject no-match, multi-match, missing or non-callable member, unsupported marker, and marker/boundary conflicts, while allowing an immutable `runtimeContractProfile` export to resolve a deliberately multi-shape runtime whose declared boundary passes; and it shall accept only identical produced and reference profiles — while recursively recognizing scalar or `playbook.parked` Boss-reply surfaces, keying literal nested-call content by target playbook id and dynamic nested-call content by its context metadata, distinguishing direct-Captain, delegated-player, and playbook actor bindings, and comparing verbatim prompt or child-input lines, structured-machine conformance, and reachable transitions without requiring byte, item-partition, or state-name identity ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md#runtime-profiles-and-root-phase-sessions), [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md)).

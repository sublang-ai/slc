<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# VERIFY: Compilation-Correctness Verification

## Intent

This package specifies acceptance tests for the compilation-correctness
verification of the `verification` dev package: the deterministic checks hold
against the manual reference artifacts `@sublang/playbook` ships, injected
drift is detected, and a successful reserved-pipeline run emits the
verification tests beside its artifacts.

Essential project-specific references: `slc`, this project's compiler CLI; and
`@sublang/playbook`, whose installed package provides the manual reference
artifacts, compiler definitions, and linked runtime contract.

## Checks against the reference

### VERIFY-7
Verifies: [VERIFY-1](../dev/verification.md#verify-1), [VERIFY-3](../dev/verification.md#verify-3), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-5](../dev/verification.md#verify-5), [VERIFY-6](../dev/verification.md#verify-6)

Where the installed `@sublang/playbook` provides the manual reference artifacts, when the conformance, introspection, prompt-contract, and transition-coverage checks run over the reference `gears`, `fsm`, and linked composers, each shall report no finding; whereas when a drift is injected — an inserted, deleted, split, or reordered prompt-body segment, a direct Captain changed to a player or a delegated player changed to Captain, an invented or mis-bound player, a dropped or mis-bound child playbook, mismatched `playbookIdContext` or `textContext` metadata, dynamic target or text wiring that does not return the named context sentinel, a missing or mismatched explicit/public state id, a missing `needsBossReply` result, a changed hierarchy, type, tag, join, or local wait, a machine no longer matching its pinned topology, a mutated Captain or player prompt, a synchronously throwing invocation input or actor start, or an unreachable actor, nested `onDone`, nested `onError`, or other transition arm — the corresponding check shall report it without an uncaught XState error escaping the checker.

## Emission

### VERIFY-8
Verifies: [VERIFY-2](../dev/verification.md#verify-2), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-5](../dev/verification.md#verify-5), [VERIFY-6](../dev/verification.md#verify-6), [VERIFY-12](../dev/verification.md#verify-12)

Where a reserved pipeline's faked agents produce a conformant `gears` and `fsm` pair at their canonical locations, when a full run succeeds, the slc command shall emit its artifact-local checker support plus the conformance, introspection, prompt-contract, and coverage tests beside the artifacts and list them among the outputs; every generated test shall import sibling TypeScript artifacts through NodeNext `.js` specifiers while the coverage test reads the physical `.fsm.ts` source; when a linked TypeScript module imports its sibling FSM through the NodeNext-required `.js` specifier and exposes `composeCaptainPrompt`, emission shall run that composer check through an ephemeral TypeScript edge without changing the linked source and shall emit the direct-Captain composition checks; when those generated tests run from a temporary destination with `vitest` and the FSM's `xstate` dependency but no SLC package or sibling checkout, all shall resolve the relative checker, use a coverage timeout derived from the checker's bounded work rather than Vitest's default, and pass; whereas where the produced `fsm` cannot be imported for derivation, the slc command shall still emit the checker support and conformance test, report a diagnostic per degraded test, and leave the run successful.

## Reference equivalence

### VERIFY-9
Verifies: [COMPILE-1](../user/compiler.md#compile-1), [SELFHOST-6](../dev/self-hosting.md#selfhost-6), [VERIFY-1](../dev/verification.md#verify-1), [VERIFY-10](../dev/verification.md#verify-10)

Where `slc playbook` output for the reference workflow exists, when the equivalence harness compares it to the manual reference package, the harness shall accept exactly when the compilations are equivalent — the same distinct direct-Captain, delegated-player, and playbook actor bindings, the same player bindings, literal target playbook ids, and dynamic target/input context metadata, the same verbatim per-actor prompt or child-input line sets, each flat or structured `fsm` conformant to its own `gears` with recursive Boss surfaces declared and its transitions reachable, and each linked module honoring the same exactly probed `legacy`, `session-v1`, or six-port `composed-v2` runtime contract profile — without requiring byte-identity, item-partition identity, or state-name identity; whereas where the profiles differ, no exact boundary matches, multiple unmarked boundaries match, a marker conflicts with the driven or callable boundary, or a required member or composed port is missing or non-callable it shall report that incompatibility, and where no produced output exists it shall skip with a notice instead of failing.

### VERIFY-11
Verifies: [VERIFY-1](../dev/verification.md#verify-1), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-6](../dev/verification.md#verify-6), [VERIFY-10](../dev/verification.md#verify-10)

Where synthetic artifacts contain distinct direct-Captain and delegated-player leaves, nested parallel regions whose public parent alone is root-jumpable, public metadata ids distinct from config keys while matching explicit state ids, multiple branch-local Boss waits, a guarded parallel join, a literal nested-playbook actor, and a dynamic nested-playbook actor with named target and text context, when the conformance, introspection, coverage, and runtime-profile checks run, the checks shall traverse every stable nested leaf without a missing-state false finding, retain the existing flat representation for a flat control fixture, reject actor-kind swaps and dynamic metadata or sentinel-wiring drift, leave an unknown question id parked, prevent a blank reply from resuming the acting agent, address only the selected pending question, exercise reachable join arms under bounded probing, synthesize structured Captain delegation output against an exact enabled catalog, enter a dynamic child through the assigning Captain transition, evaluate nested input against initialized or transition-produced context, drive every satisfiable nested `onDone` and `onError` arm independently, avoid generic interrupt findings for valid dynamic-call and final-state preconditions, distinguish unmarked strict `legacy` and `session-v1` boundaries, recognize matching `legacy`, `session-v1`, and resumable six-port `composed-v2` runtime pairs, reject every mixed pair and inconsistent marker, key literal nested content by target playbook id, and key dynamic nested content by its context metadata.

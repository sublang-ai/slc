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
artifacts (`code.gears.md`, `code.fsm`, and the linked `code.playbook` module).

## Checks against the reference

### VERIFY-7
Verifies: [VERIFY-1](../dev/verification.md#verify-1), [VERIFY-3](../dev/verification.md#verify-3), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-5](../dev/verification.md#verify-5), [VERIFY-6](../dev/verification.md#verify-6)

Where the installed `@sublang/playbook` provides the manual reference artifacts, when the conformance, introspection, prompt-contract, and transition-coverage checks run over the reference `gears`, `fsm`, and linked composer, each shall report no finding; whereas when a drift is injected — an inserted, deleted, split, or reordered prompt-body segment, a dropped nested leaf, a mis-bound player or child playbook, a missing or mismatched explicit/public state id, a missing `needsBossReply` result, a changed hierarchy, type, tag, join, or local wait, a machine no longer matching its pinned topology, a mutated composed prompt, or an unreachable transition arm — the corresponding check shall report it.

## Emission

### VERIFY-8
Verifies: [VERIFY-2](../dev/verification.md#verify-2), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-5](../dev/verification.md#verify-5), [VERIFY-6](../dev/verification.md#verify-6)

Where a reserved pipeline's faked agents produce a conformant `gears` and `fsm` pair at their canonical locations, when a full run succeeds, the slc command shall emit the conformance, introspection, prompt-contract, and coverage tests beside the artifacts and list them among the outputs; whereas where the produced `fsm` cannot be imported for derivation, the slc command shall emit the conformance test only, report a diagnostic per degraded test, and leave the run successful.

## Reference equivalence

### VERIFY-9
Verifies: [COMPILE-1](../user/compiler.md#compile-1), [SELFHOST-6](../dev/self-hosting.md#selfhost-6), [VERIFY-1](../dev/verification.md#verify-1), [VERIFY-10](../dev/verification.md#verify-10)

Where `slc playbook` output for the reference workflow exists, when the equivalence harness compares it to the manual reference package, the harness shall accept exactly when the compilations are equivalent — the same actor bindings and target playbook ids, the same verbatim per-actor prompt or child-input line sets, each flat or structured `fsm` conformant to its own `gears` with recursive Boss surfaces declared and its transitions reachable, and each linked module honoring the same exactly probed `legacy`, `session-v1`, or `composed-v2` runtime contract profile — without requiring byte-identity, item-partition identity, or state-name identity; whereas where the profiles differ, no exact boundary matches, multiple unmarked boundaries match, a marker conflicts with the driven or callable boundary, or a required member is missing or non-callable it shall report that incompatibility, and where no produced output exists it shall skip with a notice instead of failing.

### VERIFY-11
Verifies: [VERIFY-1](../dev/verification.md#verify-1), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-6](../dev/verification.md#verify-6), [VERIFY-10](../dev/verification.md#verify-10)

Where synthetic artifacts contain nested parallel regions, public metadata ids distinct from config keys while matching explicit state ids, multiple branch-local Boss waits, a guarded parallel join, and a nested-playbook actor, when the conformance, introspection, coverage, and runtime-profile checks run, the checks shall traverse every stable nested leaf without a missing-state false finding, retain the existing flat representation for a flat control fixture, leave an unknown question id parked, prevent a blank reply from resuming the Captain, address only the selected pending question, exercise reachable join arms under bounded probing, distinguish unmarked strict `legacy` and `session-v1` boundaries, recognize matching `legacy`, `session-v1`, and resumable `composed-v2` runtime pairs, reject every mixed pair and inconsistent marker, key nested prompt content by target playbook id, and report nested-playbook coverage that cannot yet be driven as explicitly unsupported rather than silently covered.

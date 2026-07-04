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

Where the installed `@sublang/playbook` provides the manual reference artifacts, when the conformance, introspection, prompt-contract, and transition-coverage checks run over the reference `gears`, `fsm`, and linked composer, each shall report no finding; whereas when a drift is injected — a changed prompt body, a dropped state, a mis-bound player, a missing `needsBossReply` result, a machine no longer matching its pinned topology, a mutated composed prompt, or an unreachable transition arm — the corresponding check shall report it.

## Emission

### VERIFY-8
Verifies: [VERIFY-2](../dev/verification.md#verify-2), [VERIFY-4](../dev/verification.md#verify-4), [VERIFY-5](../dev/verification.md#verify-5), [VERIFY-6](../dev/verification.md#verify-6)

Where a reserved pipeline's faked agents produce a conformant `gears` and `fsm` pair at their canonical locations, when a full run succeeds, the slc command shall emit the conformance, introspection, prompt-contract, and coverage tests beside the artifacts and list them among the outputs; whereas where the produced `fsm` cannot be imported for derivation, the slc command shall emit the conformance test only, report a diagnostic per degraded test, and leave the run successful.

## Reference equivalence

### VERIFY-9
Verifies: [COMPILE-1](../user/compiler.md#compile-1), [SELFHOST-6](../dev/self-hosting.md#selfhost-6), [VERIFY-1](../dev/verification.md#verify-1)

Where `slc playbook` output for the reference workflow exists, when the equivalence harness compares it to the manual reference package, the harness shall accept exactly when the compilations are equivalent — the same player set, the same verbatim per-player prompt-line sets, each `fsm` conformant to its own `gears` with the Boss surfaces declared and its transitions reachable, and each linked module honoring the `createPlaybookRuntime` contract — without requiring byte-identity, item-partition identity, or state-name identity; whereas where no produced output exists, the harness shall skip with a notice instead of failing.

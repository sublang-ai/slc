<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-040: Current Dependency Baseline

## Status

Completed

## Intent

Adopt current published dependencies before the comprehensive performance and clarification experiments, preserving the compiler's required programmatic APIs and reviewed artifact contracts.

## Deliverables

- [x] Registry-audited runtime, provider SDK, and development dependency updates.
- [x] Reviewed Spex grammar and Playbook definition adoption with current pins.
- [x] A supported TypeScript CLI and programmatic API arrangement.
- [x] Passing release checks and an immutable experiment baseline.

## Tasks

1. [x] Review dependency changes and update the manifest and lockfile.
2. [x] Reconcile installed definitions, grammar inputs, retained artifacts, and pins under [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md).
3. [x] Run the complete release checks, update affected reproduction guidance, and freeze the validated baseline.

## Verification

- Record exact registry versions and intentional compatibility constraints rather than equating a dist-tag with an unconditional migration.
- Preserve TypeScript APIs used for AST inspection, emission, and standalone FSM checking; verify the native build command independently of executable-name collisions.
- Keep this repository's spec-authoring law unchanged while separately reviewing the installed Spex semantic grammar.
- Verify installed Playbook ABI/schema, byte-identical definitions, generated suites and independent contracts, both reference demos, reproducible pins, and production package smoke.
- Rebuild a reviewed artifact only if its retention checks fail; retain the evidence and explain any compatibility-driven exception.

The validated dependency adoption is committed at `84b80bb`; the isolated compiler and exact dependency inventories are recorded in `docs/performance/complex-workflows-2026-09-12.json`.
Both ordinary execution strategies were verified before real provider cases began.

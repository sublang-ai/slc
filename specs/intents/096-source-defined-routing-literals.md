<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-096: Source-Defined Routing Literals

## Status

Implemented and independently reviewed; deterministic verification passed; integration pending.

## Intent

Discover lawful long helper-bound routing identifiers from the artifact source without changing bounded reachability proof.

## Deliverables

- [x] Specify finite source-literal discovery without an arbitrary identifier-length cutoff.
- [x] Remove only the length filter while retaining identifier shape and source ordering.
- [x] Verify real entry-to-child paths and meaningful refusal controls under unchanged limits.

## Tasks

1. Correct candidate discovery and retain actual ordered replay in the public verifier.

## Verification

Real XState child-chain integration covers short and long helper-bound public entry values, including 32/33-character boundary cases and incidental hash-like source identifiers, while retaining rejected, shadowed and impossible-context refusals [[verification-44](../packages/verification.md#verification-44)].
The retained parent comparison rejects the long route while its short control passes.
The exact identifier-filter correction accepts the long route and preserves rejected-entry, ordered-shadowing and impossible-context controls.
Eight new integration cases pass; the complete deterministic suite passes 1,798 tests across 83 files with two existing skips.
Build, changed-source lint, scoped formatting and diff checks pass.
Sparse spec lint retains exactly 15 missing protected-target citations and no warnings; this is not a complete spec-lint pass.
The expanded finite candidate pool may consume existing budgets; no exhaustive reachability or constant-cost guarantee is introduced.
No compiler, package release or workflow acceptance follows from these mechanical checks.

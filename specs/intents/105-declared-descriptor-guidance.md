<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-105: Declared Descriptor Guidance

## Status

Implemented and focused checks completed; pending independent review and integration.

## Intent

Guide complete declared acting results from eligible own data descriptor reads without changing their schema, accepted predicates or finite search limits.

## Deliverables

- [x] Eligible descriptor guidance preserving earlier unresolved fields across assigned-field reads.
- [x] Public integration coverage for copied descriptor values, concrete execution and contradictory refusal.

## Tasks

1. Extend declared-field nomination to own data descriptors and verify concrete public replay and retained bounded refusal behavior.

## Verification

- The new public integration file passed three tests: independent two-invocation concrete execution, copied descriptor fields matching actual predecessor context with a distinct report revision, and contradictory-equality refusal.
- Existing paired-search, reached-value-priority and coverage-budget files passed all 61 tests, including required-null, genuine-null, mixed-value refusal, shared limits, cancellation and emitted-support controls.
- A name-filtered existing coverage run passed 33 declared-placeholder, descriptor, reached-value and successive-canonical-question cases; 237 unrelated cases were skipped.
- The isolated TypeScript build and focused ESLint and formatting checks passed.
- Spec lint reports the known 15 unavailable-reference errors and zero warnings; the unavailable specification body remains excluded.
- No full suite, release gate, live compilation or model-backed acceptance was run.

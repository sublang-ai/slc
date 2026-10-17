<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-070: Nested Child Relay Scalars

## Status

Completed (2026-10-17).

## Intent

Observe literal-child scalar dataflow through initialized plain records without replacing their shape or guessing placeholder mappings.
Keep unknown composition and incomplete multiline quotation refused.

## Deliverables

- [x] Clarify nested scalar observation and bounded record traversal.
- [x] Implement the literal-child-only correction with real conformance and XState progression coverage.
- [x] Complete model-free checks and independently review the patch.

## Tasks

1. Correct nested scalar observation and verify preserved record shape, complete literal quotation and fail-closed boundaries.

## Verification

Public conformance and real XState predecessor-to-child progression exercise initially absent record scalars with unrelated placeholder names.
Distinct literal and multiline payloads retain blank-line quote markers, while malformed composers and unprovable record access remain refused.
The original T04 artifact remains unchanged and must still fail its independent blank-line quotation defect.

The affected conformance and producer/consumer integration suites passed all 240 cases, including the ten new nested-scalar cases.
The TypeScript build, ESLint, changed-file formatting and Spex 3.0.0 spec lint passed; independent production review found no blocking issue.
Public conformance over the unchanged external T04 FSM and GEARS now rejects both child calls for incomplete quoted continuation lines, with all protected input hashes unchanged.
No provider call or compilation of that external artifact was run.

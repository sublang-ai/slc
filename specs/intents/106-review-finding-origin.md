<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-106: Review Finding Origin

## Status

Implementation and focused verification complete; independent review pending.

## Intent

Report the actual origin of final compilation findings while preserving the shared three-checking-round and two-correction budget.

## Deliverables

- [x] Distinguish mechanical findings from model Reviewer findings in terminal diagnostics and explicit correction transcripts.
- [x] Preserve existing findings, latest usable Coder result, role tokens and fail-closed behavior.
- [x] Verify configured all-mechanical, independent Reviewer and mixed-round integration flows.

## Tasks

1. Update the reviewed compilation contract and bounded wrapper wording.
2. Extend the existing protocol integration matrix and record observed verification.

## Verification

The focused reviewed-compilation protocol suite passed all 54 tests, including configured all-mechanical rounds without Reviewer construction or calls, actual Reviewer failures, and mixed rounds ending in either origin.
Build, changed TypeScript ESLint, formatting and whitespace checks passed.
Sparse spec lint remains qualified by the deliberately excluded completion package references; it is not a full lint pass.
No model, workshop compiler or workflow execution is part of this change.

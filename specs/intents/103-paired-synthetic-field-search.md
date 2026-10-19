<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-103: Paired Synthetic-Field Search

## Status

Implemented and locally verified; pending integration review.

## Intent

Improve bounded raw-child output exploration while retaining null-valued candidates and existing acceptance semantics.

## Deliverables

- [x] Resumable paired traversal within the existing probe and context-guidance bounds.
- [x] Public-entry integration coverage for both value orders and retained refusal behavior.

## Tasks

1. Implement paired synthetic-field exploration and verify its public acceptance, refusal and resource-bound cases.

## Verification

- Both initial PR CI runs failed the existing expanded-policy actor-cleanup test before its root callback started: the expected deadline was reported at 106–108 ms, before its 150 ms callback loop could run.
- That test now advances a scoped monotonic clock only inside the real callback, preserving the 100 ms caller deadline, positive starts and equal stops, with clock restoration in `finally`; real-time finite synchronous cleanup coverage remains unchanged.
- After that correction, one focused invocation passed all 328 tests across `coverage-budget.test.ts`, `verify-coverage-paired.test.ts` and `verify-coverage.test.ts`; no full local suite or release-gate rerun was performed.
- The public paired-search integration file passes all nine tests, including broad-pool nonblank and required-null outputs, preserved fixed null context during paired discovery, partial shapes, retained bounded mixed-value refusal, impossible and shadowed arms, and cancellation before and during search.
- Before the CI timing correction, the initial candidate's full local suite passed 1,893 tests in 89 files, with two skips; the subsequent fixed-null fixture strengthening passed the final nine-test focused rerun without repeating the full suite.
- Before the CI timing correction, all ten standard local release gates passed for the initial candidate, including the unmodified installed-package check.
- Spec lint retains the known 15 unavailable-reference errors and zero warnings; no unavailable specification body was read.

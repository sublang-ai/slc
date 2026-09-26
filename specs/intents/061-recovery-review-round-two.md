<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-061: Recovery review, round two

## Status

Completed on `codex/captain-recovery`; not merged.

## Intent

Close the SLC parts of review items 12 and 22 without changing the already-correct controller recognition code.

## Deliverables

- [x] State that DR-053 amends DR-024, including the map entry (item 12).
- [x] Exclude valid controller domains from the near-miss rule (item 22).
- [x] Assert both complete expected domains and suppression of unrelated wait and interrupt findings (item 22).

## Tasks

1. Accept both findings, align the specifications and tests, and make one new review-fix commit with coder and reviewer credit.

## Verification

- `vitest run test/verify.test.ts test/verify-coverage.test.ts`: 330 passed.
- ESLint on both changed tests: passed.
- `spex lint`: 0 errors, 1 sentence warning in verification-11; its two statements cover the same controller-case matrix.
- No SLC build was repeated: implementation and build inputs did not change.
- No findings were rejected; the other round-two findings belong to Playbook.
- Coder: GPT-6 Astra; reviewer: Claude Opus 5.5.

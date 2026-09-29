<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-060: Recovery review fixes

## Status

Complete.

## Intent

Make malformed recovery-controller diagnostics name the expected action set.

## Deliverables

- [x] One shared diagnostic domain in conformance and coverage checks.
- [x] Both domains checked, with specifications and decision history aligned.

## Tasks

1. Fix the diagnostic and its integration evidence in one review-fix commit.

## Verification

Run the changed conformance and coverage suites, build and lint the changed files, and lint specifications.
Credit Coder GPT-6 Astra and Reviewer Claude Opus 5.5.

Results: 330 conformance and coverage tests passed; build, ESLint and specification lint passed.
Formatting was checked and corrected in the three changed TypeScript files.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-082: Successive Canonical Question Replay

## Status

Complete.

## Intent

Permit a finite sequence of actual canonical question and reply revisits within the existing coverage budgets.
Keep ordinary invocation cycles unsupported and retain reached-question validation.

## Deliverables

- [x] Specify successive revisits within unchanged depth, attempt and deadline limits.
- [x] Replay each actual wait and addressed nonblank reply without context injection.
- [x] Verify multiple replies, malformed and blank continuations, and depth exhaustion through real XState execution.

## Tasks

1. Remove the global one-question restriction, share bounded replay with guarded preemptive outcomes, and prioritize reached-target continuations while retaining ordinary cycle exclusion.

## Verification

The affected transition-coverage and retained-completion suites pass 227 cases; all 12 focused sequence, target, cycle and budget cases pass.
The branching-predecessor regression fails without target-local continuation priority and passes with it.
The complete integration checkout passes specification validation, build, lint, formatting, definitions, release, artifact, pin and demo checks, plus 1,696 tests with two skips.
The installed-package consumer and benchmark fixture were aligned with the current configured-option contract and their affected checks pass.

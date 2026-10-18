<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-091: Prompt Substitution Positions

## Status

Completed.

## Intent

Avoid rejecting a faithful linked prompt when a populated quoted relay and an absent optional relay share the same line shape.
Use the complete ordered body to distinguish their positions while retaining body-drift findings.

## Deliverables

- [x] Clarify positional substitution evidence.
- [x] Prefer the complete body match over unrelated line matches.
- [x] Verify faithful composition and mutation refusal through the public linked-module gate.

## Tasks

1. Bind derived substitutions to their positions in the complete prompt body.

## Verification

The linked-module integration regression first reproduced the positional false finding against the parent implementation. All eleven repository gates pass with the fix, including 1,732 tests and two existing skips. The focused prompt checks pass 48 cases; literal deletion, reordering, and absent-placeholder deletion still produce body findings. An independent review found no issues. A pure recheck of the original failing generated module removes its two false body findings while preserving every artifact byte; this is checker evidence, not compiler acceptance or workflow completion.

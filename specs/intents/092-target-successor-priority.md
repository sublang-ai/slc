<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-092: Target Successor Priority

## Status

Implemented; repository release checks passed. Full spec-lint verification remains limited by excluded protected content.

## Intent

A bounded search can discover a valid next invocation into its audited target but exhaust its attempt budget while that path waits behind unrelated prefixes.
Replay discovered target successors promptly without changing the acceptance rules or search limits.

## Deliverables

- [x] Specify target-successor scheduling and preserved replay requirements.
- [x] Prioritize target successors while retaining candidate order.
- [x] Verify real target reachability and refusal controls.

## Tasks

1. Prioritize discovered target successors within the existing bounded search.

## Verification

The parent checker rejects the four-child-prefix target fixture with five attempt-budget findings; target priority accepts it through real question/reply and transition replay.
Five new focused cases and three existing question-path cases pass, including later-alternative eligibility, ordered shadowing and escaped-target refusals, and an explicit stronger case that still exhausts the unchanged budget.
Build, lint and formatting pass; sparse spec lint reports 15missing protected-spec citation targets and no other errors. The protected body was not accessed, so this is not a full spec-lint pass.
One public comparison on the unchanged retained failing artifact removes its eight findings; this is checker evidence, not compiler acceptance or workflow delivery.

The first full repository run retained one failing historical expectation: its fixture had expected pull-request entry exhaustion that the scheduling change now resolves.
The unchanged parent has that fixture's separate code-arm exhaustion plus six pull-request findings; the candidate retains the original code finding and observes actual pull-request completion through the alternate public route with branch and code evidence.
The targeted expectation now asserts both the newly reached completion and the remaining bound instead of treating the entire fixture as covered; the original full-run failure remains preserved.
The corrected fixture and three exhaustion controls pass targeted verification. The subsequent complete release check passes 1,737 tests with two existing skips, formatting, lint, build, definition/release/artifact/pin/demo checks and package smoke; the separate CI-contract check also passes.

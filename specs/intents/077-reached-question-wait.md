<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-077: Reached Question Wait

## Status

Complete.

## Intent

Entry actions can change which ordered completion arm accepts a question result.
Identify the wait from the actual invocation transition instead of the fallback selected under initialized context, preserving canonical question binding, declared targets and reply checks.

## Deliverables

- [x] Specify actual completion evidence for the reached question wait.
- [x] Match the invocation source, completion event and declared wait target.
- [x] Verify real XState entry-action coverage and retained question refusals.

## Tasks

1. Validate the question wait selected after actual entry actions.

## Verification

A retained-artifact diagnostic observes a valid canonical question at the actual wait while the checker expects an initialized-context fallback target.
The unchanged parent fails the real XState entry-action case with a false wait refusal and two unproved resumed arms.
The correction passes all 11 focused cases and all 210 affected coverage and completion cases; build, lint and formatting pass.
An initial implementation looked for the completion before a dynamic predecessor had finished; the failed 209-pass/1-failure result is retained, and the existing bounded question settle now requires that completion before resolving its target.
The complete integration checkout passes spec validation and all repository gates, including 1,668 tests with two existing skips across 81 files, both language demos and the installed-package smoke.
The sparse checkout’s 15 missing-target diagnostics remain preserved as a separate environment limitation.

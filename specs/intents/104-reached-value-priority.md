<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-104: Reached-Value Priority

## Status

Implemented and focused checks completed; pending independent review and integration.

## Intent

Try newly observed bounded reached-context values before the remaining static child-output candidates without changing acceptance or search limits.

## Deliverables

- [x] Lazy bounded reached-value priority with preserved baseline and declared-result guidance.
- [x] Public-entry equality regression and contradictory-equality refusal with retained paired-search controls.

## Tasks

1. Amend candidate iteration and verify public replay, refusal and existing finite-budget behavior.

## Verification

- The new public-entry integration file passes all three tests: independent two-invocation concrete execution, exact Boolean-and-revision output matching actual predecessor context amid 144 unrelated candidates, and contradictory-equality refusal.
- The existing paired-search, coverage-budget and coverage suites passed 327 of 328 tests on the first isolated run; the emitted-support case failed because the isolated checkout had not yet been built.
- After building the isolated TypeScript output, that one affected emitted-support case passed; the other 327 cases were not repeated.
- Source type checking, focused ESLint and focused formatting checks passed.
- Spec lint reports the existing 15 unavailable-reference errors and zero warnings; the unavailable specification body remains excluded.
- No full suite, release gate, live compilation or model-backed acceptance was run.

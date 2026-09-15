<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-047: Static Child Coverage Through Actual Entry

## Status

Completed.

## Intent

Correct coverage findings caused by probing non-jumpable child states without the context their preceding acting transitions produce.

## Deliverables

- [x] Bounded actual-entry coverage for static and dynamic child calls.
- [x] Integration positives and dead-route, shadowed-arm and input-failure controls.
- [x] Unchanged CKr2Ni replay with historical evidence preserved.

## Tasks

1. Specify and implement reached-context child probing with finite predecessor and timeout accounting.
2. Validate integration cases and replay the immutable generated counterexample without waiving its separate semantic failure.

## Verification

- All 83 coverage integration tests pass, including distinct actual predecessor results, an initially active non-jumpable child, dead and shadowed routes, and real input failures.
- Build, project type checking, changed-file ESLint/format and global Spex 3 lint pass.
- `/private/tmp/slc-CKr2Ni-coverage-audit/corrected-evidence.json` records the unchanged generated FSM's ten original coverage findings becoming none in 1,264.986 ms; all 21 artifact/support files, original summary and diagnostics remain identical.
- The original real-XState counterexamples and separate canonical failure-terminal misclassification remain in adjacent immutable `evidence.json`; this correction grants no full compilation or semantic acceptance.
- The combined-suite attempt ran 848 tests successfully with two skips, while 15 suites could not load a concurrently authored entry-options module's not-yet-corrected import; final repository validation is deferred to the coordinated freeze of that separate change and does not replace this checkpoint's focused evidence.
- Maintained DEV's no-preemption selection and preceding-child paths are explicitly outside this one-hop checkpoint; its old empty finding list does not establish child coverage.

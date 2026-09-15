<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-049: Non-Preemptive Child-Chain Coverage

## Status

Completed.

## Intent

Replace vacuous actor and child acceptance in non-preemptive workflows with bounded actual-path coverage, including children reached through preceding children and one canonical question/reply revisit.

## Deliverables

- [x] Bounded path replay independent of root preemption.
- [x] DEV-like branch, decision, coding and pull-request chain integration with strict negative controls.
- [x] Explicit cycle, unsupported-path and budget exhaustion findings.
- [x] Unchanged maintained DEV readiness evidence, distinguished from generated-artifact acceptance.

## Tasks

1. Specify and implement finite actor/child path replay with route, shape, failure and exhaustion controls and immutable fixture readiness.

## Verification

- `test/verify-coverage.test.ts`: 89 integration and existing verification cases passed, including real question/reply revisit, dead and repeated paths, accessor/property preservation, and the five-minute generated-test ceiling.
- The explicit depth/attempt exhaustion case completed in 259 milliseconds; it preserves findings rather than treating bounded search as a semantic proof.
- `/private/tmp/slc-IR049-path-probe/final-evidence.json` records unchanged maintained DEV coverage in 11.237 seconds, generated CKr2Ni coverage in 1.135 seconds, and maintained CODE coverage in 2.853 seconds, with actual actor/child target-entry counters and protected file hashes. These are checker-readiness results, not new generated-workflow acceptance.
- Per-probe descriptor snapshots reduced the unchanged DEV check from 17.026 to 11.362 seconds in the focused local comparison; fresh objects and accessor, symbol, prototype and data-property semantics remain covered.
- `/private/tmp/slc-IR049-path-probe/capped/policy-evidence.json` and its adjacent generated test/report verify the actual emitted maintained DEV coverage test using the final 300,000-millisecond cap; CODE and CKr2Ni receive the same ceiling, while smaller computed deadlines remain smaller.
- The earlier uncapped scheduling estimates are preserved only as diagnostic evidence; final emitted tests use the five-minute execution deadline, and the benchmark independently terminates validation children at its whole-experiment deadline. No timeout becomes a source-clarification or unsatisfiable-arm finding.
- Three reference-equivalence cases now execute real CODE coverage twice, taking 5.76–5.88 seconds locally; their deadlines derive from twice the actual reference coverage budget with the same five-minute ceiling, preserving all checks and assertions rather than relying on the old five-second default.
- The maintained CODE coverage case also uses its actual derived deadline; the complete repository suite passes 1,381 tests with two skips across 73 files after the four deadline corrections, with assertions unchanged.
- The shared build, formatting, ESLint and Spex 3.0.0 lint pass; no live provider or maintained artifact edit was used for this intent.

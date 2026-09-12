<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-030: Faithful Transition-Coverage Probes

## Status

Complete

## Intent

Remove the measured script-fallback false finding while detecting guards satisfied only by impossible script outputs.

## Deliverables

- [x] Ordered fallback acceptance and runtime-faithful script probes.
- [x] Regression matrix and unchanged-artifact replay evidence.

## Tasks

1. [x] Specify and implement faithful coverage probes, exercise valid and invalid machines, and replay the measured artifact.
2. [x] Share the bounded valid-output candidates between result acceptance and arm auditing, and verify an exit-status-two route through real XState.

## Verification

- The unchanged `compile-hmOuZA` FSM reaches `runTask` for `{ guard: 'ok', exitStatus: 0 }` and `failed` for `{ guard: 'failed', exitStatus: 1 }`, while the old checker rejects the latter in 25.76 ms.
- Run the coverage and verification suites, TypeScript, focused lint, formatting, and Spex 3 lint.
- Retain reproducible local replay evidence without modifying the measured FSM or linked artifact.

The corrected checker reports no finding in 26.01 ms on that same FSM; hashes confirm the FSM and linked module were unchanged.
Replay files are `/private/tmp/slc-coverage-fallback-probe.mjs`, `/private/tmp/slc-coverage-fallback-before.json`, and `/private/tmp/slc-coverage-fallback-after.json`.
Passed 220 tests across the coverage, verification, and early-conformance suites; TypeScript, ESLint, Prettier, and Spex 3 lint also passed.
Passed the complete repository suite: 1,215 tests across 67 files, with two intentional skips.
An independent follow-up reproduced a reachable exit-status-two failure route rejected by acceptance's fixed status-one probe; sharing the bounded valid candidates corrected the finding and the checker drove the accepted status-two output through the actual machine.
An additional real-machine regression with ten status-specific failure arms exposed three false findings when a global candidate cap hid later arm constants; the shared candidate helper now applies the cap separately per arm and the driver deduplicates only accepted candidates.
Passed all 76 coverage tests after those corrections, including impossible status/payload pairs, missing routes, shadowed arms, controller distinctness, and retained-reference coverage.

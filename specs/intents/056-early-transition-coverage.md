<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-056: Early Transition Coverage

## Status

Complete.

## Intent

Reject or repair generated transition-coverage defects before linking, preserving exact coverage verdicts and safe cancellation.

## Deliverables

- [x] Cooperative coverage lifetime and protected producer/consumer gates.
- [x] Real-machine boundary, cancellation and cleanup integration evidence.
- [x] Unchanged C7 retrospective verdict and package verification.

## Tasks

1. [x] Specify and implement early exact coverage with cooperative cancellation, verify real compiler and checker lifetimes, and record the preserved C7 comparison.

## Verification

- The final full four-worker integration/system suite passed 1,417 tests with two expected skips across 75 files in 43.30 seconds; `/private/tmp/slc-ir056-postrestore-full.log` and `/private/tmp/slc-ir056-postrestore-full.json` preserve the result and unchanged runtime/fixture inputs.
- The installed Playbook definition remained SHA-256 `48a6a5d3f02a1d90dcc0883170da74e16c29b1554533913eb4fd7cefc49251bb` before and after both the 18 targeted isolation/provenance tests and the full suite; the fixture's package directory is isolated from the installed dependency tree.
- The exact prior fixture corruption and one-file restoration from immutable C6 are preserved at `/private/tmp/slc-ir056-root-dependency-audit/restore-result.json`; all other 13,312 installed entries and all 13,022 C6 entries were unchanged during restoration.
- The preserved C7 CODE `compile-GQcJFN` retains exactly its original three coverage findings with the new checker in 749 ms, with all 24 artifact files and 11,660 C7 dependency entries unchanged; `/private/tmp/slc-GQcJFN-coverage-audit/ir056-retrospective.json` records the comparison.
- The preserved C7 DEV `compile-wm3i4U` passes the new checker in 5,724 ms with FSM SHA-256 `6df23514ff7e954e0f49eda2967757bf6244bde103d8dac2ab1666ec8cb6994b` unchanged; `/private/tmp/slc-GQcJFN-coverage-audit/ir056-positive-retrospective.json` records the comparison.
- Both retrospectives and the final rebuilt checker use SHA-256 `975e653b71a5a752cc1edf9c73ca5cbf75f6808bb2ef427ae2cc07b261b6cdbb`; these provider-free checks establish verdict preservation, not an end-to-end speed improvement.
- Final scoped ESLint and Prettier, build, global Spex lint, and `git diff --check` pass; `verify:pins` passes with original and resulting pin bytes both SHA-256 `5687d55b28bdd8721f659054d46234c24994521df0bbd1697187ab1781d467dc`; `/private/tmp/slc-ir056-final-static/summary.json` preserves the checks.
- Definition, release-workflow, committed-artifact, English/Chinese demo and installed-package checks all pass; `/private/tmp/slc-ir056-postrestore-checks/summary.json` has SHA-256 `f42a7717516de780f7cc88507676b99ee7ad1ada89f9e16755045a760fe6b3a9`.

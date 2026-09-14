<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-058: Required Child Relay Substitution

## Status

Complete.

## Intent

Reject unresolved explicit child-input relays through the existing conformance boundary while preserving ordinary literal text and runtime payloads.

## Deliverables

- [x] Narrow relay-notation decision and synchronized verification contract.
- [x] Conformance rejection for static, constant-function, and partially substituted required relay slots.
- [x] Integration coverage preserving literal metavariables, repeated mappings, and quoted runtime payloads.
- [x] Immutable real-artifact controls and an accepted corrected CODE compilation with runtime verification.

## Tasks

1. [x] Implement and verify required relay substitution at the existing conformance boundary.
2. [x] Freeze corrected compiler inputs, validate the preserved failing and accepted artifacts, and record the real CODE result.

## Verification

- C8 `compile-pYzD5x` completed the full compiler benchmark in 469379 ms overall and passed eight generated tests, but independent runtime acceptance failed 14 of 18 cases on the missing quoted Original intent relay; the four repository-effect negative controls passed.
- `/private/tmp/slc-c8-pYzD5x-readiness/runtime-source-rejection.json` preserves the superseding source rejection and the original static approval without changing the generated artifact or weakening the runtime oracle.
- The focused composed-child integration group passed 18 cases; the verifier file passed 192 tests, including literal inline-code and escaped-token controls.
- The full suite passed 1421 tests with two expected skips across 75 files under two workers, recorded by `/private/tmp/slc-ir058-full-two-workers.json` with SHA-256 `6c7fd1964ccd4cc28739e48f7ab82f78d31cb6bf04002e4ce1800c9cc05c44f2`.
- An earlier concurrent full run had eight timeout-shaped failures across four files; all 100 tests in those files passed in isolation before the successful complete rerun, with no assertions or timeouts changed.
- `/private/tmp/slc-ir058-real-artifact-control.json` with SHA-256 `95fe7fec22884550ea83d05f03e2836e58a18113c5635307b8cc844035687e9d` records the previous checker accepting preserved `pYzD5x`, the corrected checker rejecting its two unresolved child relays, and both checkers accepting unchanged DEV `wm3i4U`; all 11905 C8 compiler/dependency records and four source artifacts remained unchanged.
- The real-artifact control supplied each FSM's actual exported `concurrentRoleSets`; its initial private attempt omitted that checker option and is preserved separately as a harness setup failure.
- Build, scoped lint, and global Spex validation passed. Historically, C8 `compile-pYzD5x` remains the retained failing artifact for the missing relay. The final accepted C10/v13 phase-chain evidence records the original source, unchanged accepted GEARS, real FSM, real link, normal entry emission, and both matched link arms passing 18 runtime cases.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-081: Fixed Context Payload Padding

## Status

Complete.

## Intent

A child guard may read missing immutable context properties before output cardinality, leaving no assignable output read.
Those context reads must not suppress bounded payload padding or make fixed context mutable.

## Deliverables

- [x] Specify padding eligibility in the presence of fixed context reads.
- [x] Preserve bounded payload guidance after those reads.
- [x] Verify actual reached-context success and original guard refusals.

## Tasks

1. Ignore nonassignable context reads when deciding whether payload padding is needed.

## Verification

A private retained-artifact probe confirms that fixed-context reads suppress guidance despite a valid original predicate; ignoring only those nonassignable reads finds the output in 41 probes and actual XState reaches the declared next child.
The first synthetic fixture pre-discovered all fields and passed unchanged, so it is retained without red-regression credit.
The corrected real-XState fixture reaches its precondition through the public entry transition, fails both three- and four-field success cases on the unchanged parent, and preserves three refusal controls.
All five focused cases and all 223 affected coverage and completion cases pass after the fix, as do build, lint and formatting.
An exact-parent retained-artifact check reduces 49 findings to 22, preserving unproved aborted-child and alternate-entry paths; another artifact's success stays covered while its failure path remains unproved.
The complete checkout passes global spec validation, all 1,681 tests (two existing skips), and all eleven required checks.
The earlier sparse-checkout diagnostics remain preserved as qualified evidence.

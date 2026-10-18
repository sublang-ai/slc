<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-079: Compact Child Error Candidate

## Status

Complete.

## Intent

A raw child output may contain compact normalized error data, but scalar and catalog candidates cannot satisfy that nested contract.
Offer exactly one contract-shaped candidate, verified against the installed public compact-error normalizer, without adding an emitted-checker dependency, general object synthesis or relaxed acceptance.

## Deliverables

- [x] Specify the finite public-contract candidate boundary.
- [x] Add that candidate only to raw-child completion probes.
- [x] Verify actual XState admission and malformed or shadowed refusal controls.

## Tasks

1. Supply the finite compact-error candidate within existing search limits.

## Verification

The unchanged parent rejects the required compact-error child output while three malformed-shape controls retain findings.
The final real-XState test captures the accepted child output and checks its error equals the installed public compact normalizer's result; all five focused cases pass, including optional absence, contradictory cardinality and shadowed-arm controls.
All 218 affected coverage and completion cases pass, as do build, lint and formatting.
An initial helper-import implementation passed but was replaced to preserve emitted checkers' existing dependency boundary; its evidence is retained.
The unchanged retained-artifact check removes only the nested compact-error finding, reducing three findings to two; both bounded delivery replay findings remain unproved.
The complete checkout passes global spec validation, all 1,676 tests (two existing skips), and all eleven required checks.
The earlier sparse-checkout diagnostics remain preserved as qualified evidence.

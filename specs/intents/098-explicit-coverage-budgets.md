<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-098: Explicit Finite Coverage Budgets

## Status

Implemented and locally verified; remote integration is pending.

## Intent

Support larger legitimate workflows with explicit finite exploration limits without treating exhausted search as semantic impossibility or accepting unverified paths.

## Deliverables

- [x] Validated API and CLI configuration with unchanged 8/64 defaults and 64/1024 caps.
- [x] Consistent producer, consumer, completion and emitted-test propagation; unchanged five-minute deadline and historical reuse semantics.
- [x] Real public-entry integration evidence for larger paths, finite queue exploration, invalid inputs and negative controls.

## Tasks

1. Specify and implement bounded configuration, propagate it through all existing verification boundaries, and test actual replay and compatibility.

## Verification

The full deterministic suite passes 1,834 tests with two existing skips across 85 files. Build, full lint, formatting, lazy preflight ordering, actual portable emitted suites, current-policy auxiliary restoration and unchanged model-call/history evidence pass. The initial lazy-dependency regression and stale emitted-template expectation remain recorded as failed runs before their corrections.

A real ten-invocation path requires an explicit sufficient depth; a competing-prefix fixture fails at 64 attempts and passes at 256 and 1024. A separate many-result ten-child fixture still exhausts 1024 attempts, so configurable bounds do not promise complete search or establish a team workflow outcome.

Specification lint retains exactly the 15 known missing protected-target diagnostics and no warnings in this sparse checkout; the excluded document is neither read nor restored. Repository definition, artifact, pin, English and Chinese demo, package, CI-workflow and release-workflow checks pass.

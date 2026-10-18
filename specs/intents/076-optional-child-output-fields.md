<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-076: Optional Child Output Fields

## Status

Completed.

## Intent

Bounded child-output probing must not force an observed optional own field to exist or omit a boolean value merely because its predicate is inside a helper.
Keep seed descriptors, fixed reached context, four-field search, probe and replay bounds, concrete ordered guards and actual targets unchanged.
Nested object synthesis and question-history gaps remain outside this intent.

## Deliverables

- [x] Specify bounded observed-field absence/presence alternatives and both boolean candidates.
- [x] Implement the narrow search correction without increasing existing limits.
- [x] Verify actual XState positives, adversarial controls and affected gates.

## Tasks

1. Preserve optional child-output absence while guiding bounded values.

## Verification

The causal diagnostic proves valid error-absent child outputs reach their declared target, while current shape enrichment adds the optional field and prevents admission.
An independent hidden-false control fails until that primitive is available as a candidate; the true control already passes.
The unchanged parent fails the hidden-false and optional-absence integration cases while the true control passes.
The correction passes all five focused cases and all 206 affected coverage and completion cases, including contradictory count, shadowed-arm and required nested-error controls.
Build, lint and formatting pass.
The initial implementation allowed value guidance to reintroduce a selected absent field; the failed focused result is retained and absence is now fixed within each shape.
A retained artifact still has five findings; this correction does not establish complete artifact admission.
The complete checkout passes global spec lint, 1,664 tests with two existing skips, build, lint, formatting, definitions, release, artifact and pin verification, both demo checks and package smoke.
The earlier sparse-checkout result remains qualified by 15 missing-target diagnostics; the complete validation closes that gate.

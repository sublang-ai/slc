<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-087: Declared Acting Result Values

## Status

Implemented.

## Intent

A declared acting result can contain more fields than the variable-field bound while requiring only one generated value to match real reached context.
Preserve its complete declared seed and guide only eligible placeholder values without widening the search or altering context.

## Deliverables

- [x] Specify bounded declared-value guidance and actual-target acceptance.
- [x] Implement lazy guidance within the existing probe and override limits.
- [x] Verify real reached targets and negative controls with isolated dependencies.

## Tasks

1. Preserve declared acting-result schemas while probing reached-value equality.

## Verification

On the unchanged parent, the two intended real-target regressions fail while six refusal controls pass.
All eight focused cases and all 250 affected coverage and completion tests pass with guidance; build, lint and formatting pass.
A single changed-checker comparison on an unchanged retained artifact clears its last delivery-success finding while preserving the source and actual ordered target requirement.
That comparison follows an intervening child-guidance change, so the generic red/green and exact reached-value witness provide the intent-specific causal evidence; checker acceptance alone does not establish compiler acceptance or workflow delivery.
Independent review found no acceptance, context or budget blocker and prompted an explicit nonempty-string qualification matching the implementation.
The combined integration checkout passes global spec validation, all 1,713 tests with two skips, and all release checks including the installed-package smoke.

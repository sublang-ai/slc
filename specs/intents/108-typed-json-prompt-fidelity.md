<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-108: Typed JSON Prompt Fidelity

## Status

Implemented and locally verified; independent review complete.

## Intent

Accept exact canonical JSON prompt substitutions from actual typed inputs without weakening whole-template fidelity or coercing their shapes.

## Deliverables

- [x] Specify finite descriptor-safe typed JSON evidence and repeated-token consistency.
- [x] Share that evidence across the live link gate, continuation and literal probes, and emitted suites.
- [x] Verify generic public module/FSM and emitted-suite positive and refusal cases.
- [x] Complete affected local checks and independent review.

## Tasks

1. Implement and verify typed JSON composition evidence while retaining existing scalar, quote, absence and identity checks.

## Verification

The independently preserved generic public-gate witness refused three canonical typed JSON cases despite fixed output goldens; malformed output also refused.
Historical failed compiler output was not retained, so this product defect does not prove that earlier actor’s reported cause.
The affected public/emitted integration checks passed 272 tests across five files; the separately materialized, byte-exact existing topology suite passed 20 tests. Build/type checking, changed-file lint, format and whitespace checks passed. Spec lint retains 15 known excluded-reference errors and zero warnings, so it is not a full spec-lint pass. The expanded new file then passed 24 tests, including literal/factory initial-context accessor acceptance and refusal with zero hook calls; the resulting unique affected coverage is 296 tests across six files, not the sum of repeated cases. Independent review found no material issues.
No compiler, model, native or workflow acceptance follows from this repair.

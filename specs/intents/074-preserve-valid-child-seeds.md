<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-074: Preserve Valid Child Seeds

## Status

Completed (2026-10-17).

## Intent

Shape discovery can turn an absent optional field into a null field before evaluating an already valid native child seed.
Test the original seed first without changing ordered guard acceptance, actual replay or probe limits.

## Deliverables

- [x] Specify unmodified-seed precedence before shape enrichment.
- [x] Restore accepted native seeds without weakening malformed or shadowed refusal.
- [x] Verify the real XState regression, adversarial controls and affected gates.

## Tasks

1. Preserve valid original child seeds before bounded shape discovery.

## Verification

An isolated public real XState reproduction passes on the former checker and fails after shape discovery enriches an absent optional error field.
The new integration case fails on the unchanged parent and passes with the seed-first check; contradictory count and shadowed-arm controls remain refused.
All 203 affected coverage and completion cases pass, as do build, lint and changed-file formatting.
Complete-checkout spec validation, all 1,659 full-suite cases with two existing skips, lint, formatting, package smoke, definitions, release, artifacts, pins and both demo checks passed.
The sparse validation limitation remains recorded; no excluded specification body was retrieved or exported.

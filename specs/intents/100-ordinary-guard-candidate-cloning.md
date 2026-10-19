<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-100: Ordinary Guard-Candidate Cloning

## Status

Implemented, independently reviewed and locally verified; integration pending.

## Intent

Reduce repeated guard-probe candidate cloning cost without changing predicate acceptance, candidate values, replay order or finite limits.

## Deliverables

- [x] Cache a private ordinary-data snapshot per probe and retain descriptor copying for other seed shapes.
- [x] Verify actual XState routes, descriptor and assignment compatibility, and bounded offline performance evidence.

## Tasks

1. Specify and implement equivalent fresh candidate copying, verify real replay and refusal controls, and record measured local performance with its limits.

## Verification

The focused coverage and descriptor suites pass 291 tests, and the final full suite passes 1,855 tests across 87 files with two existing skips.
Build, full lint, formatting, definitions, release workflow, artifact checks, pin currency, both demos and installed-package acceptance pass.
Seven alternating 100-call batches of one generic public guard-probe workload retain identical guard-call counts, with ordinary-data medians of 30.23 ms before and 5.44 ms after, null-prototype medians of 21.84 ms and 6.87 ms, and accessor-fallback medians of 30.98 ms and 31.61 ms.
These local measurements establish neither whole-artifact performance nor compiler, workflow or team acceptance, and all earlier team deadline failures remain failed.
Two initial fixture drafts and an initial TypeScript narrowing failure are retained separately and are not counted as passing evidence.
Specification lint retains exactly 15 known missing protected-document references and no warnings; the excluded body is neither read nor restored.

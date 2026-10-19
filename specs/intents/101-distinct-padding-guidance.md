<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-101: Distinct Padding Guidance

## Status

Implemented, independently reviewed and locally verified; integration pending.

## Intent

Avoid redundant reflective guidance work without changing concrete guard acceptance, candidate ordering, finite probe accounting or actual replay.

## Deliverables

- [x] Coalesce identical ordinary-data padding shapes within one read pass, retaining distinct shapes and descriptor fallback.
- [x] Verify actual public-entry descriptor routes, refusal controls and reduced duplicate guidance observations.

## Tasks

1. Specify and implement per-read-pass padding deduplication, preserve logical charges and checkpoints, and verify focused real XState integration.

## Verification

The parent integration fixture accepts the actual route but fails the duplicate-guidance assertion. The corrected candidate passes all 291 focused tests across three files, and the full suite passes 1,865 tests across 88 files with two existing skips.

Build, formatting, full lint, definitions, release-workflow checks, artifact review, pin currency, both language demos and installed-package acceptance pass. Earlier scratch-commit and registry-resolution failures remain recorded separately; their underlying causes are unresolved.

Specification lint retains 15 existing missing spec-package-reference errors and no warnings. No whole-artifact elapsed-time improvement or expanded reachability guarantee is claimed.

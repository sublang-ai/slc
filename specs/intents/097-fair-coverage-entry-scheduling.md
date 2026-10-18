<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-097: Fair Coverage Entry Scheduling

## Status

Implemented and independently source-reviewed; deterministic verification passed; integration pending.

## Intent

Avoid starving admitted root-invocation paths while retaining bounded actual transition proof.

## Deliverables

- [x] Define fair root-family scheduling without merging reached paths or expanding limits.
- [x] Preserve family-local target priority, candidate order and lazy entry alternatives.
- [x] Verify real multi-root routes and existing question/replay refusal controls.

## Tasks

1. Correct bounded replay scheduling and verify its real XState paths and refusal controls.

## Verification

Real public-entry controls reach shared stages and mode-specific final arms, while the parent checker exhausts its finite budget on earlier families [[verification-44](../packages/verification.md#verification-44)].
Candidate and retained integration checks must preserve ordered guards, fixed context, canonical questions, lazy accepted entry variants and the original global 64-attempt/eight-invocation bounds.
No complete reachability, compiler or workflow acceptance is inferred from mechanical checks.

The parent regression retains two unproved ordered final arms despite four actual public-entry witnesses reaching their correct terminal states.
The scheduler correction accepts the four routes while preserving rejected-entry, earlier-arm shadowing and contradictory fixed-child-revision refusals.
A single root's lazy alternatives prove the 32nd variant but retain refusal of the 33rd under the unchanged charged replay budget; separate real execution still reaches that last route.
The new integration cases and the existing coverage suite pass; the full deterministic suite passes 1,804 tests across 84 files with two existing skips.
Build, changed-source lint, scoped formatting, diff and the release metadata audit pass.
Sparse spec lint retains exactly 15 missing protected-target citations; this is not a complete spec-lint pass.
The exact tested implementation and test bytes are unchanged after retargeting onto the release metadata base.

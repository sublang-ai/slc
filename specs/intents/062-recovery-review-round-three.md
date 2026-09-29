<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-062: Recovery review, round three

## Status

Completed on `codex/captain-recovery`; no merge.

## Intent

Accept review items 22 and 34: keep controller acceptance checks strict while allowing their defensive error fallback and use one GEARS statement per item.

## Deliverables

- [x] Fold verification-11 into one statement (22).
- [x] Exclude only a final unguarded controller fallback to the same parked leaf as its error arm (34).
- [x] Retain rejection of a second route to an action (34).
- [x] Regenerate Playbook's verifier support from the built SLC implementation (34).

## Tasks

1. Verify the changed checker and add one new review-fix commit with coder and reviewer credit.

## Verification

- Build: passed.
- `vitest run test/verify-coverage.test.ts`: 135 passed.
- Playbook's regenerated Captain coverage, introspection, conformance and prompt checks: 6 passed.
- `spex lint`: no problems found.
- No findings rejected. Other round-three findings belong to Playbook.
- Coder: GPT-6 Astra; reviewer: Claude Opus 5.5.

- Source formatting passed; the final build regenerated Playbook support directly from SLC.
- Final spec lint: no problems found; configured author: `Σ* <alph@sublang.ai>`.

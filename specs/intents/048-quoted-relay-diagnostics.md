<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-048: Quoted Relay Diagnostics

## Status

Completed

## Intent

Explain the existing quote-layer requirement when a generated GEARS prompt adds a bare unquoted token, without changing Source-fidelity acceptance or authoring missing domain behavior.

## Deliverables

- [x] Actionable diagnostic preserving the existing authored-line exemptions.
- [x] Actual parser/composer acceptance and rejection cases.
- [x] Preserved REVIEW failure replay with unchanged artifact bytes.

## Tasks

1. [x] Refine the existing Source-fidelity diagnostic and verify its representation boundary under [[verification-25](../packages/verification.md#verification-25)] and [[verification-26](../packages/verification.md#verification-26)].

## Verification

- Preserved C3 REVIEW `phase-AegKvB` failed with seven additional raw-token lines after the parser removed their single outer GEARS marker; the source needed no compiler question.
- Its separate contradiction `phase-1y1wBw` produced the intended clarification and no GEARS artifact.
- Compare single-layer rejection with double-layer acceptance and exact quoted runtime value delivery, preserving authored raw-token lines, plain-prose freedom, and rejection of added labels.
- This changes diagnostic wording only; it neither edits generated artifacts nor decides which runtime value a source requires.
- Independent private adjudication: `/private/tmp/slc-review-v5-007-008-adjudication/evidence.json`, SHA256 `82b77f524cfcfe1a35a57f1df9e100d70118170ac1718ab75823994aec41e05c`.
- All 23 Source-fidelity cases pass, including the real installed composer; TypeScript, focused ESLint and Spex 3 checks pass.
- The unchanged failing REVIEW pair retains seven findings with actionable examples; `/private/tmp/slc-review-v5-007-008-adjudication/diagnostic-replay.json`, SHA256 `7c12cd95c9d2162f01158031ec463e315b053016f4ea2b1816ec9080f77e50b6`, records both checker identities and the preserved source, GEARS, summary and diagnostics.

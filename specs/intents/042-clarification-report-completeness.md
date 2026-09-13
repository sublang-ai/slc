<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-042: Clarification Report Completeness

## Status

Completed

## Intent

Reinforce complete report serialization after a real DEV omission probe identified the intended missing route but emitted an unterminated JSON envelope.

## Deliverables

- [x] Explicit syntax-completeness guidance in the shared performing contract.
- [x] Preserved strict failure behavior and new-cohort real rerun evidence.

## Tasks

1. [x] Clarify the existing report-production duty and verify malformed reports still fail without review.
2. [x] Repeat the affected real case in a separately frozen compiler cohort and record the outcome without erasing the failed attempt.

## Verification

- Preserve the original case-011 failure: source behavior was detected, but no valid clarification reached the API because the top-level JSON object lacked its closing brace.
- Keep parser acceptance, protected-input precedence, and stop behavior unchanged; do not invent a question or silently repair malformed model output.
- Keep source sufficiency decisions with the performing agent and add no extra calls or interactive steps.
- Treat subsequent live success as observed report delivery, not proof that wording eliminates all model formatting failures.

The shared prompt and unchanged strict boundary pass 44 compiler/executor/phase-recorder integration cases, including a truncated top-level report.
Lint, build, and Spex checks pass.
The C2 affected-case rerun delivered no report and therefore does not establish this guidance's effectiveness.
The C3 full original-source run `compile-SQkdsA` delivered one complete, targeted clarification from `gears2fsm` after 190.888 seconds: the reachable documentation-only outcome has no defined action or terminal meaning.
The report names the original source to edit, and no FSM or entry was emitted; all 11,903 recorded inputs remained unchanged.
Independent adjudication is recorded in `docs/performance/complex-workflows-followup-2026-09-12.json`; this is observed successful report delivery, not isolated wording causation or universal detection.

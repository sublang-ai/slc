<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-073: Question-Resumed Arm Coverage

## Status

Completed (2026-10-17).

## Intent

An acting state's approval guards can require the canonical nested context created by its real question and Boss reply.
Initialized-context probing cannot manufacture that history and shall not substitute a fabricated question record.
Replay the already validated question prefix to verify otherwise unproved ordered arms against their actual target.

## Deliverables

- [x] Specify same-state canonical replay, fixed context and bounded accounting.
- [x] Reuse the known actual question/reply prefix without changing generated artifacts.
- [x] Verify real approved/refused arms and preserved negative cases through XState.

## Tasks

1. Cover question-resumed acting arms through concrete ordered guards and real target progression.

## Verification

The retained artifact's two approval/refusal arms accept with real question/reply context and reject initialized top-level samples.
The new real XState regression first reported both arms as unsatisfiable, then passed with actual actions recording each resumed outcome.
Wrong question identity, contradictory and shadowed guards, blank-answer admission and failure to settle at the declared target remain refused.
All 202 affected coverage and completion cases, the TypeScript build, ESLint, changed-file formatting, Spex 3.0.0 spec lint and diff check passed.
The existing maintained DEV deadline cap and smaller derived timeout check also passed.
Independent production review found no blocking issue.
Public model-free coverage of the unchanged external artifact now has zero findings, with its exact original guards and actual transitions preserved.
No provider call, compilation or generated artifact edit was performed.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-072: Reached Child Value Dataflow

## Status

Completed (2026-10-17).

## Intent

A predecessor can supply an exact primitive later compared with a child result.
The reached value can be absent from artifact literals and generic candidates, leaving a satisfiable child arm unproved.
Reuse bounded values observed from fixed reached context without assigning context or inferring a workflow-specific result.

## Deliverables

- [x] Specify bounded observed primitive reuse and unchanged refusal boundaries.
- [x] Implement raw-child-only reuse without nested traversal or additional probe budget.
- [x] Verify real XState predecessor-to-child equality, contradictory and shadowed cases, and affected gates.

## Tasks

1. Preserve primitive dataflow through bounded child-result probing and verify actual replay.

## Verification

An isolated diagnostic proves the original guard accepts when its exact actual predecessor value is available, while the unchanged candidate pool never supplies that value.
The separate canonical nested-question context limitation remains outside this intent.
The three real XState regressions for a string, false and a finite number first failed at the expected unsatisfiable-arm assertion, then passed with the correction.
Contradictory equality, shadowed arms, nested data and a fifth new context value remain refused.
All 196 affected coverage and completion cases, the TypeScript build, ESLint, changed-file formatting, Spex 3.0.0 spec lint and diff check passed.
Independent production review found no blocking issue.
Public model-free checks preserve a clear unchanged external artifact and reduce another artifact's findings from 15 to two canonical question-route arms, which remain unproved.
No provider call, compilation or external artifact edit was performed.

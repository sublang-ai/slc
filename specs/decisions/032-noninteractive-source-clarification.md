<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-032: Noninteractive source clarification

## Status

Accepted.

## Context

Missing or contradictory source behavior can become apparent during normalization or any later transformation.
Freeform `BLOCKED` diagnostics do not distinguish an actionable source question from an execution failure.
The compiler must remain noninteractive: the user resolves questions in the original source and repeats the command.

## Decision

- Introduce a generic structured clarification result, distinct from successful output and hard failure.
- Transformation-performing agents report concrete questions with reasons and source evidence through a shared host protocol.
- Interpreted and compiled execution stop on that protocol; routing and judge calls retain their existing contracts.
- Preserve the original inputs and leave any artifact written by a clarifying phase unaccepted.
- Report the original invocation inputs, stopped phase, target, and questions through the API and standard error, with CLI exit code `2`.
- Add no interactive prompt, answer file, pending session, or resume store.
- Retain success-only build publication; after editing the source the user repeats the original command under ordinary incremental rules.

## Consequences

The protocol applies to every pipeline without phase-specific semantic rules in SLC.
Existing `BLOCKED` reports remain hard failures.
Clarification ends a compiled runtime turn without requiring Playbook snapshot or resume capabilities.
Later-phase questions point back to the original source rather than suggesting edits to generated intermediates.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-042: Literal Prompt-relay Fidelity

## Status

Accepted

## Context

A fixed-FSM CODE link passed one-line prompt probes but relayed actual multiline input without the quote markers required by its source prompt.
The existing same-Coder correction loop cannot repair a defect the deterministic prompt check does not expose.

## Decision

Extend the existing whole-template composition evidence with bounded literal-string and complete quoted-relay probes, as specified by [[verification-41](../packages/verification.md#verification-41)].
Observe actual composer inputs and captured substitution values rather than guessing additional context fields or evaluating the FSM against invented domain shapes.
Keep aliases together, retain typed and deterministic JSON slots under their existing checks, and keep inline identifiers single-line.
Use the same role lookup and ordinary or continuation mode without changing contract capture, generation profiles, or empty-value policy.
The live link gate and emitted suite share the check, so findings enter the existing bounded same-Coder repair mechanism.

## Consequences

Literal replacement and multiline quoting defects are visible before link acceptance.
The check establishes template rendering fidelity, not whether a runtime field is the correct source-domain value.
No workflow artifact, frozen compiler cohort, runtime engine, or provider invocation is changed by this correction.

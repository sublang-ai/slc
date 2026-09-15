<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-047: Child-Call Quiescence

## Status

Accepted.

## Context

A generated CODE runtime tagged nested-call states both `playbook.busy` and `playbook.suspended`.
The shared runtime treats a pending child as quiescent only without an active busy tag, so the public call waited until cancellation despite the host having returned a suspended child.
The producer definition incorrectly applied its busy requirement to every actor kind.

## Decision

- A nested-playbook invocation shall not carry or inherit `playbook.busy`, including from the machine root; a busy sibling remains valid while it performs independent work.
- Check this structural constraint at GEARS-to-FSM conformance and before consuming a supplied FSM, without inferring guards, result meanings or state-name conventions.
- Use existing bounded producer repair and protected consumer preflight; generated tag defects are compiler findings, not requests for a source author's decision.
- Preserve transition-coverage findings independently; correcting quiescence does not excuse unreachable branches or establish complete workflow acceptance.

## Consequences

The compiler can reject a known child-suspension deadlock before paying for linking.
Ancestor checks account for XState's inherited tags without rejecting busy parallel siblings.
The shared runtime contract remains unchanged.

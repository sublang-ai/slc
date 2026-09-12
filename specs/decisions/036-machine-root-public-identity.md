<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-036: Machine-Root Public Identity

## Status

Accepted.

## Context

A measured compilation assigned `meta.playbook.stateId` to both the machine root and its ordinary active state.
XState exposes both through `snapshot.getMeta()`, so the shared Playbook runtime rejected initialization after a 308-second link phase because its flat runtime requires exactly one public state identity.
The canonical GEARS-to-FSM States contract identifies states by properties under `states`; its metadata requirement does not authorize another public identity on the machine root.

## Decision

- Make that boundary explicit in conformance: the machine root omits `meta.playbook.stateId`; public playbook identities belong to state nodes declared under `states`.
- Preserve the root's XState `id`, description, and other metadata, and existing flat, structured, and historical state-node identity rules.
- Report the root declaration through the existing conformance checker and early GEARS-to-FSM gate under [DR-033](033-early-conformance-and-mechanical-repair.md), without rewriting artifacts or introducing a general machine-shape validator.
- Keep the upstream definition clarification separate from any deferred change to runtime construction validation or dependency adoption.

## Consequences

This compiler-generated identity defect reaches the producing phase before linking, while its FSM remains the producer's repairable target.
Runtime identity normalization and all ordinary state metadata remain unchanged.

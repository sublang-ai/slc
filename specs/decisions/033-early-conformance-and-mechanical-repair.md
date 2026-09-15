<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-033: Early Conformance and Bounded Mechanical Repair

## Status

Accepted.
Amends the unreviewed-finding disposition in [DR-029](029-source-fidelity-gate.md) and [DR-030](030-link-fidelity-gate.md), and the single-invocation rule in [DR-004](004-slc-interpreted-phase-execution.md).

## Context

A measured minimal compilation accepted an FSM that interpolated a runtime value into a prompt which the GEARS source required verbatim.
Linking spent 158 seconds before an existing fidelity check rejected it; the existing GEARS-to-FSM conformance checker identified the same defect in 46 milliseconds.
Deterministic findings currently reach the Coder only when an independent Reviewer is configured.

## Decision

- Apply existing GEARS-to-FSM conformance and artifact-schema resolution at that format boundary, before downstream work, including import failures as findings; use only the existing conformance checks, excluding introspection snapshots and coverage.
- Use the actual full-link target's contract as schema evidence when available, otherwise the generated FSM's structural evidence; never substitute a compiler phase pin or a previous linked artifact.
- A missing continuation generation remains unclassified at pre-link conformance, which has no continuation composer to check; it still reports conflicting or invalid supplied schema evidence.
- Make mechanical correction available with the same Coder independently of optional semantic review: at most three checking rounds and two corrections, with the existing numbered findings and private correction envelope.
- A clean mechanical result returns immediately without an independent Reviewer; otherwise create the Reviewer lazily and retain the existing shared round bound and review contract.
- Preserve control-call bypass, clarification stopping, cancellation, source and definition immutability, generic checks, and final deterministic gate rechecks.
- Retain the repair default only after a live compile demonstrates useful recovery with artifact validation; report early rejection separately from successful compilation performance.

## Consequences

Invalid FSMs stop before expensive linking, and mechanically repairable mistakes can recover without an additional agent identity.
Already-valid unreviewed phases use one agent invocation; defects add at most two calls.
The compiler gains no new transformation semantics: phase definitions remain authoritative and boundary checks reuse existing artifact verification.

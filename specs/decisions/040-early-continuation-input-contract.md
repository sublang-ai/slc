<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-040: Early Continuation Input Contract

## Status

Accepted.
Extends the existing boundary in [DR-033](033-early-conformance-and-mechanical-repair.md).

## Context

A generated FSM kept the pending Boss question only inside a private nested context member.
The machine resumed under a manually supplied event, but the installed shared runtime rejected its deferred question because the canonical context record was absent.
Linking spent 39.734 seconds before refusing that protected input; the existing prompt-contract continuation-input probe found the same artifact defect in 1.1 milliseconds.

## Decision

- Reuse the existing canonical scalar and state-keyed continuation-input sentinel probe before accepting a produced FSM and before executing a protected-FSM consumer.
- Run generation-specific probes only when the existing schema decision resolves the artifact, preserving the unclassified direct-Captain case and controller exemption.
- Preserve resolved initial context shapes and source-owned context members; require only the existing singular question and reply input contract, without introducing a general context-shape validator or a composer requirement.
- Use the existing producer repair budget and reject supplied invalid FSMs before consumer construction; preserve source protection and cancellation.
- Snapshot the existing protected-input set before an importing preflight and recheck it on success, findings, or exceptions, rejecting detected mutation before consumer construction.

## Consequences

An existing deferred-input defect fails where its producer can repair it, without a provider call or runtime change.
The early probe checks input wiring, while linked prompt composition and runtime execution retain their distinct checks.

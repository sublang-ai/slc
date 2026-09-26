<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-053: Recovery-capable controller discrimination

## Status

Accepted.
Amends [DR-024](024-playbook-10-schema-3-adoption.md) by admitting the recovery-capable controller alongside the legacy seven-action domain.

## Context

Playbook adds an optional payload-free `recover` selection for host-owned prerequisite preparation and continuation.
The exact seven-action controller discriminator would classify that Captain as an ordinary workflow and require inappropriate Boss-wait behavior.

## Decision

Recognize exactly two structural controller domains: the existing seven actions, and those same actions plus `recover`.
Use this shared discriminator for conformance, prompt and coverage checks, retaining near-miss diagnostics and rejection of arbitrary extensions.
For result acceptance, ignore only a final unguarded fallback into the same parked leaf used by an error arm, with no invocation, child states or automatic transition; it reports invalid output rather than selecting a second action.
An unguarded arm entering another action path remains a duplicate acceptance finding.
This is verifier compatibility; it neither changes the runtime ABI nor adopts unpublished playbook pipeline assets.

## Consequences

Existing compiled Captains remain valid, and recovery-capable Captains receive the same controller-specific checks.
Other action domains remain ordinary or receive the existing precise near-miss finding.

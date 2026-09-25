<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-053: Recovery-capable controller discrimination

## Status

Accepted.

## Context

Playbook adds an optional payload-free `recover` selection for host-owned prerequisite preparation and continuation.
The exact seven-action controller discriminator would classify that Captain as an ordinary workflow and require inappropriate Boss-wait behavior.

## Decision

Recognize exactly two structural controller domains: the existing seven actions, and those same actions plus `recover`.
Use this shared discriminator for conformance, prompt and coverage checks, retaining near-miss diagnostics and rejection of arbitrary extensions.
This is verifier compatibility; it neither changes the runtime ABI nor adopts unpublished playbook pipeline assets.

## Consequences

Existing compiled Captains remain valid, and recovery-capable Captains receive the same controller-specific checks.
Other action domains remain ordinary or receive the existing precise near-miss finding.

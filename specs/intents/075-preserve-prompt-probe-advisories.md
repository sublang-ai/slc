<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-075: Preserve Prompt-Probe Advisories

## Status

Completed.

## Intent

Preserve the prompt verifier's existing diagnostic-versus-finding boundary when completing a retained bundle, without changing retained artifacts, agent execution or history authority.

## Deliverables

- [x] Carry explicitly classified non-finding prompt-probe diagnostics through completion without turning them into refusals, while retaining successful CLI diagnostics.
- [x] Keep actual composition, schema, coverage, typing, import and physical-write failures blocking.
- [x] Verify the boundary through the public retained-bundle command with a real XState initializer requiring host input, actual composer drift and existing corruption/write-barrier cases.

## Tasks

1. Keep prompt advisories distinct through deterministic completion and add the public regression matrix.

## Verification

- Public completion accepts the valid host-initialized fixture, preserves all retained input bytes and reports its degraded prompt probe, while actual composer drift refuses before derived writes [[verification-5](../packages/verification.md#verification-5)] [[verification-11](../packages/verification.md#verification-11)].
- Public completion and prompt-emission regression cases, the full source suite, build, formatting, lint, global spec lint, package smoke, definitions, release, artifacts, pins and both demo checks pass; no compiler agent or workshop runtime was invoked.

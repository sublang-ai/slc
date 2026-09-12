<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-039: Strict FSM Boundary

## Status

Accepted.
Extends the existing artifact checks in [DR-033](033-early-conformance-and-mechanical-repair.md).

## Context

A generated FSM loaded and passed structural conformance despite a TypeScript error in its declared output type.
Linking spent 74.5 seconds before discovering that error in its protected input.
An isolated strict check found the same error in 611 milliseconds without changing the FSM.
Another run selected an incompatible global TypeScript and spent an additional model turn interpreting dependency declaration errors.

## Decision

- Check a produced TypeScript FSM at the existing GEARS-to-FSM boundary, before module conformance, using the already-required strict standalone ESM artifact contract.
- Check a supplied TypeScript FSM before its compile or Playbook-link consumer constructs an executor; the consumer cannot repair its protected input.
- Ship the already-locked Node declarations as a production dependency so standalone installed compilers can check the required Node ambient contract.
- Use SLC's installed TypeScript and Node ambient declarations as the compiler authority, while resolving the artifact's imports from their original locations; project compiler versions and configuration do not alter the accepted contract.
- Treat only the standalone FSM root as ESM; preserve imported files' actual module formats, source bytes, relative resolution, and cwd.
- Check only that root and its TypeScript dependency graph, without executing it, consulting project compiler configuration, emitting files, or checking unrelated generated suites.
- Route type diagnostics through the existing same-Coder repair budget; preserve clarification, cancellation, protected-input checks, and lazy Reviewer construction.
- Honor cancellation before the local compiler check and after yielding pending cancellation events, and treat an unavailable or failed checker as an execution failure rather than a repairable source diagnostic.

## Consequences

Type-invalid FSMs fail where their producer can still repair them, avoiding futile downstream work.
The check adds bounded local work and no transformation rule, provider call, runtime export, or dependency version adoption.

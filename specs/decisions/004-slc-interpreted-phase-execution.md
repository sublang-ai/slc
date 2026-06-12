<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-004: SLC Interpreted Phase Execution

## Status

Accepted

## Context

Per [DR-003](003-slc-phase-execution.md), a phase may be executed by interpreting its definition or by a compiled artifact.
Compiling a phase needs the compiler pipeline to already exist, so a pipeline cannot bootstrap from compiled artifacts alone.
The simplest executor — an agent following the definition — needs no prior toolchain and defines what a phase definition means.

## Decision

### Interpreter

`slc` shall be able to execute any phase by interpreting its definition directly.
To interpret a phase, `slc` shall prompt a coding agent with the phase or link definition and the phase inputs, and the agent shall perform the transformation and write the target.
`slc` shall reach coding agents through Cligent (npm `@sublang/cligent` [[1]]), so any supported agent CLI can interpret; agent and model selection is `slc` configuration, not phase semantics.

Interpreted execution shall not require compiling the definition, an FSM, or linking.
The agent may invoke deterministic tools or commands the definition calls for, as part of following the definition.
It may also read the content the definition cites or references; that readable closure is the semantic input closure that pinning ([DR-005](005-slc-self-hosting-meta-pipeline.md#pinning)) tracks.

Interpreted execution shall be available for every phase, so a pipeline can run from its definitions alone.
This is the bootstrap base case: it has no dependency on [DR-005](005-slc-self-hosting-meta-pipeline.md).

### Reference semantics

Interpreted execution is the reference semantics of a phase definition.
A compiled phase artifact ([DR-005](005-slc-self-hosting-meta-pipeline.md)) shall be behavior-equivalent to interpreting the same definition: given the same inputs it shall produce an acceptable target under the definition, or report `BLOCKED` for the same incompatibilities.
Equivalence is at the level of acceptable target and blocked conditions, not identical output, call count, or actor structure.

### Agent contract

When interpreting a phase, the agent prompt shall establish this contract:

- the phase or link definition is authoritative;
- the agent writes only the requested target or linked artifact;
- the agent does not edit sources, phase definitions, specs, link targets, object artifacts, or unrelated files;
- the agent does not commit;
- the agent produces a complete artifact, not a sketch;
- the agent adds no domain semantics except those the source implies or the definition requires, and drops nothing the source states;
- the agent preserves verbatim content wherever the definition requires it;
- the agent verifies the produced artifact against the definition before finishing;
- the agent reports a concise summary and diagnostics, and follows the [DR-003](003-slc-phase-execution.md) blocked protocol.

### Scope

Within this DR's scope, `slc` shall interpret a phase with one agent invocation per phase.
Automatic multi-call audit and repair orchestration is out of scope for this DR.

## Consequences

- A pipeline is runnable directly from its phase definitions, with no compilation step.
- Interpreted runs are the oracle against which compiled artifacts ([DR-005](005-slc-self-hosting-meta-pipeline.md)) are validated; the validation procedure belongs to test specs, not this DR.
- Per-run variation from a stochastic agent is bounded by the human-editable intermediate ([DR-001](001-slc-pipeline-layout-naming-invocation.md)) between phases, which is the pipeline's error-correction boundary.
- Interpreted execution covers every phase at the correctness level, with the agent following the definition within one invocation; compilation ([DR-005](005-slc-self-hosting-meta-pipeline.md)) adds determinism, fixed and auditable control flow, and per-step model binding where a phase needs that fidelity.

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

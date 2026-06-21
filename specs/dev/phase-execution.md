<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PHEXEC: Phase Execution

## Intent

This package specifies the boundary between generic `slc` mechanics and
phase-specific transformation, the generic checks and blocked protocol that
guard a phase run, and interpreted phase execution by a coding agent, per
[DR-003](../decisions/003-slc-phase-execution.md) and
[DR-004](../decisions/004-slc-interpreted-phase-execution.md).
Generic pipeline mechanics are specified in the `pipeline` package.

Essential project-specific references: `slc`, this project's compiler CLI; and
Cligent (`@sublang/cligent` [[1]]), the SDK through which `slc` reaches coding
agents.

## Execution boundary

### PHEXEC-1

The slc command shall perform only generic pipeline mechanics, and shall not contain phase-specific transformation rules, phase-specific prompt notes, or phase-specific semantic validators ([DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).

### PHEXEC-2

Where executing an ordinary compile phase, the slc command shall treat the phase definition file as the semantic source of truth; where executing a link phase, the slc command shall treat the pipeline's `link.md` as the semantic source of truth ([DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).

### PHEXEC-3

While executing, the executing phase shall write only its declared target or linked artifact, and shall not modify sources, phase or link definitions, specs, object artifacts, link targets, or unrelated files; scratch space that does not persist past the run is not such a write ([DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).

## Generic checks

### PHEXEC-4

When a phase finishes, the slc command shall verify that the expected target artifact exists and that its extension matches the declared target extension ([DR-003](../decisions/003-slc-phase-execution.md#generic-checks)).

### PHEXEC-5

When a phase finishes, the slc command shall verify that the source, any object inputs, and the link target are unchanged from before the run and that the pipeline chain remains valid ([DR-003](../decisions/003-slc-phase-execution.md#generic-checks)).

### PHEXEC-6

When a write-scope violation is detected by any means, the slc command shall fail it like a failed generic check ([DR-003](../decisions/003-slc-phase-execution.md#generic-checks)).

## Blocked protocol

### PHEXEC-7

When the source, object artifacts, link target, or options are malformed under the applicable definition, or the definition is incompatible with the inputs, the executing phase shall stop and report `BLOCKED` with concrete diagnostics instead of guessing through semantic incompatibility ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

### PHEXEC-8

While following its definition, the executing phase shall resolve only benign ambiguity that does not change domain semantics, and shall report any ambiguity it resolves ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

### PHEXEC-9

When the executing phase reports `BLOCKED` or a generic check fails, the slc command shall stop the pipeline and emit a failure report naming the phase, target path, and reasons ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

## Interpreted execution

### PHEXEC-10

The slc command shall be able to execute any phase by interpreting its definition directly, and interpreted execution shall be available for every phase without requiring compilation, an FSM, or linking ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter)).

### PHEXEC-11

When interpreting a phase, the slc command shall prompt a coding agent, reached through Cligent [[1]], with the phase or link definition and the phase inputs, and the agent shall perform the transformation and write the target ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter)).

### PHEXEC-12

When interpreting a phase, the slc command shall use exactly one agent invocation per phase ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#scope)).

### PHEXEC-13

Where slc configuration selects an agent CLI and model, the slc command shall apply that selection as configuration and shall not let it change phase semantics ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter)).

### PHEXEC-14

When interpreting a phase, the slc command shall establish in the agent prompt a contract that ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#agent-contract)):

- the phase or link definition is authoritative;
- the agent writes only the requested target or linked artifact;
- the agent does not edit sources, phase or link definitions, specs, link targets, object artifacts, or unrelated files;
- the agent does not commit;
- the agent produces a complete artifact, not a sketch;
- the agent adds no domain semantics except those the source implies or the definition requires, and drops nothing the source states;
- the agent preserves verbatim content wherever the definition requires it;
- the agent verifies the produced artifact against the definition before finishing;
- the agent reports a concise summary and diagnostics, and follows the blocked protocol ([PHEXEC-7](#phexec-7)).

### PHEXEC-15

When interpreting a phase, the slc command shall permit the agent to invoke the deterministic tools or commands the definition calls for and to read the content the definition cites or references, as part of following the definition, and shall treat that readable closure as the phase's semantic input closure ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter)).

## Compiled execution

### PHEXEC-23

Where a phase is executed by a compiled artifact, the slc command shall drive the artifact only through a stable phase-runner facade — a no-argument `createPhaseRunner` factory whose `run` is handed the phase input, the host ports (Playbook's source-owned ports together with the file capability), and an abort signal, and returns a terminal `ok`, `blocked`, or `error` status with diagnostics drained for every status ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract)).

### PHEXEC-24

When a compiled artifact returns its terminal status, the slc command shall proceed to the generic checks on `ok`, treat `blocked` as the `BLOCKED` outcome, and stop the pipeline like a failed generic check on `error`, and shall surface the drained diagnostics for every status so an `ok` run still reports any ambiguity it resolved ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract), [DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

### PHEXEC-25

Where a compiled phase runs, the slc command shall back the runner's player and judge ports with a coding agent reached through Cligent [[1]] per [DR-004](../decisions/004-slc-interpreted-phase-execution.md), applying per-player model selection as configuration without changing phase semantics, and shall collect the runtime's status and telemetry emissions as drainable diagnostics ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract)).

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

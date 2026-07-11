<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PHEXEC: Phase Execution

## Intent

This package specifies integration and system acceptance tests for the
execution boundary, interpreted and compiled phase execution, and pin-driven
strategy selection in the `phase-execution` dev package, exercising the `slc`
command with faked agent transports and fixture compiled artifacts per
[DR-003](../decisions/003-slc-phase-execution.md),
[DR-004](../decisions/004-slc-interpreted-phase-execution.md),
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), and
[DR-007](../decisions/007-slc-phase-artifact-pinning.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## Interpreted runs

### PHEXEC-16
Verifies: [PHEXEC-8](../dev/phase-execution.md#phexec-8), [PHEXEC-10](../dev/phase-execution.md#phexec-10), [PHEXEC-11](../dev/phase-execution.md#phexec-11), [PHEXEC-12](../dev/phase-execution.md#phexec-12), [COMPILE-5](../user/compiler.md#compile-5)

Where every phase is interpreted, when the slc command runs a full pipeline whose agent writes each declared target, the slc command shall complete with exactly one agent invocation per phase, the canonical artifacts present, and any ambiguity the agent reported surfaced in its diagnostics.

### PHEXEC-17
Verifies: [PHEXEC-4](../dev/phase-execution.md#phexec-4), [PHEXEC-9](../dev/phase-execution.md#phexec-9), [COMPILE-4](../user/compiler.md#compile-4)

While interpreting a phase, when the agent finishes without writing the declared target or writes a file whose extension differs from the declared one, the slc command shall stop the pipeline and emit a failure report naming the phase and target.

### PHEXEC-18
Verifies: [PHEXEC-3](../dev/phase-execution.md#phexec-3), [PHEXEC-5](../dev/phase-execution.md#phexec-5), [PHEXEC-6](../dev/phase-execution.md#phexec-6), [COMPILE-4](../user/compiler.md#compile-4)

While interpreting a phase, when the agent modifies the source, an object input, the link target, or a phase or link definition, the slc command shall fail the run with a report naming the changed path.

### PHEXEC-19
Verifies: [PHEXEC-7](../dev/phase-execution.md#phexec-7), [PHEXEC-9](../dev/phase-execution.md#phexec-9), [COMPILE-4](../user/compiler.md#compile-4)

While interpreting a phase, when the agent reports `BLOCKED` for malformed inputs or an incompatible definition, the slc command shall stop the pipeline and emit a failure report carrying the blocked diagnostics.

### PHEXEC-20
Verifies: [PHEXEC-1](../dev/phase-execution.md#phexec-1), [PHEXEC-2](../dev/phase-execution.md#phexec-2), [PHEXEC-14](../dev/phase-execution.md#phexec-14), [PHEXEC-15](../dev/phase-execution.md#phexec-15)

When the slc command interprets a phase, the agent prompt shall embed the phase or link definition verbatim as authoritative, establish every clause of the [PHEXEC-14](../dev/phase-execution.md#phexec-14) agent contract together with permission to run definition-called tools and read cited content, and add no phase-specific rules of slc's own.

### PHEXEC-21
Verifies: [PHEXEC-13](../dev/phase-execution.md#phexec-13)

Where slc configuration selects an agent and model, when the slc command interprets a phase, the slc command shall pass that selection to the agent transport without it changing the phase definition or the produced artifact.

### PHEXEC-22
Verifies: [PHEXEC-5](../dev/phase-execution.md#phexec-5), [COMPILE-4](../user/compiler.md#compile-4)

While interpreting a phase, when the agent adds, removes, or renames a phase file so the pipeline chain no longer infers, the slc command shall fail the run with a diagnostic rather than report success.

## Compiled runs

### PHEXEC-26
Verifies: [PHEXEC-23](../dev/phase-execution.md#phexec-23), [PHEXEC-24](../dev/phase-execution.md#phexec-24)

Where a phase is backed by a fixture compiled `playbook` artifact driven only through the runtime ports, when the executor runs it, a turn that writes the target shall yield an `ok` outcome carrying the runtime's drained diagnostics, a clean turn that reaches a non-failed quiescent state without producing output shall yield a `blocked` outcome, and a turn that throws or whose standard FSM telemetry ends at the `failed` quiescent state shall yield an `error` outcome.

### PHEXEC-28
Verifies: [PHEXEC-27](../dev/phase-execution.md#phexec-27), [COMPILE-6](../user/compiler.md#compile-6)

When the slc command runs a fixture phase, a phase with no pin file or absent from a present pin file shall interpret, a current pin shall run the compiled executor without interpreting, a current pin a host cannot run compiled shall fail closed, and a stale pin, a malformed pin record, or an unparseable pin file shall fail the run with a diagnostic and not interpret.

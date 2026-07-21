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
[DR-007](../decisions/007-slc-phase-artifact-pinning.md), including the
runtime-profile transition in
[DR-010](../decisions/010-playbook-runtime-contract-evolution.md) and its
immutable Playbook 1.0 adoption in
[DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).
It also covers direct Captain control-call isolation from
[DR-012](../decisions/012-playbook-routing-control-separation.md).

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
Verifies: [PHEXEC-23](../dev/phase-execution.md#phexec-23), [PHEXEC-24](../dev/phase-execution.md#phexec-24), [PHEXEC-25](../dev/phase-execution.md#phexec-25)

Where phases are backed by `legacy`, `session-v1`, and `composed-v2` fixture `playbook` artifacts driven only through the runtime boundary, when the executor runs them, `legacy` shall receive only four direct ports, `session-v1` shall receive its unique minimal session with exactly four ports, and `composed-v2` shall receive its unique causal root session with exactly six ports including `callCaptain` and `callPlaybook`; the two void profiles shall retain output-delta and failed-telemetry mapping and reject structured results, while `composed-v2` shall require a structured result, map output-producing `quiescent` or `terminal` to `ok`, map outputless `quiescent` or `terminal` and `no-action` to `blocked`, and map absent, cross-variant, accessor- or proxy-backed, non-JSON, malformed-state, `failed`, `aborted`, unexpectedly `suspended`, thrown, or otherwise-successful but disposal-failing runs to `error`; explicit false or token player resume selection and returned tokens shall cross the Cligent adapter unchanged, `session-v1` and `composed-v2` shall reject omitted or invalid selections before invoking the player, and `legacy` shall preserve omission; a direct Captain call shall cross without player identity or resume state and shall preserve its required visibility, status, final text, and error; concurrent Captain and judge calls shall be single-flight in one queue; nested calls shall fail deterministically; and exact `playbook.trace` prompts, replies, errors, and resume tokens shall not occur in the returned diagnostics.

### PHEXEC-28
Verifies: [PHEXEC-27](../dev/phase-execution.md#phexec-27), [PHEXEC-30](../dev/phase-execution.md#phexec-30), [COMPILE-6](../user/compiler.md#compile-6)

When the slc command runs a fixture phase, a phase with no pin file or absent from a present pin file shall interpret, a current pin with absent or exact `@sublang/playbook@0.9.0` link-target provenance shall select the `legacy` compiled executor without interpreting, a current pin with exact `@sublang/playbook@1.0.0` or `@sublang/playbook@2.0.0` provenance shall select the six-port `composed-v2` executor, a current pin carrying any other unmapped provenance — including `@sublang/playbook@1.3.0` — or a compiled artifact the selected host cannot run shall fail closed without profile inference or initialization retry, and a stale pin, a malformed pin record, or an unparseable pin file shall fail the run with a diagnostic and not interpret.

### PHEXEC-32

Verifies: [PHEXEC-31](../dev/phase-execution.md#phexec-31)

Where a `composed-v2` fixture calls Captain with visible or hidden control work and then calls its hidden judge, when the SLC phase adapter runs it, each Cligent call shall receive `resume: false` and an explicitly empty allowed-tool list without sharing an agent conversation; whereas any missing, inherited, accessor-backed, non-false resume, or nonempty allowed-tool option on the direct Captain call shall reject before the agent transport runs.

### PHEXEC-35
Verifies: [PHEXEC-34](../dev/phase-execution.md#phexec-34)

Where a pinned `composed-v2` meta-phase artifact is driven through the compiled executor over a fake agent transport that captures transported prompts, when the seeded compile or link turn reaches the artifact's transformation-performing direct Captain call, the transported prompt shall carry the artifact's composed GEARS-derived body plus the host workspace contract naming the request's absolute workspace inputs and the absolute artifact-to-write path, and a captain that writes exactly that artifact shall map the run to `ok`; whereas a routing-only Captain call carrying an explicitly empty `allowedTools` and every hidden judge call shall receive its composed prompt unchanged.

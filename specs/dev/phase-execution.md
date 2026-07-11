<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PHEXEC: Phase Execution

## Intent

This package specifies the boundary between generic `slc` mechanics and
phase-specific transformation, the generic checks and blocked protocol that
guard a phase run, interpreted phase execution by a coding agent, and compiled
phase execution through the phase-runner facade with pin-driven strategy
selection, per [DR-003](../decisions/003-slc-phase-execution.md),
[DR-004](../decisions/004-slc-interpreted-phase-execution.md),
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), and
[DR-007](../decisions/007-slc-phase-artifact-pinning.md), with the evolving
runtime boundary settled by
[DR-010](../decisions/010-playbook-runtime-contract-evolution.md).
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

Where a phase is executed by a compiled `playbook` artifact, the slc command shall drive it host-side through a stable phase-runner facade — construct the `PlaybookRuntime` the artifact's `createPlaybookRuntime` factory builds; for `legacy`, initialize it directly with exactly `callPlayer`, `callJudge`, `emitStatus`, and `emitTelemetry`; for `session-v1`, initialize it with `{ sessionId, playbookId, ports }` carrying a globally unique id, the selected phase id, and exactly those four traced-session ports; for `composed-v2`, initialize it with a causal root `PlaybookSession` whose root id equals its globally unique session id, playbook id names the selected phase, depth is zero, parent identity is absent, and whose exact five ports additionally include `callPlaybook`; drive one non-interactive `handleBossInput` turn seeded from the phase input under an abort signal; then dispose it — without retrying initialization under another profile ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md#runtime-profiles-and-root-phase-sessions)).

### PHEXEC-24

When the slc command derives a compiled phase's terminal status, the slc command shall require `legacy` and `session-v1` turns to return `void` and map them by output delta plus failed-state telemetry; shall require `composed-v2` to return a valid structured result made only of plain, accessor-free data with exact outcome-variant fields, literal state status, recursive state value, and finite JSON output, treating hostile accessors or proxies as invalid rather than letting validation throw; shall map `quiescent` or `terminal` with newly produced declared output to `ok`, `quiescent` or `terminal` without new output and `no-action` to `blocked`, and `failed`, `aborted`, invalid, absent, unexpectedly `suspended`, or thrown results to `error`; shall reject a structured result from either void profile instead of inferring another profile; shall proceed to generic checks on `ok`, treat `blocked` as the `BLOCKED` outcome, and stop like a failed generic check on `error`; and shall report a disposal failure unless a prior turn failure already determines the outcome ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md#phase-result-mapping), [DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

### PHEXEC-25

Where a compiled phase runs, the slc command shall back the runtime's player and judge ports with coding agents reached through Cligent [[1]] per [DR-004](../decisions/004-slc-interpreted-phase-execution.md), apply per-player model selection as configuration without changing phase semantics, pass each explicit player `resume: false | string` selection and returned resume token unchanged, reject an omitted or invalid selection on `session-v1` and `composed-v2` before invoking the agent while preserving legacy omission, serialize judge calls through one abort-aware FIFO, provide `callPlaybook` only in the `composed-v2` port object and settle each such call with a deterministic unsupported-operation error because the phase host has no child stack, collect human status and non-trace operational telemetry as drainable diagnostics, and exclude every `playbook.trace` payload from ordinary diagnostics ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract), [DR-010](../decisions/010-playbook-runtime-contract-evolution.md#port-policy-and-diagnostic-privacy)).

### PHEXEC-27

When the slc command runs a phase, the slc command shall select its execution from the pin index: a phase with no pin — including when the pipeline has no pin file — interprets; a current pin runs the phase's compiled artifact, and fails the run closed when it cannot run that artifact rather than interpreting it; and a stale or malformed pin, or an unparseable pin file, stops the run with a diagnostic, never silently interpreting the phase ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#strategy-selection), [DR-007](../decisions/007-slc-phase-artifact-pinning.md#currency-and-selection)).

### PHEXEC-30

Where the slc command configures compiled execution from a current pin, when it selects the runtime contract profile, the slc command shall select `legacy` only for absent link-target provenance or exact `@sublang/playbook@0.9.0` provenance, reject every other provenance until an immutable release is mapped explicitly to `session-v1` or `composed-v2`, and neither infer the profile from callable runtime members nor retry a failed initialization under another profile ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md#runtime-profiles-and-root-phase-sessions)).

### PHEXEC-29

When the slc command seeds a compiled phase's non-interactive turn ([PHEXEC-23](#phexec-23)), the slc command shall pass one Boss turn whose text states the request kind — compile or link — in prose and carries the full request as a single JSON line introduced by `Request: `, with the request's workspace paths resolved to absolute host paths, so any compiled `playbook` artifact's classifier — or a deterministic consumer — recovers the exact phase input without host-specific parsing ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract)).

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

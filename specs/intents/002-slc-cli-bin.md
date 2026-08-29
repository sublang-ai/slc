<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-002: SLC CLI Bin Wiring

## Status

Done

## Intent

Turn the stubbed `slc` executable into a working command-line host over the existing `runSlc` core, with production pipeline resolution and a configuration-selected Cligent agent.
The iteration supplied the resolver and interpreted executor through the core's injected seams so a compiled executor could land later without bin rework.
The additive host layer left `runSlc` and the accepted decisions unchanged, while compiled execution, pinning, and the file capability remained follow-up work under [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).
The delivered behavior and its verification are now owned by the [`cli`](../packages/cli.md) package.

## Deliverables

- [x] `cli` spec package, registered in `map.md`
- [x] Concrete pipeline-reference resolver mapping a `<pipeline>` reference to one directory under a defined host policy ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md))
- [x] Configuration-driven agent/model selection with credentials from the environment, backing the interpreted executor through Cligent ([DR-004](../decisions/004-slc-interpreted-phase-execution.md))
- [x] Working `slc` bin over `runSlc`: full-pipeline, single-phase, `.link`, `--link`, `-o`, and `--link-option`, plus `--version`/`--help` and cancellation
- [x] Result reporting: canonical artifact paths on success; a phase/target/reasons report with a non-zero exit on any failure or `BLOCKED` ([DR-003](../decisions/003-slc-phase-execution.md))
- [x] Integration tests covering the bin behaviors, with the runSlc core and DRs unchanged

## Tasks

1. **Author the `cli` package behavior.**
   Write `specs/packages/cli.md` with the bin surface (running a documented invocation form, `--version`/`--help` with exit 0, printing canonical artifact paths on success, printing the phase/target/reasons report on failure or `BLOCKED` with a non-zero exit, and cancellation on interrupt) and host wiring (pipeline-reference resolution to one directory per [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md); agent-CLI and model selection from configuration with credentials from the environment per [DR-004](../decisions/004-slc-interpreted-phase-execution.md); constructing the interpreted executor over Cligent and injecting it with the resolver into `runSlc`; pre-handling `--version`/`--help`; interrupt-to-`AbortSignal` cancellation; and mapping `runSlc`'s result to printed output and a process exit code per [DR-003](../decisions/003-slc-phase-execution.md)).
   Register the `cli` package in `map.md`.
   Add SPDX headers per [[licensing-1](../packages/licensing.md#licensing-1)]/[[licensing-2](../packages/licensing.md#licensing-2)].

2. **Pipeline-reference resolver** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).
   Implement a concrete `PipelineResolver` that maps a `<pipeline>` reference to candidate directories under a defined host policy, returning every match so `runSlc`'s exactly-one rule refuses zero or many ([[pipeline-16](../packages/pipeline.md#pipeline-16)]).
   Unit-test the hit, miss, and ambiguous cases.

3. **Configuration and agent/model selection** ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).
   Resolve configuration into an agent-CLI selection (a Cligent adapter chosen by name) and an optional model, taking credentials from the environment, then construct the Cligent-backed `AgentClient` via `createCligentAgent` and the executor via `createInterpretedExecutor`, keeping selection configuration-only and never phase semantics ([[phase-execution-13](../packages/phase-execution.md#phase-execution-13)]).
   Unit-test the configuration resolution with adapter construction faked.

4. **Bin orchestration and reporting** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-003](../decisions/003-slc-phase-execution.md)).
   Refactor the bin entry into a testable async function that pre-parses `--version`/`--help` (print and exit 0), otherwise builds `SlcDeps` from Tasks 2–3, installs an interrupt handler that aborts the run, calls `runSlc`, prints canonical artifact paths to stdout on success and the formatted phase/target/reasons report to stderr on failure or `BLOCKED`, and returns a 0 or non-zero exit code.
   Update `src/cli.ts` and `src/index.ts` `run()` to this shape, leaving `runSlc` untouched.

5. **Author the `cli` package verification.**
   Add integration and system verification items to `specs/packages/cli.md`, binding every assertion inline to its same-package behavior under [[meta-20](../meta.md#meta-20)] and keeping unit tests outside the specs under [[meta-21](../meta.md#meta-21)]; register the package in `map.md`.

6. **Integration tests.**
   Implement the Task 5 items against the bin with a fake resolver and a faked agent transport: `--version`/`--help` output with exit 0; full-pipeline, single-phase, `.link`, and `--link` runs with `-o` and `--link-option` route correctly and print canonical paths with exit 0; a phase failure and a `BLOCKED` print the phase/target/reasons report with a non-zero exit; and an interrupt cancels the run.

## Verification

- Bin-boundary integration scenarios [[cli-13](../packages/cli.md#cli-13)] through [[cli-19](../packages/cli.md#cli-19)] preserve the iteration's acceptance coverage.
- The task commits left the `runSlc` core and accepted decisions unchanged, while compiled execution, pinning, and the file capability were not part of this iteration.

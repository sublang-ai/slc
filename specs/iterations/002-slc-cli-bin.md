<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-002: SLC CLI Bin Wiring

## Goal

Turn the stubbed `slc` bin into a working command-line compiler over the existing `runSlc` core, so the documented invocation forms run end-to-end with each phase interpreted by a coding agent ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)) because the compiled path ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)) is unimplemented.

- Dependencies: builds on the existing `runSlc` core, which already parses the CLI grammar, resolves and loads pipelines, places artifacts, and enforces the execution boundary; `runSlc` takes the pipeline resolver and the phase executor as injected dependencies ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-004](../decisions/004-slc-interpreted-phase-execution.md)), and this IR supplies the production ones.
- Strategy: the bin constructs the interpreted executor ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)) over a Cligent agent and injects it, so the resolver/executor seam stays the slot where a compiled executor ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)) lands later without bin rework.
- Out of scope: compiled phase execution, pinning, and the file capability ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)), which DR-005 itself defers; until those land, the bin interprets every phase.
- Constraint: no change to the `runSlc` core or to any DR; the bin is an additive host layer.

## Deliverables

- [ ] `cli` spec package (`user`, `dev`, `test`), short form `CLI`, registered in `map.md`
- [x] Concrete pipeline-reference resolver mapping a `<pipeline>` reference to one directory under a defined host policy ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md))
- [x] Configuration-driven agent/model selection with credentials from the environment, backing the interpreted executor through Cligent ([DR-004](../decisions/004-slc-interpreted-phase-execution.md))
- [x] Working `slc` bin over `runSlc`: full-pipeline, single-phase, `.link`, `--link`, `-o`, and `--link-option`, plus `--version`/`--help` and cancellation
- [x] Result reporting: canonical artifact paths on success; a phase/target/reasons report with a non-zero exit on any failure or `BLOCKED` ([DR-003](../decisions/003-slc-phase-execution.md))
- [ ] Integration tests covering the bin behaviors, with the runSlc core and DRs unchanged

## Tasks

1. **Author the user and dev `cli` spec items.**
   Write `specs/user/cli.md` (bin surface: running a documented invocation form, `--version`/`--help` with exit 0, printing canonical artifact paths on success, printing the phase/target/reasons report on failure or `BLOCKED` with a non-zero exit, and cancellation on interrupt) and `specs/dev/cli.md` (host wiring: pipeline-reference resolution to one directory per [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md); agent-CLI and model selection from configuration with credentials from the environment per [DR-004](../decisions/004-slc-interpreted-phase-execution.md); constructing the interpreted executor over Cligent and injecting it with the resolver into `runSlc`; pre-handling `--version`/`--help`; interrupt-to-`AbortSignal` cancellation; and mapping `runSlc`'s result to printed output and a process exit code per [DR-003](../decisions/003-slc-phase-execution.md)).
   Register the `CLI` package in `map.md`.
   Add SPDX headers per [LIC-1](../dev/licensing.md#lic-1)/[LIC-2](../dev/licensing.md#lic-2).

2. **Pipeline-reference resolver** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#directory-layout)).
   Implement a concrete `PipelineResolver` that maps a `<pipeline>` reference to candidate directories under a defined host policy, returning every match so `runSlc`'s exactly-one rule refuses zero or many ([PIPE-16](../dev/pipeline.md#pipe-16)).
   Unit-test the hit, miss, and ambiguous cases.

3. **Configuration and agent/model selection** ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter)).
   Resolve configuration into an agent-CLI selection (a Cligent adapter chosen by name) and an optional model, taking credentials from the environment, then construct the Cligent-backed `AgentClient` via `createCligentAgent` and the executor via `createInterpretedExecutor`, keeping selection configuration-only and never phase semantics ([PHEXEC-13](../dev/phase-execution.md#phexec-13)).
   Unit-test the configuration resolution with adapter construction faked.

4. **Bin orchestration and reporting** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli), [DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).
   Refactor the bin entry into a testable async function that pre-parses `--version`/`--help` (print and exit 0), otherwise builds `SlcDeps` from Tasks 2–3, installs an interrupt handler that aborts the run, calls `runSlc`, prints canonical artifact paths to stdout on success and the formatted phase/target/reasons report to stderr on failure or `BLOCKED`, and returns a 0 or non-zero exit code.
   Update `src/cli.ts` and `src/index.ts` `run()` to this shape, leaving `runSlc` untouched.

5. **Author the test `cli` spec items.**
   Write `specs/test/cli.md` as integration and system test items, each with a `Verifies:` line citing the Task 1 user/dev items ([META-20](../meta.md#meta-20), [META-21](../meta.md#meta-21)); register in `map.md`.

6. **Integration tests.**
   Implement the Task 5 items against the bin with a fake resolver and a faked agent transport: `--version`/`--help` output with exit 0; full-pipeline, single-phase, `.link`, and `--link` runs with `-o` and `--link-option` route correctly and print canonical paths with exit 0; a phase failure and a `BLOCKED` print the phase/target/reasons report with a non-zero exit; and an interrupt cancels the run.

## Acceptance criteria

- `slc <pipeline> <source>`, `slc <pipeline>.<phase> <source>`, `slc <pipeline>.link <object>... <target>`, and `slc <pipeline> <source> --link <target>`, each honoring `-o` and `--link-option`, run through the bin over `runSlc` and write or report canonical artifacts ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations), [DR-002](../decisions/002-slc-link-phases.md#cli)).
- Each phase is interpreted by a coding agent selected from configuration with credentials from the environment, with no compiled path used ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)).
- A `<pipeline>` reference resolves to its directory through the bin's resolver, and a reference resolving to zero or many is refused with a diagnostic ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#directory-layout)).
- On success the bin prints canonical artifact paths and exits 0; on any failure or `BLOCKED` it prints a report naming the phase, target, and reasons and exits non-zero ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).
- `--version` and `--help` print and exit 0, and an interrupt cancels the run.
- The `runSlc` core and all DRs are unchanged, and compiled execution, pinning, and the file capability remain out of scope ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)).

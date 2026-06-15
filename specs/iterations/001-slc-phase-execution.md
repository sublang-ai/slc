<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-001: SLC Interpreted Phase Execution

## Goal

Implement [DR-003](../decisions/003-slc-phase-execution.md) (phase execution boundary) and [DR-004](../decisions/004-slc-interpreted-phase-execution.md) (interpreted phase execution) as a working `slc` command.

- Dependencies: the repository has no code yet, and DR-003 delegates generic mechanics to [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) and [DR-002](../decisions/002-slc-link-phases.md); this IR therefore builds the minimal DR-001/DR-002 mechanics those DRs require to run.
- Strategy: interpreted execution via Cligent is the only executor in this IR; the boundary orchestrator exposes an executor interface that a future compiled executor can implement.
- Out of scope: compiled phase execution, pinning, and the file capability ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)), which DR-005 itself defers; until those land, `slc` interprets every phase.

## Deliverables

- [x] `slc` TypeScript/Node project scaffold with build, test, and lint
- [x] Generic pipeline mechanics: pipeline resolution, chain inference, source naming, artifact paths, CLI, link phases ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md))
- [x] Execution boundary: generic checks, write-scope enforcement, blocked protocol, failure reporting ([DR-003](../decisions/003-slc-phase-execution.md))
- [x] Interpreted executor via Cligent honoring the agent contract, one invocation per phase ([DR-004](../decisions/004-slc-interpreted-phase-execution.md))
- [x] Dev and test spec packages `pipeline` and `phase-execution`, registered in `map.md`
- [x] Integration tests for interpreted full-pipeline, single-phase, and link runs

## Tasks

1. **Scaffold the `slc` project.**
   Initialize a TypeScript/Node package with a `slc` `bin` entry, a test runner (e.g., Vitest), lint, and format scripts; `build` and `test` pass on a stub.
   Add SPDX headers per [LIC-3](../test/licensing.md#lic-3)/[LIC-4](../test/licensing.md#lic-4).

2. **Author dev spec packages.**
   Write `specs/dev/pipeline.md` (DR-001/DR-002 generic mechanics) and `specs/dev/phase-execution.md` (DR-003 boundary plus DR-004 interpreted execution and agent contract) as GEARS items; register both in `map.md`.

3. **Phase model and `## Formats` parsing** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#phase-format-declarations)).
   Parse a phase `.md`, extract the `## Formats` table, validate the `<source-format>2<target-format>.md` filename against its tokens, and refuse conflicting extensions for the same format token.

4. **Pipeline resolution and chain inference** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#full-pipeline-ordering)).
   Resolve a pipeline reference to its directory and phase files, infer the single linear chain (entry/exit), exclude `link.md`, and refuse incomplete, branching, or cyclic chains.

5. **Source naming and artifact paths** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations)).
   Validate entry and non-entry source filename forms, compute `<art-dir>` with the no-nesting rule, and compute intermediate and output paths honoring `-o`.

6. **CLI parsing and invocation routing** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli), [DR-002](../decisions/002-slc-link-phases.md#cli)).
   Parse `slc <pipeline>[.<phase>] <source> [-o <target>]`, `--link <target>`, and repeated `--link-option name=value`; route to full-pipeline, single-phase, or `.link`; infer no positional roles by extension.

7. **Link phase loading and link invocation** ([DR-002](../decisions/002-slc-link-phases.md#link-phase)).
   Load `link.md`, parse `## Formats` and `## Link Targets` (required symbols, options, validation), enforce a distinct linked-format token, order objects, and compute linked-artifact paths per the `.link` and `--link` output rules.

8. **Execution boundary orchestrator** ([DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).
   Run generic mechanics only behind an executor interface; snapshot inputs before the run and apply generic checks after (target exists, extension matches, source/objects/link target unchanged, chain still valid) ([DR-003](../decisions/003-slc-phase-execution.md#generic-checks)); enforce target/linked-only write scope; surface the blocked protocol and emit failure reports naming phase, target path, and reasons ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

9. **Interpreted executor via Cligent** ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter)).
   Implement the executor interface by prompting a coding agent through `@sublang/cligent`, building the agent-contract prompt ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#agent-contract)); one invocation per phase ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#scope)); agent and model selection from `slc` config, not phase semantics; wire into the Task 8 orchestrator.

10. **Author test spec packages.**
    Write `specs/test/pipeline.md` and `specs/test/phase-execution.md` as integration and system test items, each with a `Verifies:` line citing the Task 2 dev items; register both in `map.md`.

11. **Integration tests.**
    Implement the Task 10 test items against a sample pipeline (with a faked agent transport), covering interpreted full-pipeline, single-phase, and `.link` runs, plus blocked and generic-check-failure paths.

## Acceptance criteria

- `slc <pipeline> <source>` runs a full interpreted pipeline, writing intermediates and the output to canonical paths ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations)).
- `slc <pipeline>.<phase> <source>` and `slc <pipeline>.link <object>... <target>` run a single phase or link to the same locations ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli), [DR-002](../decisions/002-slc-link-phases.md#cli)).
- The `slc` command holds no phase-specific transformation rules, prompt notes, or semantic validators ([DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).
- Generic checks enforce target existence, extension match, input integrity, and chain validity; any violation or `BLOCKED` stops the pipeline with a report naming phase, target, and reasons ([DR-003](../decisions/003-slc-phase-execution.md#generic-checks), [DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).
- Each phase is interpreted by one Cligent agent invocation under the agent contract, available for every phase with no compilation step ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter), [DR-004](../decisions/004-slc-interpreted-phase-execution.md#agent-contract)).
- Compiled execution, pinning, and the file capability ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)) remain unimplemented and `slc` interprets every phase.

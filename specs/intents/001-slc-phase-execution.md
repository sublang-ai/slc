<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-001: SLC Interpreted Phase Execution

## Status

Done

## Intent

Implement [DR-003](../decisions/003-slc-phase-execution.md) and [DR-004](../decisions/004-slc-interpreted-phase-execution.md) as the runnable `runSlc` core behind injected pipeline-resolution and executor boundaries.
Starting from a repository with no code, this iteration included the minimal [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) and [DR-002](../decisions/002-slc-link-phases.md) mechanics needed to exercise that core.
Interpreted execution through Cligent was this iteration's only executor, while the executor seam reserved a later compiled implementation.
Published-bin resolver and agent-selection wiring remained separate host follow-up work, while compiled execution, pinning, and the file capability remained follow-up work under [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).
The delivered behavior and its verification are now owned by the [`pipeline`](../packages/pipeline.md) and [`phase-execution`](../packages/phase-execution.md) packages.

## Deliverables

- [x] `slc` TypeScript/Node project scaffold with build, test, and lint
- [x] Generic pipeline mechanics: pipeline resolution, chain inference, source naming, artifact paths, CLI, link phases ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md))
- [x] Execution boundary: generic checks, write-scope enforcement, blocked protocol, failure reporting ([DR-003](../decisions/003-slc-phase-execution.md))
- [x] Interpreted executor via Cligent honoring the agent contract, one invocation per phase ([DR-004](../decisions/004-slc-interpreted-phase-execution.md))
- [x] Spec packages `pipeline` and `phase-execution`, registered in `map.md`
- [x] Integration tests for interpreted full-pipeline, single-phase, and link runs

## Tasks

1. **Scaffold the `slc` project.**
   Initialize a TypeScript/Node package with a `slc` `bin` entry, a test runner (e.g., Vitest), lint, and format scripts; `build` and `test` pass on a stub.
   Add SPDX headers per [[licensing-3](../packages/licensing.md#licensing-3)]/[[licensing-4](../packages/licensing.md#licensing-4)].

2. **Author package behavior.**
   Write `specs/packages/pipeline.md` for the generic mechanics and `specs/packages/phase-execution.md` for the execution boundary and interpreted agent contract as GEARS behavior items; register both in `map.md`.

3. **Phase model and `## Formats` parsing** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).
   Parse a phase `.md`, extract the `## Formats` table, validate the `<source-format>2<target-format>.md` filename against its tokens, and refuse conflicting extensions for the same format token.

4. **Pipeline resolution and chain inference** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).
   Resolve a pipeline reference to its directory and phase files, infer the single linear chain (entry/exit), exclude `link.md`, and refuse incomplete, branching, or cyclic chains.

5. **Source naming and artifact paths** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).
   Validate entry and non-entry source filename forms, compute `<art-dir>` with the no-nesting rule, and compute intermediate and output paths honoring `-o`.

6. **CLI parsing and invocation routing** ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md)).
   Parse `slc <pipeline>[.<phase>] <source> [-o <target>]`, `--link <target>`, and repeated `--link-option name=value`; route to full-pipeline, single-phase, or `.link`; infer no positional roles by extension.

7. **Link phase loading and link invocation** ([DR-002](../decisions/002-slc-link-phases.md)).
   Load `link.md`, parse `## Formats` and `## Link Targets` (required symbols, options, validation), enforce a distinct linked-format token, order objects, and compute linked-artifact paths per the `.link` and `--link` output rules.

8. **Execution boundary orchestrator** ([DR-003](../decisions/003-slc-phase-execution.md)).
   Run generic mechanics only behind an executor interface; snapshot inputs before the run and apply generic checks after (target exists, extension matches, source/objects/link target unchanged, chain still valid) ([DR-003](../decisions/003-slc-phase-execution.md)); enforce target/linked-only write scope; surface the blocked protocol and emit failure reports naming phase, target path, and reasons ([DR-003](../decisions/003-slc-phase-execution.md)).

9. **Interpreted executor via Cligent** ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).
   Implement the executor interface by prompting a coding agent through `@sublang/cligent`, building the agent-contract prompt ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)); one invocation per phase ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)); agent and model selection from `slc` config, not phase semantics; wire into the Task 8 orchestrator.

10. **Author package verification.**
    Write integration and system verification items in `specs/packages/pipeline.md` and `specs/packages/phase-execution.md`, binding each assertion to its same-package behavior inline under [[meta-20](../meta.md#meta-20)] and keeping unit tests outside the specs under [[meta-21](../meta.md#meta-21)]; register both packages in `map.md`.

11. **Integration tests.**
    Implement the Task 10 test items against a sample pipeline (with a faked agent transport), covering interpreted full-pipeline, single-phase, and `.link` runs, plus blocked and generic-check-failure paths.

## Verification

- The scaffold's build, test, lint, and format checks passed when Task 1 completed.
- Package-local integration and system scenarios [[pipeline-20](../packages/pipeline.md#pipeline-20)] through [[pipeline-29](../packages/pipeline.md#pipeline-29)] and [[phase-execution-16](../packages/phase-execution.md#phase-execution-16)] through [[phase-execution-22](../packages/phase-execution.md#phase-execution-22)] preserve the iteration's acceptance coverage.
- Published-bin wiring, compiled execution, pinning, and the file capability were not part of this iteration.

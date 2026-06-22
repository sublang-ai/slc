<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-006: Reconcile Compiled Execution with Playbook's PlaybookRuntime Contract

## Goal

`@sublang/playbook@0.7.0` ships the `slc/` meta-pipeline definitions SLC now consumes (IR-005, [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)), but its linked-artifact contract diverges from [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and [DR-008](../decisions/008-slc-file-capability.md) as written: the link phase emits the `playbook` format (not `phase`), the artifact default-exports a `PlaybookRuntimeFactory` (`createPlaybookRuntime` → `init`/`handleBossInput`/`dispose`, not SLC's `createPhaseRunner`), and `init` receives only `PlaybookPorts` (so a `FileCapability` cannot be artifact-facing).
This iteration reconciles SLC's compiled-execution contract with the shipped Playbook contract: adopt the `playbook` linked format, move SLC's phase-runner facade out of the artifact into a host-side adapter that drives the runtime non-interactively, and relocate the standardized file capability host-side.
It updates the affected decisions ([DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-008](../decisions/008-slc-file-capability.md)) and reworks the compiled-execution code, specs, and tests delivered by IR-005 Tasks 3/5/7.

- Context: [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) already frames a compiled artifact as "a non-interactive playbook" driven to a terminal state, so the runtime *concept* is aligned; what diverges is the artifact's exported surface, the format name, the link-phase structure, and the file-capability plumbing.
- State today: IR-005 consumes Playbook's `slc/` compile chain (`text2gears` → `gears2fsm`) and pins/selects compiled artifacts against an SLC `phase` contract; the reserved `slc` link is not yet driven, because Playbook's `link.md` is `playbook`-format with no `## Link Targets`, which SLC's link machinery rejects (recorded by IR-005's link boundary test).
- Why not one commit: it revises three Accepted DRs and reworks three committed subsystems — facade, loader/executor, pinning — plus the self-hosting specs, locations, and fixtures; each is substantial and separately reviewable.
- Sequencing: the DR reconciliation (A) fixes the contract; the facade and format detection (B) and the runtime-driving executor (C) implement it; pinning (D) and self-hosting/locations (E) follow the rename; the reserved-`slc` link (F) closes the loop.
- Decisions adopted (pending Boss review): the linked format is renamed `phase` → `playbook` to match the consumed Playbook output, keeping a single source of truth; the file capability becomes host/executor-side because Playbook's `init(ports: PlaybookPorts)` is fixed and its runtime touches no host types beyond ports, so deterministic reads/writes are staged around the runtime rather than handed to the artifact.
- Out of scope (Boss-owned prerequisite): building and reviewing the first compiled `playbook` artifact (the IR-005 Task 10 carryover), which gates exercising pinned end-to-end execution against a real artifact.

## Deliverables

- [ ] [DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), and [DR-008](../decisions/008-slc-file-capability.md) updated to Playbook 0.7.0's `playbook`/`PlaybookRuntime` contract: the `playbook` linked format (`fsm` `.ts` → `playbook` `.ts`), the artifact as a `PlaybookRuntimeFactory`, the SLC facade as a host-side non-interactive driver, and the file capability host/executor-side
- [ ] The phase-runner facade rebound to `@sublang/playbook`'s `PlaybookRuntime`/`PlaybookRuntimeFactory` (from its `./runtime` surface), with `playbook`-format detection replacing `resolvesToPhase` (extends `PHEXEC`)
- [ ] The compiled loader and `CompiledExecutor` reworked into the non-interactive runtime driver — `init` → `handleBossInput` seeded from `PhaseInput` → drive to a terminal state → `dispose` — mapping the terminal state onto the `ok`/`blocked`/`error` protocol, with the file capability supplied host-side and writes confined to `target`/`linked` (extends `PHEXEC`)
- [ ] Pin currency's artifact-format sub-check updated to recognize the `playbook` factory, and `PIN` items renamed `phase` → `playbook`
- [ ] `SELFHOST` (`user`/`dev`/`test`) and the [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) output locations renamed `phase` → `playbook` (`.playbook.ts`), with `map.md` updated and the IR-005 link boundary test replaced by a real reserved-`slc` link test
- [ ] The reserved `slc` link driven end-to-end so `slc slc <source> --link <target>` produces a `.playbook.ts` runtime through Playbook's link definition

## Tasks

Each task is one-commit-sized and updates decisions, specs, code, and tests together as applicable.

### A. Decision reconciliation

1. **Update DR-002/005/008 to the Playbook 0.7.0 contract.**
   Revise [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) so the link phase emits `playbook` (`fsm` `.ts` → `playbook` `.ts`), the artifact is a `PlaybookRuntimeFactory` (`createPlaybookRuntime`/`init`/`handleBossInput`/`dispose`), the SLC phase-runner facade is a host-side non-interactive driver rather than an artifact export, and the file capability is host/executor-side (`init` takes only `PlaybookPorts`); note in [DR-002](../decisions/002-slc-link-phases.md) how the reserved `slc` link reconciles with Playbook's link definition; revise [DR-008](../decisions/008-slc-file-capability.md) for the host-side capability role; refresh the Playbook reference to 0.7.0. Doc-only.

### B. Facade and format detection ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

2. **Rebind the phase-runner facade to `PlaybookRuntime`.**
   Import `PlaybookRuntime`/`PlaybookRuntimeFactory` from `@sublang/playbook`'s `./runtime` surface, replace `resolvesToPhase` with `playbook`-format detection over the artifact bytes, and rename `phase` → `playbook` in the `PHEXEC` `dev`/`test` items the facade owns.
   Unit-test format detection and the protocol mapping.

### C. Runtime-driving executor ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-008](../decisions/008-slc-file-capability.md))

3. **Rework the loader and `CompiledExecutor` into the non-interactive driver.**
   Load `createPlaybookRuntime`, construct the runtime, `init` it with the `PlaybookPorts` adapter, seed and drive it via `handleBossInput` from `PhaseInput` to a terminal state, `dispose`, and map the terminal state and drained diagnostics onto the `ok`/`blocked`/`error` protocol; stage deterministic reads/writes through the host-side file capability, confined to `target`/`linked`.
   Test against a fixture `playbook` runtime module, including `ok`, `blocked`, and `error`.

### D. Pinning ([DR-007](../decisions/007-slc-phase-artifact-pinning.md))

4. **Update pin currency to the `playbook` artifact.**
   Replace the `resolvesToPhase` currency sub-check with `playbook`-factory detection and rename `phase` → `playbook` across the `PIN` items.
   Unit- and integration-test the updated sub-check.

### E. Self-hosting and locations ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md))

5. **Rename the self-hosting contract and locations.**
   Rename `phase` → `playbook` across `SELFHOST` (`user`/`dev`/`test`) and the [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) `.playbook.ts` output locations, update `map.md`, and replace the IR-005 link boundary test with a reserved-`slc` link test now that linking is supported.

### F. Reserved `slc` link ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md))

6. **Drive the reserved `slc` link end-to-end.**
   Make `slc slc <source> --link <target>` produce a `.playbook.ts` runtime through Playbook's link definition, reconciling the reserved link path with Playbook's `link.md` (which carries no `## Link Targets`).
   Integration-test reserved-`slc` linking to a `.playbook.ts` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) location.

## Acceptance criteria

- A pinned phase runs its compiled `playbook` artifact by driving a `PlaybookRuntime` non-interactively through the SLC host adapter; an unpinned phase interprets unchanged; a stale, malformed, or missing pin fails closed with a diagnostic and never silently interprets.
- The compiled artifact reaches agents, judges, status, and telemetry only through `PlaybookPorts` and receives no host types beyond them; deterministic file reads and writes are mediated host-side and confined to the `target` or `linked` path, honoring the [DR-003](../decisions/003-slc-phase-execution.md) write-scope invariant.
- `slc slc <source> --link <target>` emits a `.playbook.ts` runtime at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) location, and `slc slc <source>` without `--link` still stops at the `fsm` object.
- [DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-008](../decisions/008-slc-file-capability.md), `SELFHOST`, `PIN`, and `PHEXEC` consistently describe the `playbook` linked format and the host-side file capability, with no `phase`-format references remaining outside historical iteration records.
- Interpreted execution, the [DR-003](../decisions/003-slc-phase-execution.md) boundary and generic checks, and the [DR-004](../decisions/004-slc-interpreted-phase-execution.md) reference semantics are unchanged, and compiled execution stays behavior-equivalent to interpreting the definition (established by review).

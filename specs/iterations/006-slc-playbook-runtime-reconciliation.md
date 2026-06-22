<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-006: Reconcile Compiled Execution with Playbook's PlaybookRuntime Contract

## Goal

`@sublang/playbook@0.7.0` ships the `slc/` meta-pipeline definitions SLC now consumes (IR-005, [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)), but its linked-artifact contract diverges from [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and [DR-008](../decisions/008-slc-file-capability.md) as written: the link phase emits the `playbook` format (not `phase`), the artifact default-exports a `PlaybookRuntimeFactory` (`createPlaybookRuntime` → `init`/`handleBossInput`/`dispose`, not SLC's `createPhaseRunner`), and `init` receives only `PlaybookPorts` (so a `FileCapability` cannot be artifact-facing).
This iteration reconciles SLC's compiled-execution contract with the shipped Playbook contract: adopt the `playbook` linked format, move SLC's phase-runner facade out of the artifact into a host-side adapter that drives the runtime non-interactively, and relocate the standardized file capability host-side.
It updates the affected decisions ([DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-008](../decisions/008-slc-file-capability.md)) and reworks the compiled-execution code, specs, and tests delivered by IR-005 Tasks 3/5/7.

- Context: [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) already frames a compiled artifact as "a non-interactive playbook" driven to completion, so the runtime *concept* is aligned; what diverges is the artifact's exported surface, the format name, the link-phase structure, and the file-capability plumbing.
- State today: IR-005 consumes Playbook's `slc/` compile chain (`text2gears` → `gears2fsm`) and pins/selects compiled artifacts against an SLC `phase` contract; the reserved `slc` link is not yet driven, because Playbook's `link.md` is `playbook`-format with no `## Link Targets`, which SLC's link machinery rejects (recorded by IR-005's link boundary test).
- Why not one commit: it revises three Accepted DRs and reworks three committed subsystems — facade, loader/executor, pinning — plus the self-hosting specs, locations, and fixtures; each is substantial and separately reviewable.
- Sequencing: the DR reconciliation (A) fixes the contract; the facade and format detection (B) and the runtime-driving executor (C) implement it; pinning (D) and self-hosting/locations (E) follow the rename; the reserved-`slc` link (F) closes the loop.
- Decisions adopted (pending Boss review): the linked format is renamed `phase` → `playbook` to match the consumed Playbook output, keeping a single source of truth; the file capability becomes host/executor-side because Playbook's `init(ports: PlaybookPorts)` is fixed and its runtime touches no host types beyond ports, so deterministic reads/writes are staged around the runtime rather than handed to the artifact.
- Out of scope (Boss-owned prerequisite): building and reviewing the first compiled `playbook` artifact (the IR-005 Task 10 carryover), which gates exercising pinned end-to-end execution against a real artifact.

## Deliverables

- [x] [DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), and [DR-008](../decisions/008-slc-file-capability.md) updated to Playbook 0.7.0's `playbook`/`PlaybookRuntime` contract: the `playbook` linked format (`fsm` `.ts` → `playbook` `.ts`), the artifact as a `PlaybookRuntimeFactory`, the SLC facade as a host-side non-interactive driver, and the file capability host/executor-side
- [x] The Playbook import surface migrated to `@sublang/playbook`'s generic `./runtime` entry (the canonical `PlaybookPorts`/`PlaybookRuntime`/`PlaybookRuntimeFactory` source), so the facade and ports bind to it instead of the `code/playbook` reference realization
- [x] The compiled loader and `CompiledExecutor` reworked into the non-interactive runtime driver — `init` → `handleBossInput` seeded from `PhaseInput` → drive to quiescence → `dispose` — deriving `ok`/`blocked`/`error` from the host-observable outcome (the `void`-returning `handleBossInput` resolving versus throwing, plus the quiescent state and diagnostics seen through `emitStatus`/`emitTelemetry`), with the file capability supplied host-side and writes confined to `target`/`linked`; this lands the facade-type rebind and `playbook`-format detection (`createPlaybookRuntime`) replacing `resolvesToPhase` together with the `createPlaybookRuntime` fixtures the loader accepts, since facade type, detection, loader, and fixtures are one green unit (extends `PHEXEC`)
- [x] The `FCAP` package (`dev`, `test`) and its `map.md` summary reconciled to [DR-008](../decisions/008-slc-file-capability.md)'s host-side capability — host-owned rather than artifact-facing — repointing FCAP-1's citation from the removed `#artifact-facing-api` anchor to `#capability-api`
- [ ] Pin currency's artifact-format sub-check updated to recognize the `playbook` factory, and `PIN` items renamed `phase` → `playbook`
- [ ] `SELFHOST` (`user`/`dev`/`test`) and the [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) output locations renamed `phase` → `playbook` (`.playbook.ts`), with `map.md` updated
- [ ] The reserved `slc` link driven end-to-end so `slc slc <source> --link <target>` produces a `.playbook.ts` runtime through Playbook's link definition, with [PIPE-11](../dev/pipeline.md#pipe-11)'s `## Link Targets` requirement reconciled to except the reserved `slc` link, replacing the IR-005 link boundary test with a passing reserved-`slc` link test

## Tasks

Each task is one-commit-sized and updates decisions, specs, code, and tests together as applicable.

### A. Decision reconciliation

1. **Update DR-002/005/007/008 to the Playbook 0.7.0 contract.**
   Revise [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) so the link phase emits `playbook` (`fsm` `.ts` → `playbook` `.ts`), the artifact is a `PlaybookRuntimeFactory` (`createPlaybookRuntime`/`init`/`handleBossInput`/`dispose`), the SLC phase-runner facade is a host-side non-interactive driver (rather than an artifact export) that derives `ok`/`blocked`/`error` from the runtime's host-observable outcome since `handleBossInput` returns `void`, and the file capability is host/executor-side (`init` takes only `PlaybookPorts`); note in [DR-002](../decisions/002-slc-link-phases.md) how the reserved `slc` link reconciles with Playbook's link definition; rename the linked `phase` format to `playbook` in [DR-007](../decisions/007-slc-phase-artifact-pinning.md)'s pin-currency sub-check (the artifact must resolve to the linked format); revise [DR-008](../decisions/008-slc-file-capability.md) for the host-side capability role; refresh the Playbook reference to 0.7.0. Doc-only.

### B. Playbook import surface ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

2. **Migrate the facade and ports to Playbook's `./runtime` entry.**
   Move the `PlaybookPorts`/`PlayerResult` imports in `phase-runner.ts` and `playbook-ports.ts` from the `@sublang/playbook/code/playbook` reference realization to the generic `./runtime` surface DR-005 names, refreshing the doc comments. (Detection, the facade type, and the `PHEXEC` rename move to Task 3, where they land green with the loader and fixtures.)

### C. Runtime-driving executor ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-008](../decisions/008-slc-file-capability.md))

3. **Rework the loader and `CompiledExecutor` into the non-interactive driver.**
   Rebind the facade type to the runtime contract and replace `resolvesToPhase` with `playbook`-format (`createPlaybookRuntime`) detection, renaming `phase` → `playbook` in the `PHEXEC` `dev`/`test` items; the loader, the facade type, the detection, and the `createPlaybookRuntime` test fixtures across the pinning/selection/self-host suites move together as one green unit, since a fixture must be a form the loader accepts and the detector recognizes.
   Load `createPlaybookRuntime`, construct the runtime, `init` it with the `PlaybookPorts` adapter, seed and drive it via `handleBossInput` from `PhaseInput` to quiescence, then `dispose`. Because `handleBossInput` returns `void`, derive the protocol result from the host-observable outcome: a clean resolve at a success state is `ok`, a quiescent state that parks for Boss input a non-interactive run cannot supply is `blocked`, and a throw or a `failed` state is `error`, with diagnostics drained from `emitStatus`/`emitTelemetry`. Stage deterministic reads/writes through the host-side file capability, confined to `target`/`linked`.
   Test against a fixture `playbook` runtime module, including `ok`, `blocked`, and `error`. Settling the host-observable mapping benefits from the first reviewed `playbook` artifact (the Boss-owned prerequisite).

### D. Pinning ([DR-007](../decisions/007-slc-phase-artifact-pinning.md))

4. **Update pin currency to the `playbook` artifact.**
   Replace the `resolvesToPhase` currency sub-check with `playbook`-factory detection and rename `phase` → `playbook` across the `PIN` items.
   Unit- and integration-test the updated sub-check.

### E. Self-hosting and locations ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md))

5. **Rename the self-hosting contract and locations.**
   Rename `phase` → `playbook` across `SELFHOST` (`user`/`dev`/`test`) and the [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) `.playbook.ts` output locations, and update `map.md`. The IR-005 link boundary test stays until Task 6 makes linking work.

### F. Reserved `slc` link ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md))

6. **Drive the reserved `slc` link end-to-end.**
   Make `slc slc <source> --link <target>` produce a `.playbook.ts` runtime through Playbook's link definition, reconciling the reserved link path with Playbook's `link.md` (which carries no `## Link Targets`), and reconcile [PIPE-11](../dev/pipeline.md#pipe-11)'s `## Link Targets` requirement to except the reserved `slc` link.
   Replace the IR-005 link boundary test with a passing integration test of reserved-`slc` linking to a `.playbook.ts` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) location.

### G. File capability package ([DR-008](../decisions/008-slc-file-capability.md))

7. **Reconcile the `FCAP` package to host-side.**
   Update `FCAP` (`dev`, `test`) and the `map.md` summary so the capability is host-owned rather than artifact-facing, repointing FCAP-1's citation from the removed `#artifact-facing-api` anchor to `#capability-api`, and adjust any `FCAP` test items the reframing touches. Unblocked by Task 1; the dead anchor it repairs is a Task-1 byproduct.

## Acceptance criteria

- A pinned phase runs its compiled `playbook` artifact by driving a `PlaybookRuntime` non-interactively through the SLC host adapter; an unpinned phase interprets unchanged; a stale, malformed, or missing pin fails closed with a diagnostic and never silently interprets.
- The compiled artifact reaches agents, judges, status, and telemetry only through `PlaybookPorts` and receives no host types beyond them; deterministic file reads and writes are mediated host-side and confined to the `target` or `linked` path, honoring the [DR-003](../decisions/003-slc-phase-execution.md) write-scope invariant.
- `slc slc <source> --link <target>` emits a `.playbook.ts` runtime at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) location, and `slc slc <source>` without `--link` still stops at the `fsm` object.
- [DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-008](../decisions/008-slc-file-capability.md), `SELFHOST`, `PIN`, and `PHEXEC` consistently describe the `playbook` linked format and the host-side file capability, with no `phase`-format references remaining outside historical iteration records.
- Interpreted execution, the [DR-003](../decisions/003-slc-phase-execution.md) boundary and generic checks, and the [DR-004](../decisions/004-slc-interpreted-phase-execution.md) reference semantics are unchanged, and compiled execution stays behavior-equivalent to interpreting the definition (established by review).

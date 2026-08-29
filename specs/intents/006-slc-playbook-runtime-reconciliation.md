<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-006: Reconcile Compiled Execution with Playbook's PlaybookRuntime Contract

## Status

Done

## Intent

Reconcile the initial compiled-execution path with the consumed `PlaybookRuntime` contract under [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), and [DR-008](../decisions/008-slc-file-capability.md).
The iteration adopted the `playbook` linked format, a host-side non-interactive runtime driver, matching artifact detection and pinning, canonical locations, and the reserved `slc` link.
Seven one-commit tasks sequenced the decision reconciliation, runtime import and driver, pinning, self-hosting locations and link, and then-existing host-side capability package.
Building the first reviewed compiled artifact and enforcing the deferred player sandbox remained follow-up work at completion, and the sandbox and capability were later removed under [DR-008](../decisions/008-slc-file-capability.md).
Delivered behavior and evidence are now owned by the [`phase-execution`](../packages/phase-execution.md), [`pinning`](../packages/pinning.md), [`pipeline`](../packages/pipeline.md), and [`self-hosting`](../packages/self-hosting.md) packages.

## Deliverables

- [x] [DR-002](../decisions/002-slc-link-phases.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), and [DR-008](../decisions/008-slc-file-capability.md) updated to Playbook 0.7.0's `playbook`/`PlaybookRuntime` contract: the `playbook` linked format (`fsm` `.ts` → `playbook` `.ts`), the artifact as a `PlaybookRuntimeFactory`, the SLC facade as a host-side non-interactive driver, and the file capability host/executor-side
- [x] The Playbook import surface migrated to `@sublang/playbook`'s generic `./runtime` entry (the canonical `PlaybookPorts`/`PlaybookRuntime`/`PlaybookRuntimeFactory` source), so the facade and ports bind to it instead of the `code/playbook` reference realization
- [x] The compiled loader and `CompiledExecutor` reworked into the non-interactive runtime driver — `init` → `handleBossInput` seeded from `PhaseInput` → drive to quiescence → `dispose` — deriving `ok`/`blocked`/`error` from the host-observable outcome (the `void`-returning `handleBossInput` resolving versus throwing, plus whether the run created or updated its declared output, and diagnostics seen through `emitStatus`/`emitTelemetry`), with the runtime receiving only `PlaybookPorts` — host-side deterministic-I/O staging and `target`/`linked` write-scope enforcement are deferred (the grant machinery is built but reserved for a player sandbox); this lands the facade-type rebind and `playbook`-format detection (`createPlaybookRuntime`) replacing `resolvesToPhase` together with the `createPlaybookRuntime` fixtures the loader accepts, since facade type, detection, loader, and fixtures are one green unit (extends `phase-execution`)
- [x] The since-removed file-capability package and its `map.md` summary reconciled to [DR-008](../decisions/008-slc-file-capability.md)'s host-side capability — host-owned rather than artifact-facing — and its decision citation repaired
- [x] Pin currency's artifact-format sub-check updated to recognize the `playbook` factory, and `pinning` items renamed `phase` → `playbook`
- [x] The [`self-hosting`](../packages/self-hosting.md) package and the [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) output locations renamed `phase` → `playbook` (`.playbook.ts`), with `map.md` updated
- [x] The reserved `slc` link driven end-to-end so `slc slc <source> --link <target>` produces a `.playbook.ts` runtime through Playbook's link definition, with [[pipeline-11](../packages/pipeline.md#pipeline-11)]'s `## Link Targets` requirement reconciled to except the reserved `slc` link, replacing the initial link-boundary test with a passing reserved-`slc` link test

## Tasks

Each task is one-commit-sized and updates decisions, specs, code, and tests together as applicable.

### A. Decision reconciliation

1. **Update DR-002/005/007/008 to the Playbook 0.7.0 contract.**
   Revise [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) so the link phase emits `playbook` (`fsm` `.ts` → `playbook` `.ts`), the artifact is a `PlaybookRuntimeFactory` (`createPlaybookRuntime`/`init`/`handleBossInput`/`dispose`), the SLC phase-runner facade is a host-side non-interactive driver (rather than an artifact export) that derives `ok`/`blocked`/`error` from the runtime's host-observable outcome since `handleBossInput` returns `void`, and the file capability is host/executor-side (`init` takes only `PlaybookPorts`); note in [DR-002](../decisions/002-slc-link-phases.md) how the reserved `slc` link reconciles with Playbook's link definition; rename the linked `phase` format to `playbook` in [DR-007](../decisions/007-slc-phase-artifact-pinning.md)'s pin-currency sub-check (the artifact must resolve to the linked format); revise [DR-008](../decisions/008-slc-file-capability.md) for the host-side capability role; refresh the Playbook reference to 0.7.0. Doc-only.

### B. Playbook import surface ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

2. **Migrate the facade and ports to Playbook's `./runtime` entry.**
   Move the `PlaybookPorts`/`PlayerResult` imports in `phase-runner.ts` and `playbook-ports.ts` from the `@sublang/playbook/code/playbook` reference realization to the generic `./runtime` surface DR-005 names, refreshing the doc comments. (Detection, the facade type, and the `phase-execution` rename move to Task 3, where they land green with the loader and fixtures.)

### C. Runtime-driving executor ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-008](../decisions/008-slc-file-capability.md))

3. **Rework the loader and `CompiledExecutor` into the non-interactive driver.**
   Rebind the facade type to the runtime contract and replace `resolvesToPhase` with `playbook`-format (`createPlaybookRuntime`) detection, renaming `phase` → `playbook` in the `phase-execution` behavior and verification items; the loader, the facade type, the detection, and the `createPlaybookRuntime` test fixtures across the pinning/selection/self-host suites move together as one green unit, since a fixture must be a form the loader accepts and the detector recognizes.
   Load `createPlaybookRuntime`, construct the runtime, `init` it with the `PlaybookPorts` adapter, seed and drive it via `handleBossInput` from `PhaseInput` to quiescence, then `dispose`. Because `handleBossInput` returns `void`, derive the protocol result from the host-observable outcome: a clean turn that creates or updates the declared output is `ok`, a clean turn that leaves it untouched (parked for Boss input a non-interactive run cannot supply) is `blocked`, and a throw or abort is `error`, with diagnostics drained from `emitStatus`/`emitTelemetry`. The runtime receives only `PlaybookPorts`; host-side deterministic-I/O staging and `target`/`linked` write-scope enforcement through the file capability are deferred (the grant machinery is reserved for a player sandbox).
   Test against a fixture `playbook` runtime module, including `ok`, `blocked`, and `error`. Settling the host-observable mapping benefits from the first reviewed `playbook` artifact (the Boss-owned prerequisite).

### D. Pinning ([DR-007](../decisions/007-slc-phase-artifact-pinning.md))

4. **Update pin currency to the `playbook` artifact.**
   Replace the `resolvesToPhase` currency sub-check with `playbook`-factory detection and rename `phase` → `playbook` across the `pinning` items.
   Unit- and integration-test the updated sub-check.

### E. Self-hosting and locations ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md))

5. **Rename the self-hosting contract and locations.**
   Rename `phase` → `playbook` across the [`self-hosting`](../packages/self-hosting.md) package and the [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) `.playbook.ts` output locations, and update `map.md`.
   The initial link-boundary test stays until Task 6 makes linking work.

### F. Reserved `slc` link ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md))

6. **Drive the reserved `slc` link end-to-end.**
   Make `slc slc <source> --link <target>` produce a `.playbook.ts` runtime through Playbook's link definition, reconciling the reserved link path with Playbook's `link.md` (which carries no `## Link Targets`), and reconcile [[pipeline-11](../packages/pipeline.md#pipeline-11)]'s `## Link Targets` requirement to except the reserved `slc` link.
   Replace the initial link-boundary test with a passing integration test of reserved-`slc` linking to a `.playbook.ts` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) location.

### G. File capability package ([DR-008](../decisions/008-slc-file-capability.md))

7. **Reconcile the file-capability package to host-side.**
   Update the file-capability package behavior and verification and the `map.md` summary so the capability is host-owned rather than artifact-facing, repair its decision citation, and adjust any verification the reframing touches.
   This task is unblocked by Task 1 because the dead anchor it repairs is a Task-1 byproduct.

## Verification

- The seven checked deliverables and seven task commits establish completion of the runtime reconciliation.
- Current runtime and selection scenarios [[phase-execution-26](../packages/phase-execution.md#phase-execution-26)] and [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)], artifact-format scenario [[pinning-14](../packages/pinning.md#pinning-14)], reserved-pipeline scenarios [[self-hosting-4](../packages/self-hosting.md#self-hosting-4)] and [[self-hosting-5](../packages/self-hosting.md#self-hosting-5)], and reserved-link scenario [[pipeline-42](../packages/pipeline.md#pipeline-42)] preserve the iteration's acceptance coverage.
- [DR-008](../decisions/008-slc-file-capability.md) records the later capability removal, while the first reviewed compiled artifact remained outside this iteration.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-005: SLC Compiled Execution and Self-Hosting Meta-Pipeline

## Status

Superseded — the initial `phase` artifact and file-capability design was replaced by the `PlaybookRuntime` contract, and the capability was later removed under [DR-008](../decisions/008-slc-file-capability.md).

## Intent

Implement the first end-to-end compiled-execution and reserved-`slc` self-hosting design under [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), and [DR-008](../decisions/008-slc-file-capability.md).
The iteration began from interpreted-only execution plus an unwired pin validator and decomposed capability, facade and executor, selection, meta-pipeline, and pin generation into independently reviewable commits.
Judgment-produced compiled artifacts required explicit build and review followed by committed pins rather than regeneration during ordinary runs.
Consuming Playbook-owned definitions avoided a second authored copy of the meta-pipeline.
The planned runnable link and first compiled artifact in Task 10 did not land before their initial contract was superseded.
Surviving behavior and evidence are now owned by the [`phase-execution`](../packages/phase-execution.md), [`compiler`](../packages/compiler.md), [`pinning`](../packages/pinning.md), and [`self-hosting`](../packages/self-hosting.md) packages, while [DR-008](../decisions/008-slc-file-capability.md) retains the removed capability design for history.

## Deliverables

- [x] A since-removed file-capability spec package, registered in `map.md` at completion
- [x] The since-removed artifact-facing `FileCapability` (`read`/`list`/`write`): virtual POSIX paths (a leading `/` is the virtual run root) normalized and confined to the run root after realpath, platform-absolute syntax such as Windows drive paths rejected, exact-byte `sha256:` hashes on read and write, atomic whole-file writes, and an `ifMatch` compare-and-swap that returns `stale`
- [x] The host-side per-run grant model (default-deny): writable paths limited to `target`/`linked`, read grants closed over the run inputs and the [DR-007](../decisions/007-slc-phase-artifact-pinning.md) semantic-input closure, and capability scope failures mapped like a failed generic check
- [x] The SLC phase-runner facade (`PhaseInput`/`PhaseResult`/`PhaseRunner`/`createPhaseRunner`) bound to `@sublang/playbook` `PlaybookPorts`, with the `ok`/`blocked`/`error` → [DR-003](../decisions/003-slc-phase-execution.md) protocol mapping and diagnostics drain (extends `phase-execution`)
- [x] A `PlaybookPorts` adapter backing `callPlayer`/`callJudge` with Cligent and supplying status and telemetry sinks
- [x] A compiled-`phase` loader and `CompiledExecutor` implementing `PhaseExecutor`, running a loaded artifact under the ports and the file capability (extends `phase-execution`)
- [x] Compiled selection in `runSlc`: per phase, no pin interprets, a current pin runs the compiled artifact, and a stale, malformed, or missing pin fails closed with a diagnostic and never silently interprets (extends `phase-execution`, `compiler`; selection is execution behavior, which `pinning` deliberately excludes)
- [x] The deferred [DR-007](../decisions/007-slc-phase-artifact-pinning.md) currency sub-check that a pinned artifact resolves to the linked `phase` format (extends `pinning`)
- [x] A [`self-hosting`](../packages/self-hosting.md) spec package for the reserved `slc` pipeline and the compiled `phase` artifact contract, registered in `map.md`, plus recognition of the reserved `slc` name and the `phase` linked format (`fsm` `.ts` → `phase` `.ts`) with [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) locations
- [x] The `slc` meta-pipeline definitions consumed from `@sublang/playbook`'s `slc/`, not duplicated here (per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)'s Playbook-owned source; Boss-approved option 2): the compile chain (`text2gears` → `gears2fsm`, auditable GEARS-to-FSM mapping) loads, chains, and infers through `slc`. Linking a runnable artifact through Playbook's reserved `link` was **not** delivered here: Playbook shipped it in the `playbook` runtime contract (no `## Link Targets`, so SLC's `phase`-format link machinery rejected it), making reconciliation with that runtime ([[self-hosting-3](../packages/self-hosting.md#self-hosting-3)]) the remaining concern at completion
- [x] Pin generation: an explicit build-and-review flow that writes `slc.pins.json` for a reviewed artifact and is not run during ordinary pipeline runs (extends `pinning`)
- [x] `map.md` updated for the since-removed file-capability package and the `self-hosting` package

## Tasks

Each task is one-commit-sized and updates code, specs, and tests together.

### A. File capability ([DR-008](../decisions/008-slc-file-capability.md))

1. **Artifact-facing `FileCapability`.**
   Author the file-capability package behavior and verification and implement `read`/`list`/`write` over virtual POSIX paths: treat a leading `/` as the virtual run root, normalize and confine each path to the run root after realpath, reject platform-absolute syntax such as Windows drive paths, return exact-byte `sha256:` hashes, write whole files atomically, and honor `ifMatch` as a compare-and-swap that returns `stale`.
   Unit-test path containment and symlink escape, hashing, listing order, and the compare-and-swap.

2. **Host-side per-run grant model.**
   Implement the default-deny grant model: grant records (path, access, kind, listing, recursive, optional expected identity, reason), the only writable paths being `target` and `linked`, read grants closed over the run inputs and the pin's semantic-input closure, and capability scope failures (unauthorized, invalid path, escape, out-of-allowlist write) mapped like a failed generic check rather than a phase `BLOCKED`.
   Unit-test default-deny, write-scope refusal, and closure-limited reads; add file-capability package verification.

### B. Compiled execution plumbing ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

3. **Phase-runner facade and protocol mapping.**
   Add the `@sublang/playbook` dependency and define the SLC phase-runner facade types (`PhaseInput`, `PhaseResult`, `PhaseRunner`, `createPhaseRunner`) over `PlaybookPorts`, with the `ok` → generic checks, `blocked` → `BLOCKED`, `error` → stop mapping and diagnostics drained for every status.
   Unit-test the result-to-protocol mapping and extend the `phase-execution` package behavior and verification.

4. **Cligent-backed `PlaybookPorts` adapter.**
   Implement the adapter backing `callPlayer`/`callJudge` with Cligent per [DR-004](../decisions/004-slc-interpreted-phase-execution.md) and supplying status and telemetry sinks so diagnostics can be drained.
   Unit-test the adapter against a fake Cligent transport.

5. **Compiled-`phase` loader and `CompiledExecutor`.**
   Implement a loader that imports a `phase` module and calls `createPhaseRunner()`, and a `CompiledExecutor` implementing `PhaseExecutor` that constructs the per-run capability and ports, calls `run`, and maps `PhaseResult` to `ExecutorResult`.
   Test against a fixture `phase` artifact, including `ok`, `blocked`, and `error`.

### C. Compiled selection ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) + [DR-007](../decisions/007-slc-phase-artifact-pinning.md))

6. **Wire selection into `runSlc`.**
   Use `evaluatePins` per phase so no pin interprets, a current pin runs the `CompiledExecutor` with grants derived from the pin closure, and a stale, malformed, or missing pin fails closed with a diagnostic and never silently interprets; extend `pinning` and `compiler`.
   Add integration tests over fixtures for each verdict path.

7. **Artifact-resolves-to-`phase` currency sub-check.**
   Extend the validator and the `pinning` items so a pinned artifact whose bytes do not resolve to the linked `phase` format is stale, replacing the initial existence-and-hash-only deferral.
   Unit- and integration-test the new sub-check.

### D. Self-hosting meta-pipeline ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

8. **Reserved `slc` pipeline and `phase` format.**
   Recognize the reserved `slc` pipeline name and the `phase` linked format (`fsm` `.ts` → `phase` `.ts`) in pipeline, link, and artifact resolution and locations; author the [`self-hosting`](../packages/self-hosting.md) package.
   Test reserved-name resolution, `phase` linking, and [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) locations.

9. **`text2gears` and `gears2fsm` definitions.**
   Consume the Playbook-owned `slc` meta-pipeline phase definitions `text2gears.md` and `gears2fsm.md`, with `gears2fsm` preserving an auditable GEARS-to-FSM mapping, and confirm they chain and infer as a pipeline.

10. **Reserved `link.md` and a first compiled artifact.**
    The planned task was to drive the Playbook-owned reserved link and build and review a first compiled artifact through the loader and `CompiledExecutor`.
    It did not land in this iteration, and later work replaced its `phase` contract before delivering the runnable artifact.

### E. Lifecycle ([DR-007](../decisions/007-slc-phase-artifact-pinning.md))

11. **Pin generation.**
    Implement the explicit build-and-review flow that writes `slc.pins.json` for a reviewed artifact (definition closure plus link-target identity) and is not run during ordinary pipeline runs; extend `pinning`.
    Test a generate-then-validate round-trip whose pin `evaluatePins` reports current.

## Verification

- The 12 checked deliverables and ten completed task commits preserve the delivered portions of this iteration, while Task 10 records the runnable-artifact boundary that did not land before supersession.
- Current compiled-runtime and selection scenarios [[phase-execution-26](../packages/phase-execution.md#phase-execution-26)] and [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)], artifact-format and generation scenarios [[pinning-14](../packages/pinning.md#pinning-14)] and [[pinning-16](../packages/pinning.md#pinning-16)], and meta-pipeline scenarios [[self-hosting-4](../packages/self-hosting.md#self-hosting-4)] and [[self-hosting-5](../packages/self-hosting.md#self-hosting-5)] preserve the surviving acceptance coverage.
- [DR-008](../decisions/008-slc-file-capability.md) retains the removed capability design, and interpreted reference semantics remained unchanged.

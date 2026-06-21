<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-005: SLC Compiled Execution and Self-Hosting Meta-Pipeline

## Goal

Implement compiled phase execution end to end: the host-side file capability ([DR-008](../decisions/008-slc-file-capability.md)), the SLC phase-runner facade and a Playbook-backed compiled executor, compiled selection that runs a current pin's artifact and otherwise fails closed, and the reserved `slc` meta-pipeline that produces `phase` artifacts ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)).
This also completes the [DR-007](../decisions/007-slc-phase-artifact-pinning.md) items IR-004 deferred that compiled execution depends on: wiring the currency verdict into strategy selection, the artifact-resolves-to-`phase` currency sub-check, and pin generation.
Interpreted execution stays the reference semantics and the fallback, and the [DR-003](../decisions/003-slc-phase-execution.md) execution boundary and generic checks are unchanged.

- Context: [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) settles the meta-pipeline, the phase-runner facade, and compiled selection; [DR-008](../decisions/008-slc-file-capability.md) settles the file capability; [DR-007](../decisions/007-slc-phase-artifact-pinning.md) settles pinning, and IR-004 built the host-side currency validator (`evaluatePins`) but deferred selection, generation, and the `phase`-format check.
- State today: every phase interprets through the single `PhaseExecutor` seam; the pin validator exists but is not wired into `runSlc`; there is no file capability, no `phase` linked format, no compiled executor, and no reserved `slc` pipeline. `@sublang/playbook@0.6.1` already exposes `PlaybookPorts`/`PlaybookRuntime` through its `./runtime` entry, so the facade has a concrete port surface to bind.
- Why not one commit: the work spans three DRs and several independent subsystems — capability, facade, ports adapter, loader/executor, selection, meta-pipeline, generation — each substantial and separately reviewable; one commit would be unreviewable and unsafe.
- Sequencing: the capability (A) and the facade and executor (B) are buildable and unit-testable against a fixture `phase` artifact before the meta-pipeline (D) can generate a real one; selection (C) wires the existing validator; generation (E) closes the lifecycle.
- Risks: a generated `phase` artifact is a judgment-produced program, so behavior-equivalence to interpreting the definition ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#compiled-phase-execution)) is established by review, not asserted by a unit test; the meta-pipeline definitions are authored content whose quality gates self-hosting.
- Out of scope (deferred to a later IR): the package-manager integrity-digest link-target identity that [DR-007](../decisions/007-slc-phase-artifact-pinning.md#link-target-identity) permits for directory or package targets, which IR-004 deferred and which is independent of compiled execution (the validator keeps recomputing `sha256:` content and tree hashes only); and directory listing and subtree pin identities, which [DR-008](../decisions/008-slc-file-capability.md#host-side-grants) withholds until a pinning extension defines them, along with the directory and recursive read grants that depend on them.

## Deliverables

- [x] A `file-capability` spec package (`dev`, `test`), short form `FCAP`, registered in `map.md`
- [x] The artifact-facing `FileCapability` (`read`/`list`/`write`): virtual POSIX paths (a leading `/` is the virtual run root) normalized and confined to the run root after realpath, platform-absolute syntax such as Windows drive paths rejected, exact-byte `sha256:` hashes on read and write, atomic whole-file writes, and an `ifMatch` compare-and-swap that returns `stale`
- [x] The host-side per-run grant model (default-deny): writable paths limited to `target`/`linked`, read grants closed over the run inputs and the [DR-007](../decisions/007-slc-phase-artifact-pinning.md) semantic-input closure, and capability scope failures mapped like a failed generic check
- [x] The SLC phase-runner facade (`PhaseInput`/`PhaseResult`/`PhaseRunner`/`createPhaseRunner`) bound to `@sublang/playbook` `PlaybookPorts`, with the `ok`/`blocked`/`error` → [DR-003](../decisions/003-slc-phase-execution.md) protocol mapping and diagnostics drain (extends `PHEXEC`)
- [x] A `PlaybookPorts` adapter backing `callPlayer`/`callJudge` with Cligent and supplying status and telemetry sinks
- [x] A compiled-`phase` loader and `CompiledExecutor` implementing `PhaseExecutor`, running a loaded artifact under the ports and the file capability (extends `PHEXEC`)
- [ ] Compiled selection in `runSlc`: per phase, no pin interprets, a current pin runs the compiled artifact, and a stale, malformed, or missing pin fails closed with a diagnostic and never silently interprets (extends `PIN`, `COMPILE`)
- [ ] The deferred [DR-007](../decisions/007-slc-phase-artifact-pinning.md) currency sub-check that a pinned artifact resolves to the linked `phase` format (extends `PIN`)
- [ ] A `self-hosting` spec package (`user`, `dev`, `test`), short form `SELFHOST`, for the reserved `slc` pipeline and the compiled `phase` artifact contract, registered in `map.md`, plus recognition of the reserved `slc` name and the `phase` linked format (`fsm` `.ts` → `phase` `.ts`) with [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) locations
- [ ] The `slc` meta-pipeline definitions — `text2gears.md`, `gears2fsm.md` preserving an auditable GEARS-to-FSM mapping, and the reserved `link.md` emitting `phase` — committed per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)
- [ ] Pin generation: an explicit build-and-review flow that writes `slc.pins.json` for a reviewed artifact and is not run during ordinary pipeline runs (extends `PIN`)
- [ ] `map.md` updated for the new `FCAP` and `SELFHOST` packages

## Tasks

Each task is one-commit-sized and updates code, specs, and tests together.

### A. File capability ([DR-008](../decisions/008-slc-file-capability.md))

1. **Artifact-facing `FileCapability`.**
   Author the `FCAP` spec package (`dev`, `test`) and implement `read`/`list`/`write` over virtual POSIX paths: treat a leading `/` as the virtual run root, normalize and confine each path to the run root after realpath, reject platform-absolute syntax such as Windows drive paths, return exact-byte `sha256:` hashes, write whole files atomically, and honor `ifMatch` as a compare-and-swap that returns `stale`.
   Unit-test path containment and symlink escape, hashing, listing order, and the compare-and-swap.

2. **Host-side per-run grant model.**
   Implement the default-deny grant model: grant records (path, access, kind, listing, recursive, optional expected identity, reason), the only writable paths being `target` and `linked`, read grants closed over the run inputs and the pin's semantic-input closure, and capability scope failures (unauthorized, invalid path, escape, out-of-allowlist write) mapped like a failed generic check rather than a phase `BLOCKED`.
   Unit-test default-deny, write-scope refusal, and closure-limited reads; add `FCAP` `test` items.

### B. Compiled execution plumbing ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

3. **Phase-runner facade and protocol mapping.**
   Add the `@sublang/playbook` dependency and define the SLC phase-runner facade types (`PhaseInput`, `PhaseResult`, `PhaseRunner`, `createPhaseRunner`) over `PlaybookPorts`, with the `ok` → generic checks, `blocked` → `BLOCKED`, `error` → stop mapping and diagnostics drained for every status; extend `PHEXEC` (`dev`, `test`).
   Unit-test the result-to-protocol mapping.

4. **Cligent-backed `PlaybookPorts` adapter.**
   Implement the adapter backing `callPlayer`/`callJudge` with Cligent per [DR-004](../decisions/004-slc-interpreted-phase-execution.md) and supplying status and telemetry sinks so diagnostics can be drained.
   Unit-test the adapter against a fake Cligent transport.

5. **Compiled-`phase` loader and `CompiledExecutor`.**
   Implement a loader that imports a `phase` module and calls `createPhaseRunner()`, and a `CompiledExecutor` implementing `PhaseExecutor` that constructs the per-run capability and ports, calls `run`, and maps `PhaseResult` to `ExecutorResult`.
   Test against a fixture `phase` artifact, including `ok`, `blocked`, and `error`.

### C. Compiled selection ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) + [DR-007](../decisions/007-slc-phase-artifact-pinning.md))

6. **Wire selection into `runSlc`.**
   Use `evaluatePins` per phase so no pin interprets, a current pin runs the `CompiledExecutor` with grants derived from the pin closure, and a stale, malformed, or missing pin fails closed with a diagnostic and never silently interprets; extend `PIN` and `COMPILE`.
   Add integration tests over fixtures for each verdict path.

7. **Artifact-resolves-to-`phase` currency sub-check.**
   Extend the validator and the `PIN` items so a pinned artifact whose bytes do not resolve to the linked `phase` format is stale, replacing IR-004's existence-and-hash-only deferral.
   Unit- and integration-test the new sub-check.

### D. Self-hosting meta-pipeline ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md))

8. **Reserved `slc` pipeline and `phase` format.**
   Recognize the reserved `slc` pipeline name and the `phase` linked format (`fsm` `.ts` → `phase` `.ts`) in pipeline, link, and artifact resolution and locations; author the `SELFHOST` package (`user`, `dev`, `test`).
   Test reserved-name resolution, `phase` linking, and [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) locations.

9. **`text2gears` and `gears2fsm` definitions.**
   Author the `slc` meta-pipeline phase definitions `text2gears.md` and `gears2fsm.md`, with `gears2fsm` preserving an auditable GEARS-to-FSM mapping, and confirm they chain and infer as a pipeline.

10. **Reserved `link.md` and a first compiled artifact.**
    Author the reserved `slc` `link.md` that emits the `phase` format, then build and review a first compiled `phase` artifact for one phase to exercise the loader and `CompiledExecutor` end to end.

### E. Lifecycle ([DR-007](../decisions/007-slc-phase-artifact-pinning.md))

11. **Pin generation.**
    Implement the explicit build-and-review flow that writes `slc.pins.json` for a reviewed artifact (definition closure plus link-target identity) and is not run during ordinary pipeline runs; extend `PIN`.
    Test a generate-then-validate round-trip whose pin `evaluatePins` reports current.

## Acceptance criteria

- An unpinned phase interprets unchanged; a phase with a current pin runs its compiled `phase` artifact through the runner facade; a stale, malformed, or missing pin stops the run with a diagnostic and never silently interprets.
- The file capability serves only normalized, run-root-confined paths and returns exact-byte `sha256:` hashes on read and write; a write outside `target`/`linked`, a path escape, or a symlink escape fails like a failed generic check rather than a phase `BLOCKED`.
- A compiled phase reaches the workspace only through Playbook ports and the file capability and writes only its `target` or `linked` path, honoring the [DR-003](../decisions/003-slc-phase-execution.md) write-scope invariant.
- `slc slc <source>` compiles a phase definition through `text2gears` and `gears2fsm` and, with linking, emits a `phase` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) location, and the GEARS-to-FSM mapping is auditable against the definition.
- Pins are written only by the explicit build-and-review flow and never regenerated during ordinary runs, and a generated pin that IR-004's `evaluatePins` checks reports current.
- Interpreted execution, the [DR-003](../decisions/003-slc-phase-execution.md) boundary and generic checks, and the [DR-004](../decisions/004-slc-interpreted-phase-execution.md) reference semantics are unchanged, and compiled execution is behavior-equivalent to interpreting the definition (established by review per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)).

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-019: Compile Progress and Stall Watchdog

## Status

Done — all seven recovered task commits landed, although the legacy record left all seven deliverables unchecked.

## Intent

Implement [DR-019](../decisions/019-compile-progress-stall-watchdog.md): report per-phase progress and streamed compiled-runtime status live on standard error with a silence-bounded heartbeat, abort a stalled agent call loudly through a configurable inactivity watchdog, and replace optimistic time estimates with measured ranges.
Seven task boundaries separated the decision and package contract, primary implementation, production-timer liveness, documentation, watchdog edge hardening, executor-selection terminalization, and unreadable-module terminalization.
The accepted design remains in [DR-019](../decisions/019-compile-progress-stall-watchdog.md), while surviving behavior and evidence are owned by the [`cli`](../packages/cli.md) and [`phase-execution`](../packages/phase-execution.md) packages.

## Deliverables

These seven unchecked boxes are stale historical evidence retained separately from the truthful status above.

- [ ] A progress module with event types, elapsed-time formatting, a standard-error line renderer, and a silence-bounded heartbeat wrapper over injectable timer seams.
- [ ] `SlcDeps` carries an optional progress sink, and the step loop emits phase start, finish, and failure events with elapsed times.
- [ ] The compiled port adapter streams human status and non-trace telemetry to a configured sink as it occurs, excludes trace payloads, avoids duplicating streamed lines into diagnostics, and keeps drainable diagnostics when no sink is configured [[phase-execution-25](../packages/phase-execution.md#phase-execution-25)].
- [ ] The Cligent transport aborts an agent call that observes no adapter event for the configured stall timeout and reports the inactivity duration as an error [[phase-execution-36](../packages/phase-execution.md#phase-execution-36)].
- [ ] The executable wires the progress reporter into `runSlc` and compiled execution, resolves `stallTimeout` and `SLC_STALL_TIMEOUT` into both transports with a 600-second default and `0` disabling, and names the configuration in `--help` [[cli-35](../packages/cli.md#cli-35)].
- [ ] The root and English and Chinese demo READMEs state measured, agent- and workload-dependent durations and describe the progress output.
- [ ] Spec items [[cli-32](../packages/cli.md#cli-32)] through [[cli-37](../packages/cli.md#cli-37)], [[phase-execution-36](../packages/phase-execution.md#phase-execution-36)] through [[phase-execution-38](../packages/phase-execution.md#phase-execution-38)], the [[phase-execution-25](../packages/phase-execution.md#phase-execution-25)] amendment, and the then-current map entries.

## Tasks

1. Record the accepted compile-progress and agent-stall decision, its package requirements and verification, the implementation record, and the then-current map entries.
2. Implement live phase progress, compiled-runtime status streaming, the silence-bounded heartbeat, the configurable inactivity watchdog, and the executable and configuration wiring with deterministic coverage.
3. Keep the production stall-watchdog timer referenced so a stalled transport cannot let Node exit before reporting the inactivity failure, and add regression coverage for the real timer seam.
4. Replace optimistic compile-time estimates in the root and demo documentation with measured, agent- and workload-dependent ranges and describe progress, heartbeat, and stall-timeout output.
5. Let a successful terminal outcome observed during the post-abort drain win over a stall verdict, reject watchdog windows outside the runtime timer range, and close the progress-liveness, executable-wiring, and heartbeat-reset test gaps.
6. Route compiled-executor selection exceptions through the phase-failure path so every started phase receives a terminal progress event and the report names its phase and target.
7. Treat an unreadable emitted module as a failed link so every started phase terminates with an attributed diagnostic.

## Verification

- The seven stale unchecked deliverables and seven recovered task boundaries preserve the historical record state without treating delivered work as open.
- Commits `7af1117`, `7babcfc`, `4e893a0`, `81725e1`, `2a979ec`, `bd8459e`, and `20a0562` record those task boundaries in order.
- Full-pipeline phase ordering, elapsed-time lines, heartbeat liveness, standard-error output, and success-only standard output are exercised by [[cli-36](../packages/cli.md#cli-36)], while attributed stall failure is exercised at the executable boundary by [[cli-37](../packages/cli.md#cli-37)].
- Live compiled status, diagnostic de-duplication, and trace privacy are exercised by [[phase-execution-37](../packages/phase-execution.md#phase-execution-37)].
- Inactivity abort, no-retry behavior, and post-abort-drain success are exercised by [[phase-execution-38](../packages/phase-execution.md#phase-execution-38)].
- Commit `81725e1` records the measured documentation update, and the release-gate concern is now owned by [[release-12](../packages/release.md#release-12)] and audited by [[release-20](../packages/release.md#release-20)] without claiming a fresh run.

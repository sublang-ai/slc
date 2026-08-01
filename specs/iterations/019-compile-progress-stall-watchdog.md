<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-019: Compile Progress and Stall Watchdog

## Goal

Implement [DR-019](../decisions/019-compile-progress-stall-watchdog.md): report per-phase progress and streamed compiled-runtime status live on stderr with a silence-bounded heartbeat, abort a stalled agent call loudly through a configurable inactivity watchdog, and revise the documented time estimates to measured ranges.

## Deliverables

- [ ] A progress module with the event types, elapsed-time formatting, the stderr line renderer, and the silence-bounded heartbeat wrapper over injectable timer seams.
- [ ] `SlcDeps` carries an optional progress sink; the step loop emits phase start, finish, and failure events with elapsed times.
- [ ] The compiled port adapter streams human status and non-trace telemetry to a configured sink as it occurs — trace payloads excluded, streamed lines not duplicated into diagnostics — and keeps drainable diagnostics when no sink is configured.
- [ ] The Cligent transport aborts an agent call that observes no adapter event for the configured stall timeout and reports the inactivity duration as an error.
- [ ] The bin wires the progress reporter into `runSlc` and compiled execution, and resolves `stallTimeout`/`SLC_STALL_TIMEOUT` (default 600 s, `0` disables) into both transports; `--help` names the new configuration.
- [ ] README and demo READMEs (en/zh) state measured, agent- and workload-dependent durations and describe the new progress output.
- [ ] Spec items [CLI-32](../user/cli.md#cli-32)–[CLI-37](../test/cli.md#cli-37), [PHEXEC-36](../dev/phase-execution.md#phexec-36)–[PHEXEC-38](../test/phase-execution.md#phexec-38), the [PHEXEC-25](../dev/phase-execution.md#phexec-25) amendment, and the map rows.

## Acceptance criteria

- A full-pipeline run over faked dependencies writes phase start and finish lines with elapsed times to stderr in execution order, keeps stdout limited to the success report, and a failed run still writes nothing to stdout.
- A compiled fixture emitting status mid-turn reaches the configured sink before the run settles without duplicating the lines into diagnostics or leaking `playbook.trace` payloads; without a sink the drained-diagnostics behavior is unchanged.
- A faked transport that stalls after its first event is aborted once the configured stall timeout elapses, the failure report names the phase, target, and inactivity duration, and no additional agent invocation occurs.
- `npm run release:check` passes.

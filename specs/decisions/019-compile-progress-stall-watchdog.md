<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-019: Compile Progress Reporting and Agent-Stall Watchdog

## Status

Accepted

## Context

A compile prints one line and then goes silent for as long as it runs ([#4][1]).
Measured on a five-line workflow: the first intermediate landed at t+4 min, the second at t+5 min, and `gears2fsm` then ran 123 minutes with no output at 0.2% CPU — a live agent session waiting on the network — before the run was abandoned.
The user cannot distinguish "working hard" from "hung", and the documented "more than ten minutes" estimate is materially optimistic against measured runs (a precompiled demo run took 51 minutes; the abandoned compile exceeded two hours).

The silence and the hang have distinct causes, both host-side:

- Progress exists but is discarded.
  A compiled phase's runtime emits the same human status lines `playbook run` prints as state transitions happen, but the SLC port adapter buffers them as drainable diagnostics ([PHEXEC-25](../dev/phase-execution.md#phexec-25)) that the bin prints only after the whole run returns.
  The generic step loop knows each phase, target, and timing and reports none of it while running.
- No layer bounds an agent call in time.
  Cligent exposes `maxTurns` and `maxBudgetUsd` but no time-based option; the transport's event loop awaits the next adapter event indefinitely; the bin sets no deadline.
  A network-stalled agent session therefore parks the pipeline forever, and the only recourse is Ctrl-C.

Structurally, a compiled phase also pays three strictly serialized cold agent sessions per phase — a judge classification of the seeded Boss turn, the transformation-performing Captain session (dominant, with a fixed link-time prompt independent of workload size), and a judge adjudication of the Captain's reply — all with `resume: false`.
That cost is owned by the pinned artifacts and `@sublang/playbook`, is the same regardless of how small the user's workflow is, and is out of scope here; this decision makes the spend visible and bounds the failure mode, so waiting is informed rather than blind.

Every Cligent adapter emits events incrementally — at least at message and tool boundaries — so adapter events are a usable activity signal, but a single long tool execution or model turn is legitimately silent on all adapters.
An absolute per-phase deadline would misfire on legitimately long phases, whose duration varies from minutes to hours with agent, model, and workload.

## Decision

### Stderr-only progress reporting

- The generic step loop reports each phase start, finish, and failure — with the phase name, target artifact, and elapsed time — through a progress sink the host injects beside the resolver and executors.
- The bin renders these events as human-readable lines on standard error.
  Standard output remains reserved for the success report ([CLI-3](../user/cli.md#cli-3)); a failed run still writes nothing to standard output ([CLI-16](../test/cli.md#cli-16)).
  The exact line format is host-owned presentation and is not specified.

### Live status streaming

- When the host configures a status sink, a compiled phase's human status and non-trace operational telemetry stream to it as they occur instead of being collected for the end; streamed lines are not duplicated into the run's diagnostics.
- Without a sink, the drainable-diagnostics behavior is unchanged, so embedders of the library API see today's contract.
- Exact `playbook.trace` payloads stay out of the streamed lines exactly as they stay out of ordinary diagnostics ([DR-010](010-playbook-runtime-contract-evolution.md#port-policy-and-diagnostic-privacy)).

### Silence-bounded heartbeat

- While a phase is in flight, when no progress line has been written for the 30-second silence bound, the bin writes an elapsed-time heartbeat, so the terminal is never silent longer than the bound while work is running.

### Inactivity watchdog, not a per-phase deadline

- The stall signal is agent inactivity: an in-flight agent call whose transport observes no adapter event for the stall timeout is aborted through the existing cancellation plumbing and reported as a failed call carrying the inactivity duration.
  Cligent's abort drain guarantees the event loop terminates promptly with a terminal event, so a watchdog abort is safe at the transport seam.
- The watchdog applies to every agent call on both transports: the single interpreted invocation and each compiled player, Captain, and judge call.
- A tripped watchdog surfaces through the unchanged phase protocols: a failure report naming the phase and target, no retry of the call ([PHEXEC-12](../dev/phase-execution.md#phexec-12), [PHEXEC-23](../dev/phase-execution.md#phexec-23)), and fail-closed handling for a pinned phase — never a silent interpreted fallback ([PHEXEC-27](../dev/phase-execution.md#phexec-27)).
- The timeout is configuration: the `stallTimeout` config-file key in seconds, overridden by a non-blank `SLC_STALL_TIMEOUT`, defaulting to 600 seconds, with `0` disabling the watchdog.
  The default is deliberately generous because one long tool execution or model turn is legitimately event-silent on every adapter; the aim is to convert an indefinite hang into a loud, attributed failure within minutes, not to police normal phase length.

### Measured time estimates

- User documentation states measured ranges — tens of minutes to more than two hours for a full compile of a five-line workflow; about 51 minutes for a run from the precompiled demo artifacts — and states that duration is agent- and workload-dependent, instead of the "more than ten minutes" phrasing.

## Consequences

- A compile is never silent longer than the heartbeat bound: phases announce themselves, targets land with elapsed times, compiled-runtime transitions stream as they happen, and a stalled agent call fails loudly within the stall timeout instead of hanging for hours.
- `SlcDeps` gains an optional progress sink; hosts that do not supply one keep today's quiet behavior, and the sink addition is not a breaking API change.
- [PHEXEC-25](../dev/phase-execution.md#phexec-25) is amended for streaming; new items [CLI-32](../user/cli.md#cli-32)–[CLI-37](../test/cli.md#cli-37) and [PHEXEC-36](../dev/phase-execution.md#phexec-36)–[PHEXEC-38](../test/phase-execution.md#phexec-38) specify the progress, heartbeat, and watchdog behavior.
- The structural three-cold-sessions-per-phase cost and the fixed-size Captain prompt remain; reducing them needs artifact and `@sublang/playbook` changes under a later decision.

## References

[1]: https://github.com/sublang-ai/slc/issues/4 "No progress output during compile: silent for 10+ minutes (measured: 2h)"

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CLI: Command-Line Entry

## Intent

This package specifies the user-facing contract of the published `slc`
executable: the command-line entry that runs the compiler and reports its
progress and outcome through process streams and exit status, together with the
`--version`/`--help` conveniences and cancellation.
The compile semantics it drives are specified in the `compiler` user package and
the `pipeline` and `phase-execution` packages; this package covers only the
executable's process-level surface.

Essential project-specific reference: `slc`, this project's compiler CLI, whose
runnable core is the `runSlc` API specified by the `pipeline` and
`phase-execution` packages.

## Conveniences

### CLI-1

When the user runs `slc` with `--version` or `-v`, the slc executable shall print its version to standard output and exit zero, without resolving a pipeline or executing any phase.

### CLI-2

When the user runs `slc` with `--help` or `-h`, the slc executable shall print usage that names the documented invocation forms, the eligible full and full-link forms' `--rebuild` and `--adopt` options, the `--config` option, and the configuration it reads — the config file and the environment variables — to standard output and exit zero, without resolving a pipeline or executing any phase ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli), [DR-002](../decisions/002-slc-link-phases.md#cli), [DR-006](../decisions/006-slc-configuration-sources.md#file-format-and-discovery), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#explicit-adoption), [CLI-6](../dev/cli.md#cli-6), [CLI-7](../dev/cli.md#cli-7)).

## Outcomes

### CLI-3

Where a successful non-adoption run writes artifacts, an adoption run attests semantic products and regenerates deterministic derivatives, or a full or full-link bundle is already current, when the slc executable reports the outcome, the slc executable shall print respectively the written artifact paths — including an `-o` path — one adoption report distinguishing attested unchanged semantic paths from regenerated written paths, or an up-to-date report to standard output and exit zero ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations), [COMPILE-1](compiler.md#compile-1), [COMPILE-3](compiler.md#compile-3), [INCR-2](incremental-compilation.md#incr-2), [INCR-33](incremental-compilation.md#incr-33)).

### CLI-4

When a run cannot complete — because the invocation or pipeline is rejected, a phase fails, or a phase reports `BLOCKED` — the slc executable shall print the failure report to standard error, naming the failing phase and its target artifact when a phase is at fault, and exit with a non-zero status ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol), [COMPILE-4](compiler.md#compile-4)).

### CLI-5

While a run is in progress, when the process is interrupted, the slc executable shall cancel the in-flight execution, exit with a non-zero status, and not print a success report.

## Progress

### CLI-32

While a run is in progress, when a phase starts and when it finishes or fails, the slc executable shall report the event on standard error — naming the phase, its target artifact, and, on finish or failure, the elapsed time — and shall additionally report a compiled phase's streamed runtime status lines as they occur, keeping standard output reserved for the success report ([DR-019](../decisions/019-compile-progress-stall-watchdog.md#stderr-only-progress-reporting), [CLI-3](#cli-3), [CLI-4](#cli-4), [PHEXEC-25](../dev/phase-execution.md#phexec-25)).

### CLI-33

While a phase is executing, when no progress has been reported for the 30-second silence bound, the slc executable shall report a heartbeat on standard error naming the running phase and its elapsed time, so silence never exceeds the bound while work is in flight ([DR-019](../decisions/019-compile-progress-stall-watchdog.md#silence-bounded-heartbeat)).

### CLI-34

Where the stall timeout — a non-blank `SLC_STALL_TIMEOUT` environment variable, otherwise the config file's `stallTimeout` field, otherwise 600, each in seconds with `0` disabling the watchdog and a value too large to serve as a timer delay refused — elapses while an in-flight agent call reports no activity, the slc executable shall abort that call and fail the run with a failure report naming the phase, its target artifact, and the inactivity duration, rather than waiting indefinitely ([DR-019](../decisions/019-compile-progress-stall-watchdog.md#inactivity-watchdog-not-a-per-phase-deadline), [CLI-4](#cli-4), [PHEXEC-36](../dev/phase-execution.md#phexec-36)).

## Configuration

### CLI-22

Where a config file is present — `slc.config.yaml` in the working directory, `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`, or a file named by `--config <path>` — when the user runs a documented invocation form, the slc executable shall take its agent, model, and pipeline search path from that file except where a matching, non-blank environment variable overrides it, so a run is configurable without environment variables ([DR-006](../decisions/006-slc-configuration-sources.md#sources-and-precedence)).

### CLI-29

Where no config file exists in the working directory or the user config location and `--config` is not given, when the user runs a documented invocation form, the slc executable shall seed `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml` with the bundled starter defaults — `agent: claude-code`, model and effort left to the agent CLI — name the created file on stderr, and carry out the run with those defaults, so a first run needs no prior setup ([DR-015](../decisions/015-first-run-config-seeding.md)).

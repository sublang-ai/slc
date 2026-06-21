<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CLI: Command-Line Entry

## Intent

This package specifies the user-facing contract of the published `slc`
executable: the command-line entry that runs the compiler and reports its
outcome through process streams and exit status, together with the
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

When the user runs `slc` with `--help` or `-h`, the slc executable shall print usage that names the documented invocation forms, the `--config` option, and the configuration it reads — the config file and the environment variables — to standard output and exit zero, without resolving a pipeline or executing any phase ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli), [DR-002](../decisions/002-slc-link-phases.md#cli), [DR-006](../decisions/006-slc-configuration-sources.md#file-format-and-discovery), [CLI-6](../dev/cli.md#cli-6), [CLI-7](../dev/cli.md#cli-7)).

## Outcomes

### CLI-3

When a run completes successfully, the slc executable shall print the paths of the artifacts it wrote — including the `-o` output path when one was given — to standard output and exit zero ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations), [COMPILE-1](compiler.md#compile-1), [COMPILE-3](compiler.md#compile-3)).

### CLI-4

When a run cannot complete — because the invocation or pipeline is rejected, a phase fails, or a phase reports `BLOCKED` — the slc executable shall print the failure report to standard error, naming the failing phase and its target artifact when a phase is at fault, and exit with a non-zero status ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol), [COMPILE-4](compiler.md#compile-4)).

### CLI-5

While a run is in progress, when the process is interrupted, the slc executable shall cancel the in-flight execution, exit with a non-zero status, and not print a success report.

## Configuration

### CLI-22

Where a config file is present — `slc.config.yaml` in the working directory, `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`, or a file named by `--config <path>` — when the user runs a documented invocation form, the slc executable shall take its agent, model, and pipeline search path from that file except where a matching, non-blank environment variable overrides it, so a run is configurable without environment variables ([DR-006](../decisions/006-slc-configuration-sources.md#sources-and-precedence)).

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CLI: Command-Line Entry

## Intent

This package specifies integration and system acceptance tests for the published
`slc` executable in the `cli` user and dev packages, driving the bin entry
end-to-end over its process streams, exit status, configuration, and
cancellation.
The generic pipeline runs it delegates to are covered by the `pipeline` and
`phase-execution` test packages; these items exercise the bin's own surface with
faked dependencies so no real agent runs.

Essential project-specific references: `slc`, this project's compiler CLI; and
Cligent (`@sublang/cligent` [[1]]), the SDK through which the executable reaches
coding agents.

## Conveniences

### CLI-13
Verifies: [CLI-1](../user/cli.md#cli-1), [CLI-9](../dev/cli.md#cli-9)

Where no agent is configured, when the slc executable is run with `--version` or `-v`, the slc executable shall print its version to standard output and exit zero without resolving a pipeline, selecting an agent, or invoking `runSlc`.

### CLI-14
Verifies: [CLI-2](../user/cli.md#cli-2), [CLI-9](../dev/cli.md#cli-9)

Where no agent is configured, when the slc executable is run with `--help` or `-h`, the slc executable shall print usage naming the documented invocation forms, the `--config` option, and the configuration it reads — the config file and the environment variables — to standard output and exit zero without resolving a pipeline or selecting an agent.

## Reporting

### CLI-15
Verifies: [CLI-3](../user/cli.md#cli-3), [CLI-11](../dev/cli.md#cli-11)

Where the run succeeds, when the slc executable runs a documented invocation form with an `-o` override, the slc executable shall print the written artifact paths — including the `-o` path — to standard output and exit zero.

### CLI-16
Verifies: [CLI-4](../user/cli.md#cli-4), [CLI-11](../dev/cli.md#cli-11)

Where a run is rejected, a phase fails, or a phase reports `BLOCKED`, when the slc executable runs, the slc executable shall print the failure report — naming the failing phase and its target when a phase is at fault — to standard error, write nothing to standard output, and exit non-zero.

## Process control

### CLI-17
Verifies: [CLI-5](../user/cli.md#cli-5), [CLI-10](../dev/cli.md#cli-10)

While a run is in progress, when the process is interrupted, the slc executable shall abort the run through the cancellation signal, exit non-zero, and print no success report.

## Configuration

### CLI-18
Verifies: [CLI-12](../dev/cli.md#cli-12), [CLI-4](../user/cli.md#cli-4)

Where neither `SLC_AGENT` nor a config file supplies an agent, or the resolved agent names an unsupported agent CLI, when the slc executable runs a pipeline, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero.

### CLI-19
Verifies: [CLI-6](../dev/cli.md#cli-6), [CLI-7](../dev/cli.md#cli-7), [CLI-8](../dev/cli.md#cli-8)

Where `SLC_PIPELINE_PATH` locates the pipeline directory and `SLC_AGENT` with an optional `SLC_MODEL` are configured, when the slc executable runs a source, the slc executable shall resolve the reference to that directory and interpret every unpinned phase through the configured agent CLI with that model.

### CLI-23
Verifies: [CLI-22](../user/cli.md#cli-22), [CLI-7](../dev/cli.md#cli-7), [CLI-6](../dev/cli.md#cli-6)

Where a config file supplies the agent, model, and pipeline search path and no `SLC_*` variables are set, when the slc executable runs a source, the slc executable shall resolve the reference through the file's search path and interpret every unpinned phase through the file's agent CLI with the file's model, writing the artifact and exiting zero.

### CLI-24
Verifies: [CLI-7](../dev/cli.md#cli-7), [CLI-6](../dev/cli.md#cli-6), [CLI-20](../dev/cli.md#cli-20)

Where both a config file and a non-blank `SLC_AGENT`, `SLC_MODEL`, or `SLC_PIPELINE_PATH` supply the corresponding key — agent, model, or pipeline search path — when the slc executable runs a source, the slc executable shall use the environment value over the file value for that key, resolving the reference through `SLC_PIPELINE_PATH` rather than the file's `pipelinePath` and interpreting every unpinned phase through the environment's agent CLI and model rather than the file's.

### CLI-25
Verifies: [CLI-20](../dev/cli.md#cli-20), [CLI-22](../user/cli.md#cli-22)

Where `--config <path>` names an existing config file and a different config file sits in the working directory, when the slc executable runs a source, the slc executable shall load configuration from the `--config` file and ignore the discovered file.

### CLI-26
Verifies: [CLI-21](../dev/cli.md#cli-21)

Where `--config <path>` names a file that does not exist, when the slc executable runs, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero; whereas where no config file is discovered, the executable shall not refuse on that basis and shall fall through to the environment and built-in defaults.

### CLI-27
Verifies: [CLI-21](../dev/cli.md#cli-21)

Where a loaded config file is malformed YAML, declares an unknown key, or holds a wrong-typed value, when the slc executable runs, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero.

## Compiled execution

### CLI-28
Verifies: [CLI-8](../dev/cli.md#cli-8), [COMPILE-6](../user/compiler.md#compile-6)

Where a pipeline directory pins a phase to a current compiled `playbook` artifact, when the slc executable runs that phase, the slc executable shall run the pinned artifact through compiled execution — writing the artifact's declared target and exiting zero — without invoking the interpreted executor for that phase.

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

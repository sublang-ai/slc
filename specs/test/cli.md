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

Where no agent is configured, when the slc executable is run with `--help` or `-h`, the slc executable shall print usage naming the documented invocation forms to standard output and exit zero without resolving a pipeline or selecting an agent.

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

Where `SLC_AGENT` is unset or names an unsupported agent CLI, when the slc executable runs a pipeline, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero.

### CLI-19
Verifies: [CLI-6](../dev/cli.md#cli-6), [CLI-7](../dev/cli.md#cli-7), [CLI-8](../dev/cli.md#cli-8)

Where `SLC_PIPELINE_PATH` locates the pipeline directory and `SLC_AGENT` with an optional `SLC_MODEL` are configured, when the slc executable runs a source, the slc executable shall resolve the reference to that directory and interpret every phase through the configured agent CLI with that model, applying no compiled phase artifact.

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

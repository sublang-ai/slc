<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CLI: Command-Line Entry

## Intent

This package specifies how the published `slc` executable wires the `runSlc`
core to a concrete host: resolving a pipeline reference to a directory,
selecting and constructing the coding agent from configuration with credentials
from the environment, injecting an interpreted executor so every phase runs
without compilation, passing a cancellation signal, short-circuiting
`--version`/`--help`, and mapping the run result to process streams and an exit
code.
The user-facing surface (streams, exit status, conveniences) is in the `cli`
user package; generic mechanics and the execution boundary are in the `pipeline`
and `phase-execution` packages.

Essential project-specific references: `slc`, this project's compiler CLI, whose
core `runSlc` API takes a pipeline resolver and a phase executor as injected
dependencies; and Cligent (`@sublang/cligent` [[1]]), the SDK through which the
executable reaches coding agents.

## Dependency construction

### CLI-6

When the slc executable receives a `<pipeline>` reference, the executable shall resolve it to the directories named `<reference>` directly under each configured pipeline search root, defaulting the search root to the working directory when none is configured, and supply those candidates to `runSlc` so that exactly one is required and zero or many is refused ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#directory-layout), [PIPE-16](pipeline.md#pipe-16)).

### CLI-7

Where the slc executable's configuration selects an agent CLI and an optional model, the executable shall construct the coding-agent transport for that agent CLI through Cligent [[1]] with that model and with credentials supplied by the process environment, and shall treat the selection as configuration that does not change phase semantics ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter), [PHEXEC-13](phase-execution.md#phexec-13)).

### CLI-8

When the slc executable runs a pipeline, phase, or link, the executable shall inject into `runSlc` an interpreted executor built on the agent transport, so every phase is interpreted and no compiled phase artifact is applied ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#pinning)).

## Process control

### CLI-9

When argv requests `--version`/`-v` or `--help`/`-h`, the slc executable shall handle the request and return a zero exit code before it resolves a pipeline, selects an agent, or invokes `runSlc`.

### CLI-10

While `runSlc` is in progress, when the process receives an interrupt, the slc executable shall abort the run through a cancellation signal it passed into `runSlc`.

### CLI-11

When `runSlc` returns its result, the slc executable shall, on success, write the produced artifact paths to standard output and return a zero exit code, and otherwise write the failure diagnostics to standard error and return a non-zero exit code ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

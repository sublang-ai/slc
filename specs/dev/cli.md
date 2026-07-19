<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CLI: Command-Line Entry

## Intent

This package specifies how the published `slc` executable wires the `runSlc`
core to a concrete host: resolving a pipeline reference to a directory,
selecting and constructing the coding agent from configuration with credentials
from the environment, injecting an interpreted executor for unpinned phases and
the compiled-execution factory that pinned phases select, passing a cancellation
signal, short-circuiting `--version`/`--help`, and mapping the run result to
process streams and an exit code.
The user-facing surface (streams, exit status, conveniences) is in the `cli`
user package; generic mechanics and the execution boundary are in the `pipeline`
and `phase-execution` packages.

Essential project-specific references: `slc`, this project's compiler CLI, whose
core `runSlc` API takes a pipeline resolver and a phase executor as injected
dependencies; and Cligent (`@sublang/cligent` [[1]]), the SDK through which the
executable reaches coding agents.

## Dependency construction

### CLI-6

When the slc executable receives a `<pipeline>` reference other than the reserved `slc` name or the `playbook` pipeline — both resolved to the shared definition set ([SELFHOST-2](self-hosting.md#selfhost-2), [SELFHOST-6](self-hosting.md#selfhost-6), [SELFHOST-9](self-hosting.md#selfhost-9)) — the executable shall resolve it to the directories named `<reference>` directly under each pipeline search root — taking the roots from a non-blank `SLC_PIPELINE_PATH` environment variable (an OS path-list), otherwise from the config file's `pipelinePath` sequence when present, otherwise the working directory, and resolving relative roots against the working directory — and supply those candidates to `runSlc` so that exactly one is required and zero or many is refused ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#directory-layout), [DR-006](../decisions/006-slc-configuration-sources.md#pipelinepath-shape-and-base), [PIPE-16](pipeline.md#pipe-16)).

### CLI-7

Where the resolved agent — a non-blank `SLC_AGENT` environment variable, otherwise the config file's `agent` field — names one of the Cligent agent adapters the executable registers — `claude-code`, `codex`, `gemini`, or `opencode` — and the resolved model — a non-blank `SLC_MODEL`, otherwise the config file's `model` field — optionally names a model, and the resolved effort — a non-blank `SLC_EFFORT`, otherwise the config file's `effort` field — optionally names a reasoning effort the selected agent supports per Cligent's adapter-scoped effort metadata (an unsupported value refuses the run), the executable shall construct the coding-agent transport for that agent CLI through Cligent [[1]] with that model and effort — omitting either so the agent CLI uses its own default when neither source supplies one — leaving the agent CLI to read its credentials from the inherited process environment, and shall treat the selection as configuration that does not change phase semantics ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter), [DR-006](../decisions/006-slc-configuration-sources.md#sources-and-precedence), [PHEXEC-13](phase-execution.md#phexec-13)).

### CLI-12

Where neither a non-blank `SLC_AGENT` environment variable nor the config file's `agent` field supplies an agent, or the resolved agent names an agent CLI outside the set [CLI-7](#cli-7) registers, the executable shall refuse the run with a diagnostic and execute no phase, applying no implicit default agent ([DR-004](../decisions/004-slc-interpreted-phase-execution.md#interpreter), [DR-006](../decisions/006-slc-configuration-sources.md#sources-and-precedence), [CLI-4](../user/cli.md#cli-4)).

### CLI-20

When the slc executable builds run dependencies, the executable shall load configuration from the path given by `--config <path>` when present — disabling discovery — otherwise from the first existing of `slc.config.yaml` in the working directory then `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`, and shall apply each loaded value only where the corresponding environment variable does not supply a non-blank value ([DR-006](../decisions/006-slc-configuration-sources.md#file-format-and-discovery)).

### CLI-21

Where `--config <path>` names a file that does not exist, or a loaded config file is malformed, declares an unknown key, or holds a wrong-typed value, the executable shall refuse the run with a diagnostic and execute no phase, while a discovery miss instead seeds the user config file ([CLI-30](#cli-30)) and proceeds from it ([DR-006](../decisions/006-slc-configuration-sources.md#validation), [DR-015](../decisions/015-first-run-config-seeding.md), [CLI-4](../user/cli.md#cli-4)).

### CLI-30

When discovery finds neither the working-directory `slc.config.yaml` nor the user config file, the executable shall create `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml` from the starter template bundled with the host — `agent: claude-code` set, `model` and `effort` as commented examples — report the created path on stderr, load the seeded file, and shall not seed when `--config` is given or when either discovered file exists ([DR-015](../decisions/015-first-run-config-seeding.md)).

### CLI-8

When the slc executable runs a pipeline, phase, or link, the executable shall inject into `runSlc` an interpreted executor built on the agent transport — the execution for every unpinned phase — and a compiled-execution factory that runs a current pinned phase's compiled `playbook` artifact, resolved against its pipeline directory, with the runtime's player ports backed by one configured agent transport per player id, its Captain and judge ports backed by one shared configured transport, and the selected model applied as the default per-player model ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#strategy-selection), [PHEXEC-25](phase-execution.md#phexec-25), [PHEXEC-27](phase-execution.md#phexec-27)).

## Process control

### CLI-9

When argv requests `--version`/`-v` or `--help`/`-h`, the slc executable shall handle the request and return a zero exit code before it resolves a pipeline, selects an agent, or invokes `runSlc`.

### CLI-10

While `runSlc` is in progress, when the process receives an interrupt, the slc executable shall abort the run through a cancellation signal it passed into `runSlc`.

### CLI-11

When `runSlc` returns its result, the slc executable shall, on success, write the produced artifact paths to standard output and return a zero exit code, and otherwise write the failure diagnostics to standard error and return a non-zero exit code ([DR-003](../decisions/003-slc-phase-execution.md#blocked-protocol)).

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# cli: Command-Line Entry

## Intent

This package specifies the user-facing contract of the published `slc` executable: the command-line entry that runs the compiler and reports its progress and outcome through process streams and exit status, together with the `--version`/`--help` conveniences and cancellation.
It also specifies how the executable wires the `runSlc` core to a concrete host: resolving pipeline references, constructing configured interpreted and compiled execution, passing cancellation and progress, short-circuiting conveniences, and mapping results to process output.
Its verification drives the bin entry end to end over those process, configuration, execution, and cancellation seams with faked dependencies so no real agent runs.
Compile outcomes belong to the `compiler` package, while generic mechanics and execution boundaries belong to the `pipeline` and `phase-execution` packages.
Essential project-specific references are `slc`, this project's compiler CLI whose core `runSlc` API takes an injected pipeline resolver and phase executor, and Cligent (`@sublang/cligent` [[1]]), the SDK through which the executable reaches coding agents.

## External Behavior

### cli-1

When the user runs `slc` with `--version` or `-v`, the slc executable shall print its version to standard output and exit zero, without resolving a pipeline or executing any phase.

### cli-2

When the user runs `slc` with `--help` or `-h`, the slc executable shall print usage that names the documented invocation forms, `--rebuild`, the `--config` option, and the configuration it reads — including the Coder and optional Reviewer config keys and environment variables — to standard output and exit zero, without resolving a pipeline or executing any phase ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md), [DR-006](../decisions/006-slc-configuration-sources.md), [DR-021](../decisions/021-incremental-compilation.md), [[cli-6](#cli-6)], [[cli-7](#cli-7)], [[cli-40](#cli-40)]).

### cli-3

When a run completes successfully, the slc executable shall print to standard output either the paths of the artifacts it wrote — including the `-o` output path when one was given — or `up to date` when incremental selection invoked no phase executor, print every diagnostic returned with the successful run to standard error, and exit zero ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-021](../decisions/021-incremental-compilation.md), [DR-023](../decisions/023-host-settled-link-object-imports.md), [[compiler-1](compiler.md#compiler-1)], [[compiler-3](compiler.md#compiler-3)]).

### cli-4

When a run cannot complete — because the invocation or pipeline is rejected, a phase fails, or a phase reports `BLOCKED` — the slc executable shall print the failure report to standard error, naming the failing phase and its target artifact when a phase is at fault, and exit with a non-zero status ([DR-003](../decisions/003-slc-phase-execution.md), [[compiler-4](compiler.md#compiler-4)]).

### cli-5

While a run is in progress, when the process is interrupted, the slc executable shall cancel the in-flight execution, exit with a non-zero status, and not print a success report.

### cli-32

While a run is in progress, when a phase starts and when it finishes or fails, the slc executable shall report the event on standard error — naming the phase, its target artifact, and, on finish or failure, the elapsed time — and shall additionally report a compiled phase's streamed runtime status lines as they occur, keeping standard output reserved for the success report ([DR-019](../decisions/019-compile-progress-stall-watchdog.md), [[cli-3](#cli-3)], [[cli-4](#cli-4)], [[phase-execution-25](phase-execution.md#phase-execution-25)]).

### cli-33

While a phase is executing, when no progress has been reported for the 30-second silence bound, the slc executable shall report a heartbeat on standard error naming the running phase and its elapsed time, so silence never exceeds the bound while work is in flight ([DR-019](../decisions/019-compile-progress-stall-watchdog.md)).

### cli-34

Where the stall timeout — a non-blank `SLC_STALL_TIMEOUT` environment variable, otherwise the config file's `stallTimeout` field, otherwise 600, each in seconds with `0` disabling the watchdog and a value too large to serve as a timer delay refused — elapses while an in-flight agent call reports no activity, the slc executable shall abort that call and fail the run with a failure report naming the phase, its target artifact, and the inactivity duration, rather than waiting indefinitely ([DR-019](../decisions/019-compile-progress-stall-watchdog.md), [[cli-4](#cli-4)], [[phase-execution-36](phase-execution.md#phase-execution-36)]).

### cli-22

Where a config file is present — `slc.config.yaml` in the working directory, `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`, or a file named by `--config <path>` — when the user runs a documented invocation form, the slc executable shall take its agent, model, and pipeline search path from that file except where a matching, non-blank environment variable overrides it, so a run is configurable without environment variables ([DR-006](../decisions/006-slc-configuration-sources.md)).

### cli-39

Where `reviewerAgent` or `SLC_REVIEWER_AGENT` selects a supported independent Reviewer, when the user runs a documented invocation form, the slc executable shall enable reviewed compilation using the independently resolved optional Reviewer model, effort, and fast mode; whereas Reviewer model, effort, or fast mode without a Reviewer agent shall refuse the run clearly, and absent Reviewer configuration shall leave execution unreviewed ([DR-022](../decisions/022-two-agent-reviewed-compilation.md), [DR-006](../decisions/006-slc-configuration-sources.md)).

### cli-29

Where no config file exists in the working directory or the user config location and `--config` is not given, when the user runs a documented invocation form, the slc executable shall seed `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml` with the bundled starter defaults — `agent: claude-code` active, Coder model/effort/fast mode and Reviewer agent/model/effort/fast mode as commented examples so agent defaults apply and reviewed compilation remains disabled — name the created file on stderr, and carry out the run with those defaults, so a first run needs no prior setup ([DR-015](../decisions/015-first-run-config-seeding.md)).

## Internal Behavior

### cli-6

When the slc executable receives a `<pipeline>` reference other than the reserved `slc` name or the `playbook` pipeline — both resolved to the shared definition set ([[self-hosting-2](self-hosting.md#self-hosting-2)], [[self-hosting-6](self-hosting.md#self-hosting-6)], [[self-hosting-9](self-hosting.md#self-hosting-9)]) — the executable shall resolve it to the directories named `<reference>` directly under each pipeline search root — taking the roots from a non-blank `SLC_PIPELINE_PATH` environment variable (an OS path-list), otherwise from the config file's `pipelinePath` sequence when present, otherwise the working directory, and resolving relative roots against the working directory — and supply those candidates to `runSlc` so that exactly one is required and zero or many is refused ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-006](../decisions/006-slc-configuration-sources.md), [[pipeline-16](pipeline.md#pipeline-16)]).

### cli-7

Where the resolved agent — a non-blank `SLC_AGENT` environment variable, otherwise the config file's `agent` field — names one of the Cligent agent adapters the executable registers — `claude-code`, `codex`, `gemini`, or `opencode` — and the resolved model — a non-blank `SLC_MODEL`, otherwise the config file's `model` field — optionally names a model, the resolved effort — a non-blank `SLC_EFFORT`, otherwise the config file's `effort` field — optionally names a reasoning effort the selected agent supports per Cligent's adapter-scoped effort metadata (an unsupported value refuses the run), and the resolved fast mode — a non-blank `SLC_FAST_MODE` holding exactly `true` or `false`, otherwise the config file's boolean `fastMode` field — optionally requests fast mode as a literal, `false` included, that Cligent's adapter-scoped fast-mode capability contract accepts for the selected agent (a literal for an agent that contract reports unsupported refuses the run naming the agent, and any other environment value refuses the run naming the variable, each before any agent call), the executable shall construct the coding-agent transport for that agent CLI through Cligent [[1]] with that model, effort, and fast mode in its call settings — omitting any of them so the agent CLI uses its own default when neither source supplies it — leaving the agent CLI to read its credentials from the inherited process environment, keeping no adapter capability list of its own wherever Cligent publishes that capability — its one exception being tool-restriction enforcement, for which Cligent publishes no metadata [[phase-execution-31](phase-execution.md#phase-execution-31)] — and shall treat the selection as configuration that does not change phase semantics ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-006](../decisions/006-slc-configuration-sources.md), [[phase-execution-13](phase-execution.md#phase-execution-13)]).

### cli-12

Where neither a non-blank `SLC_AGENT` environment variable nor the config file's `agent` field supplies an agent, or the resolved agent names an agent CLI outside the set [[cli-7](#cli-7)] registers, the executable shall refuse the run with a diagnostic and execute no phase, applying no implicit default agent ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-006](../decisions/006-slc-configuration-sources.md), [[cli-4](#cli-4)]).

### cli-20

When the slc executable builds run dependencies, the executable shall load configuration from the path given by `--config <path>` when present — disabling discovery — otherwise from the first existing of `slc.config.yaml` in the working directory then `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`, and shall apply each loaded value only where the corresponding environment variable does not supply a non-blank value ([DR-006](../decisions/006-slc-configuration-sources.md)).

### cli-21

Where `--config <path>` names a file that does not exist, or a loaded config file is malformed, declares an unknown key, or holds a wrong-typed value, the executable shall refuse the run with a diagnostic and execute no phase, while a discovery miss instead seeds the user config file [[cli-30](#cli-30)] and proceeds from it ([DR-006](../decisions/006-slc-configuration-sources.md), [DR-015](../decisions/015-first-run-config-seeding.md), [[cli-4](#cli-4)]).

### cli-30

When discovery finds neither the working-directory `slc.config.yaml` nor the user config file, the executable shall create `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml` from the starter template bundled with the host — `agent: claude-code` set, Coder `model`, `effort`, and `fastMode` plus `reviewerAgent`, `reviewerModel`, `reviewerEffort`, and `reviewerFastMode` as commented examples so reviewed compilation is disabled — report the created path on stderr, load the seeded file, and shall not seed when `--config` is given or when either discovered file exists ([DR-015](../decisions/015-first-run-config-seeding.md)).

### cli-8

When the slc executable runs a pipeline, phase, or link, the executable shall inject into `runSlc` an interpreted executor built on the agent transport — the execution for every unpinned phase — and a compiled-execution factory that runs a current pin whose contract decision selects `legacy`, `composed-v2`, or `composed-v3` through its artifact resolved against the pipeline directory, backs each `legacy` and `composed-v2` player port with one configured agent transport per player id while the roleless `composed-v3` player port rejects without an agent transport, backs every profile's Captain and judge ports with one shared configured transport, applies the selected model as the default per-player model, and rejects every pin whose contract decision fails before artifact execution without interpreting that pinned phase ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), [[phase-execution-25](phase-execution.md#phase-execution-25)], [[phase-execution-27](phase-execution.md#phase-execution-27)], [[phase-execution-30](phase-execution.md#phase-execution-30)]).

### cli-40

Where a non-blank `SLC_REVIEWER_AGENT` environment variable, otherwise the config file's `reviewerAgent`, supplies the optional Reviewer selection, when the slc executable constructs interpreted and compiled executors, the executable shall refuse an unsupported Reviewer adapter or Reviewer model/effort/fast mode without a Reviewer agent, validate a supported optional Reviewer model, adapter-scoped effort, and adapter-scoped fast mode through the same selection rules as the Coder [[cli-7](#cli-7)], lazily wrap each transformation-capable client with a fresh read-only Reviewer per performing call carrying that Reviewer selection in its call settings, preserve separate compiled-player clients, and apply each non-blank environment value over its corresponding flat YAML key independently ([DR-022](../decisions/022-two-agent-reviewed-compilation.md), [DR-006](../decisions/006-slc-configuration-sources.md), [[phase-execution-46](phase-execution.md#phase-execution-46)]).

### cli-35

When the slc executable builds run dependencies for a documented invocation form, the executable shall construct a progress reporter that renders phase, streamed-status, and heartbeat events as lines on standard error, inject it into `runSlc` as the run's progress sink, thread it into the compiled-execution factory so streamed runtime status reaches the same reporter, and resolve the stall timeout — a non-blank `SLC_STALL_TIMEOUT` environment variable, otherwise the config file's `stallTimeout` field, otherwise 600 seconds, `0` disabling — into every agent transport it constructs ([DR-019](../decisions/019-compile-progress-stall-watchdog.md), [[cli-8](#cli-8)], [[cli-32](#cli-32)], [[cli-34](#cli-34)], [[phase-execution-36](phase-execution.md#phase-execution-36)]).

### cli-9

When argv requests `--version`/`-v` or `--help`/`-h`, the slc executable shall handle the request and return a zero exit code before it resolves a pipeline, selects an agent, or invokes `runSlc`.

### cli-10

While `runSlc` is in progress, when the process receives an interrupt, the slc executable shall abort the run through a cancellation signal it passed into `runSlc`.

### cli-11

When `runSlc` returns its result, the slc executable shall, on success, write the produced artifact paths or its `up to date` outcome to standard output, write every returned diagnostic to standard error, and return a zero exit code, and otherwise write the failure diagnostics to standard error and return a non-zero exit code ([DR-003](../decisions/003-slc-phase-execution.md), [DR-021](../decisions/021-incremental-compilation.md), [DR-023](../decisions/023-host-settled-link-object-imports.md)).

## Verification

### cli-13

Where no agent is configured, when the slc executable is run with `--version` or `-v`, the slc executable shall print its version to standard output and exit zero without resolving a pipeline, selecting an agent, or invoking `runSlc` [[cli-1](#cli-1)], [[cli-9](#cli-9)].

### cli-14

Where no agent is configured, when the slc executable is run with `--help` or `-h`, the slc executable shall print usage naming the documented invocation forms, `--rebuild`, the `--config` option, and the Coder and optional Reviewer config keys and environment variables it reads to standard output and exit zero without resolving a pipeline or selecting an agent [[cli-2](#cli-2)], [[cli-9](#cli-9)].

### cli-15

Where the run succeeds, when the slc executable runs a documented invocation form with an `-o` override, the slc executable shall print the written artifact paths — including the `-o` path — to standard output and exit zero [[cli-3](#cli-3)], [[cli-11](#cli-11)].

### cli-16

Where a run is rejected, a phase fails, or a phase reports `BLOCKED`, when the slc executable runs, the slc executable shall print the failure report — naming the failing phase and its target when a phase is at fault — to standard error, write nothing to standard output, and exit non-zero [[cli-4](#cli-4)], [[cli-11](#cli-11)].

### cli-38

Where `runSlc` reports an incremental `up to date` outcome, when the slc executable completes the run, the slc executable shall print `up to date` to standard output and exit zero [[cli-3](#cli-3)], [[cli-11](#cli-11)].

### cli-42

Where `runSlc` returns a successful result carrying diagnostics, when the slc executable completes the run, the slc executable shall write every returned diagnostic to standard error, keep standard output limited to artifact paths or `up to date`, and exit zero [[cli-3](#cli-3)], [[cli-11](#cli-11)].

### cli-36

Where a run succeeds over faked dependencies, when the slc executable runs a full pipeline, the slc executable shall write each phase's start line and its finish line carrying the elapsed time to standard error in execution order, shall write recurring heartbeats naming the phase and its elapsed time while an in-flight phase remains silent across 30-second bounds, and shall keep standard output limited to the written artifact paths [[cli-3](#cli-3)], [[cli-32](#cli-32)], [[cli-33](#cli-33)], [[cli-35](#cli-35)].

### cli-37

Where a faked agent transport stalls after its first event and a short stall timeout is configured, when the slc executable runs a phase, the slc executable shall abort the call once the timeout elapses, print a failure report naming the phase, its target, and the inactivity duration to standard error, write nothing to standard output, and exit non-zero [[cli-34](#cli-34)], [[cli-35](#cli-35)].

### cli-17

While a run is in progress, when the process is interrupted, the slc executable shall abort the run through the cancellation signal, exit non-zero, and print no success report [[cli-5](#cli-5)], [[cli-10](#cli-10)].

### cli-18

Where neither `SLC_AGENT` nor a config file supplies an agent, or the resolved agent names an unsupported agent CLI, when the slc executable runs a pipeline, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero [[cli-4](#cli-4)], [[cli-12](#cli-12)].

### cli-19

Where `SLC_PIPELINE_PATH` locates the pipeline directory and `SLC_AGENT` with an optional `SLC_MODEL` are configured, when the slc executable runs a source, the slc executable shall resolve the reference to that directory and interpret every unpinned phase through the configured agent CLI with that model [[cli-6](#cli-6)], [[cli-7](#cli-7)], [[cli-8](#cli-8)].

### cli-23

Where a config file supplies the agent, model, and pipeline search path and no `SLC_*` variables are set, when the slc executable runs a source, the slc executable shall resolve the reference through the file's search path and interpret every unpinned phase through the file's agent CLI with the file's model, writing the artifact and exiting zero [[cli-6](#cli-6)], [[cli-7](#cli-7)], [[cli-22](#cli-22)].

### cli-24

Where both a config file and a non-blank `SLC_AGENT`, `SLC_MODEL`, or `SLC_PIPELINE_PATH` supply the corresponding key — agent, model, or pipeline search path — when the slc executable runs a source, the slc executable shall use the environment value over the file value for that key, resolving the reference through `SLC_PIPELINE_PATH` rather than the file's `pipelinePath` and interpreting every unpinned phase through the environment's agent CLI and model rather than the file's [[cli-6](#cli-6)], [[cli-7](#cli-7)], [[cli-20](#cli-20)].

### cli-25

Where `--config <path>` names an existing config file and a different config file sits in the working directory, when the slc executable runs a source, the slc executable shall load configuration from the `--config` file and ignore the discovered file [[cli-20](#cli-20)], [[cli-22](#cli-22)].

### cli-26

Where `--config <path>` names a file that does not exist, when the slc executable runs, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero; whereas where no config file is discovered, the executable shall not refuse on that basis and shall fall through to the environment and built-in defaults [[cli-21](#cli-21)].

### cli-27

Where a loaded config file is malformed YAML, declares an unknown key, or holds a wrong-typed value, when the slc executable runs, the slc executable shall print a diagnostic to standard error, run no phase, and exit non-zero [[cli-21](#cli-21)].

### cli-31

Where neither the working-directory `slc.config.yaml` nor the user config file exists and `--config` is absent, when the slc executable runs a full pipeline, the slc executable shall create the user config file with active `agent: claude-code`, commented `model`, `effort`, `fastMode`, `reviewerAgent`, `reviewerModel`, `reviewerEffort`, and `reviewerFastMode` examples, and no active Reviewer or fast-mode selection, name it on stderr, and complete the run with the seeded Coder selection; where the working-directory file exists, where the user file exists, or where `--config` is given, the slc executable shall create no file [[cli-29](#cli-29)], [[cli-30](#cli-30)].

### cli-41

Where Reviewer configuration is supplied to the config-loader and run-config seams by a strict flat config file and matching environment values, when those seams and the configured executor factories are exercised, each non-blank environment Reviewer value shall override its file value, supported adapter-scoped selections shall lazily build reviewed interpreted and compiled-player execution whose Reviewer calls carry the Reviewer's model, effort, and literal fast mode, and an unsupported Reviewer, a Reviewer fast mode the installed Cligent contract reports unsupported, or Reviewer model/effort/fast mode without Reviewer agent shall refuse before phase execution [[cli-20](#cli-20)], [[cli-39](#cli-39)], [[cli-40](#cli-40)].

### cli-43

Where the Coder fast mode is supplied by `fastMode`, `SLC_FAST_MODE`, or both, when the config-loader and run-config seams and the configured executor factories are exercised over faked adapters with the installed Cligent capability contract deciding support, the slc executable shall produce the outcome for the applicable case [[cli-7](#cli-7)], [[cli-20](#cli-20)], [[cli-21](#cli-21)]:

| Case | Required outcome |
| --- | --- |
| Both sources supply a value. | The non-blank environment value wins, and a blank one falls through to the file. |
| A literal `true` or `false` on an agent the installed contract reports supported. | Every interpreted and compiled-player Coder call carries that literal — `false` included — in its call settings, whereas omission leaves it unset. |
| A literal from either source on an agent the installed contract reports unsupported. | The run is refused before any agent call, naming the agent. |
| A file value that is not a YAML boolean. | The run is refused as wrong-typed. |
| An environment value other than exactly `true` or `false`. | The run is refused naming the variable. |

### cli-28

Where a pipeline directory pins a phase to a current compiled `playbook` artifact, when the slc executable runs that phase, the slc executable shall apply the compiled-execution outcome for the applicable case [[cli-8](#cli-8)]:

| Case | Required outcome |
| --- | --- |
| The pin's contract decision selects `legacy`, `composed-v2`, or `composed-v3` and the artifact completes. | Write the artifact's declared target, exit zero, use the configured agent transport and selected per-player model for any player call, and never invoke the interpreted executor. |
| The pin's contract decision rejects — including exact `@sublang/playbook@9.0.0` on a link target outside any installed engine. | Fail closed before artifact execution without invoking a player transport or the interpreted executor. |

## References

[1]: https://www.npmjs.com/package/@sublang/cligent "Cligent: Unified TypeScript SDK for AI Coding Agent CLIs"

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# slc

[![npm version](https://img.shields.io/npm/v/@sublang/slc)](https://www.npmjs.com/package/@sublang/slc)
[![Node.js](https://img.shields.io/node/v/@sublang/slc)](https://nodejs.org/)
[![CI](https://github.com/sublang-ai/slc/actions/workflows/ci.yml/badge.svg)](https://github.com/sublang-ai/slc/actions/workflows/ci.yml)

_The SubLang Compiler: describe a workflow in a paragraph of prose, get a
deterministic multi-agent program you can inspect, verify, and run._

You write what should happen — in English or Chinese, no DSL, no
orchestration framework. `slc` compiles that paragraph into a spec, a
state machine, and a runnable **playbook** that drives AI coding agents
through it. Why compile prose instead of prompting with it:

- **Deterministic where it matters.** Who acts, in what order, when to
  stop — the control flow becomes an inspectable
  [XState](https://xstate.js.org) machine, not prompt improvisation.
  LLM judgment is confined to the work *inside* each state.
- **Auditable at every stage.** Every intermediate is a file you can
  read and edit: the normalized text, one testable "shall" item per
  behavior, the state machine itself. The compiler also emits tests
  binding its output back to the spec.
- **Cheaper and safer by optimization.** Steps that need no judgment are
  rewritten at compile time into plain shell commands — no LLM call, no
  hallucination.
- **Your agents, per role.** Compilation and execution run through the
  agent CLIs you already use — Claude Code, Codex, Gemini, OpenCode —
  selectable per role, with an optional
  [second agent reviewing](#reviewed-compilation-two-agents) every
  compile step.

The flagship pipeline is `playbook` (the name of both the pipeline and
the sibling [playbook](https://github.com/sublang-ai/playbook) project
that executes its output): prose → GEARS spec items → XState machine →
a linked module the `playbook` CLI runs.

## See it run

The [demo](demo/README.md) compiles a one-paragraph description into a
two-agent code-review loop, then lets it loose on a buggy C file: the
coder and reviewer commit, review, and debate inside a real Git
repository until the review comes back clean. Precompiled artifacts are
included, so you can watch a run — or read every compile stage —
without waiting on a compile.

## Install

```bash
npm install -g @sublang/slc @sublang/playbook
npm install -g @anthropic-ai/claude-agent-sdk @openai/codex-sdk
slc --version
```

Requirements:

- A POSIX platform — macOS or Linux; on Windows, use WSL (or Git Bash).
  Compiled script steps execute through `sh`.
- Node.js >= 23.6 (compiled artifacts are imported as native TypeScript).
- One supported coding-agent CLI, installed and authenticated:
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview),
  [Codex CLI](https://github.com/openai/codex),
  [Gemini CLI](https://github.com/google-gemini/gemini-cli), or
  [OpenCode](https://opencode.ai).

The second install line supplies the agent SDKs for the default Claude
and Codex lineup; name the SDKs your own lineup needs instead. A missing
or too-old SDK stops the compile before any agent call and names the
exact package and version to install.

Compiled artifacts import the Playbook engine from their own directory;
when that import does not resolve, `playbook run` (3.1+) links its own
engine beside the artifact and says so (`--no-provision` opts out).
Working inside an npm project? Install the same set there and prefix the
commands with `npx`: a project-local install is authoritative wherever it
resolves, a project manifest declaring `@sublang/playbook` must install
it itself, and a global SDK is invisible to a project's nested
`@sublang/cligent`
([[release-11](specs/packages/release.md#release-11)] has the full rules).

## Quick start

Write a prose workflow as a `.md` or `.txt` file —
[`demo/workflow.txt`](demo/workflow.txt) is a complete one-paragraph
example — and compile it from any directory:

```bash
slc playbook my-workflow.md
```

Artifacts land in your working directory: `my-workflow.playbook/` holds
the intermediates — `my-workflow.gears.md`, the XState machine
`my-workflow.fsm.ts`, the linked runtime module, and its verification
tests — and `my-workflow.ts` is the runnable entry. Run it:

```bash
playbook run ./my-workflow.ts "<your task>"
```

Compilation drives your configured coding agent, so **expect it to take
a while**: measured compiles of a five-line workflow have run from tens
of minutes to more than two hours, with the first intermediate typically
landing within about five minutes. Meanwhile `slc` reports each phase,
each artifact with its elapsed time, and a heartbeat at least every 30
seconds on stderr; an agent call that goes silent for `stallTimeout`
seconds fails that phase instead of hanging. Success prints the artifact
paths and exits 0; a failure prints diagnostics naming the failing phase
and exits non-zero.

Intermediates are first-class: edit one, re-run a single phase
(`slc playbook.gears2fsm …`), and it lands in the same place.
`slc --help` shows all invocation forms and flags, including
`--no-optimize` to skip the optimization pass.

### Incremental recompiles

A successful full compile is snapshotted under `<artifact-dir>/.slc/`,
so a re-run only redoes what changed. Per phase, `slc` picks:

- **Reuse** — inputs are byte-identical: no agent call, and the artifact
  on disk is left exactly as it is, manual refinements included.
- **Update** — inputs changed: the phase runs ordinarily and also
  receives its prior input and a diff, as a hint to update the artifact
  rather than rewrite it from scratch.
- **Ordinary** — no usable record, a changed link phase, or `--rebuild`.

A run that reuses everything prints `up to date` instead of paths.
History is success-only, so an interrupted or failed run simply leaves
the next one to compile ordinarily. `.slc/` holds verbatim copies of
your source and outputs — treat it as no less private, gitignore it if
you commit the bundle, and delete it freely. Excluded invocation forms
and the full rules are in the
[incremental spec](specs/packages/incremental-compilation.md).

## Configuration

The first run seeds `~/.config/slc/config.yaml` with
`agent: claude-code`, so a fresh machine needs no setup. A
`slc.config.yaml` in the working directory wins over the user config,
and `SLC_AGENT`, `SLC_MODEL`, and the other `SLC_*` variables override
either, per key.

```yaml
# slc.config.yaml
agent: claude-code # claude-code | codex | gemini | opencode
model: claude-opus-4-8 # optional; omit to use the agent CLI's default
effort: high # optional adapter-scoped reasoning effort
fastMode: true # optional adapter-scoped fast mode; false is a literal request
reviewerAgent: codex # optional; enables reviewed compilation
reviewerModel: gpt-5.3-codex # optional reviewer model
reviewerEffort: xhigh # optional reviewer reasoning effort
reviewerFastMode: true # optional reviewer fast mode
stallTimeout: 600 # seconds of agent silence before a stalled call fails
pipelinePath: # search roots for <pipeline> references; defaults to the cwd
  - ./pipelines
```

Effort and fast mode are adapter-scoped: Cligent's capability contract
decides which agent CLIs accept them, and a literal on one that does not
refuses the run before any agent call. Discovery order, `--config`, and
validation rules live in the [CLI spec](specs/packages/cli.md);
`slc --help` prints the summary.

### Reviewed compilation (two agents)

Set `reviewerAgent` to compile with two independent agents. Your `agent`
selection is the Coder that writes each artifact; the Reviewer then
inspects that work read-only and reports only material correctness or
spec defects, and the Coder answers every finding with evidence and a
minimal fix. Up to three review rounds — if the third still reports
findings, the phase fails closed and names them rather than shipping a
questionable artifact.

It costs at least one extra agent call per transformation that runs.
Reuse performs no transformation and so makes no calls; Update,
Ordinary, and `--rebuild` use the loop automatically
([DR-022](specs/decisions/022-two-agent-reviewed-compilation.md)).

## How pipelines work

A pipeline is a directory of phase definitions named
`<source-format>2<target-format>.md`, each declaring its formats in a
`## Formats` table, plus an optional `link.md` for the terminal link
phase. `slc` infers phase order by chaining formats — no manifest — and
refuses incomplete, branching, or cyclic chains. Adding a phase means
writing a definition, never changing the compiler: `slc` itself performs
only the generic mechanics of chaining, validation, and artifact
placement. The bundled `playbook` pipeline chains `text2gears` and
`gears2fsm`, with `link` emitting the runnable runtime.

Every phase runs through a coding agent, one of two ways:

- **Interpreted** — the configured agent reads the definition and
  performs it. This is how an npm-installed `slc` runs the `playbook`
  pipeline, using the definitions shipped inside `@sublang/playbook`.
- **Compiled** — the phase's own compiled playbook artifact drives the
  agent through audited state-machine steps. This repository runs its
  bundled phases this way: `slc` is self-hosting, its phase definitions
  compiled, reviewed, and sha256-pinned under
  [`pipelines/playbook/`](pipelines/playbook), failing closed on drift
  ([self-hosting spec](specs/packages/self-hosting.md)).

Specs are the source of truth — start at the
[spec map](specs/map.md).

## Ecosystem

`slc` is part of the SubLang stack (all Apache-2.0,
[github.com/sublang-ai](https://github.com/sublang-ai)):

- [cligent](https://github.com/sublang-ai/cligent) — the unified
  coding-agent SDK `slc` executes phases through.
- [playbook](https://github.com/sublang-ai/playbook) — authors the
  `playbook` pipeline's phase specs and runs the compiled output.
- [spex](https://github.com/sublang-ai/spex) — the spec tool that owns
  the shared GEARS grammar and invokes `slc` for its in-app playbook
  compile flow.

## Develop

```bash
npm ci
npm run build
npm test
npm run lint
```

A checkout's own [`slc.config.yaml`](slc.config.yaml) routes the
`playbook` pipeline to the bundled copy under `pipelines/`, so repo
compiles exercise the pinned artifacts. CI additionally re-verifies the
compiled meta-phase bundles and checks that pin regeneration is
byte-identical to the committed index.

## Contributing

We welcome contributions of all kinds.

- 🌟 Star our repo if you find slc useful.
- [Open an issue](https://github.com/sublang-ai/slc/issues) for bugs or feature requests.
- [Open a PR](https://github.com/sublang-ai/slc/pulls) for fixes or improvements.
- Discuss on [Discord](https://discord.gg/XxTPjNqy9g) for support or new ideas.

## License

[Apache-2.0](LICENSE)

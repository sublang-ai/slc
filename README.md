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
- **Auditable at every stage.** The intermediates are first-class files
  you can read and edit: the normalized text, one testable "shall" item
  per behavior (in the GEARS spec grammar the SubLang stack shares), and
  the state machine itself. The compiler also emits verification tests
  binding its output to the source spec.
- **Cheaper and safer by optimization.** Steps that need no judgment are
  rewritten at compile time into plain shell commands — no LLM call, no
  hallucination, verifiable before anything runs.
- **Your agents, per role.** Compilation and execution run through the
  agent CLIs you already use — Claude Code, Codex, Gemini, OpenCode —
  selectable per role.

The flagship pipeline is `playbook` (the name of both the pipeline and
the sibling [playbook](https://github.com/sublang-ai/playbook) project
that executes its output): prose → GEARS spec items → XState machine →
a linked module the `playbook` CLI runs.

## See it run

The [demo](demo/README.md) compiles a one-paragraph description into a
two-agent code-review loop, then lets it loose on a buggy C file: the
coder and reviewer commit, review, and debate inside a real Git
repository until the review comes back clean. Precompiled reference
artifacts are included, so you can watch a run — or just read every
compile stage — without waiting on a compile.

## Install

```bash
npm install -g @sublang/slc @sublang/playbook
npm install -g @anthropic-ai/claude-agent-sdk @openai/codex-sdk
slc --version
```

The second line supplies the agent SDKs for the default Claude and Codex
lineup. Playbook 4 installs none itself — which versions work is
`@sublang/cligent`'s to enforce at load — so name the SDKs your own
configuration needs. If one is missing, the compile stops before any
agent call and names the package to install; if one is too old, it
names the installed and required versions along with the exact version
to install.

Compiled artifacts import the Playbook engine from their own directory;
when that import does not resolve, `playbook run` (3.1+) links its own
engine beside the artifact and says so (`--no-provision` opts out).
Working inside an npm project instead? Install the same set there — the
compiler, the engine, and the SDKs your lineup uses — and prefix the
commands with `npx`. A project's own install is always authoritative,
and a globally installed SDK is invisible to a project's nested
`@sublang/cligent`, so the SDKs belong in the same tree
([RELEASE-11](specs/dev/release.md#release-11) has the full rules).

Requirements:

- A POSIX platform — macOS or Linux; on Windows, use WSL (or Git
  Bash). Compiled script steps execute through `sh`, so native Windows
  is not supported.
- Node.js >= 24 (compiled phase artifacts are imported as native
  TypeScript at runtime).
- One supported coding-agent CLI, installed and authenticated:
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview),
  [Codex CLI](https://github.com/openai/codex),
  [Gemini CLI](https://github.com/google-gemini/gemini-cli), or
  [OpenCode](https://opencode.ai).

## Quick start

In any directory, write a prose workflow as a `.md` or plain `.txt`
file — [`demo/workflow.txt`](demo/workflow.txt) is a complete
one-paragraph example — and compile it:

```bash
slc playbook my-workflow.md
```

`slc` finds the `playbook` pipeline inside its own `@sublang/playbook`
dependency, so it compiles in any directory — no clone, no project
setup. Compilation drives your configured coding agent — the first run
seeds `~/.config/slc/config.yaml` with `agent: claude-code`; set
`SLC_AGENT` (or edit that file) to use another agent CLI. Expect it to
take a while: duration is agent- and workload-dependent, and measured
compiles of a five-line workflow have run from tens of minutes to more
than two hours, with the first intermediate typically landing within
about five minutes. Plain-text input (`.txt`) works too; it is
normalized first. The pipeline's optimization pass, which rewrites
judgment-free steps into plain script, runs by default
(`--no-optimize` skips it).

Artifacts land in your working directory: `my-workflow.playbook/` holds
the intermediates — `my-workflow.gears.md`, the XState machine
`my-workflow.fsm.ts`, the linked runtime module, and its verification
tests — and `my-workflow.ts` is the runnable entry. Run it:

```bash
playbook run ./my-workflow.ts "<your task>"
```

A canonical full compile also records its source binding and accepted
products in `my-workflow.playbook/.slc-source` and `.slc-build.json`. If
the bundle belongs to another same-named source or a managed product was
edited outside an accepted compile, `slc` refuses to overwrite it. To
replace those compiler-managed products deliberately, run the complete
pipeline with `--rebuild`:

```bash
slc playbook my-workflow.md --rebuild
```

A rebuild validates the current compiler pins first, executes every step
normally, and publishes the replacement lineage only after the complete
run succeeds and verifies. A failed rebuild leaves the previously accepted
lineage in place. Because it replaces canonical lineage, `--rebuild` is
available only for full or full-link runs without `-o`.

Intermediates are first-class: edit one and re-run a single phase
(`slc playbook.gears2fsm …`) and it lands in the same place.
`slc --help` shows all invocation forms.

While a compile runs, `slc` reports progress on stderr: each phase as it
starts, each artifact as it lands with the elapsed time, the compiled
runtime's own state transitions, and a heartbeat so the terminal is
never silent for more than 30 seconds. An agent call that goes quiet for
`stallTimeout` seconds (default 600, `0` disables) is aborted and
reported as a failed phase rather than hanging indefinitely.

Success prints the written artifact paths to stdout and exits 0; a
failure prints diagnostics to stderr — naming the failing phase when one
is at fault — and exits non-zero.

## Configuration

`slc` reads its agent and pipeline settings from an optional YAML config file,
overridden per key by environment variables. A blank or unset environment value
falls through to the file. When no config file exists anywhere, the first run
seeds `~/.config/slc/config.yaml` with `agent: claude-code`, so a fresh
machine needs no setup; `model` falls through to the agent CLI's own default
and `pipelinePath` to the working directory.

```yaml
# slc.config.yaml
agent: claude-code # claude-code | codex | gemini | opencode
model: claude-opus-4-8 # optional; omit to use the agent CLI's default
stallTimeout: 600 # seconds of agent silence before a stalled call fails
pipelinePath: # search roots for <pipeline> references; defaults to the cwd
  - ./pipelines
```

A `slc.config.yaml` in the working directory wins over the user config;
`SLC_AGENT`, `SLC_MODEL`, `SLC_STALL_TIMEOUT`, and `SLC_PIPELINE_PATH`
override either per key. Discovery order, `--config`, and validation
rules live in the [CLI spec](specs/user/cli.md); `slc --help` prints the
summary.

## How pipelines work

A pipeline is a directory of phase definitions named
`<source-format>2<target-format>.md`, each declaring its formats in a
`## Formats` table, plus an optional `link.md` defining the terminal
link phase. `slc` infers phase order by chaining formats — no
manifest — and refuses incomplete, branching, or cyclic chains. Adding
a phase means writing a definition, never changing the compiler: `slc`
itself performs only the generic mechanics of chaining, validation, and
artifact placement. The bundled `playbook` pipeline chains `text2gears`
and `gears2fsm`, with `link` emitting the runnable runtime.

Every phase runs through a coding agent, one of two ways:

- **Interpreted** — the configured agent reads the definition and
  performs it. This is how an npm-installed `slc` runs the `playbook`
  pipeline, using the definitions shipped inside `@sublang/playbook`.
- **Compiled** — the phase's own compiled playbook artifact drives the
  agent through audited state-machine steps. This repository's checkout
  runs its bundled phases this way: `slc` is self-hosting, its phase
  definitions compiled, reviewed, and sha256-pinned under
  [`pipelines/playbook/`](pipelines/playbook), failing closed on drift
  ([self-hosting spec](specs/user/self-hosting.md)).

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

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# slc

[![CI](https://github.com/sublang-ai/slc/actions/workflows/ci.yml/badge.svg)](https://github.com/sublang-ai/slc/actions/workflows/ci.yml)

_The SubLang Compiler: pipelines whose phases are written in prose and
carried out by coding agents._

`slc` runs compilation pipelines in which each phase is defined by a
plain markdown file and executed by an AI coding agent (reached through
[cligent](https://github.com/sublang-ai/cligent)). Adding a phase means
writing a definition, never changing the compiler: `slc` itself performs
only the generic mechanics — chaining phases by their declared formats,
validating names and locations, and placing artifacts.

```bash
slc <pipeline>[.<phase>] <source> [-o <target>]
```

Its flagship pipeline is `playbook`, the compilation service behind
[playbook](https://github.com/sublang-ai/playbook): it turns a workflow
written in prose into GEARS spec items (one normative item per state
behavior) and then into an inspectable XState v5 state machine,
optionally linked into the runnable runtime module playbook's hosts
execute.

Distinctively, `slc` is self-hosting. The reserved `slc` meta-pipeline
compiles phase definitions themselves into runnable playbook artifacts:
the bundled phases ship compiled, reviewed, and sha256-pinned under
[`pipelines/playbook/`](pipelines/playbook). A pinned phase runs exactly
its reviewed compiled artifact, verified by hash — a missing or stale
pin fails with a diagnostic instead of silently reinterpreting — while
unpinned phases fall back to the agent reading the definition directly.

## Install

Not yet published to npm — install from source:

```bash
git clone https://github.com/sublang-ai/slc.git
cd slc
npm ci
npm run build
npm link   # puts `slc` on PATH
```

Requirements:

- Node.js >= 23.6 (compiled phase artifacts are imported as native
  TypeScript at runtime).
- One supported coding-agent CLI, installed and authenticated:
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview),
  [Codex CLI](https://github.com/openai/codex),
  [Gemini CLI](https://github.com/google-gemini/gemini-cli), or
  [OpenCode](https://opencode.ai).

## Quick start

From the repo root — its [`slc.config.yaml`](slc.config.yaml) routes the
`playbook` pipeline to the bundled copy under `pipelines/` — compile a
prose workflow:

```bash
slc playbook my-workflow.md
```

This writes `my-workflow.playbook/` — the intermediates
(`my-workflow.gears.md`, the XState machine `my-workflow.fsm.ts`), the
runnable runtime module, and its verification tests — plus the
`my-workflow.ts` entry that `playbook run` consumes, all in your
working directory. A raw input (any extension the entry phase doesn't
declare, e.g. `.txt`) is normalized first, and the pipeline's
optimization pass runs by default (`--no-optimize` skips it). For what
a prose workflow looks like, see playbook's canonical worked example,
[`code.md`](https://github.com/sublang-ai/playbook/blob/main/reference/sdlc/code.md).
Intermediates are first-class: edit one and re-run a single
phase (`slc playbook.gears2fsm …`) and it lands in the same place.
`slc --help` shows all invocation forms. The repo config pins
`agent: claude-code` — set `SLC_AGENT` (or edit the config) to compile
with another agent CLI.

Success prints the written artifact paths and exits 0; a failure prints
diagnostics to stderr — naming the failing phase when one is at fault —
and exits non-zero.

## Configuration

`slc` reads its agent and pipeline settings from an optional YAML config file,
overridden per key by environment variables. A blank or unset environment value
falls through to the file. `agent` is the one required setting — it has no
built-in default; `model` falls through to the agent CLI's own default and
`pipelinePath` to the working directory.

```yaml
# slc.config.yaml
agent: claude-code # claude-code | codex | gemini | opencode
model: claude-opus-4-8 # optional; omit to use the agent CLI's default
pipelinePath: # search roots for <pipeline> references; defaults to the cwd
  - ./pipelines
```

Discovery order (first match wins):

1. `slc.config.yaml` in the working directory.
2. `${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml`.

`slc --config <path>` loads a specific file and disables discovery; a `--config`
path that does not exist is an error, whereas a discovery miss simply falls
through to the environment and defaults. Unknown keys, malformed YAML, and
wrong-typed values are rejected.

The matching environment variables, which override the file per key, are:

| Variable | Overrides | Meaning |
| --- | --- | --- |
| `SLC_AGENT` | `agent` | agent CLI: `claude-code`, `codex`, `gemini`, `opencode` |
| `SLC_MODEL` | `model` | optional model for the agent CLI |
| `SLC_PIPELINE_PATH` | `pipelinePath` | OS path-list of search roots (default: cwd) |

Credentials are read by the agent CLI from the inherited process environment.
Run `slc --help` for the full invocation and configuration summary.

## How pipelines work

A pipeline is a directory of phase definitions named
`<source-format>2<target-format>.md`, each declaring its formats in a
`## Formats` table, plus an optional `link.md` defining the terminal
link phase. `slc` infers phase order by chaining formats — no
manifest — and refuses incomplete, branching, or cyclic chains. The
bundled `playbook` pipeline chains `text2gears` and `gears2fsm`, with
`link` emitting the runnable runtime.

Every phase runs through a coding agent, one of two ways:

- **Interpreted** — the configured agent reads the definition and
  performs it.
- **Compiled** — the phase's own compiled playbook artifact (produced by
  the `slc` meta-pipeline, reviewed, and pinned in
  [`slc.pins.json`](pipelines/playbook/slc.pins.json)) drives the agent
  through audited state-machine steps. Pins bind each artifact by
  sha256 to every input that shaped it — definition, artifact bundle,
  and runtime dependencies — so which artifact executes is reproducible,
  and pinned runs fail closed on drift.

Specs are the source of truth — start at the
[spec map](specs/map.md).

## Ecosystem

`slc` is part of the SubLang stack (all Apache-2.0,
[github.com/sublang-ai](https://github.com/sublang-ai)):

- [cligent](https://github.com/sublang-ai/cligent) — the unified
  coding-agent SDK `slc` executes phases through.
- [playbook](https://github.com/sublang-ai/playbook) — authors the
  `playbook` pipeline's phase specs and runs the compiled output.
- [spex](https://github.com/sublang-ai/spex) — the desktop app that
  invokes `slc` for its in-app playbook compile flow.

## Develop

```bash
npm ci
npm run build
npm test
npm run lint
```

CI additionally re-verifies the compiled meta-phase bundles and checks
that pin regeneration is byte-identical to the committed index.

## Contributing

We welcome contributions of all kinds.

- 🌟 Star our repo if you find slc useful.
- [Open an issue](https://github.com/sublang-ai/slc/issues) for bugs or feature requests.
- [Open a PR](https://github.com/sublang-ai/slc/pulls) for fixes or improvements.
- Discuss on [Discord](https://discord.gg/XxTPjNqy9g) for support or new ideas.

## License

[Apache-2.0](LICENSE)

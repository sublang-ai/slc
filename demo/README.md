<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Demo: from one paragraph to a running two-agent code-review loop

*[中文版](README.zh.md)*

One raw paragraph is compiled into a deterministic
state-machine workflow, and that workflow then drives two real coding
agents — a coder and a reviewer — through a commit/review/debate loop
over a real Git repository until the review comes back clean.

Three lines, run from this directory:

```sh
slc playbook workflow.zh.txt
playbook run ./workflow.zh.ts "<task>"
git log --oneline
```

## The input

[`workflow.txt`](workflow.txt):

> Use two agents to carry out the input task.
> One agent modifies the code in the current directory as the task requires and commits it to Git; the other agent reviews the resulting commit and raises reasonable findings, handing them back to the first agent to judge — it may accept or reject them, but must explain why.
> The two agents argue until they reach agreement (arguing no more than 2 rounds, i.e. after the 3rd judgment in total they stop arguing), and the first agent is responsible for changing the code according to the conclusion and committing again.
> Loop like this until the review raises no findings, then finish.
> No more than 2 loops.

Note what the paragraph does *not* say: it never names the two agents,
never spells out who speaks when inside a debate round, and silently
assumes the working directory is a Git repository. The compiler makes
all three explicit in the state machine — and the two explicit bounds (at most 2 debate rounds, at
most 2 review cycles) become loop counters there.

## Prerequisites

- Node.js ≥ 23.6
- `npm install -g @sublang/slc @sublang/playbook` — the `slc` compiler and
  the `playbook` host
- [Claude Code](https://www.anthropic.com/claude-code) (`claude`) and
  [Codex](https://openai.com/codex) (`codex`) CLIs installed and signed in —
  they play the coder and the reviewer. A third agent session, the
  Captain, adjudicates each state's result
- `git`

## 1. Compile the paragraph

From this directory:

```sh
slc playbook workflow.zh.txt
```

No flags: a `.txt` input is raw prose, so `slc` normalizes it first; the
pipeline's optimization pass runs by default; and the `playbook` pipeline
links against the installed `@sublang/playbook` runtime when no `--link`
is given, also emitting the runnable entry module. Compilation is
performed by a real coding agent (configured in
[`slc.config.yaml`](slc.config.yaml); override with
`SLC_AGENT`/`SLC_MODEL`/`SLC_EFFORT`). Expect tens of minutes.

### Where the output lands

Artifacts land in your **working directory**, never beside someone
else's source: `./workflow.zh.playbook/` (the compiled bundle) and
`./workflow.zh.ts` (the runnable entry). Compiling from here regenerates
the committed bundle in place — because a real coding agent produces it,
the result will not be byte-identical, so `git diff` is the interesting
view and `git checkout -- .` (in `demo/`) the undo. To try the compiler
without touching the repo, run from anywhere else:
`cd /tmp && slc playbook /path/to/slc/demo/workflow.zh.txt` writes
`/tmp/workflow.zh.playbook/` and `/tmp/workflow.zh.ts`.

Compiling from this directory also discovers the demo's
[`slc.config.yaml`](slc.config.yaml), whose `pipelinePath: [../pipelines]`
selects the repository's committed, pinned pipeline definitions. From
elsewhere, configure the agent yourself (`SLC_AGENT`), and the
definitions come from the installed `@sublang/playbook`.

### What it produced

The bundle is committed, so you can skip the compile and just read it:

| Artifact | What to look at |
| --- | --- |
| `workflow.zh.text.md` | The normalized source: the two unnamed agents became declared players `编码者` and `审查者`, and the unstated assumption became step 1 — “开始前，确认当前目录是一个Git仓库的根目录；若不是，则先在此初始化一个Git仓库。” The meaning, order, and language of the original are preserved; what normalization adds is structure — a title, a `Players:` block, and seven numbered steps. |
| `workflow.zh.gears.raw.md` | The GEARS spec items straight out of the front-end: the Git check is `Captain shall 确保当前目录是一个 Git 仓库的根目录` — direct Captain work in prose, still needing an LLM to interpret it. The other five items are `Captain shall prompt <player>` behaviors. |
| `workflow.zh.gears.md` | After the optimize pass: the Git step is rewritten to a `Captain shall run:` **script item** — `[ -e .git ] \|\| git init`, a fixed shell command with two exit-status guards, no LLM — with provenance recorded under `## Optimizations` (`CODE-1: direct Captain work → script`). |
| `workflow.zh.fsm.ts` | The XState machine: one *invoking* state per GEARS item — the Git step invokes the `script` actor, the other five a `player` actor — plus an idle hub, a Boss-reply suspension state, and two terminal states. |
| `workflow.zh.playbook.ts` | The linked runtime: drives the FSM, calls the agents through the host's four-port contract (`callPlayer`, `callJudge`, `emitStatus`, `emitTelemetry`), and executes the script state locally via `sh -c` — no LLM, no token, milliseconds. |
| [`workflow.zh.ts`](workflow.zh.ts) | The emitted entry module `playbook run` consumes directly: players, intent, and options all derived from the compiled bundle. Nothing in this demo is hand-written wiring. |
| `workflow.zh.*.test.ts` | Verification emitted by the compiler beside its output: GEARS↔FSM conformance, FSM introspection pins, prompt contracts, transition coverage. `npx vitest run demo/workflow.zh.playbook` runs them, and so does the repo's `npm test`. |

## 2. Run it on the sample project

[`sample/`](sample) is a tiny project with a real bug to fix:
`stats.js` has a `median` that depends on element order, gets even-length
arrays wrong, and mutates its input; `test.js` fails while any of that is
true (`node sample/test.js`). Hand it to the two agents, from this
directory:

```sh
playbook run ./workflow.zh.ts \
  "There is a bug in the median function in sample/stats.js: the result depends on element order, and even-length arrays are wrong too. Fix it so that node sample/test.js passes."
```

Every role defaults to `claude`; pick your own lineup with
`--player 编码者=claude:claude-sonnet-5 --player 审查者=codex:gpt-5.6-terra
--captain claude:claude-sonnet-5` (`<adapter>[:<model>][@<effort>]`).
The player IDs are `编码者` (coder) and `审查者` (reviewer) — they come
from the source paragraph, which is why they're Chinese; the emitted
entry declares them as the required roles. The task text is free-form
and passed through at runtime, so it can be in any language,
independent of the language the workflow was compiled from.

The workflow operates on the **current directory**, and its scripted
first step checks whether that directory is the **root** of a Git
repository. This one isn't — it sits inside the slc checkout — so the
step runs `git init` right here, without any agent, and the loop
commits into that fresh nested repository. Then:

- the coder makes the change and commits;
- the reviewer reviews that commit and raises findings; the coder
  accepts or rebuts with reasons; they iterate, bounded by the paragraph's
  own limits;
- when a review comes back clean, the machine reaches its final state and
  the run exits `0`.

```sh
git log --oneline     # just the reviewed commits — the nested repo's history
node sample/test.js   # stats.js: all checks passed
```

Undo the run with `rm -rf .git && git -C .. checkout -- demo/`.

To use it for real, run the same command in your own project's root with
your own task — there the scripted step finds `.git` and passes through.

> The agents commit into whatever directory you run this in. Point it at
> a working tree you're willing to have modified.

Add `--json --verbose` for a machine-readable summary on stdout and
per-state status lines on stderr — the scripted step reports
`Executed script for <state> (exit 0).` before any agent has run.

## What this demonstrates

- **Natural language is the source.** The paragraph was never edited;
  normalization made its implicit structure explicit instead.
- **Deterministic orchestration, agent-performed work.** The loop —
  who acts, when to stop — is a compiled state machine, not prompt
  improvisation; only the work inside each state uses an LLM.
- **Optimization is real.** A step that needs no judgment became a
  compile-time-verified shell command: cheaper, faster, and immune to
  hallucination.
- **Verification is emitted with the artifact.** The compiler ships the
  tests that pin its own output to the source specification.

## Reproducing the acceptance run

[`acceptance/`](acceptance/) holds the maintainer-side harness: it seeds
a scratch copy of `sample/`, scripts the two-agent run over it, and
validates every artifact plus the live run evidence. See
[`acceptance/README.md`](acceptance/README.md). You don't need any of it
to use the demo — step 2 above is the same run, by hand.

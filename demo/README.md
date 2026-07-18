<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Demo: from one Chinese paragraph to a running two-agent code-review loop

*[中文版](README.zh.md)*

One raw paragraph of Chinese prose is compiled into a deterministic
state-machine workflow, and that workflow then drives two real coding
agents — a coder and a reviewer — through a commit/review/debate loop
over a real Git repository until the review comes back clean.

Two commands: `slc` compiles the paragraph, `playbook` runs the result.

## The input

[`workflow.zh.md`](workflow.zh.md) — verbatim, never edited by the tools:

> 用两个agent来完成输入的任务，一个agent按任务要求对当前目录的代码进行修改并提交Git，另一个agent对提交的commit进行review并提出合理问题，交回给第一个agent做判断，它可以接受或拒绝但要讲清楚原因，两个agent争论直至达成一致（争论不超过2轮，即至多到总计第3次判断后不再争论，自己定夺），由第一个agent负责按结论修改代码，再次提交。依此循环，直到review没有任何问题后结束。循环次数不超过2次。

[`workflow.md`](workflow.md) is an English rendering of the same
paragraph, for readers who don't read Chinese. It is a translation, not
the compiled source — the committed artifacts come from the Chinese
file. (You can compile the English one too; because artifacts are named
after the input, it lands in its own `workflow.playbook/` and leaves the
committed set alone.)

Note what the paragraph does *not* say: it never names the two agents,
never spells out who speaks when inside a debate round, and silently
assumes the working directory is a Git repository. The compiler handles
all three — and the two explicit bounds (at most 2 debate rounds, at
most 2 review cycles) become typed loop counters in the state machine.

## Prerequisites

- Node.js ≥ 23.6 (the compiled artifacts are erasable TypeScript, loaded
  through Node's built-in type stripping)
- `npm install -g @sublang/slc @sublang/playbook` — the `slc` compiler and
  the `playbook` host. `playbook run` requires **playbook ≥ 0.10**
- [Claude Code](https://www.anthropic.com/claude-code) (`claude`) and
  [Codex](https://openai.com/codex) (`codex`) CLIs installed and signed in —
  they play the coder and the reviewer. A third agent session, the
  Captain, adjudicates each state's result
- `git`
- To compile rather than just read: a clone of this repository with
  `npm install` run in it (step 1's `--link` target lives under
  `node_modules/`)

## 1. Compile the paragraph

From the repository root:

```sh
slc playbook demo/workflow.zh.md --normalize -O \
  --link node_modules/@sublang/playbook/src/runtime.ts
```

- `--normalize` first rewrites the raw prose into a pipeline-ready source
  (a generic, pipeline-agnostic step: it reads the entry phase's own
  definition and restructures the input toward it).
- `-O` runs the pipeline's optimization pass between phases.
- `--link` produces the runnable playbook module against the shared
  runtime contract.

Compilation is performed by a real coding agent (configured in
`slc.config.yaml`; override with `SLC_AGENT`/`SLC_MODEL`/`SLC_EFFORT`).
Expect tens of minutes.

### Where the output lands

Artifacts go **beside the input file**, never in your current directory:
`slc` derives the output directory from the source path as
`<input-dir>/<stem>.<pipeline>/`. So even
`cd /tmp && slc playbook /path/to/slc/demo/workflow.zh.md` writes into
`/path/to/slc/demo/workflow.zh.playbook/`. (`-o <path>` is the only flag
that moves output, and it moves only the terminal artifact.)

Run from the repository root anyway, for two reasons that have nothing to
do with placement: `slc.config.yaml` is discovered in the *current*
directory, and its `pipelinePath: [pipelines]` is resolved against the
current directory too — so only from the root do you compile with this
repo's committed, pinned pipeline definitions. From elsewhere it still
works, falling back to whatever the installed `@sublang/playbook` ships.
And `--link node_modules/…` is a relative path.

> **Recompiling overwrites the committed artifacts.** `slc` creates the
> output directory with `mkdir -p` semantics — no existence check, no
> prompt, no backup. Running the command above rewrites every file in
> `demo/workflow.zh.playbook/` in place. Because a real coding agent
> produces them, the result will not be byte-identical to what is
> committed, so expect a dirty worktree — `git diff` is the interesting
> view, and `git checkout -- demo/workflow.zh.playbook` is the undo.

### What it produced

The bundle is committed, so you can skip the compile and just read it:

| Artifact | What to look at |
| --- | --- |
| `workflow.zh.text.md` | The normalized source: the two unnamed agents became declared players `编码者` and `审查者`, and the unstated assumption became step 1 — “开始前，确认当前目录是一个Git仓库；若不是，则先将其初始化为Git仓库。” The meaning, order, and language of the original are preserved; what normalization adds is structure — a title, a `Players:` block, and seven numbered steps. |
| `workflow.zh.gears.raw.md` | The GEARS spec items straight out of the front-end: the Git check is `Captain shall 确保当前目录是一个 Git 仓库` — direct Captain work in prose, still needing an LLM to interpret it. The other five items are `Captain shall prompt <player>` behaviors. |
| `workflow.zh.gears.md` | After the optimize pass: the Git step is rewritten to a `Captain shall run:` **script item** — a fixed shell command with two exit-status guards, no LLM — with provenance recorded under `## Optimizations` (`CODE-1: direct Captain work → script`). |
| `workflow.zh.fsm.ts` | The XState machine: one *invoking* state per GEARS item — the Git step invokes the `script` actor, the other five a `player` actor — plus an idle hub, a Boss-reply suspension state, and two terminal states. |
| `workflow.zh.playbook.ts` | The linked runtime: drives the FSM, calls the agents through the host's four-port contract (`callPlayer`, `callJudge`, `emitStatus`, `emitTelemetry`), and executes the script state locally via `sh -c` — no LLM, no token, milliseconds. |
| `workflow.zh.*.test.ts` | Verification emitted by the compiler beside its output: GEARS↔FSM conformance, FSM introspection pins, prompt contracts, transition coverage. `npx vitest run demo/workflow.zh.playbook` runs them, and so does the repo's `npm test`. |
| [`registry.ts`](registry.ts) | A small hand-written adapter (the one piece slc does not emit) exposing the compiled runtime to `playbook run`. |

## 2. Run it on the sample project

[`sample/`](sample) is a tiny project with a real bug to fix:
`stats.js` has a `median` that depends on element order, gets even-length
arrays wrong, and mutates its input; `test.js` fails while any of that is
true. Copy it somewhere and watch it fail:

```sh
cp -R /path/to/slc/demo/sample /tmp/median-demo
cd /tmp/median-demo
node test.js        # AssertionError: median must not depend on element order
```

Now hand it to the two agents:

```sh
playbook run /path/to/slc/demo/registry.ts \
  "There is a bug in the median function in stats.js: the result depends on element order, and even-length arrays are wrong too. Fix it so that node test.js passes." \
  --player 编码者=claude:claude-sonnet-5 \
  --player 审查者=codex:gpt-5.6-terra \
  --captain claude:claude-sonnet-5
```

When it exits `0`:

```sh
node test.js        # stats.js: all checks passed
git log --oneline   # the reviewed commits, in a repo the workflow created
```

The player IDs are `编码者` (coder) and `审查者` (reviewer) — they come
from the source paragraph, which is why they're Chinese; `registry.ts`
declares them as the required roles. Any adapter/model pair works
(`<adapter>[:<model>][@<effort>]`). The task text is free-form and passed
through at runtime, so it can be in any language, independent of the
language the workflow was compiled from.

To use it for real, run the same command in your own project with your
own task. The workflow operates on the **current directory**, which does
not need to be a Git repository — as `/tmp/median-demo` above isn't. The
compiled workflow's scripted step initializes one if needed, without any
agent running. Then:

- the coder makes the change and commits;
- the reviewer reviews that commit and raises questions; the coder
  accepts or rebuts with reasons; they iterate, bounded by the paragraph's
  own limits;
- when a review comes back clean, the machine reaches its final state and
  the run exits `0`.

> The agents commit into whatever directory you run this in. Point it at
> a working tree you're willing to have modified — which is why the
> walkthrough above copies the sample out to `/tmp` first.

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

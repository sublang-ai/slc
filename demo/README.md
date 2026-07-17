<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Demo: from one Chinese paragraph to a running two-agent code-review loop

This folder is an end-to-end, hands-on tour of `slc` and `playbook`:
one raw paragraph of Chinese prose is compiled into a deterministic
state-machine workflow, and that workflow then drives two real coding
agents — a coder and a reviewer — through a commit/review/debate loop
over a real Git repository until the review comes back clean.

The same folder doubles as the acceptance test: `check.mjs` validates
every artifact and the live run, including the workflow step that runs
**without any LLM** (the scripted Git check/init).

## The input

[`workflow.md`](workflow.md) — verbatim, never edited by the tools:

> 用两个agent来完成输入的任务，一个agent按任务要求对当前目录的代码进行修改并提交Git，另一个agent对提交的commit进行review并提出合理问题，交回给第一个agent做判断，它可以接受或拒绝但要讲清楚原因，两个agent争论直至达成一致，由第一个agent负责按结论修改代码，再次提交。依此循环，直到review没有任何问题后结束。

Note what it does *not* say: it never names the two agents, never spells
out the debate turns, and silently assumes the working directory is a
Git repository. The compiler handles all three.

## Prerequisites

- Node.js ≥ 23.6 (the compiled artifacts are erasable TypeScript, loaded
  through Node's built-in type stripping)
- `npm install -g @sublang/slc @sublang/playbook` — the `slc` compiler and
  the `playbook` host
- [Claude Code](https://www.anthropic.com/claude-code) (`claude`) and
  [Codex](https://openai.com/codex) (`codex`) CLIs installed and signed in —
  they play the coder and the reviewer
- `git`

Run everything from the repository root unless noted.

## 1. Compile the paragraph

```sh
slc playbook demo/workflow.md --normalize -O \
  --link node_modules/@sublang/playbook/src/runtime.ts
```

- `--normalize` first rewrites the raw prose into a pipeline-ready source
  (a generic, pipeline-agnostic step: it reads the entry phase's own
  definition and restructures the input toward it).
- `-O` runs the pipeline's optimization pass between phases.
- `--link` produces the runnable playbook module against the shared
  runtime contract.

Compilation is performed by a real coding agent (configured in
`slc.config.yaml`; override with `SLC_AGENT`/`SLC_MODEL`). Expect tens of
minutes. Everything lands in `demo/workflow.playbook/` — which is also
committed, so you can skip this step and read the artifacts instead:

| Artifact | What to look at |
| --- | --- |
| `workflow.text.md` | The normalized source: the two unnamed agents became declared players `编码者` and `审查者`, and the unstated assumption became step 1 — “确认当前目录是 Git 仓库；若不是，则先将其初始化”. The meaning, order, and language of the original are untouched. |
| `workflow.gears.raw.md` | The GEARS spec items straight out of the front-end: every step is an agent behavior, including the Git check. |
| `workflow.gears.md` | After the optimize pass: the Git step is rewritten to a `Captain shall run:` **script item** — a fixed shell command with two exit-status guards, no agent — with provenance recorded under `## Optimizations`. |
| `workflow.fsm.ts` | The XState machine: one state per item; the Git step invokes the `script` actor, every other state a `player` actor. |
| `workflow.playbook.ts` | The linked runtime: drives the FSM, calls the agents through the six-port host contract, and executes the script state locally via `sh -c` — no LLM, no token, milliseconds. |
| `workflow.*.test.ts` | Verification emitted by the compiler beside its output: GEARS↔FSM conformance, FSM introspection pins, prompt contracts, transition coverage. `npx vitest run demo/workflow.playbook` runs them. |
| `registry.ts` | A small hand-written adapter (the one piece slc does not emit) exposing the compiled runtime to `playbook run`. |

## 2. Seed the target repository

```sh
demo/setup.sh
```

This creates `demo/run/` with a tiny project: `stats.js` has a real
`median` bug (order-dependent, wrong for even lengths) and `test.js`
fails while it is present. The directory is deliberately **not** a Git
repository — the compiled workflow's scripted step will initialize it.

## 3. Run the workflow with two real agents

```sh
demo/run.sh
```

which is essentially:

```sh
cd demo/run
playbook run ../registry.ts \
  "stats.js 里的 median 函数有 bug：结果依赖元素顺序，偶数长度数组也算错。请修复它，使 node test.js 通过。" \
  --player 编码者=claude:claude-sonnet-5 \
  --player 审查者=codex:gpt-5.6-terra \
  --captain claude:claude-sonnet-5 \
  --json --verbose
```

Watch the `◇` status lines on stderr:

- the scripted step reports `Executed script for <state> (exit 0)` — and
  `.git/` appears without any agent having run;
- the coder (Claude Code) fixes `median` and commits;
- the reviewer (GPT-5.6 Terra via Codex) reviews the commit and raises
  questions; the coder accepts or rebuts with reasons; they iterate;
- when a review comes back clean, the machine reaches its final state and
  the run exits `0` with a JSON summary on stdout.

Different lineup? `CODER_AGENT`/`REVIEWER_AGENT`/`CAPTAIN_AGENT` override
the specs (`<adapter>[:<model>][@<effort>]`).

## 4. Validate everything

```sh
node demo/check.mjs --run-dir demo/run
```

The checker validates the artifacts (script item, script state,
conformance, emitted verification suite), exercises the non-LLM Git
command standalone in scratch directories, and then audits the run
evidence: terminal outcome, the agent-free script execution in the live
log, commits in the repository, and `node test.js` finally passing.

Without `--run-dir` it validates just the compiled artifacts — that
static half runs in this repository's CI on every push.

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

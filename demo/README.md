<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Demo: from one paragraph to a reliable two-agent code-review loop

*[中文版](README.zh.md)*

A plain text description is compiled into a deterministic state-machine
workflow, and that workflow drives two agents — a coder and a reviewer —
through a commit/review/debate loop over a real Git repository, until the
review raises no further findings.

## Quick start

Three lines, run from this directory:

```sh
npx slc playbook workflow.txt  # compile the input workflow description to a playbook
npx playbook run ./workflow.ts "<task>"  # run the workflow playbook with a task you specify
git log --oneline  # view what the run produced
```

Prerequisites:

- macOS or Linux (on Windows, use WSL or Git Bash — the workflow's
  scripted step runs through `sh`)
- Node.js ≥ 23.6
- `npm install --save-dev @sublang/slc @sublang/playbook` in the project — the
  compiler, runtime host, and project-local engine imported by generated files
- Default setup: [Claude Code CLI](https://www.anthropic.com/claude-code)
  installed and signed in, so the `claude` command is available. Other
  agents and models can be configured, including per role (coder,
  reviewer, Captain) — see [role setup](#role-setup).
- `git`

## More details

### Input

[`workflow.txt`](workflow.txt) — the English source the commands below
compile; [`workflow.zh.txt`](workflow.zh.txt) is the same paragraph in
Chinese, compiled by the [Chinese README](README.zh.md)'s flow:

> Before work begins, ensure the current directory is the root of its own Git repository; if `.git` is absent there, initialize a repository there.
> Use two agents to carry out the input task.
> One agent modifies the code in the current directory as the task requires and commits it to Git; the other agent reviews the resulting commit and raises reasonable findings, handing them back to the first agent to judge — it may accept or reject them, but must explain why.
> The two agents argue until they reach agreement (arguing no more than 2 rounds, i.e. after the 3rd judgment in total they stop arguing), and the first agent is responsible for changing the code according to the conclusion and committing again.
> Loop like this until the review raises no findings, then finish.
> No more than 2 loops.

Note what the paragraph leaves **unstated**: it never names the two
agents or says how a round of debate is exchanged. The compiler makes both
explicit in the state machine. The stated repository-root setup becomes a
scripted state, while the two stated bounds — at
most 2 debate rounds, at most 2 loops — become loop counters there.

### Compile

```sh
npx slc playbook workflow.txt
```

`slc` first normalizes the input text into the form the playbook pipeline
expects, links the result against the installed `@sublang/playbook`
runtime, and by default runs the compile optimization that reduces LLM
calls.
The agent used by the compilation itself is configured in
`~/.config/slc/config.yaml`.
Compiling may take more than ten minutes.

Artifacts land in the current directory: `./workflow.playbook/` (the
compile intermediates) and `./workflow.ts` (the runnable entry).
Reference artifacts are provided under
[`reference/workflow.playbook/`](reference/workflow.playbook/), for
preview or comparison; the Chinese flow's set is being regenerated with
the released packages and will land alongside it.
You can also skip compiling and just read them.

| Intermediate | What it is |
| --- | --- |
| `workflow.text.md` | The normalized source text: declares the players `Coder` and `Reviewer` and arranges the original into numbered steps. |
| `workflow.gears.raw.md` | The GEARS spec items generated from the source text (before optimization). |
| `workflow.gears.md` | The optimized GEARS spec items: the Git check is rewritten into a fixed shell command that needs no LLM. |
| `workflow.fsm.ts` | The XState machine generated from the GEARS items. |
| `workflow.playbook.ts` | The linked runtime module: drives the machine and calls each agent. |
| `workflow.*.test.ts` | Verification tests emitted alongside the artifacts, pinning the compiler's output to the source spec. |

### Use

[`sample.c`](sample.c) is a tiny C file with a real bug: its `median()`
depends on element order and gets even-length arrays wrong. From this
directory, hand it to the two agents:

```sh
npx playbook run ./workflow.ts \
  "There is a bug in the median function in sample.c: the result depends on element order, and even-length arrays are wrong too. Fix it."
```

(Skipped the compile? Run the reference entry directly:
`npx playbook run ./reference/workflow.ts "<task>"`)

<a id="role-setup"></a>

Every role defaults to `claude`; to choose an agent, model, or other
parameters, add `--player Coder=claude:claude-sonnet-5 --player
Reviewer=codex:gpt-5.6-terra --captain claude:claude-sonnet-5`
(`<adapter>[:<model>][@<effort>]`).

The workflow operates on the **current directory**, and its scripted
first step checks whether that directory is the **root** of a Git
repository. This one is not, so the step runs `git init` first. Then:

- the coder makes the change and commits;
- the reviewer reviews that commit and raises findings; the coder accepts
  or rebuts with reasons; they go back and forth, bounded by the limits
  the source paragraph set;
- when a review comes back clean, the machine reaches its final state and
  the run exits `0`.

```sh
git log --oneline   # the reviewed commits
git show            # the reviewed fix to sample.c
```

To reset before running again, from the repository root:

```sh
rm -rf demo/.git demo/workflow.playbook demo/workflow.ts
git checkout -- demo/
```

To use it for real, run the `npx playbook run` command from your own project's **root**
with the path to the playbook and your own task — there the scripted step finds `.git` and passes
through.
The agents commit into whatever directory you run the command in.

## What this demo shows

- **Natural language is the source.** The input prose was never edited;
  normalization only makes its implicit structure explicit.
- **Deterministic orchestration.** The loop — who acts, when to stop — is
  a compiled state machine rather than prompt improvisation; only the
  work **inside** each state uses an LLM.
- **Compile-time optimization.** A step needing no judgment became a
  shell command verifiable at compile time: cheaper, faster, and immune
  to hallucination.
- **Verification ships with the artifacts.** The compiler also generates
  the tests that check its own output against the source spec.

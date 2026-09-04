<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Demo: from one paragraph to a reliable two-agent code-review loop

*[中文版](README.zh.md)*

A plain text description is compiled into a deterministic state-machine
workflow, and that workflow drives two agents — a coder and a reviewer —
through a commit/review/debate loop over a real Git repository, until the
review raises no further findings.

## Quick start

Prerequisites: macOS or Linux (on Windows, use WSL or Git Bash — the
workflow's scripted step runs through `sh`), Node.js ≥ 23.6, `git`, and
the [Claude Code CLI](https://www.anthropic.com/claude-code) installed
and signed in so the `claude` command works. Other agents and models can
be chosen per role — see [Role setup](#role-setup).

This directory is a self-contained npm project. From `demo/`, install
first, then run:

```sh
npm install
```

```sh
npx slc playbook workflow.txt
```

```sh
npx playbook run ./workflow.ts \
  "There is a bug in the median function in sample.c: the result depends on element order, and even-length arrays are wrong too. Fix it."
```

```sh
git log --oneline
```

What each step does:

1. **`npm install`** brings in `@sublang/slc` (the compiler) and
   `@sublang/playbook` (the `playbook` command, plus the runtime engine
   that generated files import from `./node_modules`). It must run
   before the `npx` lines — with nothing installed, `npx` would offer
   to download `slc` and `playbook` from the registry, which are
   **unrelated packages** that happen to share the names.
2. **`npx slc playbook workflow.txt`** compiles the one-paragraph
   description into a runnable playbook. The compile calls your
   configured agent, and **its duration is agent- and
   workload-dependent: measured compiles of this five-line workflow have
   run from tens of minutes to more than two hours**. It reports each
   phase on stderr as it goes and succeeds when `./workflow.ts` appears.
   Want to skip the wait? A precompiled copy ships in
   [`reference/`](reference/), runnable as
   `npx playbook run ./reference/workflow.ts "<task>"` with the same
   task string as the next step — though note the run itself is real
   agent work too (see below).
3. **`npx playbook run …`** hands the buggy [`sample.c`](sample.c) to
   the two agents. They commit, review, and debate inside a Git
   repository created here; every round is real agent work, so expect a
   run on the order of an hour — one run from the precompiled artifacts
   measured about 51 minutes, varying with agent, model, and task. The
   run exits `0` when a review comes back clean.
4. **`git log`** shows what the loop produced: the reviewed commits
   (`git show` displays the final fix).

## More details

### Input

[`workflow.txt`](workflow.txt) — the English source the commands above
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
The agent driving the compilation is set in `~/.config/slc/config.yaml`
(created on the first run; defaults to Claude Code).
Compile time is agent- and workload-dependent: the first intermediate
has measured about 4 minutes in and the next about a minute later,
while full compiles of this workflow have ranged from tens of minutes
to more than two hours — the later phases dominate. `slc` prints
each phase, each artifact with its elapsed time, and a heartbeat while
work is in flight, so you can tell progress from a stall.

Artifacts land in the current directory: `./workflow.playbook/` (the
compile intermediates) and `./workflow.ts` (the runnable entry).
Reference artifacts are provided under
[`reference/workflow.playbook/`](reference/workflow.playbook/) — and the
Chinese flow's under
[`reference/workflow.zh.playbook/`](reference/workflow.zh.playbook/) —
for preview or comparison. You can also skip compiling and just read
them.

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

(Skipped the compile? Run the reference entry directly, with the same
task string: `npx playbook run ./reference/workflow.ts "<task>"`)

### Role setup

Every role defaults to `claude` — the coder and reviewer players, and
the Captain, the hidden orchestrator that routes turns and adjudicates
results. To choose an agent, model, or effort per role, add flags in the
form `<adapter>[:<model>][@<effort>]`, for example: `--player
coder=claude:claude-sonnet-5 --player reviewer=codex:gpt-5.6-terra
--captain claude:claude-sonnet-5@high`. The entry names each role by its
canonical lowercase id, the same id the compiled machine delegates to.

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

To reset before running again, from the slc repo root (the directory
above `demo/`):

```sh
rm -rf demo/.git demo/workflow.playbook demo/workflow.ts
git checkout -- demo/
```

(The installed `demo/node_modules` can stay.)

To use it for real, run `playbook run` from your own project's **root**
with the path to the playbook and your own task — there the scripted
step finds `.git` and passes through. Copy the entry (`workflow.ts`)
**together with** its `workflow.playbook/` directory; the two move as a
pair. With a global install (playbook 3.1+) the engine needs nothing
more — `playbook run` links it beside the artifact on its first run
there — but playbook 10 ships no agent SDK, so the SDKs your lineup
uses must sit alongside that global install. If that project's
`package.json` declares `@sublang/playbook`, install it there instead
(`npm install --save-dev @sublang/playbook@10`) together with those
SDKs, as this demo's own manifest declares them: a declared dependency
is authoritative, so provisioning refuses rather than shadow a missing
install, and a global SDK is invisible to a project's nested cligent.
The demo itself uses a project-local install for exactly that reason —
it sits inside the slc repository, whose manifest declares the
engine.
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

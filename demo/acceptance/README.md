<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Acceptance harness for the demo (IR-012)

Maintainer-side only. Nothing here is needed to *use* the demo — see
[`../README.md`](../README.md) for that. This directory exists to make
the demo's claims reproducible: a seeded repository with a known bug, a
scripted two-agent run over it, and a checker that validates both the
compiled artifacts and the live run evidence.

All three scripts locate themselves, so they work from any directory.

## Seed the target repository

```sh
demo/acceptance/setup.sh [<work-dir>] [--init]
```

Creates `<work-dir>` (default `${TMPDIR:-/tmp}/slc-demo-run`, deliberately
outside this repository so the agents see only the demo project, not
slc's own `CLAUDE.md`/`specs/`) holding a copy of the user-facing sample,
[`../sample.c`](../sample.c): its `median()` has a real bug —
order-dependent and wrong for even lengths.

The directory is deliberately **not** a Git repository, so the compiled
workflow's scripted step is the thing that initializes it. Pass `--init`
to seed it as a repository instead, to exercise the pass-through branch
of the same command.

> `<work-dir>` is `rm -rf`'d before seeding. Don't point it at anything
> you care about.

## Run it with two real agents

```sh
demo/acceptance/run.sh [<work-dir>]
```

Calls `setup.sh` itself, so the work directory is always freshly seeded —
running `setup.sh` beforehand is redundant, and anything added between the
two is discarded. It then `cd`s into the work directory (this matters:
the emitted entry `workflow.zh.ts` hands the process working directory to
the compiled workflow as the tree its scripted step and its agents
operate on) and invokes `playbook run` with `--json --verbose`.

Evidence is captured **beside** the work repository, in
`<work-dir>.evidence/` — a growing log inside the worktree would be a
legitimate review finding, and the reviewer would raise it every round:

| File | Contents |
| --- | --- |
| `run.json` | the playbook's stdout — the JSON outcome envelope |
| `run.log` | stderr — the per-state status lines |
| `run.exit` | the playbook's own exit status |

Watch it live with `tail -f "${TMPDIR:-/tmp}/slc-demo-run.evidence/run.log"`.

`run.sh` itself exits 0 regardless of how the run went, so **`run.exit` is
the authoritative signal** — which is what `check.mjs` reads.

Overrides: `CODER_AGENT`, `REVIEWER_AGENT`, `CAPTAIN_AGENT`
(`<adapter>[:<model>][@<effort>]`), `DEMO_TASK` for the task text, and
`PLAYBOOK_BIN` for the launcher (`playbook-dev` against a sibling working
copy).

## Validate

```sh
node demo/acceptance/check.mjs [--run-dir <work-dir>]
```

Static stages (always): the artifact set exists; the optimized GEARS
carries the agent-free script item with recorded provenance; the FSM
realizes it as a `script` actor state and the linked runtime executes it
with no agent port; the script command really performs the non-LLM Git
operation, exercised standalone in scratch directories; the compiler's
emitted verification suite passes.

With `--run-dir`, it additionally audits the evidence: terminal outcome,
the agent-free script execution in the live log, state traversal, commits
in the repository, and the repaired `sample.c` passing a scratch
compile-and-run median check (requires a C compiler, `cc`).

Requires `npm install && npm run build` at the repository root —
`check.mjs` imports `dist/verify.js` and shells out to `npx vitest`. It
reads the evidence triple unguarded, so `--run-dir` for a run not produced
by `run.sh` throws rather than reporting a failed check.

Note that CI does not run this checker; what runs on every push is the
compiler's emitted verification suite, collected by `npm test`.

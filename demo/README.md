<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Demo: from prose to a two-agent code-review loop

*[中文版](README.zh.md)*

The [English procedure](workflow.txt) and [Chinese procedure](workflow.zh.txt)
describe the same bounded code-and-review loop. The compiled workflow drives
a coder and reviewer through real Git commits until the review is clean or
the procedure's limit is reached.

## Quick start with the precompiled workflow

Use macOS or Linux, Node.js ≥ 23.6,
`git`, and an installed, authenticated [Claude Code CLI](https://www.anthropic.com/claude-code).
From `demo/`, install dependencies and prepare a fresh scratch copy.
The local Git identity below is for the exercise; replace it with your own
if you want attribution in the resulting commits:

```sh
npm install
demo_source="$PWD"
demo_work=$(mktemp -d)
cp sample.c workflow.txt workflow.zh.txt package.json playbook.config.yaml "$demo_work/"
cp -R reference "$demo_work/reference"
ln -s "$demo_source/node_modules" "$demo_work/node_modules"
cd "$demo_work"
printf 'node_modules/\n.spex/\n' > .gitignore
git init --quiet
git config user.name 'Demo Participant'
git config user.email 'demo@example.invalid'
git add .
git -c commit.gpgsign=false commit -m 'chore: Record demo baseline'
mkdir -p .spex/config
cp playbook.config.yaml .spex/config/playbook.config.yaml
export SPEX_HOME="$PWD/.spex"
npx playbook --list
```

The remaining commands run inside the scratch copy, whose baseline
contains the original sample and workflow artifacts. The participant's
checkout stays separate.

The list must include `/workflow` and `/workflow.zh`. The supplied
[config template](playbook.config.yaml) enables both reference entries,
binds their exact declared roles to two stable players, and selects
Claude Opus 5.5 at `high` for those players and Captain. Its paths resolve
relative to `.spex/config/playbook.config.yaml`. The explicit `SPEX_HOME`
keeps this demo's configuration and sessions in `.spex/`.

Run the English workflow on the buggy [sample.c](sample.c):

```sh
npx playbook run "/workflow There is a bug in the median function in sample.c: the result depends on element order, and even-length arrays are wrong too. Fix it."
git log --oneline
```

This calls real agents. The workflow initializes a Git repository rooted
in the current directory if needed, then the coder changes and commits
code, the reviewer inspects the commit, and they resolve findings within
the source's bounds: at most two review loops and two debate rounds.
The agents commit into the directory where you run the command.

Install before using `npx`: without these dependencies, `npx slc` and
`npx playbook` can offer unrelated packages with the same unscoped names.
The [consumer manifest](package.json) supplies the scoped compiler,
Playbook engine, and the Claude and Codex SDKs.

## Compile your own copy

```sh
npx slc playbook workflow.txt
```

Compilation uses the Coder configured in `~/.config/slc/config.yaml`, or
`slc.config.yaml` in the current directory. Pin it explicitly when
comparing results, for example:

```yaml
agent: codex
model: gpt-6.1-sol
effort: xhigh
```

The compiler normalizes the prose, generates GEARS requirements and an
XState machine, applies the default optimization passes, and links a
runtime module. Its stdout lists artifacts; stderr reports phase progress
and heartbeats. Compilation time depends on the procedure and model;
the [performance report](../docs/compilation-performance.md) records measured
settings and their limits. If unresolved source behavior needs clarification,
exit `2` names the source and questions: edit the source and repeat the command.

The fresh entry is `./workflow.ts`, with intermediates and tests under
`./workflow.playbook/`. To run it, change only the English entry's `from`
in `.spex/config/playbook.config.yaml` from `../../reference/workflow.ts`
to `../../workflow.ts`,
then repeat the list and run commands above. The Chinese reference remains
available; compiling `workflow.zh.txt` similarly emits `workflow.zh.ts`.

| Artifact | Purpose |
| --- | --- |
| `workflow.text.md` | Normalized source with declared roles and ordered steps. |
| `workflow.gears.raw.md` | GEARS requirements before optimization. |
| `workflow.gears.md` | Optimized requirements, including a fixed Git setup script. |
| `workflow.fsm.ts` | Deterministic state machine. |
| `workflow.playbook.ts` | Linked runtime module. |
| `workflow.*.test.ts` | Generated checks binding the artifacts to the requirements. |
| `workflow.ts` | Registry entry to enable in Playbook configuration. |

## Roles and reuse

A schema-3 entry is enabled through configuration, then invoked as a slash
command. It is not passed as a positional filename to `playbook run`.
English declares `coder` and `reviewer`; Chinese declares `编码者` and `审查者`.
The template binds both languages to `demo.coder` and `demo.reviewer`.
Use distinct player IDs to keep conversations separate, or share an ID
deliberately across workflows.

To choose Codex for the reviewer, replace its player block with:

```yaml
players:
  demo.reviewer:
    adapter: codex
    model: gpt-6.1-sol
    effort: xhigh
    permissions:
      mode: auto
      writablePaths: ['.git']
```

The Codex CLI must also be authenticated. Agent settings belong in this
configuration; the former `--player` and `--captain` run flags are retired.
See Playbook's [configuration guide](https://github.com/sublang-ai/playbook/blob/main/docs/configuration.md)
for overrides and reusable role bindings.

To reuse a compiled workflow in another project, copy its entry together
with its matching `.playbook/` directory, enable the new absolute entry
path in the config, bind every `requiredRoleIds` role, and invoke the
command from that project's root. The host provisions its engine beside
external artifacts when needed. A project declaring `@sublang/playbook`
must install it locally; provisioning cannot shadow a declared dependency.
Install that lineup's SDKs beside the host's Cligent installation.

The procedure is the reusable source: edit it, compile a new version, and
inspect the generated requirements and tests before sharing the entry and
bundle. Stable player bindings belong to the consuming team's configuration.

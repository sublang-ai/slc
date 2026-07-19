<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-013: CWD output, entry emission, and the three-line demo

## Goal

Implement [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md) — CWD artifact placement, raw-entry auto-normalization, default-on passes, the default playbook link target, and entry-module emission — and rebase `demo/` on it so an end user runs three lines from `demo/`: `slc playbook workflow.zh.txt`, `playbook run ./workflow.zh.ts "<task>"`, `git log --oneline`.

## Deliverables

- [x] Artifact directories derive from the invocation working directory across full, single-phase, pass, and `.link` runs (`PIPE-7`, `PIPE-38`), with the no-nesting reuse when the working directory is already `<basename>.<pipeline>`.
- [x] Entry sources with a foreign extension compile as raw inputs through auto-scheduled normalization (`PIPE-6`, `PIPE-34`, `PIPE-39`, `COMPILE-7`).
- [x] Discovered passes run by default with `--no-optimize` as the escape (`PIPE-32`, `PIPE-35`, `PIPE-37`, `COMPILE-8`).
- [x] Bare `slc playbook <source>` links against the installed `@sublang/playbook` runtime (`SELFHOST-13`, `PIPE-13`, `SELFHOST-8`).
- [x] Full-link playbook runs emit the `<basename>.ts` entry module; `playbook run` performs it unmodified (`SELFHOST-14`, `SELFHOST-15`, `SELFHOST-16`).
- [x] `demo/` carries no hand-written registry: `workflow.zh.ts` is the committed emitter output, the scripted Git step detects the repository **root** (`[ -e .git ] || git init`, initializing a nested repository when run inside a larger checkout), and the READMEs document the three-line flow.
- [x] The reference recompile from `demo/acceptance/` (claude-code, claude-opus-4-8 at high effort, over the pinned vendored pipeline) reproduced the committed reference set byte-for-byte after formatting — including the entry module — and the optimizer independently derived the root-detecting command from the normalized 根目录 wording, retiring the hand-adjustment note of Task 6.

## Tasks

1. Rebase artifact-directory derivation on the invocation CWD and re-anchor the placement tests.
2. Accept raw entry sources and auto-schedule normalization; split the source-name refusal tests.
3. Default-schedule passes with `--no-optimize`; update scheduling and refusal tests.
4. Add the reserved playbook pipeline's default link target and its routing.
5. Implement the deterministic entry-module emitter beside the verification emitters, with emitted-entry tests.
6. Adjust the demo bundle's scripted step to root detection — `text.md`, `gears.raw.md`, `gears.md`, and `fsm.ts` edited consistently, emitted conformance green — and note the artifacts are hand-adjusted pending the next recompile.
7. Commit the emitted `demo/workflow.zh.ts`, delete `demo/registry.ts`, add `demo/slc.config.yaml` (agent + `pipelinePath: [../pipelines]`).
8. Rewrite the demo READMEs around the three-line flow and update the acceptance harness (`run.sh` entry path, `check.mjs` nested-init sub-check).

## Acceptance criteria

- `npm test` covers CWD placement, raw-entry normalization, default passes, the default link target, and entry emission (PIPE-38, PIPE-39, PIPE-35, SELFHOST-8, SELFHOST-16).
- From `demo/`, `slc playbook workflow.zh.txt` reproduces the committed bundle layout plus `workflow.zh.ts` with no flags.
- `playbook run ./workflow.zh.ts "<task>"` reaches a terminal outcome over the demo sample, and `node demo/acceptance/check.mjs` passes, including the scripted step's nested initialization inside a larger checkout.

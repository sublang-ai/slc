<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-013: CWD Output, Entry Emission, and the Three-Line Demo

## Status

Done

## Intent

Implement [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md): invocation-CWD artifact placement, raw-entry auto-normalization, default-on passes, the default Playbook link target, and deterministic entry-module emission.
Rebase the then-current demo on those defaults so an end user could compile, run, and inspect the result with three commands from `demo/`.
Eight task boundaries separated the five host surfaces from the demo artifact, configuration, documentation, and acceptance updates.
The initial root-level emitted entry and configuration were later replaced by a self-contained demo consumer with committed English and Chinese entries under `demo/reference/`, while the root-detecting scripted Git behavior remains in both reference bundles.
The surviving behavior and evidence are now owned by the [`pipeline`](../packages/pipeline.md), [`compiler`](../packages/compiler.md), and [`self-hosting`](../packages/self-hosting.md) packages, while current demo gates are owned by the [`continuous-integration`](../packages/continuous-integration.md) and [`release`](../packages/release.md) packages.

## Deliverables

- [x] Artifact directories derived from the invocation working directory across full, single-phase, pass, and direct-link runs, with no nested artifact directory when the working directory was already `<basename>.<pipeline>` [[pipeline-7](../packages/pipeline.md#pipeline-7)], [[pipeline-18](../packages/pipeline.md#pipeline-18)].
- [x] Entry sources with a foreign extension compiled as raw inputs through auto-scheduled normalization [[pipeline-6](../packages/pipeline.md#pipeline-6)], [[pipeline-34](../packages/pipeline.md#pipeline-34)], [[compiler-7](../packages/compiler.md#compiler-7)].
- [x] Discovered passes ran by default with `--no-optimize` as the escape [[pipeline-32](../packages/pipeline.md#pipeline-32)], [[pipeline-37](../packages/pipeline.md#pipeline-37)], [[compiler-8](../packages/compiler.md#compiler-8)].
- [x] A bare `slc playbook <source>` invocation linked against the installed `@sublang/playbook` runtime [[self-hosting-13](../packages/self-hosting.md#self-hosting-13)], [[pipeline-13](../packages/pipeline.md#pipeline-13)].
- [x] Full-link Playbook runs emitted a `<basename>.ts` entry module that `playbook run` performed without hand-written wiring [[self-hosting-14](../packages/self-hosting.md#self-hosting-14)], [[self-hosting-15](../packages/self-hosting.md#self-hosting-15)].
- [x] In the completion-time demo layout, `workflow.zh.ts` was committed emitter output, no hand-written registry remained, `demo/slc.config.yaml` selected the vendored pipeline, the scripted Git step detected the repository root with `[ -e .git ] || git init`, and the READMEs documented the three-line flow.
- [x] A reference recompile from the then-current demo reference directory using Claude Code with Claude Opus 4.8 at high effort reproduced the committed reference set byte-for-byte after formatting, including the entry module, and independently derived the root-detecting command from the normalized Chinese wording.

## Tasks

1. Rebase artifact-directory derivation on the invocation CWD and re-anchor the placement tests.
2. Accept raw entry sources and auto-schedule normalization; split the source-name refusal tests.
3. Default-schedule passes with `--no-optimize`; update scheduling and refusal tests.
4. Add the reserved Playbook pipeline's default link target and its routing.
5. Implement the deterministic entry-module emitter beside the verification emitters, with emitted-entry tests.
6. Adjust the then-current demo bundle's scripted step to root detection, edit its `text.md`, `gears.raw.md`, `gears.md`, and `fsm.ts` consistently, keep emitted conformance green, and record that the artifacts were hand-adjusted pending a later recompile.
7. Commit the emitted root `demo/workflow.zh.ts`, delete `demo/registry.ts`, and add the then-current `demo/slc.config.yaml` agent and pipeline-path configuration.
8. Rewrite the demo READMEs around the three-line flow and update the acceptance harness's entry path and nested-initialization check.

## Verification

- The seven checked deliverables and eight task boundaries establish completion of the invocation-contract and demo rebase.
- Invocation-CWD placement is exercised for full runs by [[pipeline-38](../packages/pipeline.md#pipeline-38)] and for direct links by [[pipeline-25](../packages/pipeline.md#pipeline-25)]; raw-entry normalization and default passes are exercised by [[pipeline-39](../packages/pipeline.md#pipeline-39)] and [[pipeline-35](../packages/pipeline.md#pipeline-35)], with their user-level flow covered by [[compiler-10](../packages/compiler.md#compiler-10)].
- Default Playbook linking is exercised by [[self-hosting-8](../packages/self-hosting.md#self-hosting-8)], and emitted runnable entries and role binding are exercised by [[self-hosting-16](../packages/self-hosting.md#self-hosting-16)].
- Commits `3fcb39f` and `105c3fc` record implementation of the host and demo tasks, while commit `75ad870` records the later byte-identical reference recompile that retired the temporary hand-adjustment note.
- The current relocated English demo reference is required by [[continuous-integration-5](../packages/continuous-integration.md#continuous-integration-5)] and exercised through the installed-package flow by [[release-18](../packages/release.md#release-18)].

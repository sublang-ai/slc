<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-012: Normalization, Pass Phases, and the Workflow Demo

## Status

Done

## Intent

Implement generic normalization and format-preserving pass scheduling under [DR-013](../decisions/013-normalize-and-pass-phases.md), extend conformance and coverage to script actors, and prove the flow through a demo compiled and run with real agents.
Four task boundaries separated pass loading and scheduling, the pipeline-agnostic normalization step, script verification, and the end-to-end demo.
At completion, the demo used an explicit `--normalize -O --link` invocation over a Chinese Markdown source; [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md) later made raw-input normalization, optimization passes, and Playbook linking default behavior, and the current demo uses plain-text inputs.
The surviving behavior and evidence are now owned by the [`pipeline`](../packages/pipeline.md), [`phase-execution`](../packages/phase-execution.md), and [`verification`](../packages/verification.md) packages, while current demo gates are owned by the [`continuous-integration`](../packages/continuous-integration.md) and [`release`](../packages/release.md) packages.

## Deliverables

- [x] Pass-phase loading and chain exclusion [[pipeline-30](../packages/pipeline.md#pipeline-30)], [[pipeline-31](../packages/pipeline.md#pipeline-31)], scheduling with raw and canonical naming [[pipeline-32](../packages/pipeline.md#pipeline-32)], standalone pass runs [[pipeline-33](../packages/pipeline.md#pipeline-33)], and flag validation [[pipeline-37](../packages/pipeline.md#pipeline-37)] were delivered.
- [x] The built-in pipeline-agnostic `normalize.md` definition and normalization scheduling [[pipeline-34](../packages/pipeline.md#pipeline-34)] were delivered with protected read-only references [[phase-execution-33](../packages/phase-execution.md#phase-execution-33)].
- [x] Script-item parsing and script-state conformance [[verification-15](../packages/verification.md#verification-15)] plus script coverage driving [[verification-16](../packages/verification.md#verification-16)] were delivered.
- [x] At completion, `demo/` contained the raw workflow source, seeded buggy fixture repository, registry wrapper, setup and checking scripts, and end-user compile, run, and verification guidance.
- [x] The then-current demo acceptance checker observed the compiled playbook's behavior, including agent-free scripted Git setup.
- [x] The two-agent acceptance run with Claude Code Sonnet 5 as Coder and GPT-5.6 Terra as Reviewer reached `{ outcome: 'terminal' }` with exit 0, one reviewed commit, a clean verdict, and the median fixed, and its checker passed 27 of 27 assertions.

## Tasks

1. Load format-preserving phases as passes and schedule them under `-O`.
2. Ship and wire the generic normalization step.
3. Extend GEARS/FSM verification to the script actor kind.
4. Build the demo fixture, scripts, and README; run the real-agent acceptance.

## Verification

- The six checked deliverables and four task boundaries establish completion of the normalization, pass, script-verification, and demo work.
- Pass loading, exclusion, scheduling, standalone execution, and flag refusal are exercised by [[pipeline-35](../packages/pipeline.md#pipeline-35)], normalization is exercised by [[pipeline-36](../packages/pipeline.md#pipeline-36)], and protected normalization references are exercised by [[phase-execution-48](../packages/phase-execution.md#phase-execution-48)].
- Script conformance and coverage are exercised by [[verification-17](../packages/verification.md#verification-17)].
- Commit `9579b6f` records the completion-time real-agent result and 27-of-27 checker evidence; current English-reference and installed-package demo surfaces are gated by [[continuous-integration-5](../packages/continuous-integration.md#continuous-integration-5)] and [[release-18](../packages/release.md#release-18)] rather than by the retired harness.
- [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md) records the later default invocation contract, so the original explicit-flag command is historical completion evidence rather than current usage guidance.

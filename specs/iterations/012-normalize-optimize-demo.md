<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-012: Normalization, pass phases, and the workflow demo

## Goal

Implement [DR-013](../decisions/013-normalize-and-pass-phases.md) — the generic `--normalize` step and `-O` pass scheduling — extend verification to script actors, and land an end-to-end `demo/` that compiles a raw Chinese two-agent code-review workflow and runs it with real agents as the acceptance test.

## Deliverables

- [x] Pass-phase loading and chain exclusion (`pipeline-30`, `pipeline-31`), `-O` scheduling with `.raw`/canonical naming (`pipeline-32`), standalone pass runs (`pipeline-33`), and flag validation (`pipeline-37`).
- [x] The built-in pipeline-agnostic `normalize.md` definition, `--normalize` scheduling (`pipeline-34`), and protected read-only references (`phase-execution-33`).
- [x] Script-item parsing, script-state conformance, and script coverage driving (`verification-15`, `verification-16`, `verification-17`).
- [x] `demo/`: the raw workflow source, a seeded buggy fixture repo, a registry wrapper, setup and check scripts, and a README walking an end user through compile → run → verify.
- [x] The demo acceptance checker observes the compiled playbook's behavior, including the agent-free scripted Git setup.
- [x] The two-agent acceptance run (Claude Code Sonnet 5 coder, GPT-5.6 Terra reviewer) reached `{ outcome: 'terminal' }` with exit 0 — agent-free scripted Git init, one reviewed commit, clean verdict, median fixed — and the full checker passes 27/27.

## Tasks

1. Load format-preserving phases as passes and schedule them under `-O`.
2. Ship and wire the generic normalization step.
3. Extend GEARS/FSM verification to the script actor kind.
4. Build the demo fixture, scripts, and README; run the real-agent acceptance.

## Acceptance criteria

- `npm test` covers pass scheduling, normalization scheduling, and script conformance/coverage (pipeline-35, pipeline-36, verification-17).
- `slc playbook demo/workflow.zh.md --normalize -O --link <runtime>` produces a playbook whose Git setup is a `script` state, verified by the emitted tests.
- `playbook run` executes the compiled workflow over the demo repository with a Claude Code coder and a Codex reviewer to a terminal outcome, and the demo checker validates the run evidence.

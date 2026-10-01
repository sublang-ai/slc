<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-065: Cligent 0.29 Adoption

## Status

Completed (2026-10-01): SLC declares Playbook ^17.2.0 and Cligent ^0.29.0 with regenerated pins, builds against Cligent 0.29\'s adapter typing, passes the release checks and the opt-in local acceptance gate on the candidate, and ships as 0.14.0.

## Intent

Depend on Cligent `^0.29.0` and Playbook `^17.2.0` through the routine adoption of [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), so that a host requiring both resolves one Cligent with the compiler instead of a nested second copy.

## Deliverables

- [x] `@sublang/cligent` raised to `^0.29.0` and `@sublang/playbook` to `^17.2.0`, with a lock holding one copy of each.
- [x] The adapter factory's annotation admitting Cligent 0.29's subagent-model type argument, with no runtime change.
- [x] Vendored definitions confirmed byte-identical to 17.2.0; retained bundles, demo references, and regenerated pins verified.
- [x] The demo's consumer project declaring Playbook `^17.2.0` and the next SLC release.
- [x] A release declaring the new dependency set.

## Tasks

1. [x] Raise both dependencies, widen the adapter factory's annotation, regenerate pins, and record the changelog and adoption evidence.
2. [x] Prepare and publish the release.

## Verification

Playbook 17.2.0 needs no decision record under DR-028:

| Question | Evidence | Verdict |
| --- | --- | --- |
| Engine contract | The installed engine exports `RUNTIME_ABI` `1` and frozen `SUPPORTED_ARTIFACT_SCHEMAS` `[3]`. | Unchanged |
| Vendored set | Every vendored file and published sidecar matches `@sublang/playbook@17.2.0` without re-synchronization. | Unchanged |
| Retention | The pin generator's compiled-execution gate, three artifact reviews, the generated bundle suites, and both demo checkers pass against the installed engine. | All retained |

| Run (task 1) | Result |
| --- | --- |
| Install and lock | One Cligent 0.29.0 and one Playbook 17.2.0, which requires Cligent `^0.29.0`; the development SDKs stay at Claude Agent SDK 0.3.284 and Codex SDK 0.159.0, the releases Cligent 0.29 tests. |
| Build | Without the annotation change the build fails at the adapter factory, since the Claude adapter's third type argument is `string`; with it the build passes. |
| Tests | 1,535 passed, 2 skipped. |
| Release checks | `npm run release:check` passes: formatting, lint, build, tests, definitions, the release workflow, artifacts, pins, both demos, and the package. |
| Pins | Regenerated current; only the lockfile identity, the link-target identities, and their provenance, now `@sublang/playbook@17.2.0`, changed. |

| Release candidate | Verification |
| --- | --- |
| Release checks | `npm run release:check` passed on the prepared 0.14.0 tree: formatting, lint, build, 1,535 tests with 2 skips, definitions, the release workflow, artifact reviews, current pins, the demo in both languages, and the package smoke; the pull request's CI passed. |
| Local acceptance | The opt-in gate passed on the candidate with `claude-code` compiling: a cold compile of 1,330 s (normalize 1 m 00 s, text2gears 3 m 05 s, optimize 2 m 33 s, prefix 41 s, gears2fsm 10 m 24 s, link 4 m 27 s) whose entry loads, an unchanged repeat reusing every phase with no agent call, an incremental update after a manual refinement re-emitting `gears2fsm` in 3 m 30 s with downstream reuse retained, and a run with real agents that exited zero in 43 s, its two commits landed on the preserved baseline. |

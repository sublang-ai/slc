<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-066: Cligent 0.30 Adoption

## Status

Completed (2026-10-01): SLC declares Playbook ^17.3.0 and Cligent ^0.30.0 with regenerated pins, passes the release checks and the opt-in local acceptance gate on the candidate, and ships as 0.15.0.

## Intent

Depend on Cligent `^0.30.0` and Playbook `^17.3.0` through the routine adoption of [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), so that a host requiring both resolves one Cligent with the compiler instead of a nested second copy.

## Deliverables

- [x] `@sublang/cligent` raised to `^0.30.0` and `@sublang/playbook` to `^17.3.0`, with a lock holding one copy of each.
- [x] The build confirmed against Cligent 0.30's defaulted subagent-effort type parameter, with no source change.
- [x] Vendored definitions confirmed byte-identical to 17.3.0; retained bundles, demo references, and regenerated pins verified.
- [x] The demo's consumer project declaring Playbook `^17.3.0` and the next SLC release.
- [x] A release declaring the new dependency set.

## Tasks

1. [x] Raise both dependencies, regenerate pins, and record the changelog and adoption evidence.
2. [x] Prepare and publish the release.

## Verification

Playbook 17.3.0 needs no decision record under DR-028:

| Question | Evidence | Verdict |
| --- | --- | --- |
| Engine contract | The installed engine exports `RUNTIME_ABI` `1` and frozen `SUPPORTED_ARTIFACT_SCHEMAS` `[3]`. | Unchanged |
| Vendored set | Every vendored file and published sidecar matches `@sublang/playbook@17.3.0` without re-synchronization. | Unchanged |
| Retention | The pin generator's compiled-execution gate, three artifact reviews, the generated bundle suites, and both demo checkers pass against the installed engine. | All retained |

| Run (task 1) | Result |
| --- | --- |
| Install and lock | One Cligent 0.30.0 and one Playbook 17.3.0, which requires Cligent `^0.30.0`; the development SDKs stay at Claude Agent SDK 0.3.284 and Codex SDK 0.159.0, the releases Cligent 0.30 tests. |
| Build | Passes with no source change: Cligent 0.30's fourth `AgentAdapter` type parameter, the subagent effort, defaults so the adapter factory's `AgentAdapter<string, boolean, string>` stays assignable. |
| Queries | The compiler's Cligent agent sets neither `subagentModel` nor `subagentEffort`, and SLC reads its own configuration, not the Playbook launcher blocks where 17.3 resolves an unset Claude subagent model to `inherit`, so a compile's queries are unchanged. |
| Tests | 1,535 passed, 2 skipped. |
| Release checks | `npm run release:check` passes: formatting, lint, build, tests, definitions, the release workflow, artifacts, pins, both demos, and the package. |
| Pins | Regenerated current; only the lockfile identity, the link-target identities, and their provenance, now `@sublang/playbook@17.3.0`, changed. |

| Release candidate | Verification |
| --- | --- |
| Release checks | `npm run release:check` passed on the prepared 0.15.0 tree: formatting, lint, build, 1,535 tests with 2 skips, definitions, the release workflow, artifact reviews, current pins, the demo in both languages, and the package smoke; the pull request's CI passed. |
| Local acceptance | The opt-in gate passed on the candidate with `claude-code` compiling: a cold compile of 1,443 s (normalize 1 m 26 s, text2gears 2 m 42 s, optimize 2 m 36 s, prefix 39 s, gears2fsm 10 m 37 s, link 6 m 03 s) whose entry loads, an unchanged repeat reusing every phase with no agent call, an incremental update after a manual refinement re-emitting `gears2fsm` in 2 m 04 s with downstream reuse retained, and a run with real agents that exited zero in 54 s, its two commits landed on the preserved baseline. |

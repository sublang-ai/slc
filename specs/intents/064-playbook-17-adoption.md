<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-064: Playbook 17 Adoption

## Status

In progress; Playbook 17.0.0 is adopted with Cligent 0.27.0, and the final Playbook 17.1.0 / Cligent 0.28.0 set waits for those releases; no release is prepared.

## Intent

Compile and verify against Playbook 17's engine and definitions through the routine adoption of [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), keeping the tree ready so the final dependency set needs only a bump, pin regeneration, and re-verification.

## Deliverables

- [x] `@sublang/playbook` raised to the published 17.0.0 from a clean registry install.
- [x] Vendored definitions and published local inputs byte-identical to 17.0.0.
- [x] Engine contract and compiled-execution sections compared; retained bundles, demo references, and regenerated pins verified.
- [ ] Development agent SDKs at Claude Agent SDK 0.3.283 and Codex SDK 0.158.0.
- [ ] Seeded configuration and user-facing examples naming `claude-opus-5-5` and `gpt-6-sol`.
- [ ] Final set: Playbook ^17.1.0 and Cligent ^0.28.0 with regenerated pins, a re-run verification chain, and the opt-in local acceptance gate on that candidate.

## Tasks

1. [x] Raise Playbook to 17.0.0, re-synchronize the definitions, regenerate pins, and record the changelog and adoption evidence.
2. [ ] Move the development SDKs to their current releases and regenerate pins.
3. [ ] Name the latest model of each line in the seeded configuration and examples.
4. [ ] After Cligent 0.28.0 and Playbook 17.1.0 publish, raise both dependencies, re-synchronize, regenerate pins, re-run the verification chain, and finalize the changelog entry.

## Verification

Playbook 17.0.0 needs no decision record under DR-028:

| Question | Evidence | Verdict |
| --- | --- | --- |
| Engine contract | Both installed engines export `RUNTIME_ABI` `1` and frozen `SUPPORTED_ARTIFACT_SCHEMAS` `[3]`. | Unchanged |
| Compiled execution | The `## Compiled execution` sections of `text2gears.md`, `gears2fsm.md`, and `link.md` are byte-identical between 16.0.0 and 17.0.0. | Unchanged |
| Vendored set | Of eight vendored files only `gears2fsm.md` (the `recover` controller action) and `link.md` (step checkpoints, recovery offers, the judge's `{ blocked: … }` answer) differ; the published sidecar is unchanged. | Re-synchronized |
| Retention | The pin generator's compiled-execution gate, three independent artifact reviews, twelve generated bundle suites, and both demo checkers pass against the installed engine. | All retained |

| Run (task 1) | Result |
| --- | --- |
| Clean install and lock | One Cligent 0.27.0; the nested 0.26.0 copy Playbook 16 required is gone. |
| Tests | 1,535 passed, 2 skipped. |
| Definitions, artifacts, demos (en, zh) | Pass. |
| Pins | Regenerated current; only lockfile, definition, and link-target identities and provenance changed. |

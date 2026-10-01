<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-065: Cligent 0.29 Adoption

## Status

In progress; Playbook 17.2.0 and Cligent 0.29.0 are adopted and verified, and no release is prepared.

## Intent

Depend on Cligent `^0.29.0` and Playbook `^17.2.0` through the routine adoption of [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), so that a host requiring both resolves one Cligent with the compiler instead of a nested second copy.

## Deliverables

- [x] `@sublang/cligent` raised to `^0.29.0` and `@sublang/playbook` to `^17.2.0`, with a lock holding one copy of each.
- [x] The adapter factory's annotation admitting Cligent 0.29's subagent-model type argument, with no runtime change.
- [x] Vendored definitions confirmed byte-identical to 17.2.0; retained bundles, demo references, and regenerated pins verified.
- [x] The demo's consumer project declaring Playbook `^17.2.0` and the next SLC release.
- [ ] A release declaring the new dependency set.

## Tasks

1. [x] Raise both dependencies, widen the adapter factory's annotation, regenerate pins, and record the changelog and adoption evidence.
2. [ ] Prepare and publish the release.

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

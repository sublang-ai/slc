<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-018: Adopt Playbook 3.1 and Prepare 0.2.0

## Status

Done — all seven recovered task commits landed and `v0.2.0` was tagged at `1d79333`, although the legacy record left its release deliverable unchecked.

## Intent

Implement [DR-018](../decisions/018-playbook-3-1-adoption.md) by moving the dependency closure, vendored definitions, reviewed meta-phase bundles, and pins from Playbook 2.0.0 to 3.1.0 as one reviewed unit.
Make the demo a self-contained consumer, document the global-first consumption model, regenerate its Chinese reference, and prepare the 0.2.0 release.
Seven task boundaries separated consumer setup, documentation, atomic adoption, the Chinese reference, the release record, emitted-module load integrity, and player-declaration parsing.
Release acceptance exposed the final two generic compiler gaps before the 0.2.0 tag.
Playbook 4.0 later replaced the exact reviewed assets, while the 3.1 runtime-profile mapping, consumption contract, bilingual gate, load-integrity check, and player-declaration support remain owned by the [`phase-execution`](../packages/phase-execution.md), [`release`](../packages/release.md), [`verification`](../packages/verification.md), and [`self-hosting`](../packages/self-hosting.md) packages.

## Deliverables

- [x] At completion, `@sublang/playbook` was declared at `^3.1.0` and locked to 3.1.0, while `demo/package.json` used the same Playbook major with `@sublang/slc` at `^0.2.0`.
- [x] At completion, vendored `link.md` carried the 3.1 judge-prompt envelope and `spec.compat` stamping with `## Pin Inputs` retained, while the other three definitions were confirmed normatively unchanged.
- [x] All three meta-phase bundles were rebuilt through interpreted `slc slc` runs and reviewed, and their pins regenerated with exact 3.1.0 provenance and byte-reproducibility.
- [x] Exact 3.1.0 provenance mapped to `composed-v2`, while 1.3.0 and 3.0.0 remained fail-closed [[phase-execution-30](../packages/phase-execution.md#phase-execution-30)].
- [x] Four end-user interpreted Chinese-reference compiles through the packed candidate failed acceptance in distinct ways, so the accepted set came from the pinned compiled pipeline with reviewed script correction; both language checkers joined the release gate [[release-12](../packages/release.md#release-12)].
- [x] The root and demo READMEs became concise and global-first, attributed provisioning to Playbook 3.1, retained project-local authority, and restored the Chinese native reference entry [[release-11](../packages/release.md#release-11)].
- [ ] The legacy record left its 0.2.0 release deliverable unchecked: add the dated `CHANGELOG.md` section, set version 0.2.0, pass `release:check`, and follow the release preparation contract [[release-13](../packages/release.md#release-13)].
- [x] Release acceptance exposed a linked module whose relative import could not load despite a zero exit, and deterministic load-integrity checks now fail such a compile at link and entry emission [[verification-18](../packages/verification.md#verification-18)].

## Tasks

1. Make `demo/` a self-contained consumer project by adding its version-aligned private manifest and excluding its install from both repository and nested demo history.
2. Rebuild the root and demo READMEs for first-time users, documenting the global-first consumption model, project-local authority, and the mirrored Chinese demo flow.
3. Adopt Playbook 3.1.0 as one reviewed unit by updating the dependency and runtime-profile mapping, synchronizing definitions, rebuilding and reviewing all three meta-phase bundles, regenerating reproducible pins, and restating the adoption gates.
4. Land the Chinese demo reference from the accepted pinned-pipeline compile, add the bilingual task-delivery check, and run both reference sets through `verify:demo`.
5. Prepare the 0.2.0 release record by adding the dated changelog section and comparison links for the adoption, consumption model, gates, and bilingual references.
6. Fail closed when an emitted module cannot load by checking relative imports after linking and entry emission and reporting every missing target.
7. Accept both GEARS player-declaration forms by deriving entry roles from either a `Players:` line or a Markdown `Players` heading.

## Verification

- The eight historical deliverables preserve seven checked and one unchecked state, while the seven recovered task boundaries establish the adoption's actual completion.
- Commits `f3828ad`, `dcdca62`, `e700539`, `18c7fc5`, `25a71b3`, `6a7fce6`, and `1d79333` record those task boundaries in order.
- The unchecked release checkbox is stale historical evidence: commit `25a71b3` added the 0.2.0 changelog, and tag `v0.2.0` points at `1d79333` after the load-integrity and player-heading repairs, so it is not open work.
- Commit `e700539` records exact 3.1 profile selection, the atomic reviewed set, reproducible pins, and the no-mixed-set gate, while commit `18c7fc5` records both passing reference checkers; the current exact-profile test is [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)].
- Current global-first resolution and installed thin-entry behavior are specified by [[release-11](../packages/release.md#release-11)] and exercised by [[release-15](../packages/release.md#release-15)].
- Emitted-module load integrity is exercised by [[verification-19](../packages/verification.md#verification-19)], while commit `1d79333` records the player-heading correction and its implementation evidence.
- Current generic atomic-adoption and release-closure mechanisms apply to the later immutable set rather than retroactively proving the 3.1 bytes [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)], [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)], [[release-20](../packages/release.md#release-20)].

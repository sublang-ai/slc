<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-020: Playbook 4.0 Adoption

## Status

Done

## Intent

Adopt `@sublang/playbook` 4.0.0 and `@sublang/cligent` 0.18.0 atomically under [DR-020](../decisions/020-playbook-4-0-adoption.md), ending the transitive Codex freeze while retaining reviewed meta-phase bundles whose recorded inputs were byte-identical across the two releases and regenerating every pin with 4.0.0 provenance.
Four task boundaries separated the adoption record, reviewed dependency and pin set, 0.3.0 release preparation, and explicit agent-SDK installation paths.
The 0.3.0 version and changelog are historical completion facts, while the current dependency lock still resolves Playbook 4.0.0 and Cligent 0.18.0.
The topology decision remains in [DR-020](../decisions/020-playbook-4-0-adoption.md), while surviving profile, reviewed-set, pin, and gate behavior is owned by the [`phase-execution`](../packages/phase-execution.md), [`self-hosting`](../packages/self-hosting.md), [`pinning`](../packages/pinning.md), and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] The adoption decision, 4.0.0 profile mapping and verification [[phase-execution-30](../packages/phase-execution.md#phase-execution-30)], [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)], retained-bundle adoption shape [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)], [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)], continuous-integration anchor [[continuous-integration-4](../packages/continuous-integration.md#continuous-integration-4)], record, and then-current map entries were recorded.
- [x] The root manifest and registry lock adopted Playbook `^4.0.0` and Cligent `^0.18.0` with agent SDKs in `devDependencies`, the demo adopted Playbook 4 and its lineup SDKs, 4.0.0 entered the profile allowlist, and all pins regenerated with exact 4.0.0 provenance.
- [x] The 0.3.0 changelog entry and version bump were prepared.
- [x] Root and demo installation guidance and the acceptance consumer gained the agent SDKs Playbook 4 no longer supplied, and fixture coverage pinned the 4.0.0 profile mapping.

## Tasks

1. Record the adoption decision, amend the profile, reviewed-set, and continuous-integration requirements for 4.0.0, and add the decision, record, and then-current map entries.
2. Adopt the reviewed set by updating root and demo dependency manifests and locks, mapping 4.0.0, moving the pin scripts' expected version, and regenerating the pin index with 4.0.0 provenance.
3. Prepare 0.3.0 with the adoption changelog entry and version bump.
4. Supply the runtimes users need in root and demo installation guidance and the acceptance consumer, and cover the 4.0.0 provenance mapping with its fixture assertion.

## Verification

- The four checked deliverables and four task boundaries preserve the completed adoption state; the legacy task checkboxes were relocated to the required Deliverables section rather than duplicated.
- Commits `f4b72ae`, `ac068c7`, `c6eba17`, and `0f37432` record the four task outcomes in order, while commit `c86525a` repairs pins after the version-lock change and commit `aec0d2e` completes every installation path.
- Tag `v0.3.0` points at `aec0d2e`, whose tree records package version 0.3.0, Playbook `^4.0.0`, Cligent `^0.18.0`, and the demo's matching release dependency.
- Exact 4.0.0 profile selection and fail-closed unmapped releases are specified by [[phase-execution-30](../packages/phase-execution.md#phase-execution-30)] and exercised by [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)].
- The current immutable definition, retained-bundle, and pin set is exercised by [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)] and [[pinning-16](../packages/pinning.md#pinning-16)] and audited as one repository set by [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)].
- Current release preparation and repository audit are owned by [[release-13](../packages/release.md#release-13)] and [[release-20](../packages/release.md#release-20)] without treating the current package version as 0.3.0.

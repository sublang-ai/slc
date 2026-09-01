<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# continuous-integration: Continuous Integration

## Intent

This package specifies the repository checks that continuously protect source quality, reviewed compiled meta-phase artifacts, reproducible pins, demos, and the publishable package.
It covers the actual clean-checkout GitHub Actions quality job for pushes and pull requests, including the exact multi-profile runtime boundary and the current immutable Playbook adoption.
Essential project-specific references are `slc`, this project's compiler; the committed Playbook meta-phase artifacts under `pipelines/playbook/`; and their pin index, `pipelines/playbook/slc.pins.json`.

## External Behavior

### Source quality

#### continuous-integration-1

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall install the package-lock dependency graph under a Node.js version satisfying the package engine and shall fail unless formatting, lint, the TypeScript build, and the full automated test suite pass.

### Reviewed artifacts

#### continuous-integration-2

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall independently review each committed Playbook meta-phase artifact by applying the artifact-schema decision [[verification-21](verification.md#verification-21)] to that artifact and its own matching current pin [[pinning-2](pinning.md#pinning-2)], then running deterministic GEARS↔FSM conformance [[verification-1](verification.md#verification-1)] over its FSM module, introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)] with the canonical linked module and each matching composer required for the actor kinds present in that FSM, and transition-coverage [[verification-6](verification.md#verification-6)] checks; regenerate the pin index through the explicit build-and-review generator [[pinning-15](pinning.md#pinning-15)]; and fail unless every generated pin is current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index.

### Runtime-contract boundary

#### continuous-integration-3

Where the repository supports the mapped historical Playbook runtime contracts and the current Playbook 10 `composed-v3` contract, when repository continuous integration runs, the workflow shall preserve their fail-closed boundary ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-027](../decisions/027-complete-playbook-10-activation.md)):

| Boundary area | Required outcome |
| --- | --- |
| Dependency isolation | Use the locked dependency graph with no mutable sibling checkout or unaudited artifact-refresh step [[continuous-integration-1](#continuous-integration-1)]. |
| Runtime fixtures | Exercise exact `legacy`, `session-v1`, and `composed-v2` behavior plus current shared-factory and bespoke `composed-v3` equivalence [[verification-10](verification.md#verification-10)] and the current roleless `composed-v3` phase-host boundary [[phase-execution-49](phase-execution.md#phase-execution-49)]. |
| Provenance selection | Exercise absent-provenance `legacy` selection, exact mapped executor selection including exact Playbook 10.0.0 `composed-v3`, and fail-closed selection for every configured unmapped provenance, including exact Playbook 5.0.0 through 9.0.0, without profile inference or initialization retry [[phase-execution-30](phase-execution.md#phase-execution-30)]. |
| Delegated structured semantics | Retain the structured conformance [[verification-1](verification.md#verification-1)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] fixtures through which role-bearing schema-3 behavior is checked without pretending SLC supplies a governed phase host. |

#### continuous-integration-4

Where the dependency manifest selects `@sublang/playbook@^10.0.0` and the lock resolves exact Playbook 10.0.0 [[self-hosting-11](self-hosting.md#self-hosting-11)], when repository continuous integration runs, the workflow shall install the registry lock without a sibling checkout, fail unless the vendored `text2gears`, `gears2fsm`, `link`, and `optimize` definitions are byte-identical to that immutable release with pin-input declarations carried by the SLC-owned sidecar, independently run every generated conformance [[verification-2](verification.md#verification-2)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] file in all three reviewed meta-phase artifact bundles, regenerate every corresponding pin through the build-and-review flow [[pinning-15](pinning.md#pinning-15)] with exact 10.0.0 link-target provenance, fail unless every pin is current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index, and reject every mixed Playbook dependency, definition, artifact, or pin set ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md), [DR-027](../decisions/027-complete-playbook-10-activation.md)).

### Release surfaces

#### continuous-integration-5

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall exercise the English demo reference through its runtime boundary, validate the publishable tarball in an empty consumer project [[release-10](release.md#release-10)] under the documented artifact-local dependency resolution contract [[release-11](release.md#release-11)], and verify that the release workflow publishes through trusted OIDC alone with no static registry credential [[release-8](release.md#release-8)].

## Verification

### Repository workflow acceptance

#### continuous-integration-6

Where the repository workflow, dependency lock, reviewed Playbook assets, and pin index are committed, when the deterministic repository continuous-integration audit runs, the audit shall verify the quality job and its inputs against every gate group:

| Gate group | Required outcome |
| --- | --- |
| Source quality | Require unfiltered push and pull-request triggers, a clean repository checkout, a Node.js version satisfying the package engine, locked installation, and unconditional fail-closed formatting, lint, build, and full-suite gates [[continuous-integration-1](#continuous-integration-1)]. |
| Reviewed artifacts | Require all twelve generated bundle tests in the full suite, the three independent artifact reviews with each artifact's own schema evidence, canonical linked module, actor-applicable composers, and fail-closed schema, conformance, composition, and coverage findings, pin regeneration, and a byte-identical pin-index diff [[continuous-integration-2](#continuous-integration-2)]. |
| Runtime-contract boundary | Require locked installation with no sibling checkout or unaudited artifact-refresh step, and retain historical runtime-profile behavior, current `composed-v3` behavior, absent- and exact-mapped-provenance executor selection including exact-10 `composed-v3`, unmapped-provenance rejection, and delegated structured-semantics fixtures in the full suite [[continuous-integration-3](#continuous-integration-3)]. |
| Immutable 10.0.0 set | Require the manifest, registry lock, definitions gate, generated tests, independent reviews, and every recorded Playbook provenance to form one Playbook 10.0.0 set [[continuous-integration-4](#continuous-integration-4)]. |
| Release surfaces | Require the English reference checker, installed-package smoke, and trusted-publication workflow audit [[continuous-integration-5](#continuous-integration-5)]. |

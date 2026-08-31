<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# continuous-integration: Continuous Integration

## Intent

This package specifies the repository checks that continuously protect source quality, reviewed compiled meta-phase artifacts, reproducible pins, demos, and the publishable package.
It covers the actual clean-checkout GitHub Actions quality job for pushes and pull requests, including the preserved runtime-transition boundary and the current immutable Playbook adoption.
Essential project-specific references are `slc`, this project's compiler; the committed Playbook meta-phase artifacts under `pipelines/playbook/`; and their pin index, `pipelines/playbook/slc.pins.json`.

## External Behavior

### Source quality

#### continuous-integration-1

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall install the package-lock dependency graph under a Node.js version satisfying the package engine and shall fail unless formatting, lint, the TypeScript build, and the full automated test suite pass.

### Reviewed artifacts

#### continuous-integration-2

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall independently review each committed Playbook meta-phase artifact with deterministic GEARS↔FSM conformance [[verification-1](verification.md#verification-1)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] checks, regenerate the pin index through the explicit build-and-review generator [[pinning-15](pinning.md#pinning-15)], and fail unless every generated pin is current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index.

### Runtime-transition boundary

#### continuous-integration-3

While the `session-v1` and `composed-v2` Playbook contracts are unavailable as an immutable dependency and the reviewed meta-phase assets remain bound to published 0.9.0, when repository continuous integration runs, the workflow shall preserve the deferred runtime boundary ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md)):

| Boundary area | Required outcome |
| --- | --- |
| Gate shape | Use the existing locked-install, source-quality, and full-test gates [[continuous-integration-1](#continuous-integration-1)], independently review committed artifacts through deterministic conformance [[verification-1](verification.md#verification-1)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] checks, regenerate the pin index [[pinning-15](pinning.md#pinning-15)], and fail unless every regenerated pin remains current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index, without a mutable sibling checkout or a new artifact-refresh step. |
| Full suite | Exercise explicit future-profile runtime equivalence [[verification-10](verification.md#verification-10)] plus structured conformance [[verification-1](verification.md#verification-1)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] fixtures. |
| Reviewed assets | Confine deterministic conformance [[verification-1](verification.md#verification-1)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] review plus pin regeneration [[pinning-15](pinning.md#pinning-15)] and currency checking [[pinning-2](pinning.md#pinning-2)] to the committed flat 0.9.0 assets. |

#### continuous-integration-4

Where the root manifest selects `@sublang/playbook@^10.0.0`, `@sublang/cligent@^0.23.0`, and direct `@sublang/spex@^0.3.0`, and the dependency lock resolves exact Playbook 10.0.0, Cligent 0.23.0, direct Spex 0.3.0, and every installed agent SDK at or above Cligent's optional-peer floor [[self-hosting-11](self-hosting.md#self-hosting-11)], when repository continuous integration runs, the workflow shall install the registry lock without a sibling checkout; fail unless the vendored `text2gears`, `gears2fsm`, `link`, and `optimize` definitions correspond to immutable Playbook 10.0.0 with SLC's explicit pin inputs retained and all three committed schema-3 meta-phase bundles are the complete reviewed set required by [[self-hosting-11](self-hosting.md#self-hosting-11)]; independently run every generated conformance [[verification-2](verification.md#verification-2)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] file in those bundles; regenerate every pin through the build-and-review flow [[pinning-15](pinning.md#pinning-15)] with exact 10.0.0 link-target provenance and current Playbook and XState runtime dependencies; fail unless every pin is current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index; require `src/normalize.md`, the demo manifest, reference artifacts, entry artifacts, and version-bearing demo READMEs to carry the same Playbook 10 Roles/schema-3 set [[self-hosting-11](self-hosting.md#self-hosting-11)]; and reject every mixed Playbook 4/10 dependency, definition, artifact, pin, entry, normalization, or demo set ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-018](../decisions/018-playbook-3-1-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md)).

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
| Reviewed artifacts | Require all twelve generated bundle tests in the full suite, the three independent artifact reviews, pin regeneration, and a byte-identical pin-index diff [[continuous-integration-2](#continuous-integration-2)]. |
| Deferred runtime boundary | Require locked installation with no sibling checkout or unaudited artifact-refresh step, and retain the future-profile and structured-verification fixtures in the full suite [[continuous-integration-3](#continuous-integration-3)]. |
| Immutable 10.0.0 set | Require the Playbook 10.0.0 and Cligent 0.23.0 manifest and lock, unchanged direct Spex 0.3 authority, definitions and normalization gate, reviewed schema-3 bundles, generated tests, independent reviews, pins, and complete demo artifacts and documentation to form one set with exact 10.0.0 provenance [[continuous-integration-4](#continuous-integration-4)]. |
| Release surfaces | Require the English reference checker, installed-package smoke, and trusted-publication workflow audit [[continuous-integration-5](#continuous-integration-5)]. |

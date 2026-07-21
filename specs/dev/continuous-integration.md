<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# CI: Continuous Integration

## Intent

This package specifies the repository checks that continuously protect source
quality and the reviewed compiled meta-phase artifacts.

Essential project-specific references: `slc`, this project's compiler; the
committed Playbook meta-phase artifacts under `pipelines/playbook/`; and their
pin index, `pipelines/playbook/slc.pins.json`.

## Source quality

### CI-1

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall install the package-lock dependency graph under a Node.js version satisfying the package engine and shall fail unless formatting, lint, the TypeScript build, and the full automated test suite pass.

## Reviewed artifacts

### CI-2

Where a commit is pushed or proposed by pull request, when repository continuous integration runs, the workflow shall independently review each committed Playbook meta-phase artifact with the deterministic compilation-correctness checks, regenerate the pin index through the explicit build-and-review generator, and fail unless every generated pin is current and the regenerated index is byte-identical to the committed index.

## Runtime-transition boundary

### CI-3

While the `session-v1` and `composed-v2` Playbook contracts are unavailable as an immutable dependency and the reviewed meta-phase assets remain bound to published 0.9.0, when repository continuous integration runs, the workflow shall use the existing locked-install, source-quality, full-test, independent-artifact-review, and byte-identical pin-regeneration gates without a mutable sibling checkout or a new artifact-refresh step; the full test gate shall exercise the explicit future-profile and structured-verification fixtures, while artifact review and pin regeneration shall continue to exercise only the committed flat 0.9.0 assets ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md#continuous-integration-during-deferral)).

### CI-4

Where the dependency manifest and lock adopt `@sublang/playbook@2.0.0`, when repository continuous integration runs, the workflow shall install the registry lock without a sibling checkout, fail unless the vendored `text2gears`, `gears2fsm`, `link`, and `optimize` definitions correspond to that immutable release with SLC's explicit pin inputs retained, independently run every generated verification file in all three reviewed meta-phase artifact bundles, regenerate all corresponding pins with exact 2.0.0 link-target provenance, and fail unless every pin is current and the regenerated index is byte-identical to the committed index, so no mixed dependency, definition, artifact, or pin set passes ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#atomic-reviewed-asset-adoption), [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md#atomic-reviewed-asset-adoption), [SELFHOST-11](self-hosting.md#selfhost-11)).

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-011: Adopt the Playbook 0.10 Generation

## Status

Superseded — the completed local 0.10-generation asset set was later replaced by the immutable 2.0, 3.1, and 4.0 adoptions.

## Intent

Move the release-vendored definitions, reviewed artifacts, and pins from the retired Playbook 0.9 legacy contract to the locally cut 0.10 generation as one atomic set carrying the final six-port composed contract, `playbook run`, and script actors from Playbook's upstream decision 016, so `slc playbook` output ran under the Playbook one-shot host.
Four task boundaries froze the legacy structural types and remapped provenance, synchronized definitions, rebuilt and reviewed the three meta-phase bundles, and regenerated the pins with the validation then available locally.
At completion, reference equivalence still recorded three follow-up compile-fidelity deltas: the produced runtime required `coderLlm` where the reference defaulted it, and produced Reviewer GEARS carried two placeholder lines the reference omitted.
Its dependency and pin provenance later moved to published 1.0 without recompilation, and immutable 2.0, 3.1, and 4.0 adoptions subsequently replaced the reviewed asset set; current behavior and evidence are owned by the [`phase-execution`](../packages/phase-execution.md), [`self-hosting`](../packages/self-hosting.md), [`pinning`](../packages/pinning.md), [`verification`](../packages/verification.md), and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] `src/playbook-contract.ts` froze the retired 0.9 legacy shapes as local structural types instead of importing them from the moving `@sublang/playbook/runtime` module.
- [x] [[phase-execution-30](../packages/phase-execution.md#phase-execution-30)] and `runtimeContractForPin` mapped exact `@sublang/playbook@0.10.0` provenance to the `composed-v2` profile.
- [x] `pipelines/playbook/` was resynchronized with Playbook's maintained 0.10-generation definitions, including script actors and the single-outcome default contract, while keeping the local `## Pin Inputs` sections.
- [x] `text2gears.slc/`, `gears2fsm.slc/`, and `link.slc/` were rebuilt from the synchronized definitions through interpreted `slc slc` runs and reviewed with `scripts/verify-artifacts.mjs` with no findings.
- [x] `pipelines/playbook/slc.pins.json` was regenerated over the rebuilt set and validated current against the packed sibling checkout; registry clean install remained blocked until published 1.0.0 supplied the same contract generation and refreshed the lockfile.
- [x] Reference-equivalence acceptance was updated so the locally installed packed-sibling reference detected as `composed-v2`, and fresh produced evidence was regenerated under the new definitions with interpreted Claude Opus 4.8 at xhigh effort; the gated comparison reported the three residual deltas retained in this record's Intent.

## Tasks

1. Freeze the legacy contract locally and remap pin provenance.
2. Sync the vendored definitions and remove the stale pins.
3. Rebuild the three compiled meta-phase artifacts with real agents; verify and install.
4. Regenerate pins and run the locally available gates.

## Verification

- The six checked deliverables and four task boundaries establish completion of the 0.10-generation adoption before its later supersession.
- Exact 0.10.0 profile selection remains part of [[phase-execution-30](../packages/phase-execution.md#phase-execution-30)], while this record's compiled full-pipeline result remains historical completion evidence rather than a claim of current package-local 0.10 coverage.
- Current reviewed-bundle and pin adoption is exercised by [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)] and [[pinning-16](../packages/pinning.md#pinning-16)] over the later immutable 4.0.0 set.
- Reference comparison remains exercised by [[verification-9](../packages/verification.md#verification-9)], and the three completion-time deltas remain historical compile-fidelity evidence rather than current package requirements.
- Commit `6ba8f4d` later established that 0.10.0 never reached the registry and published 1.0.0 supplied the same contract generation, so the checked local adoption state is not clean-install evidence.

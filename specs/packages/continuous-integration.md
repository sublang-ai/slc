<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# continuous-integration: Continuous Integration

## Intent

This package specifies the repository checks that continuously protect source quality, reviewed compiled meta-phase artifacts, reproducible pins, demos, and the publishable package.
It covers the actual clean-checkout GitHub Actions quality job for pushes to `main` and pull requests, including the exact multi-profile runtime boundary and the locked Playbook adoption whose schema-3 contract the installed engine declares ([DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)).
It also covers how a pull request merges into `main` on green, the pre-push check, and the determinism every suite keeps ([DR-060](../decisions/060-merge-on-green.md)).
Essential project-specific references are `slc`, this project's compiler; the committed Playbook meta-phase artifacts under `pipelines/playbook/`; and their pin index, `pipelines/playbook/slc.pins.json`.

## External Behavior

### Source quality

#### continuous-integration-1

Where a commit is pushed to `main` or proposed by pull request ([DR-060](../decisions/060-merge-on-green.md)), when repository continuous integration runs, the workflow shall install the package-lock dependency graph under a Node.js version satisfying the package engine and shall fail unless formatting, lint, the TypeScript build, and the full automated test suite pass.

### Reviewed artifacts

#### continuous-integration-2

Where a commit is pushed to `main` or proposed by pull request, when repository continuous integration runs, the workflow shall independently review each committed Playbook meta-phase artifact by applying the artifact-schema decision [[verification-21](verification.md#verification-21)] to that artifact and its own matching current pin [[pinning-2](pinning.md#pinning-2)], then running deterministic GEARS↔FSM conformance [[verification-1](verification.md#verification-1)] over its FSM module, compiled-execution fidelity [[verification-23](verification.md#verification-23)] between the pin's recorded definition — else the pipeline's sibling `<basename>.md` — and its GEARS, introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)] with the canonical linked module and each matching composer required for the actor kinds present in that FSM, and transition-coverage [[verification-6](verification.md#verification-6)] checks; regenerate the pin index through the explicit build-and-review generator [[pinning-15](pinning.md#pinning-15)], which refuses a bundle drifting from its definition's compiled-execution section [[pinning-23](pinning.md#pinning-23)]; and fail unless every generated pin is current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index.

### Runtime-contract boundary

#### continuous-integration-3

Where the repository supports the mapped historical Playbook runtime contracts and the declared schema-3 `composed-v3` contract, when repository continuous integration runs, the workflow shall preserve their fail-closed boundary ([DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-027](../decisions/027-complete-playbook-10-activation.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)):

| Boundary area | Required outcome |
| --- | --- |
| Dependency isolation | Use the locked dependency graph with no mutable sibling checkout or unaudited artifact-refresh step [[continuous-integration-1](#continuous-integration-1)]. |
| Runtime fixtures | Exercise exact `legacy`, `session-v1`, and `composed-v2` behavior plus current shared-factory and bespoke `composed-v3` equivalence [[verification-10](verification.md#verification-10)] and the current roleless `composed-v3` phase-host boundary [[phase-execution-49](phase-execution.md#phase-execution-49)]. |
| Contract selection | Exercise absent-provenance `legacy` selection, exact historical `composed-v2` selection, declaration-based `composed-v3` selection for exact Playbook 10.0.0 and for later or unreviewed releases alike, and fail-closed selection naming the declaration for a link target outside an installed engine — including exact Playbook 5.0.0 through 9.0.0 — or an engine declaring another ABI or no schema `3`, without profile inference or initialization retry [[phase-execution-30](phase-execution.md#phase-execution-30)]. |
| Delegated structured semantics | Retain the structured conformance [[verification-1](verification.md#verification-1)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] fixtures through which role-bearing schema-3 behavior is checked without pretending SLC supplies a governed phase host. |

#### continuous-integration-4

Where the dependency manifest declares `@sublang/playbook` as the caret range of the exact release the lock resolves [[self-hosting-11](self-hosting.md#self-hosting-11)], when repository continuous integration runs, the workflow shall install the registry lock without a sibling checkout, fail unless the vendored `text2gears`, `gears2fsm`, `link`, `optimize`, and `prefix` definitions and their published sidecar-declared local inputs are byte-identical to that immutable release with every such input in the corresponding semantic closure and pin-input declarations carried by the SLC-owned sidecar, independently run every generated conformance [[verification-2](verification.md#verification-2)], introspection [[verification-4](verification.md#verification-4)], prompt-contract [[verification-5](verification.md#verification-5)], and transition-coverage [[verification-6](verification.md#verification-6)] file in all three reviewed meta-phase artifact bundles, regenerate every corresponding pin through the build-and-review flow [[pinning-15](pinning.md#pinning-15)] with that release's exact link-target provenance, fail unless every pin is current [[pinning-2](pinning.md#pinning-2)] and the regenerated index is byte-identical to the committed index, and reject every mixed Playbook dependency, definition, artifact, or pin set, so a routine adoption changes the manifest, lock, definitions, retained or rebuilt bundles, and pins but no gate ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), [DR-024](../decisions/024-playbook-10-schema-3-adoption.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md), [DR-027](../decisions/027-complete-playbook-10-activation.md), [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md)).

### Release surfaces

#### continuous-integration-5

Where a commit is pushed to `main` or proposed by pull request, when repository continuous integration runs, the workflow shall exercise the English demo reference check, validate the publishable tarball in an empty consumer project [[release-10](release.md#release-10)] under the documented artifact-local dependency resolution contract [[release-11](release.md#release-11)], and verify that the release workflow publishes through trusted OIDC alone with no static registry credential [[release-8](release.md#release-8)].
When a demo reference check runs, it shall drive that language's committed reference over its own runtime boundary and shall also require the installed Playbook host's own registry validation to accept the same committed registry entry and list it under its own id, whatever script its declared canonical role ids are written in, because a manifest field only the host reads is invisible to a check that merely constructs the runtime:

- The validation is the host's deterministic catalog listing of a scratch configuration that enables the entry with every declared role bound to one placeholder player, resolved under scratch Spex-root, session-state, and superseded-configuration homes and with engine provisioning disabled, so the stage spends no model call, needs no adapter SDK, and writes nothing beside the committed artifacts or under the invoking user's home.

#### continuous-integration-7

When a demo reference check drives an English or Chinese committed reference over the actual shared runtime [[continuous-integration-5](#continuous-integration-5)], the checker shall require the Source-authored terminal classification for both completion cases, retaining the real governed repository boundaries:

| Driven case | Required assertion |
| --- | --- |
| The review reports no findings | The machine reaches its clean-review final state and publishes a terminal record whose kind is `success`, with every declared role reached and the Boss task delivered. |
| Both allowed review loops report findings and the Coder commits each agreed revision | The machine reaches its loop-limit final state and publishes a terminal record whose kind is `failure`, with exactly two reviews, the last revision unreviewed, and all three Coder commits preserved in a clean worktree. |

### Merging into main

#### continuous-integration-8

When a pull request into `main` is ready, the maintainer shall ask GitHub to merge it on green, which merges it with a merge commit once every job of the CI workflow has passed on the pull request's head, requiring no job to be re-run for a later move of `main` ([DR-060](../decisions/060-merge-on-green.md)):

- `main` is a protected branch whose required status checks are exactly the CI workflow's jobs — its one `quality` job — with the branch not required to be up to date;
- a conflicting pull request merges only once the branch merges `main` and its checks pass again on that head;
- a base branch is never deleted while a pull request still targets it.

#### continuous-integration-9

When a push reaches a pull request's branch, the CI workflow shall cancel the run of the head that push supersedes and run the new head once, cancelling no run of a push to `main` ([DR-060](../decisions/060-merge-on-green.md)).

#### continuous-integration-10

When a contributor or maintainer is about to push a branch, they shall run `npm run prepush`, which refuses a tree holding a conflict marker and then runs the spec lint and the TypeScript type check, pushing only once it passes ([DR-060](../decisions/060-merge-on-green.md)).

#### continuous-integration-11

Every test suite of the repository shall be deterministic by construction ([DR-060](../decisions/060-merge-on-green.md)):

- an order it reads from Git's listings or from a directory listing is sorted on both sides of the comparison, or read from the source whose order its subject promises;
- a step is bounded by the event the behavior names, never by wall-clock time;
- a tool's calls are asserted by where they went, never by their exact count;
- a scripted fault outlasts every call that may consume it before the call under test.

## Verification

### Repository workflow acceptance

#### continuous-integration-6

Where the repository workflow, dependency lock, reviewed Playbook assets, and pin index are committed, when the deterministic repository continuous-integration audit runs, the audit shall verify the quality job and its inputs against every gate group:

| Gate group | Required outcome |
| --- | --- |
| Source quality | Require a push trigger filtered to `main` and an unfiltered pull-request trigger, a clean repository checkout, a Node.js version satisfying the package engine, locked installation, and unconditional fail-closed formatting, lint, build, and full-suite gates [[continuous-integration-1](#continuous-integration-1)]. |
| Reviewed artifacts | Require all twelve generated bundle tests in the full suite, the three independent artifact reviews with each artifact's own schema evidence — its current pin's provenance and the link target's engine declaration —, canonical linked module, actor-applicable composers, compiled-execution fidelity against the recorded definition with a not-applicable report for a sectionless definition, and fail-closed schema, conformance, fidelity, composition, and coverage findings, pin regeneration, and a byte-identical pin-index diff [[continuous-integration-2](#continuous-integration-2)]. |
| Runtime-contract boundary | Require locked installation with no sibling checkout or unaudited artifact-refresh step, and retain historical runtime-profile behavior, current `composed-v3` behavior, absent- and exact-historical-provenance executor selection, declaration-based `composed-v3` selection, declaration-naming rejection, and delegated structured-semantics fixtures in the full suite [[continuous-integration-3](#continuous-integration-3)]. |
| Locked Playbook set | Require the manifest, registry lock, definitions gate, generated tests, independent reviews, and every recorded Playbook provenance to form one set for the exact release the lock resolves [[continuous-integration-4](#continuous-integration-4)]. |
| Release surfaces | Require the English reference checker — including the host registry-validation stage that lists the reference under its own id — installed-package smoke, and trusted-publication workflow audit [[continuous-integration-5](#continuous-integration-5)], with the actual English and Chinese clean-review and loop-limit terminal matrix [[continuous-integration-7](#continuous-integration-7)]. |

### Merge gate

#### continuous-integration-12

When the merge-gate audit reads the committed CI workflow and runs the pre-push check over a scratch repository holding a conflict marker, the audit shall assert:

- only a push to `main` and a pull request start a run, and the workflow's concurrency groups a pull request's runs by its number and cancels the run in progress for a pull request and never for a push [[continuous-integration-9](#continuous-integration-9)];
- the workflow holds exactly one job, `quality`, with no matrix, so the merge rule's required checks are that one job [[continuous-integration-8](#continuous-integration-8)];
- `npm run prepush` runs the pre-push script, which exits non-zero naming the file holding the marker [[continuous-integration-10](#continuous-integration-10)].

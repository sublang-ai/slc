<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-022: Current Spec Generation Migration

## Status

In progress — repository-owner approval of both released-ID rename maps is recorded, and Task 1 is complete.

## Intent

Migrate the legacy Spex tree to the current framework law without changing its behavior, project context, decisions, record state, or verification coverage.
The protected framework files in the scaffold refresh were produced and linted by the globally installed `@sublang/spex@3.0.0`.
The repository's locked `@sublang/spex@0.3.0` is a separately pinned compiled-grammar semantic input under [DR-016](../decisions/016-gears-grammar-provenance.md); changing it is outside this behavior-preserving migration and requires a separate adoption that rebuilds all three reviewed phase bundles and regenerates their pins.
The `v0.5.0` release contains every legacy package item ID and every released legacy framework ID in the rename maps, so the maps require one generation-wide owner approval before any numbered task changes those IDs or their inbound references.
The 12 legacy subjects remain 12 cohesive packages; no subject split is warranted, and no legacy `items/`, `interactions/`, or `compositions/` source exists.
The scaffold-created `git` and `licensing` packages and SPDX intent are destination seeds to reconcile with their legacy sources.
The `RELEASE-8` sample heading in the immutable vendored `pipelines/playbook/text2gears.md` definition is not an SLC item reference and remains byte-identical as an intentional residue.
The 190 legacy-ID occurrences in 25 committed `.slc-verify` support files are derived copies of canonical source and shall be rebuilt across all five bundles, not exempted as residue.
The untracked `spex-output.txt` is captured task input rather than canonical spec content, remains owner-controlled, and is excluded from final residue scans.

| Legacy source basename | Complete released-ID rename | Destination |
| --- | --- | --- |
| `cli` | `CLI-1`…`CLI-41` → `cli-1`…`cli-41` | `packages/cli.md` |
| `compiler` | `COMPILE-1`…`COMPILE-9` → `compiler-1`…`compiler-9` | `packages/compiler.md` |
| `continuous-integration` | `CI-1`…`CI-5` → `continuous-integration-1`…`continuous-integration-5` | `packages/continuous-integration.md` |
| `git` | `GIT-1`…`GIT-4` → `git-1`…`git-4` | reconcile `packages/git.md` |
| `incremental-compilation` | `INCR-1`…`INCR-29` → `incremental-compilation-1`…`incremental-compilation-29` | `packages/incremental-compilation.md` |
| `licensing` | `LIC-1`…`LIC-4` → `licensing-1`…`licensing-4` | reconcile `packages/licensing.md` |
| `phase-execution` | `PHEXEC-1`…`PHEXEC-47` → `phase-execution-1`…`phase-execution-47` | `packages/phase-execution.md` |
| `pinning` | `PIN-1`…`PIN-16` → `pinning-1`…`pinning-16` | `packages/pinning.md` |
| `pipeline` | `PIPE-1`…`PIPE-39` → `pipeline-1`…`pipeline-39` | `packages/pipeline.md` |
| `release` | `RELEASE-1`…`RELEASE-19` → `release-1`…`release-19` | `packages/release.md` |
| `self-hosting` | `SELFHOST-1`…`SELFHOST-16` → `self-hosting-1`…`self-hosting-16` | `packages/self-hosting.md` |
| `verification` | `VERIFY-1`…`VERIFY-19` → `verification-1`…`verification-19` | `packages/verification.md` |

| Released framework identity | Current-generation disposition |
| --- | --- |
| `META-1` | `meta-1` |
| `META-3` | `meta-30` |
| `META-4`…`META-16` | lowercase `meta-*` with each number unchanged |
| `META-17` | no direct successor |
| `META-18`…`META-19` | lowercase `meta-*` with each number unchanged |
| `META-20` | no prose-preserving successor; express its verification concern through inline same-package citations under `meta-20` |
| `META-21` | `meta-21` for its released testing concern; the unreleased authoring-language concern moves to `meta-27` |
| `META-23`…`META-25` | lowercase `meta-*` with each number unchanged |
| `META-26` | no direct successor |

The legacy intent status audit yields these migration states while retaining every checkbox verbatim:

| Legacy intent subject cohort | Truthful migrated status |
| --- | --- |
| SPDX header record | In progress |
| Interpreted execution, CLI wiring, configuration, and pin validation | Done |
| Compiled execution and self-hosting | Superseded |
| Runtime reconciliation, pipeline compilation, and runtime contract evolution | Done |
| Captain adoption | Superseded |
| Routing separation | Done |
| Playbook 0.10 adoption | Superseded |
| Normalization, CWD emission, grammar provenance, and Playbook 2 adoption | Done |
| First release | Repository work done; external trusted-publisher handoff unverified |
| Local release acceptance, Playbook 3.1, progress, Playbook 4, and incremental compilation | Done; the Playbook 3.1 and progress checkboxes remain stale evidence |

The package classification audit yields this target placement, with new verification added only where the current law exposes a coverage gap:

| Package | External Behavior item numbers | Internal Behavior item numbers | Verification item numbers |
| --- | --- | --- | --- |
| `cli` | 1–5, 22, 29, 32–34, 39 | 6–12, 20–21, 30, 35, 40 | 13–19, 23–28, 31, 36–38, 41 |
| `compiler` | 1–9 | — | new local coverage |
| `continuous-integration` | 1–5 | — | new local coverage |
| `git` | 1–5 | — | 6 |
| `incremental-compilation` | 1–8 | 9–17, 26 | 18–25, 27–29 |
| `licensing` | 1–2, 5–7 | — | 3–4, 8 |
| `phase-execution` | 1–15, 23–25, 27, 29–31, 33–34, 36, 39, 42, 46 | — | 16–22, 26, 28, 32, 35, 37–38, 40–41, 43–45, 47 plus new local coverage for behavior 33 |
| `pinning` | 1–6, 13, 15 | — | 7–12, 14, 16 |
| `pipeline` | 1–19, 30–34, 37 | — | 20–29, 35–36, 38–39 plus new local coverage for behavior 11 |
| `release` | 1–13, 17, 19 | — | 14–16, 18 plus uncovered local behavior |
| `self-hosting` | 1–3, 6, 9, 11, 13–15 | — | 4–5, 7–8, 10, 12, 16 |
| `verification` | 1–6, 10, 12–13, 15–16, 18 | — | 7–9, 11, 14, 17, 19 |

The existing behavior citations establish these peer-package edges:

| Consumer package | Peer packages |
| --- | --- |
| `cli` | `compiler`, `phase-execution`, `pipeline`, `self-hosting` |
| `continuous-integration` | `release`, `self-hosting` |
| `phase-execution` | `pipeline` |
| `pipeline` | `phase-execution`, `self-hosting` |
| `self-hosting` | `pinning`, `pipeline` |
| `verification` | `release` |

Package tasks shall confirm or reject the additional uncited dependency candidates exposed by package intent or prose: continuous integration to verification and pinning; compiler to pipeline, phase execution, and pinning; incremental compilation to pipeline and phase execution; phase execution to pinning and self-hosting; release to CLI, compiler, and incremental compilation; self-hosting to phase execution; and verification to pipeline and self-hosting.
They shall also add the minimal local integration or system verification needed for uncovered compiler and continuous-integration behavior, CLI item 33, phase-execution items 29 and 33, pipeline items 1, 3, 10–11, 19, and 37, and release items 1, 3–7, 9, 12–13, and 19.

## Deliverables

- [x] Obtain explicit repository-owner approval for both complete released-ID rename maps.
- [ ] Merge all legacy behavior and test sources into the 12 current package files with classifications and dependencies audited under the current law.
- [ ] Move all 22 legacy iteration records into `intents/`, reconciling the SPDX seed and preserving every checkbox and state.
- [ ] Make all non-framework decision records and project guidance use current citations, paths, and record rules without editing the protected framework law or framework decision.
- [ ] Record the Spex 3.0.0 tooling provenance while retaining the separately pinned 0.3.0 compiled-grammar dependency.
- [ ] Rebuild generated verifier support in all five committed bundles and regenerate the three affected compile-pin records atomically.
- [ ] Make `map.md` an accurate minimal index of decisions and packages and remove the retired layout only after all content and citations survive.
- [ ] Produce clean `spex lint` evidence and a manual residue audit for human diff review.

## Tasks

Each numbered task shall be exactly one commit and shall retarget every affected authored heading, prose name, link, path, anchor, and inbound reference tree-wide, including references outside `specs/`.
The package tasks shall leave derived verifier-support copies to the dedicated artifact-refresh task, which shall rebuild them once after every canonical package source is stable.
Each package task shall preserve all behavior, classify human or component guarantees as External Behavior and only hidden behavior as Internal Behavior, place integration or system tests in Verification, restate each item as one GEARS requirement, bind peer behavior inline, and confine verification citations to its own package.
Each record task shall preserve status and checkboxes, use the current required sections, move any still-unique behavior into a package or decision, retain only disposable record concerns, remove prohibited cross-intent names, and recover missing commit-sized tasks only from repository history.
Record tasks shall retarget the repository's actual legacy framework citations by concern: map the released-ID rule in `META-12` to `meta-12` while rewriting any obsolete higher-number allocation claim; replace every `META-20` detached `Verifies:` claim with inline citations at verifying assertions confined to the containing package under `meta-20`; map the released testing concern in `META-21` to `meta-21`; and map the duplicated unreleased authoring-language concern to `meta-27` if it survives disposal.
No unlisted legacy framework ID receives an identity mapping without a concern audit.

1. [x] Reconciled the legacy Git workflow source into `packages/git.md`, preserving the seed-only requirements and retargeting every authored item identity and reference.
2. Reconcile `dev/licensing.md`, `test/licensing.md`, and the legacy SPDX intent into the generated licensing package and SPDX intent seed, preserving the seed-only requirements and legacy completion state while retargeting every `LIC-*` identity and reference.
3. Merge the `compiler` sources into `packages/compiler.md` and retarget all `COMPILE-*` identities and citations.
4. Merge the `incremental-compilation` sources into `packages/incremental-compilation.md` and retarget all `INCR-*` identities and citations.
5. Merge the `pinning` sources into `packages/pinning.md` and retarget all `PIN-*` identities and citations.
6. Merge the `phase-execution` sources into `packages/phase-execution.md` and retarget all `PHEXEC-*` identities and citations.
7. Merge the `pipeline` sources into `packages/pipeline.md` and retarget all `PIPE-*` identities and citations, preserving its bidirectional component bindings with phase execution.
8. Merge the `self-hosting` sources into `packages/self-hosting.md` and retarget all `SELFHOST-*` identities and citations.
9. Merge the `verification` sources into `packages/verification.md` and retarget all `VERIFY-*` identities and citations.
10. Merge the `release` sources into `packages/release.md` and retarget all `RELEASE-*` identities and citations.
11. Merge `dev/continuous-integration.md` into `packages/continuous-integration.md` and retarget all `CI-*` identities and citations.
12. Merge the `cli` sources into `packages/cli.md` and retarget all `CLI-*` identities and citations after its peer packages have stable destinations.
13. Build once after the package migrations, refresh all six verifier-support files in each of the five committed `.slc-verify` bundles, independently verify the three reviewed pipeline bundles and both reference demos, commit the three regenerated compile-pin records, and confirm a second regeneration produces no diff without changing the locked Spex grammar dependency.
14. Migrate the interpreted-execution, CLI-wiring, configuration-file, and pin-validator intent records, preserving their record-only concerns and historical state while routing unique behavior to its owning package or decision and removing cross-intent references.
15. Migrate the compiled-execution, runtime-reconciliation, and pipeline-compilation intent records under the same preservation and disposal rules.
16. Migrate the runtime-contract, Captain-adoption, routing-separation, and Playbook 0.10 intent records under the same preservation and disposal rules.
17. Migrate the normalization-demo, CWD-emission, grammar-provenance, and Playbook 2 intent records under the same preservation and disposal rules.
18. Migrate the first-release, local-release-acceptance, and Playbook 3.1 intent records; recover the adoption's seven historical tasks from commits `f3828ad`, `dcdca62`, `e700539`, `18c7fc5`, `25a71b3`, `6a7fce6`, and `1d79333`; preserve stale checkbox evidence separately from truthful status.
19. Migrate the progress-watchdog, Playbook 4, and incremental-compilation intent records; recover the watchdog's seven historical tasks from commits `7af1117`, `7babcfc`, `4e893a0`, `81725e1`, `2a979ec`, `bd8459e`, and `20a0562`; preserve stale checkbox evidence separately from truthful status.
20. Migrate the pipeline-layout and link-phase decision records to current citation law without changing their accepted decisions.
21. Migrate the execution-boundary, interpreted-execution, and self-hosting decision records to current citation law without changing their accepted decisions.
22. Migrate the configuration-sources decision record to current citation law, removing its prohibited intent reference without changing the accepted decision.
23. Migrate the pinning and file-capability decision records to current citation law, preserving the capability decision's superseded status.
24. Migrate the playbook-compilation, runtime-contract, Captain-adoption, and routing-separation decision records to current citation law without changing their accepted decisions.
25. Migrate the normalization, CWD-emission, configuration-seeding, and grammar-provenance decision records to current citation law without changing their accepted decisions.
26. Migrate the Playbook 2, Playbook 3.1, progress-watchdog, and Playbook 4 decision records to current citation law without changing their accepted decisions.
27. Migrate the incremental-compilation and reviewed-agent-call decision records to current citation law without changing their accepted decisions.
28. Replace `map.md` with the minimal current decision-and-package index, update remaining project guidance to identify `@sublang/spex@3.0.0` as the spec migration and lint tool while retaining the separately reviewed 0.3.0 grammar dependency, remove empty legacy directories, resolve all migration residue, and report zero-error version-pinned `spex lint` plus manual audit evidence in the commit.

## Verification

- The owner approval covers both complete rename tables before Task 1 begins.
- Every legacy sentence, checkbox, behavior, and test concern is accounted for in the migrated diff.
- Every package's classification, peer dependency, and no-split judgment is listed in the human handoff.
- Every migrated record has a truthful status, and both recovered taskless-record histories cite their supporting commits in the handoff.
- The migration handoff identifies `@sublang/spex@3.0.0` as the framework producer and linter and records the locked 0.3.0 grammar dependency as unchanged and outside scope.
- All five verifier-support closures are rebuilt from migrated canonical sources, the three reviewed bundles and both demos pass independent verification, and a second regeneration of the three updated compile-pin records produces no diff.
- `@sublang/spex@3.0.0` lint reports no errors or warnings.
- Outside the rename tables and the identified immutable sample, manual searches find no old uppercase SLC item ID, single-bracket item citation, legacy path, relationship-metadata line, detached `Verifies` sentence, prohibited intent reference, or dangling link.
- The human handoff identifies every unresolved question and does not merge the migration commits.

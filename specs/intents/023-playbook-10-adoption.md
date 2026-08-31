<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-023: Adopt Playbook 10

## Status

In progress — the design and delivery order are recorded, while implementation and atomic activation remain pending.

## Intent

Implement [DR-024](../decisions/024-playbook-10-schema-3-adoption.md) by landing fail-closed `composed-v3` runtime and schema-3 consumer readiness before atomically adopting Playbook 10.0.0 and Cligent 0.23.0 with every reviewed asset.
Four commit boundaries separate this ledger, dormant runtime-host readiness, dormant Roles and schema-3 consumer readiness, and the indivisible adopted set with its completion evidence.
The preparatory commits leave exact Playbook 10 provenance inactive and keep the current manifest, lock, definitions, bundles, pins, and demo set unchanged.
The direct Spex 0.3 compiled-grammar input remains outside this adoption under [DR-016](../decisions/016-gears-grammar-provenance.md).
This record is only the disposable delivery and evidence ledger; the decision and package specs remain the design and behavior authorities.

## Deliverables

- [x] Reference the accepted adoption design and record this ordered delivery ledger without activating Playbook 10.
- [x] Land dormant `composed-v3` phase-host, result, capability, CLI, and integration-fixture readiness while exact 10.0.0 compiled execution remains fail-closed.
- [ ] Land dormant Roles, schema-3 FSM and entry-contract, equivalence, configured-registry, continuous-integration, and acceptance-harness fixture readiness without changing the current reviewed set.
- [ ] Adopt the root and demo manifests and registry lock, Cligent 0.23 runtime authority and applicable optional-peer floors, and exact Playbook 10 provenance selection while retaining the direct Spex 0.3 grammar closure [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)].
- [ ] Synchronize the four definitions and normalization prompt, rebuild all three meta-phase bundles through fresh real-agent runs, independently execute every generated verification, and regenerate current byte-reproducible pins.
- [ ] Activate schema-3 entry emission; synchronize every entry, demo reference, version-bearing document, and installed-host consumer; reject every mixed set; pass the complete adoption and release gates; and close this record.

The final three deliverables shall become current only together in Task 4's single commit.

## Tasks

1. [x] Record this delivery ledger and its immutable readiness-before-activation order.
2. [x] Add dormant `composed-v3` phase construction, fail-closed capability seams, structured-result handling, CLI wiring, and isolated integration fixtures without admitting exact 10.0.0 provenance.
3. [ ] Add dormant Roles and schema-3 conformance, entry-contract, runtime-equivalence, configured-registry, continuous-integration, and release-acceptance fixtures using synthetic and historical inputs without changing production emission or version-coupled repository assets.
4. [ ] Assemble the complete atomic reviewed set, run its deterministic and real-agent acceptance, convert the exact-10 dormancy fixture without removing permanent unmapped-provenance bin coverage, record the evidence below, mark this record `Done`, check every remaining deliverable and task, and create the single cutover commit.

## Verification

- Commits `3d32cbb`, `dc81099`, and `358fae1` record the accepted decision and its review corrections before this delivery ledger.
- Tasks 2 and 3 leave the Playbook 4 dependency and asset closure current and keep exact Playbook 10 compiled selection fail-closed, as permitted by [DR-024](../decisions/024-playbook-10-schema-3-adoption.md).
- Final profile construction, result mapping, and exact provenance selection pass [[phase-execution-26](../packages/phase-execution.md#phase-execution-26)] and [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)].
- Final Roles, entry, and runtime-equivalence behavior passes [[self-hosting-16](../packages/self-hosting.md#self-hosting-16)], [[verification-10](../packages/verification.md#verification-10)], and [[verification-11](../packages/verification.md#verification-11)].
- A clean registry install performs the three real-agent rebuilds, independently executes their generated verification, reproduces the pins without a diff, and rejects every mixed set under [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)], [[pinning-16](../packages/pinning.md#pinning-16)], and [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)].
- Completion requires the repository release gate and the opt-in installed-package acceptance flow, including configured-registry slash-command execution, to pass [[release-18](../packages/release.md#release-18)].
- Task 1 changes no executable input, so `spex lint` and `git diff --check` are its complete verification; builds and tests resume with Task 2.
- Task 2's isolated runtime and CLI fixtures and full local suite pass with 103 test files, 1,446 tests passed, and 4 skipped while covering exact schema-3 construction inside and outside a Git worktree, immutable shared-factory compatibility without bespoke-registry inference, exact authority-free construction and one-shot rejection of an authority-requiring factory, rejecting repository, effect-ledger, and delegated-role seams, profile-exact results, permanent unmapped-provenance failure, and exact Playbook 10 provenance remaining fail-closed; `npm run format:check`, `npm run build`, and global `@sublang/spex@3.0.0` `spex lint` pass, and ESLint passes on every Task 2 source and fixture, while repository-wide `npm run lint` is environment-blocked only by the pre-existing `.claude/worktrees/priceless-wright-adf5f9` second TypeScript-config root producing `No tsconfigRootDir was set` parsing errors.

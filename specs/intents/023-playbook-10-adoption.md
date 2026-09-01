<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-023: Prepare Playbook 10 Adoption

## Status

Done — all three readiness tasks landed, while atomic Playbook 10 and Cligent 0.23 activation is outside this intent record.

## Intent

Implement the readiness portion of [DR-024](../decisions/024-playbook-10-schema-3-adoption.md) by landing fail-closed `composed-v3` runtime and schema-3 consumer support without activating exact Playbook 10.0.0 or Cligent 0.23.0.
The three completed tasks cover this ledger, dormant runtime-host readiness, and dormant Roles and schema-3 consumer readiness.
The completed work deliberately leaves exact Playbook 10 provenance inactive, retains the `@sublang/playbook@^4.0.0` and `@sublang/cligent@^0.18.0` manifest ranges, and keeps the current lock, definitions, bundles, pins, and demo set unchanged under [DR-025](../decisions/025-defer-playbook-10-activation.md).
[DR-025](../decisions/025-defer-playbook-10-activation.md) durably defers the atomic Playbook 10.0.0 and Cligent 0.23.0 cutover without a scheduled delivery owner, while [DR-024](../decisions/024-playbook-10-schema-3-adoption.md) remains the accepted design for any future activation.
The direct Spex 0.3 compiled-grammar input remains outside this readiness scope under [DR-016](../decisions/016-gears-grammar-provenance.md).
This record is only the disposable delivery and evidence ledger; the decision and package specs remain the design and behavior authorities.

## Deliverables

- [x] Reference the accepted adoption design and record this ordered delivery ledger without activating Playbook 10.
- [x] Land dormant `composed-v3` phase-host, result, capability, CLI, and integration-fixture readiness while exact 10.0.0 compiled execution remains fail-closed.
- [x] Land dormant Roles, schema-3 FSM and entry-contract, equivalence, configured-registry, continuous-integration, and acceptance-harness fixture readiness without changing the current reviewed set.

## Tasks

1. [x] Record this delivery ledger and its readiness-only scope without activating Playbook 10.
2. [x] Add dormant `composed-v3` phase construction, fail-closed capability seams, structured-result handling, CLI wiring, and isolated integration fixtures without admitting exact 10.0.0 provenance.
3. [x] Add dormant Roles and schema-3 conformance, entry-contract, runtime-equivalence, configured-registry, continuous-integration, and release-acceptance fixtures using synthetic and historical inputs without changing production emission or version-coupled repository assets.

## Verification

- Commits `3d32cbb`, `dc81099`, and `358fae1` record the accepted decision and its review corrections.
- Commits `a9b3db1` through `77f7c40` record this ledger, all three readiness tasks, and their review corrections.
- The commits after `77f7c40` whose messages reference bare `IR-023` record the readiness-only closure and its review-driven durable-authority, package-spec, and verification-evidence reconciliation.
- The completed Tasks 2 and 3 leave the Playbook 4 dependency and asset closure current and keep exact Playbook 10 compiled selection fail-closed, as required by [DR-025](../decisions/025-defer-playbook-10-activation.md).
- Task 1 changes no executable input, so `spex lint` and `git diff --check` are its complete verification; builds and tests resume with Task 2.
- Task 2's isolated runtime and CLI fixtures and full local suite pass with 103 test files, 1,446 tests passed, and 4 skipped while covering exact schema-3 construction inside and outside a Git worktree, immutable shared-factory compatibility, exact authority-free construction and one-shot rejection of an authority-requiring factory, rejecting repository, effect-ledger, and delegated-role seams, profile-exact results, permanent unmapped-provenance failure, and exact Playbook 10 provenance remaining fail-closed; `npm run format:check`, `npm run build`, and global `@sublang/spex@3.0.0` `spex lint` pass, and ESLint passes on every Task 2 source and fixture, while repository-wide `npm run lint` is environment-blocked only by the pre-existing `.claude/worktrees/priceless-wright-adf5f9` second TypeScript-config root producing `No tsconfigRootDir was set` parsing errors.
- Task 3's synthetic schema-3 and immutable historical fixtures and full local suite pass with 104 test files, 1,596 tests passed, and 4 skipped while covering canonical Roles and mandatory concurrent-set exports; one reconciled artifact-schema decision across generated conformance and prompt tests, runtime-profile probes, and symlink-safe, current-pin-only independent review with canonical linked modules, actor-applicable composers, and fail-closed schema, conformance, composition, and coverage findings; the shared structural controller contract, contextual semantic action arms, post-result declared-target observation, compound leaf-hub return, state-scoped precise near-miss diagnostics, and bounded paths; canonical prompt identity and generation-correct continuation wiring; comparator-owned shared-factory interposition with exact call-time options, nested host capabilities, one-argument construction, unsuppressed failure, and direct runtime return; bespoke runtime equivalence; source-only entry composition; configured-registry slash-command planning; one-construction post-disposal release quiescence; unchanged schema-1 player bindings and composed-v2 result shapes; permanent unmapped-provenance failure; and exact Playbook 10 compiled selection remaining fail-closed. `npm run format:check`, `npm run build`, `npm test`, global `@sublang/spex@3.0.0` `spex lint`, the behavioral CI repository audit, all three independent artifact reviews, both demo-reference checks, and the 153-file installed-package smoke pass, and ESLint passes on every Task 3 source and fixture, while repository-wide `npm run lint` remains environment-blocked only by the same pre-existing `.claude/worktrees/priceless-wright-adf5f9` second TypeScript-config root producing `No tsconfigRootDir was set` parsing errors.

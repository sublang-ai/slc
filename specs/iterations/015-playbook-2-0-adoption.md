<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-015: Adopt the Playbook 2.0 generation

## Goal

Implement [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md): move the dependency closure, vendored definitions, reviewed meta-phase bundles, and pins from Playbook 1.0.0 to 2.0.0 (with cligent 0.16.0) as one atomic review unit, close the registry-entry role-identity gap, and produce the English demo reference so the documented flow — `slc playbook workflow.txt` then `playbook run ./workflow.ts "<task>"` with optional `--player Coder=… --player Reviewer=… --captain …` — works end to end.

## Deliverables

- [ ] `package.json` and `package-lock.json` adopt `@sublang/playbook@^2.0.0` and `@sublang/cligent@^0.16.0` from a clean registry install (no sibling checkout).
- [ ] `runtimeContractForPin` and PHEXEC-30 map exact `@sublang/playbook@2.0.0` to `composed-v2`, PHEXEC-30's stated set matches the selector (0.10.0, 1.0.0, 2.0.0), and 1.3.0 stays fail-closed with test coverage.
- [ ] The emitted entry module binds runtime-resolved player ids back to the verbatim `requiredRoleIds` at the `callPlayer` boundary, preserving optional runtime capabilities and failing closed on case-insensitive player collisions, with unit and behavioral coverage.
- [ ] `pipelines/playbook/` re-synced with Playbook 2.0.0's maintained `text2gears`, `gears2fsm`, `link`, and `optimize` definitions, keeping the local `## Pin Inputs` (including the DR-016 spex grammar identities).
- [ ] `text2gears.slc/`, `gears2fsm.slc/`, and `link.slc/` rebuilt from the synced definitions as thin linked modules via interpreted `slc slc` runs, reviewed with `scripts/verify-artifacts.mjs` (no findings).
- [ ] `scripts/generate-pins.mjs` expects 2.0.0, records `@sublang/playbook` as an out-of-bundle runtime dependency beside `xstate`, retires the packed-sibling fallback, and `pipelines/playbook/slc.pins.json` regenerates as current with exact `@sublang/playbook@2.0.0` link-target provenance.
- [ ] Host tests updated for the adopted semantics: 2.0.0 provenance selection, structured Captain-failure mapping through the `failed` outcome, and reference equivalence against the thin `code.playbook` reference.
- [ ] `demo/workflow.txt` compiled under the adopted set into `demo/reference/` and the documented command sequence verified verbatim, including the documented role flags; a bilingual reference checker replaces the retired harness.
- [ ] CI-4/SELFHOST-11-shaped gates restated for the 2.0.0 adoption so no mixed 1.0.0/2.0.0 set passes; the Chinese reference regeneration from the released packages is recorded as the maintainer follow-up.

## Tasks

1. Bump the dependency manifest and lock to playbook 2.0.0 and cligent 0.16.0 from a clean registry install.
2. Map 2.0.0 provenance in `runtimeContractForPin`, correct PHEXEC-30 and its test item, and pin 1.3.0 fail-closed in `config.test.ts`.
3. Implement the entry-module role binding with its emission and behavioral tests.
4. Sync the four vendored definitions from the installed package, retaining the explicit Pin Inputs.
5. Rebuild the three compiled meta-phase artifacts with real agents; run all generated verification.
6. Update `generate-pins.mjs` (expected version, shared-engine runtime dependency, retired packed-sibling fallback) and regenerate `slc.pins.json`.
7. Reconcile compiled-executor, ports, and equivalence tests with the resolved-`failed` Captain semantics and the thin reference artifact.
8. Compile the English demo reference, add the bilingual checker, and drive the documented README flow end to end with the documented role flags.
9. Restate the CI and self-hosting adoption gates for 2.0.0.

## Acceptance criteria

- `npm test`, `npm run lint`, and `npm run format:check` pass from a clean `npm ci`.
- `node scripts/verify-artifacts.mjs pipelines/playbook/<phase>.slc <phase>` reports no findings for each rebuilt artifact.
- `node scripts/generate-pins.mjs` reproduces the committed `slc.pins.json` byte-identically, and every pin records exact `@sublang/playbook@2.0.0` link-target provenance plus the shared-engine runtime dependency.
- From `demo/`, the reference path `playbook run ./reference/workflow.ts "<task>"` succeeds as `demo/README.md` documents, flagless and with `--player Coder=… --player Reviewer=… --captain …` bindings reaching both agents without an unknown-player failure.
- Reverting any dependency, definition, bundle, or pin component to its 1.0.0 form fails the gate set rather than passing as a mixed version.

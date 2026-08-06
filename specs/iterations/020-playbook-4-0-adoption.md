<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-020: Playbook 4.0 Adoption

## Goal

Adopt `@sublang/playbook` 4.0.0 and `@sublang/cligent` 0.18.0 atomically per
[DR-020](../decisions/020-playbook-4-0-adoption.md), ending the transitive
Codex freeze while keeping the reviewed meta-phase bundles — whose recorded
inputs are byte-identical across the two releases — and regenerating every
pin with 4.0.0 provenance as one reviewed set.

## Status

Done

## Tasks

Each task is one commit and keeps the repository gates green at its
boundary.

1. [x] **Record the adoption.** Record DR-020; amend PHEXEC-30 and
       PHEXEC-28 for the 4.0.0 provenance mapping, SELFHOST-11 and
       SELFHOST-12 for the retained-bundle adoption shape, and CI-4 for the
       4.0.0 anchor; add the DR-020 and IR-020 rows to the spec map.
2. [x] **Adopt the reviewed set.** Move the root manifest to playbook
       `^4.0.0` and cligent `^0.18.0` with the SDK `devDependencies`, the
       demo manifest to `^4.0.0` with its lineup's SDKs, both locks
       regenerated from the registry; map `@sublang/playbook@4.0.0` in the
       profile allowlist; move the pin scripts' expected version;
       regenerate `slc.pins.json` with 4.0.0 provenance.
3. [x] **Prepare 0.3.0.** Changelog entry for the adoption and the version
       bump.

## Acceptance criteria

- `npm ci` from the registry resolves playbook 4.0.0 and cligent 0.18.0,
  with no agent SDK outside `devDependencies`.
- `release:check` passes end to end: definitions verify against the
  installed 4.0.0, all three bundles pass their generated verification
  unchanged, and pin regeneration is byte-identical with exact
  `@sublang/playbook@4.0.0` link-target provenance.
- A fixture pin carrying 4.0.0 provenance selects `composed-v2`; 1.3.0 and
  3.0.0 still fail closed.
- The demo's contained install carries playbook 4.0.0 and its lineup's
  SDKs.

## Verification

`npm run release:check` on a clean `npm ci` tree (hermetic); the opt-in
`npm run test:acceptance` stays the user-run live gate before tagging.

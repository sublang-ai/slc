<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-016: Prepare the First npm Release

## Status

Repository work done; external trusted-publisher handoff unverified

## Intent

Prepare `@sublang/slc` 0.1.0 as the first npm release under the release package, with a reproducible tarball, CI-gated publication with provenance, accurate thin-artifact installation guidance, and auditable notes.
One task boundary kept the release requirements, version, changelog, documentation, package smoke, continuous integration, and tag workflow in one release unit.
At completion, the manifest, lock, and CLI named 0.1.0 and the documentation required project-local runtime installation; later releases advanced the version and evolved the consumption model to the current global-first contract with project-local authority [[release-11](../packages/release.md#release-11)].
The surviving repository contracts and evidence are owned by the [`release`](../packages/release.md) and [`continuous-integration`](../packages/continuous-integration.md) packages, while npm's external trusted-publisher configuration remains outside repository evidence.

## Deliverables

- [x] At completion, release behavior, verification, and the then-current map entry covered versioning, the changelog, the package, green continuous integration, provenance, and prerelease contracts.
- [x] At completion, `package.json`, `package-lock.json`, and the CLI reported 0.1.0, and package metadata identified the source repository.
- [x] `CHANGELOG.md` gained the first-release notes and comparison links.
- [x] At completion, README and demo commands used project-local installs so generated thin artifacts resolved their Playbook runtime closure; the current installation contract is [[release-11](../packages/release.md#release-11)].
- [x] The package smoke validated tarball contents, the installed executable and exports, and an external thin-entry import, concerns now exercised by [[release-14](../packages/release.md#release-14)] and [[release-15](../packages/release.md#release-15)].
- [x] Continuous integration gained the release-grade definition, artifact, pin, demo, and package checks, while the tag workflow required green `main` CI, token-free trusted publication with provenance and public access, and creation of the corresponding GitHub release [[release-7](../packages/release.md#release-7)], [[release-8](../packages/release.md#release-8)], [[release-12](../packages/release.md#release-12)].
- [x] A maintainer published 0.1.0 from an interactive `npm login` session on 2026-07-21, the bootstrap path required by [[release-8](../packages/release.md#release-8)].
- [ ] Confirm that npm's external trusted-publisher setting for `@sublang/slc` names repository `sublang-ai/slc` and the bare workflow filename `release.yml`, as required by [[release-8](../packages/release.md#release-8)].

## Tasks

1. Prepare and validate the complete 0.1.0 release unit: specs, version, changelog, documentation, package smoke, continuous integration, and tag workflow.

## Verification

- The seven checked deliverables, one unchecked external handoff, and one task boundary preserve the first-release record state.
- Commit `6e383f6` records the initial release unit, commits `548db02` and `f54876a` record the final token-free first-publication and bare-workflow contracts, and tag `v0.1.0` points at `f54876a`.
- Commit `e700539` records the completed interactive publication, and commit `8998b6d` records the reconciled token-free release contract.
- Clean locked-install checks, tarball identity and contents, release-commit sequencing, bootstrap publication, and the token-free workflow are now specified by [[release-8](../packages/release.md#release-8)], [[release-13](../packages/release.md#release-13)], [[release-14](../packages/release.md#release-14)], [[release-15](../packages/release.md#release-15)], and [[release-16](../packages/release.md#release-16)] and audited by [[release-20](../packages/release.md#release-20)] and [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)] without claiming that the 0.1.0 tree remains current.
- The repository verifies its credential-free OIDC workflow, but it cannot verify the corresponding publisher setting held by npm, so the external handoff remains open.

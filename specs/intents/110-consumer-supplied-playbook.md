<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-110: Consumer-Supplied Playbook

## Status

The complete local automated release gate passes.
Live installed acceptance is running with per-command Codex settings after the configured Claude agent's expired OAuth session prevented the first attempt.
Publication remains pending.

## Intent

Deliver [DR-061](../decisions/061-consumer-supplied-playbook.md) with the verified Playbook 18.1.0 adoption and SLC 0.20.0 release.

## Deliverables

- [x] Specify and declare the required consumer peer and exact development reference.
- [x] Synchronize the published definitions and local inputs, retain verified bundles, and regenerate current pins.
- [x] Verify installed consumer sharing, automatic peer installation, incompatible-peer rejection, and the automated release gate.
- [ ] Complete live compile, reuse, update, and run acceptance.
- [ ] Merge on green and publish through the trusted tag workflow.

## Tasks

1. Adopt the peer contract and Playbook 18.1.0 atomically with its package acceptance and release metadata.
2. Complete local verification, merge through the required checks, and publish SLC 0.20.0 from the successful main commit.

## Verification

Registry resolution changes Playbook 17.11.0 to 18.1.0 and the dependency classification without changing any other locked package version.
A clean registry install, build, formatting, lint, spec lint, repository CI and release audits, definition verification, all three retained-artifact reviews, both demo checks, and installed-tarball peer acceptance pass.
The full one-worker suite passes all 93 files: 1,929 tests pass and two are skipped.
Official pin generation reports all three pins current and repeats byte-identically.
The live installed gate builds, packs, installs and checks adapter availability, then fails before normalization because the configured agent's OAuth session expired and could not be refreshed; its scratch tree is retained.
The literal `npm run release:check` subsequently passes in full, including 93 test files with 1,929 passing tests and two skips, reproducible pins against the staged candidate, both demo languages, and the 181-file installed tarball with all three peer cases.
The second live attempt uses Codex `gpt-6-sol` at `xhigh` for compilation, the player, and the Captain through per-command environment settings; it has completed normalization and is continuing without changing the user's configuration.
Live acceptance and remote publication remain pending.

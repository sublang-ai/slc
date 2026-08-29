<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-017: Local Release Acceptance

## Status

Done

## Intent

Close the then-existing gap between proving that a publishable package installed and proving that its installed compiler and Playbook runtime worked.
Pair an automatic agent-free installed-package smoke with an opt-in real-agent compile-and-run gate that remains outside continuous integration and release checks because it spends model calls.
Three task boundaries separated the package-smoke runtime drive, the live acceptance entry point and its preconditions, and the release-spec and record updates.
The surviving behavior and deterministic evidence are owned by the [`release`](../packages/release.md) and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] The package smoke drives one Boss turn from an installed consumer project over fake ports, proving the publishable dependency closure runs [[release-18](../packages/release.md#release-18)].
- [x] The opt-in `test:acceptance` gate packs and installs the candidate, then compiles a minimal workflow and runs a compiled playbook through the installed executables with real agents [[release-17](../packages/release.md#release-17)].
- [x] The acceptance gate builds before packing, refuses an invocation selecting no stage, binds its lineup explicitly, requires exactly the selected agent CLIs, reports missing prerequisites actionably, and remains outside continuous integration and `release:check` [[release-17](../packages/release.md#release-17)].
- [x] The package build clears generated output first so a superseded artifact cannot reach the tarball [[release-19](../packages/release.md#release-19)].

## Tasks

1. Extend the package smoke with the agent-free runtime drive.
2. Add the opt-in acceptance script, its stage flags, and its prerequisite checks.
3. Record the acceptance behavior, iteration state, and then-current map entries.

## Verification

- The four checked deliverables and three task boundaries establish completion of the local release-acceptance work.
- Commit `c78dfea` records the three task boundaries, while commits `37ba434`, `9c076e9`, `0f37432`, and `b49d8fa` record the build-before-pack, stage, lineup, dependency-closure, Reuse, and Update hardening.
- The automatic installed-package drive and the live compile, Reuse, Update, and run flows are specified by [[release-18](../packages/release.md#release-18)], while [[release-20](../packages/release.md#release-20)] audits the clean build and the live gate's separate entry point.
- The repository workflow audit requires the package smoke and keeps the live gate outside continuous integration [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)].
- These checks establish delivery of the gate and its deterministic repository evidence; they do not claim a fresh real-agent acceptance run.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-017: Local release acceptance

## Goal

Close the gap between "the package installs" and "the package works": every
existing gate is static or agent-free, so nothing verified that a published
`slc` can compile prose or that a published playbook can run.

## Deliverables

- [x] The package smoke drives one Boss turn from the installed consumer
      project over fake ports, proving the published dependency closure runs
      (`RELEASE-18`, automatic in `release:check`).
- [x] An opt-in `test:acceptance` gate packs and installs the candidate, then
      compiles a minimal workflow and runs a compiled playbook through the
      installed executables with real agents (`RELEASE-17`).
- [x] The acceptance gate builds the candidate before packing, refuses an
      invocation selecting no stage, binds the lineup explicitly so host run
      defaults cannot change what it tests, requires exactly the agent CLIs
      that lineup invokes, reports missing prerequisites as actionable
      messages, and stays out of CI and `release:check`.
- [x] The package build clears generated output first (`RELEASE-19`), so a
      superseded artifact cannot reach the tarball.

## Tasks

1. Extend the package smoke with the agent-free runtime drive.
2. Add the opt-in acceptance script, its stage flags, and its prerequisite checks.
3. Record `RELEASE-17`, `RELEASE-18`, this record, and the map rows.

## Acceptance criteria

- `npm run release:check` passes and now fails if an installed package cannot
  drive its emitted entry to a terminal outcome.
- `npm run test:acceptance` compiles and runs through the installed
  executables against real agents; `--compile-only` and `--run-only` select only
  the compile or run portion, and a missing agent stops the gate with a named
  prerequisite.
- No repository CI workflow invokes the acceptance gate.

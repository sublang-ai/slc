<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-052: Canonical Actor Diagnostic

## Status

Complete.

## Intent

Add a narrow GEARS actor-clause diagnostic for generated nested-call near misses without changing parser actor classification or source interpretation.

## Deliverables

- [x] Public pure `checkGearsActorContract(gears)` API.
- [x] Runner GEARS contract wiring at producer and supplied-GEARS consumer boundaries.
- [x] GEARS-FSM conformance includes the actor-contract finding.
- [x] DR048, verification and phase-execution specs, and map entries.
- [x] Focused integration tests.
- [x] Root review before commit.

## Tasks

1. [x] Implement the bounded actor-clause check, specs, and focused tests without broad parser acceptance, source reinterpretation, providers, or full-suite execution.

## Verification

- `./node_modules/.bin/vitest run test/gears-actor-contract.test.ts` passed five focused tests after formatting.
- `./node_modules/.bin/prettier --check src/verify.ts src/runner.ts test/gears-actor-contract.test.ts specs/packages/verification.md specs/packages/phase-execution.md specs/decisions/048-canonical-actor-diagnostic.md specs/intents/052-canonical-actor-diagnostic.md specs/map.md` passed after formatting the new test file.
- `./node_modules/.bin/eslint src/verify.ts src/runner.ts test/gears-actor-contract.test.ts` passed.
- `spex lint` passed with no problems found.
- `git diff --check -- src/verify.ts src/runner.ts test/gears-actor-contract.test.ts specs/packages/verification.md specs/packages/phase-execution.md specs/decisions/048-canonical-actor-diagnostic.md specs/intents/052-canonical-actor-diagnostic.md specs/map.md` passed.
- The retrospective proof `/private/tmp/slc-ir052-kdavz2-retrospective-proof/proof.json` has SHA-256 `ee14d6aa130759ab77b24ac35fea53d523f99898cc07b07edf057ef278214e45`; unchanged raw and optimized Kdavz2 GEARS each yield exactly the DEV-5 actor finding and no result-contract finding.
- Build passes. The full suite passes with four workers: 1,402 tests and two skips across 75 files in 38.68 seconds; `/private/tmp/slc-ir052-full-test-four-workers.log`.
- The preceding default-concurrency run is preserved at `/private/tmp/slc-ir052-full-test.log`: 1,401 tests passed and one self-hosting history test exceeded its existing five-second deadline; no test deadline was changed.

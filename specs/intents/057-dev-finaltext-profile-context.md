<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-057: DEV FinalText Profile Context

## Status

Complete.

## Intent

Allow DEV workflow-acceptance profiles for reviewed generated artifacts to project the actual Analyst fixture text into advertised governed reply fields without weakening the existing strict field check.

## Deliverables

- [x] DEV harness passes the just-returned Analyst `finalText` to `profile.select`.
- [x] Workflow-acceptance README and spec document the DEV selection context.
- [x] Opt-in probe covers maintained guard-only selection context and advertised semantic payload fields.
- [x] Root-reviewed final harness change.

## Tasks

1. [x] Add the DEV finalText selection context, documentation, and focused opt-in probe coverage without running generated artifacts or providers.

## Verification

- `PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT="$PWD/node_modules/@sublang/playbook" node --test scripts/workflow-acceptance/probe.test.mjs` passed 7 tests, including the DEV finalText context and advertised semantic-payload probes.
- `/Users/basicthinker/Projects/SubLang/slc/node_modules/.bin/prettier --write scripts/workflow-acceptance/dev.mjs scripts/workflow-acceptance/probe.test.mjs scripts/workflow-acceptance/README.md specs/packages/workflow-acceptance.md specs/intents/057-dev-finaltext-profile-context.md specs/map.md` completed for the touched files.
- `./node_modules/.bin/eslint scripts/workflow-acceptance/dev.mjs scripts/workflow-acceptance/probe.test.mjs` passed with no warnings.
- `/opt/homebrew/bin/spex3 lint` could not run because that path is absent on this host; `/opt/homebrew/bin/spex lint` ran the global Spex binary and passed with no problems.
- No generated artifact or provider run is claimed.

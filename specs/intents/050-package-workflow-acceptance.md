<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-050: Package Workflow Acceptance

## Status

Complete.

## Intent

Package the reviewed private maintained CODE and DEV runtime acceptance harness as a reusable, opt-in repository test suite without changing production compiler code, generated artifacts, frozen inputs, or the default test command.

## Deliverables

- [x] Portable `scripts/workflow-acceptance/` harness modules copied from the reviewed private controls.
- [x] Local README documenting scope, commands, fixture selection, and generated-artifact profile seams.
- [x] Workflow-acceptance spec package and map entry.
- [x] Root-reviewed final spec and packaging scope before commit.

## Tasks

1. [x] Add the opt-in harness, documentation, and specs, then run the existing probe, maintained CODE, maintained DEV, and spec checks once.

## Verification

- `PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT="$PWD/node_modules/@sublang/playbook" node --test scripts/workflow-acceptance/probe.test.mjs` passed five probe controls with zero failures.
- `node scripts/workflow-acceptance/maintained.mjs "$PWD/node_modules/@sublang/playbook" "$CODE_OUT"` passed eighteen maintained CODE cases, wrote `$CODE_OUT/summary.json`, recorded zero provider calls, and left protected artifacts unchanged.
- `node scripts/workflow-acceptance/maintained-dev.mjs "$PWD/node_modules/@sublang/playbook" "$DEV_OUT"` passed twenty-four maintained DEV cases, wrote `$DEV_OUT/summary.json`, recorded zero provider calls, and left protected artifacts unchanged.
- `$CODE_OUT` was `/var/folders/vx/_3tyv8d10r309_jgrjwzfklc0000gn/T/slc-workflow-acceptance-code-run`; `$DEV_OUT` was `/var/folders/vx/_3tyv8d10r309_jgrjwzfklc0000gn/T/slc-workflow-acceptance-dev-run`.

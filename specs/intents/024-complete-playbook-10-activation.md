<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-024: Complete Playbook 10 Activation

## Status

Done — the specs, guard, scripts, and manifest are reconciled, and both regenerated demo reference sets pass their complete checkers.

## Intent

Finish the activation recorded by [DR-027](../decisions/027-complete-playbook-10-activation.md): reconcile the package specs, the deferral-era guard and acceptance scripts, and the demo manifest with the landed Playbook 10 delivery, then regenerate both demo reference sets until each passes its complete reference checker.
This record is only the disposable delivery ledger; the decisions and package specs remain the design and behavior authorities.

## Deliverables

- [x] The package specs, the definitions guard, and the demo manifest describe the one current Playbook 10 set with no deferred or dormant-readiness framing.
- [x] The deferral-era CI audit, installed-package smoke, and opt-in acceptance scripts exercise the current Playbook 10 contract.
- [x] The English demo reference set is regenerated through real compiles and passes its complete reference checker.
- [x] The Chinese demo reference set is regenerated through real compiles and passes its complete reference checker.

## Tasks

1. [x] Reconcile the package specs, the Playbook-definitions guard, and the demo manifest with the completed activation.
2. [x] Reconcile the deferral-era CI-audit, installed-package-smoke, and acceptance scripts with the activated contract.
3. [x] Regenerate the English demo reference set through real compiles until `node demo/reference/check.mjs en` passes.
4. [x] Regenerate the Chinese demo reference set through real compiles until `node demo/reference/check.mjs zh` passes.

## Verification

- Task 1: `spex lint`, `npm run verify:definitions`, and `npx prettier --check specs demo/README.md demo/README.zh.md` pass, and regenerating `pipelines/playbook/slc.pins.json` leaves it byte-identical to the committed index.
- Task 2: `node scripts/verify-ci-workflow.mjs` exits zero against the activated repository, `npm run test:package` passes with the quiescent schema-3 consumer lifecycle, and the acceptance script's argument preflight paths run without a live agent call.
- Tasks 3 and 4: each regenerated reference set passes its complete checker, including Boss-task delivery to the first player.

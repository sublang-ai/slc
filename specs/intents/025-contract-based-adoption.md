<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-025: Contract-Based Playbook Adoption

## Status

In progress

## Intent

Implement [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md) — profile selection by the engine's declared contract, bundle and demo retention by verified equivalence, run-time definition relay, and the published host-capabilities facade — and perform the first adoption under it, which is the last bundle rebuild.

## Deliverables

- [x] Compiled selection keys on the installed engine's declared ABI and schema, with the historical exact maps retained.
- [x] Compiled execution relays the exact definition bytes; the independent review and pin generation enforce compiled-execution fidelity.
- [x] The Playbook release carrying its compiled-execution definitions and host-capabilities facade is adopted: definitions re-synchronized, bundles rebuilt once, pins regenerated, demo references retained and re-verified, and SLC's own host-capability copies deleted.
- [x] `npm run release:check` passes on the adopted set.

## Tasks

1. [x] Record [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md) and this ledger.
2. [x] Implement contract-based selection, the definition relay, the fidelity gate, and their specs against the current Playbook 10 set.
3. [x] Adopt the Playbook release that carries the compiled-execution definitions and the host-capabilities facade, rebuilding the bundles once and replacing SLC's host-capability copies.

## Verification

- Task 2 leaves `npm run release:check` green against installed Playbook 10.0.0.
- Task 3 passes `npm run release:check`, both demo reference checkers, and the rebuilt bundles' generated and independent verification against the adopted engine.
- Task 3 evidence: Playbook 12.1.0 (`RUNTIME_ABI` 1, `SUPPORTED_ARTIFACT_SCHEMAS` `[3]`) and Cligent 0.24.0 installed from the registry; `verify:definitions` reports all four definitions byte-identical; each rebuilt bundle's GEARS is the one direct-Captain compiled-execution item, its independent review reports the fidelity check applicable and clean, and its generated suites pass; `generate-pins` records `@sublang/playbook@12.1.0` provenance and reads back current; both demo checkers pass through the published facade without recompiling.

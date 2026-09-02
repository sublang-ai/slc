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
- [ ] The Playbook release carrying its compiled-execution definitions and host-capabilities facade is adopted: definitions re-synchronized, bundles rebuilt once, pins regenerated, demo references retained and re-verified, and SLC's own host-capability copies deleted.
- [ ] `npm run release:check` passes on the adopted set.

## Tasks

1. [x] Record [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md) and this ledger.
2. [x] Implement contract-based selection, the definition relay, the fidelity gate, and their specs against the current Playbook 10 set.
3. [ ] Adopt the Playbook release that carries the compiled-execution definitions and the host-capabilities facade, rebuilding the bundles once and replacing SLC's host-capability copies.

## Verification

- Task 2 leaves `npm run release:check` green against installed Playbook 10.0.0.
- Task 3 passes `npm run release:check`, both demo reference checkers, and the rebuilt bundles' generated and independent verification against the adopted engine.

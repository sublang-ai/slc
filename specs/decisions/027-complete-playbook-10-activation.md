<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-027: Complete Playbook 10 Activation

## Status

Accepted

Supersedes the deferral in [DR-025](025-defer-playbook-10-activation.md).

## Context

[DR-024](024-playbook-10-schema-3-adoption.md) accepted the complete atomic Playbook 10 schema-3 design, and [DR-025](025-defer-playbook-10-activation.md) deferred its activation without a delivery owner, leaving [DR-020](020-playbook-4-0-adoption.md) the current authority.
The activation delivery has since landed: the manifest ranges `@sublang/playbook@^10.0.0` and `@sublang/cligent@^0.23.0` with the lock resolving exact 10.0.0 and 0.23.0, all four definitions re-synchronized byte-identically from immutable 10.0.0, all three meta-phase bundles rebuilt as shared-factory schema-3 artifacts through interpreted real-agent runs, regenerated current pins, and rebuilt demo reference sets.
[DR-026](026-slc-owned-pin-input-declarations.md) moved SLC's pin-input declarations into the `slc.pin-inputs.json` sidecar after [DR-024](024-playbook-10-schema-3-adoption.md) was written, so the synchronized definitions no longer carry `## Pin Inputs` sections and are byte-identical to the installed package.
The delivery landed without reconciling the deferral-era guard script, demo manifest, or package specs, and the rebuilt demo reference sets failed their own reference checkers on Boss-task delivery and zh role mapping.
Playbook 11.0.0 released on 2026-09-01 with host-level changes only; its four `slc/*.md` definitions and runtime engine sources are byte-identical to 10.0.0.

## Decision

The adopted set of [DR-024](024-playbook-10-schema-3-adoption.md) is current: exact Playbook 10.0.0 provenance actively selects `composed-v3`, [DR-020](020-playbook-4-0-adoption.md)'s current-version authority ends, and every "dormant readiness" qualification in the package specs becomes current behavior.
The definitions gate verifies each vendored definition byte-identical to the installed immutable 10.0.0 file, with pin-input declarations governed by the [DR-026](026-slc-owned-pin-input-declarations.md) sidecar rather than inline sections.
The demo consumer manifest requires `@sublang/playbook@^10.0.0`.
Both demo reference sets are regenerated through real compiles until each passes its complete reference checker, including Boss-task delivery to the first player.
Playbook 11.0.0 is reviewed as compile-contract-identical to 10.0.0 but is not adopted: it and every other unreviewed provenance remain fail-closed, and adopting any later Playbook requires its own decision.

## Consequences

- Package specs, the guard script, and the demo manifest describe one Playbook 10 set; no Playbook 4 authority remains.
- The demo reference sets become trustworthy evidence again once regenerated and checker-clean.
- A future Playbook adoption starts from this completed state and [DR-024](024-playbook-10-schema-3-adoption.md)'s atomic-set discipline.

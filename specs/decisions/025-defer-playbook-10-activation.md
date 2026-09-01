<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-025: Defer Playbook 10 Activation

## Status

Accepted

## Context

[DR-024](024-playbook-10-schema-3-adoption.md) accepted the complete atomic Playbook 10 schema-3 design and allowed its phase-host and verification support to land before activation.
The preparatory roleless `composed-v3` host and schema-3 conformance, equivalence, continuous-integration, and release-readiness fixtures are present, but the dependency, production emission, definition, reviewed-bundle, pin, demo, and installed-host cutover was not performed.
The repository therefore remains on `@sublang/playbook@^4.0.0` and `@sublang/cligent@^0.18.0`, with the Playbook 4 schema-1 assets current and exact Playbook 10 compiled selection fail-closed.
Because [DR-024](024-playbook-10-schema-3-adoption.md) states that it supersedes [DR-020](020-playbook-4-0-adoption.md)'s current-version authority, a durable decision must identify which authority governs this deferred state.

## Decision

Playbook 10.0.0 and Cligent 0.23.0 activation is deferred without a scheduled delivery owner.
Until a future delivery moves the complete atomic set described by [DR-024](024-playbook-10-schema-3-adoption.md), [DR-020](020-playbook-4-0-adoption.md) shall remain the current authority for exact Playbook 4.0.0 `composed-v2` selection, the Playbook 4 and Cligent 0.18 dependency ranges, retained reviewed bundles, exact-4 pins, and the version-coupled demo set.
Exact Playbook 10.0.0 compiled provenance shall remain unmapped and fail closed.
The roleless `composed-v3` phase host and schema-3 conformance, equivalence, continuous-integration, and release-readiness support shall remain dormant component behavior and shall not constitute dependency, production-entry, reviewed-asset, or consumer activation.
Until that activation, [DR-017](017-playbook-2-0-thin-runtime-adoption.md)'s schema-1 `Players` entry contract and the Playbook 4 release and continuous-integration surfaces shall remain current.
[DR-024](024-playbook-10-schema-3-adoption.md) shall remain the accepted design and atomic boundary for any future Playbook 10 activation, and its exact-10 compiled-profile selection, schema-3 production-entry, adopted-set, consumer-activation, and [DR-020](020-playbook-4-0-adoption.md) supersession requirements shall take effect only when that complete activation occurs.

## Consequences

- Package specs distinguish the shipped Playbook 4 and schema-1 behavior from dormant Playbook 10 readiness.
- Schema-3 verification and equivalence can reject or inspect readiness fixtures without mapping exact Playbook 10 compiled execution or enabling schema-3 production entries.
- A future Playbook 10 cutover requires a new delivery owner and the complete atomic reconciliation required by [DR-024](024-playbook-10-schema-3-adoption.md); no partial or mixed set becomes current meanwhile.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-094: Reached Literal Child Relays

## Status

Implemented; deterministic verification passed; parent review and integration remain pending.

## Intent

Prove context-dependent literal child templates across bounded actual entry cases without changing transition coverage budgets or weakening literal relay fidelity.

## Deliverables

- [x] Specify binding-local reached relay proof and conservative synchronous checks.
- [x] Share bounded replay between artifact conformance and transition coverage.
- [x] Verify producer/emitted parity and literal refusal controls.

## Tasks

1. Preserve controls while proving optional child relays across reached cases.

## Verification

The unchanged parent rejects the real two-mode public-entry positive while retaining six initial refusal controls.
The candidate establishes consistent observable mappings for each explicit relay and requires an empty or absent captured mapped payload for each omitted standalone line [[verification-39](../packages/verification.md#verification-39)].
Real XState and emitted-suite integration retains required-relay, nonempty deletion, stale unread payload, identity, literal, CRLF continuation and authored-final-LF refusals [[verification-40](../packages/verification.md#verification-40)].

An intermediate full run passed 1,762 tests with two existing skips and one retained Chinese-entry failure: the new emitted conformance suite incorrectly ran full coverage without the FSM source text used for routing candidates.
The retained fixture was valid; its separate coverage suite and independent artifact review passed.
The correction keeps the producer and protected consumer on one combined coverage run, while emitted conformance uses one bounded search only for pending literal bindings and retains its independently required coverage suite.
The corrected completion and verifier suites passed all 253 affected cases.

Peer review then identified that deduplication by read paths could discard a distinct unread nonempty payload before another mode supplied its mapping.
A three-entry real XState fixture reproduced that false acceptance.
Every actual pending case is now validated against captured descriptor facts; validated contexts are released and later cases are checked individually under the fixed mapping.
The final optional-child and nested-child suites pass all 27 cases, including that refusal and a nested in-place mutation refusal.
The final complete deterministic suite passes 1,765 tests across 82 files, with two existing skips.
Build, changed-code lint and scoped formatting pass.

Initial affected checks also retained missing local compiled-support preparation and emitted-timeout wiring failures; normal build preparation and timeout wiring corrected those without accepting artifact drift.
Sparse authoring lint reports exactly 15 missing protected-spec citation targets and no other errors.
The protected body remains absent, so this is not a full spec-lint pass.
No workflow artifact, provider call, team acceptance, signature or remote publication is claimed.

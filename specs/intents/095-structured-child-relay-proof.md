<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-095: Structured Child Relay Proof

## Status

Implemented and independently reviewed; deterministic verification passed; parent integration remains pending.

## Intent

Prove faithful canonical structured JSON relays from reached real contexts without changing container types, literal fidelity or bounded replay.

## Deliverables

- [x] Specify bounded descriptor-only canonical structured correspondence.
- [x] Implement reached structured proof with immutable facts and type-preserving leaf probes.
- [x] Verify real public-entry/predecessor positives and corrupted/unsafe/bounded refusal controls.

## Tasks

1. Extend the existing reached child proof to canonical structured quoted payloads.

## Verification

Retain the parent rejection of complete reached structured substitutions and preserve the original generated inputs.
Real XState integration must prove the same public-entry and Coordinator-assigned array/record values, exact canonical text, all-string-leaf evidence, descriptor drift and conservative refusal bounds [[verification-39](../packages/verification.md#verification-39)], [[verification-40](../packages/verification.md#verification-40)].
No workflow completion or source-aware domain truth is inferred from this mechanical proof.

The parent rejects two complete canonical structured positives after a real public START and Coordinator predecessor; five initial corruption controls remain refused.
The implementation proves descriptor-inspected arrays and records through the same reached replay, preserving original key order, alias identity, prototypes and data descriptors while only the hook-free encoding copy sorts keys [[verification-39](../packages/verification.md#verification-39)].
Every existing string leaf receives two distinct type-preserving probes, including a baseline-coincident hardcoded second-leaf refusal.
Empty and numeric-only reached containers validate under another case's established mapping, while an all-no-string container cannot invent one and encoded `[]` remains a nonempty relay [[verification-40](../packages/verification.md#verification-40)].

An intermediate full suite passed 1,786 tests with two existing skips before self-review exposed control-clone key sorting.
A new real record-control fixture failed that candidate; preserving original control key order and sorting only the encoding copy corrected it.
Independent source review then required Proxy refusal before reflection; counter-based integration retains zero inspector traps and descriptor/JSON-hook calls.
Repeated alias visits count against the node bound, and exact encoded size is checked before serialization.
The focused structured, optional and nested integration suites pass all 52 cases.

An independent 13-case fixture retained a raw 12-of-13 aggregate-counter failure.
Exact stack attribution located its three alias throws in conservative static registration probes, with none in reached observation or finalization; separate source-backed adjudication confirms two accepted and eleven refused contract outcomes without rewriting that raw failure.
A retained generated-input comparison has no asynchronous reached-conformance findings while its synchronous findings remain conservative; this is mechanical evidence and establishes no compiler or workflow acceptance.

The final complete deterministic suite passes 1,790 tests across 83 files, with two existing skips.
Build, changed-code lint and scoped formatting pass.
Final sparse authoring lint reports exactly 15 missing protected-spec citation targets and no other errors or warnings; the protected body remains absent, so this is not a full spec-lint pass.
Parent rejection, intermediate implementation/fixture/lint failures, key-order regression and independent aggregate-counter failure remain preserved.
No source signature, remote publication, frozen runtime mutation, provider call or workflow outcome is claimed.

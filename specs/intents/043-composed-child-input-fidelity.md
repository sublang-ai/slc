<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-043: Composed Child-input Fidelity

## Status

Complete

## Intent

Correct the literal nested-child text gate exposed by the preserved VucDX9 CODE compilation without changing that artifact or accepting its separate child-result interface mismatch.

## Deliverables

- [x] Explicit composed-input fidelity contract and bounded probe decision.
- [x] Exact template/dataflow verification with preserved dynamic and ordinary prompt checks.
- [x] Producer, consumer, generated-suite, maintained-FSM, and preserved-failure regression evidence.

## Tasks

1. [x] Synchronize the fidelity contract, implement its bounded probe, and verify real compiler boundaries plus positive and negative runtime-input cases.

## Verification

- The preserved VucDX9 CODE-3/CODE-4 regression reproduces the exact two old template findings and produces none under the correction, with unchanged source/FSM bytes; its separate child-result interface mismatch remains unresolved.
- The verifier suite passes 177 cases, including real XState literal child calls with distinctly named context fields, static object inputs, producer-to-consumer chains, and emitted conformance tests.
- Negative cases retain failures for deleted or invented text, repeated-token drift, recursive replacement, JSON-encoded string relays, lost quoting, unsupported shapes, and dynamic metadata drift.
- Verify ordinary producer/consumer gates and an emitted conformance suite; record no provider timing or full-workflow acceptance claim.

The maintained CODE probe retains its missing `concurrentRoleSets` declaration finding.
Maintained DEV also retains published Results syntax findings and four unproven child-text templates whose prior-discussion text derives from a typed array, beyond this scalar probe; this intent neither supplies a fake discussion array nor changes the artifacts.

The combined final repository suite passes 1,344 tests with two skips across 72 files; full lint and formatting checks also pass.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-037: Early Continuation Input Contract

## Status

Completed.

## Intent

Reject the existing canonical Boss-continuation input defect before protected-input linking.

## Deliverables

- [x] Shared continuation-input probe and producer/consumer integration.
- [x] Repair, schema, context-shape, and unchanged-artifact evidence.

## Tasks

1. [x] Extract the existing probe, integrate the boundaries, and verify the measured failing artifact and valid continuation cases.

## Verification

All 1288 tests pass with two skips, including 21 FSM-boundary cases and seven import-time mutation cases covering source, object, definition, link target, and declared semantic input before consumer selection; build, lint, formatting, and Spex pass.
The unchanged `bUlAXi` FSM fails the real producer gate in 591.593 ms with zero link calls, versus its original 39.734-second link failure; unchanged `aZda4G` passes and reaches the stub consumer in 688.317 ms.
The installed 12.3 runtime rejects the original nested pending-question record, while an in-memory canonical scalar projection exposes the question, routes an exact Boss reply, supplies Q+A to the resumed player, and completes one synthetic commit successfully.
Reproduction scripts and byte identities are retained under `/private/tmp/slc-boss-continuation-audit/`; the original source artifacts remain unchanged.
Independent review confirms import-time mutations are detected and rejected before consumer selection, without claiming rollback of the mutation, and reports no remaining findings.

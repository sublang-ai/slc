<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-051: Child-Call Quiescence

## Status

Complete.

## Intent

Reject generated or supplied nested calls that inherit a busy tag and therefore cannot return a suspended child through the public runtime.

## Deliverables

- [x] Structural child-call tag check at producer and consumer boundaries.
- [x] Actual XState quiescence and bounded compiler repair integration cases.
- [x] Preserved generated CODE diagnosis and isolated tag-only control evidence.

## Tasks

1. [x] Specify and implement the child-call quiescence boundary, verify actual tag inheritance and compiler stopping/repair, and record the unchanged failing artifact with its diagnostic control.

## Verification

- The generated CODE public entry reaches a child suspension but cannot return it while the child leaf is also tagged busy.
- A diagnostic copy removing only the two child busy tags completes one direct CODE path through the same public entry and actual host; it does not accept the original compilation or erase its two transition-coverage findings.
- The audit evidence at `/private/tmp/slc-anx8n4-suspension-audit/evidence.json` has SHA-256 `42c03073eaf2166d1352d4cc78ade0cda2dbbb6fb988c49548662f66a1a6c608` and records the original stalled CODE runtime, the exact two-tag control delta, the same public entry, the actual installed host, and zero production edits.
- The focused integration suite `test/fsm-child-suspension.test.ts` passes 15 tests covering real XState pending-call quiescence, literal and dynamic nested-call conformance, busy sibling acceptance, producer rejection before link, supplied-FSM consumer rejection before executor selection, and same-Coder tag-only repair before consumer execution.
- The rebuilt root `dist/verify.js` retrospective check in `/private/tmp/slc-ir051-anx8n4-retrocheck.json` reports exactly the two unchanged `anx8n4` child-call busy-tag findings, with the original FSM SHA-256 remaining `4d23b3f725b2ccdddb96669379cc199fa6e4c92e38bcba763f503182bc349ad8` before and after checking.

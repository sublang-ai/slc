<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-029: Early Conformance and Mechanical Repair

## Status

Completed.

## Intent

Reject mechanically invalid intermediate FSMs before linking and recover boundedly with one Coder.

## Deliverables

- [x] Early conformance gate with the measured baseline defect covered by integration verification.
- [x] Optional-Reviewer mechanical correction with bounded repairs and unchanged clarification and protection behavior.
- [x] Live recovery evidence and validated commits.

## Tasks

1. [x] Specify and implement the early FSM gate with integration checks.
2. [x] Generalize the existing correction loop, verify its bounds, and measure live compilation recovery.

## Verification

- The original failing minimal FSM produces `MINIMAL-2: FSM prompt is not the GEARS prompt verbatim` in 45.9 ms with the existing checker; its subsequent rejected linker phase took 158,223 ms.
- Exercise real conformance, configured execution, mechanical repair, protected inputs, malformed envelopes, cancellation, and clarification with fixture transports.
- Run a fresh live benchmark and all emitted artifact suites before retaining the repair default.
- Run Spex 3 lint, TypeScript build, and affected integration suites.

Passed the complete repository suite: 1,192 tests across 67 files, with two intentional skips.
Passed the TypeScript check, focused ESLint, and Spex 3 lint.

The accepted `compile-oNiH7r` link run uses one 32.649-second same-Coder mechanical import correction, passes its original strict TypeScript and linked-contract checks, and passes separate real-Git runtime acceptance with unchanged FSM and linked bytes (`/private/tmp/slc-quoted-fixed-link-runtime-probe/oNiH7r.json`).
This demonstrates useful bounded recovery, not an isolated repair-speed improvement or a cold full compile.
The earlier `compile-k6mg7y` FSM repair passes all four emitted suites but fails repository runtime acceptance; it remains a failed full-performance result.
The later cold `compile-sxeXw2` passes strict checking, all four suites, entry import, and real-Git runtime acceptance with the retained repair default, without requiring a correction.

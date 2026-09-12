<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-029: Early Conformance and Mechanical Repair

## Status

In progress

## Intent

Reject mechanically invalid intermediate FSMs before linking and recover boundedly with one Coder.

## Deliverables

- [x] Early conformance gate with the measured baseline defect covered by integration verification.
- [x] Optional-Reviewer mechanical correction with bounded repairs and unchanged clarification and protection behavior.
- [ ] Live recovery evidence and validated commits.

## Tasks

1. [x] Specify and implement the early FSM gate with integration checks.
2. [ ] Generalize the existing correction loop, verify its bounds, and measure live compilation recovery.

## Verification

- The original failing minimal FSM produces `MINIMAL-2: FSM prompt is not the GEARS prompt verbatim` in 45.9 ms with the existing checker; its subsequent rejected linker phase took 158,223 ms.
- Exercise real conformance, configured execution, mechanical repair, protected inputs, malformed envelopes, cancellation, and clarification with fixture transports.
- Run a fresh live benchmark and all emitted artifact suites before retaining the repair default.
- Run Spex 3 lint, TypeScript build, and affected integration suites.

Passed the complete repository suite: 1,192 tests across 67 files, with two intentional skips.
Passed the TypeScript check, focused ESLint, and Spex 3 lint.

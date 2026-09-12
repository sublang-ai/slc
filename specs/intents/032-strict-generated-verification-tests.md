<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-032: Strict Generated Verification Tests

## Status

Completed

## Intent

Keep compiler-generated verification suites valid under the same strict TypeScript checks as their artifacts, including empty pinned evidence.

## Deliverables

- [x] Readonly generated constants preserving existing runtime assertions.
- [x] Real generated-suite strict TypeScript and runtime acceptance evidence.

## Tasks

1. [x] Correct generated constant typing, synchronize the verification contract, and validate empty and populated evidence through the installed toolchain.

## Verification

- `compile-ebky3Y` fails the original strict TypeScript check and passes after only its verification suites are regenerated in a temporary copy; original artifacts and copied entry, FSM, and linked-runtime bytes remain unchanged (`/private/tmp/slc-strict-emitter-probe/evidence.json`).
- Real generated suites pass strict NodeNext TypeScript with artifact-local checker declarations; consistent empty evidence passes runtime tests, while populated schema findings still fail their assertions.
- All 140 verifier integration tests, TypeScript, formatting, ESLint, and global Spex 3 lint pass.

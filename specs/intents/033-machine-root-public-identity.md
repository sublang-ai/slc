<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-033: Machine-Root Public Identity

## Status

Completed

## Intent

Reject the measured extra machine-root public identity before expensive linking.

## Deliverables

- [x] Narrow conformance finding with unchanged ordinary state identities.
- [x] Real snapshot and early-boundary acceptance evidence.

## Tasks

1. [x] Synchronize the identity contract, implement the conformance finding, and validate snapshot normalization and early rejection.

## Verification

- Real XState snapshots expose two public identities before and one after removing the root public identity, preserving unrelated machine metadata.
- The unchanged `compile-ebky3Y` replay reports the finding in 2.8 ms and rejects through the real early boundary in 10.6 ms with zero link calls and unchanged source and FSM bytes (`/private/tmp/slc-root-identity-probe/evidence.json`).
- All 148 focused integration tests, TypeScript, formatting, ESLint, and global Spex 3 lint pass; the three retained compiler-phase bundles remain conformance-clean.

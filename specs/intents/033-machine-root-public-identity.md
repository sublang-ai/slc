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
2. [x] Match the runtime's own-namespace rule, covering empty and null root `meta.playbook` declarations without restricting other metadata namespaces.

## Verification

- Real XState snapshots expose two public identities before and one after removing the root public identity, preserving unrelated machine metadata.
- The unchanged `compile-ebky3Y` replay reports the finding in 2.8 ms and rejects through the real early boundary in 10.6 ms with zero link calls and unchanged source and FSM bytes (`/private/tmp/slc-root-identity-probe/evidence.json`).
- All 148 focused integration tests, TypeScript, formatting, ESLint, and global Spex 3 lint pass; the three retained compiler-phase bundles remain conformance-clean.
- The namespace follow-up passes 150 focused integration tests and the same static checks without a build: empty, null, and populated root namespaces fail before linking with unchanged inputs, while removing the namespace preserves ordinary metadata and the active state identity.

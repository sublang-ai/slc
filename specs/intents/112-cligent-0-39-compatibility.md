<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-112: Cligent 0.39 Compatibility

## Status

Prepared locally; no release or version change.

## Intent

Allow an application to share Cligent 0.39 with SLC while preserving the published 0.38.0 development installation.

## Deliverables

- [x] Declare `^0.38.0 || ^0.39.0` in the manifest and root lock requirement, retaining the unchanged locked Cligent 0.38.0 package.
- [x] Admit caret unions in the adoption verifier only when every branch preserves the existing 0.37.0 floor [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)].
- [x] Refresh lockfile hashes in the three compiled pins without changing definitions, bundles, or runtime provenance.
- [x] Record the compatibility change under `[Unreleased]`.

## Tasks

1. Widen the dependency contract, update the adoption gate and spec, refresh pins, and verify the published development closure.

## Verification

`npm ci --offline --ignore-scripts` installs the updated lock successfully.
`npm ls @sublang/cligent --all` shows one Cligent 0.38.0 shared with Playbook 18.1.3.
The locked Cligent package record, including tarball and integrity, is byte-for-byte equivalent as parsed JSON to the prior lock's record.
The definition-adoption integration matrix accepts a single caret and the compatibility union, and rejects a low-floor branch in either position, an unsupported comparator branch, an empty branch, and a missing dependency before definition acceptance [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)].
The focused adoption, CLI, and Cligent transport suites pass all 66 tests.
The full suite passes 1,936 tests with two skipped across 94 files.
`npm run build`, `npm run lint`, `npm run verify:definitions`, and `npm run verify:artifacts` pass.
The official pin generator reports all three pins current; the sole pin changes are the lockfile hashes, and repeated generation is byte-identical.
Both English and Chinese demo reference checks pass, including emitted suites, host validation, and independent artifact review.
`spex lint` passes.
Cligent 0.39.0 candidate integration is separate evidence: the development lock deliberately continues to exercise the published 0.38.0 release.

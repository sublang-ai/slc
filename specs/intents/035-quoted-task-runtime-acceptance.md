<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-035: Quoted Task Runtime Acceptance

## Status

Completed

## Intent

Recognize exact quoted task text in the source-level runtime benchmark.

## Deliverables

- [x] Exact literal-or-quoted task acceptance with recorded representation.
- [x] Real-runtime regression matrix and unchanged-artifact replay.

## Tasks

1. [x] Synchronize the benchmark contract, correct the task probe, and validate faithful and changed task representations through the actual runtime.

## Verification

All 32 measurement integration tests pass, including complete quoted text and changed, missing, reordered, and inconsistently quoted negative cases through the actual host and Git boundary.
Independent review reran all 12 runtime cases without findings; formatting, ESLint, and global Spex 3 lint pass.
The unchanged `aZda4G` entry passes runtime acceptance in 819 ms with exact quoted text, one delegated call, one commit, its own repository, and a successful terminal outcome.
The replay preserves every recorded artifact and the original failed summary and diagnostics, with identities in `/private/tmp/slc-quoted-task-acceptance-probe/evidence.json`.

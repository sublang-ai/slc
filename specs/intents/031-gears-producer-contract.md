<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-031: GEARS Producer Contract

## Status

In progress

## Intent

Return existing result-contract findings to the GEARS producer and avoid futile consumer repairs of protected input.

## Deliverables

- [x] Pure existing-parser contract check, producer correction, and consumer preflight.
- [x] Integration evidence preserving source obligations, Source fidelity, protection, and clarification.

## Tasks

1. [x] Specify and implement the GEARS boundary check and verify producer repairs plus immediate consumer rejection.

## Verification

- The measured `compile-fIne1M` raw GEARS defect is detected in 0.815 ms and its optimized copy in 0.476 ms, before 282,911 ms of failed FSM generation across three calls.
- Reproducible local evidence is `/private/tmp/slc-gears-producer-probe.mjs` and `/private/tmp/slc-gears-producer-evidence.json`.
- Exercise the real runner with configured bounded repair, custom-executor rechecks, pass production, roleless and reserved pipelines, malformed supplied input, and clarification stopping.
- Run TypeScript, focused tests and lint, formatting, and Spex 3 lint.

The unchanged measured GEARS now fails the actual runner's consumer preflight in 175.69 ms including pipeline setup, with zero executor selections, compiled-executor constructions, or agent calls; the standalone parser check takes 0.082 ms.
The replay script and evidence are `/private/tmp/slc-gears-consumer-preflight-probe.mjs` and `/private/tmp/slc-gears-consumer-preflight-evidence.json`.
Passed 64 tests across the new boundary, Source-fidelity, early-FSM, and clarification suites, plus TypeScript, ESLint, Prettier, Spex 3 lint, and whitespace checks.
After the benchmark runtime fixture received its actual TypeScript contracts, the complete repository suite passed 1,240 tests across 68 files, with two intentional skips.

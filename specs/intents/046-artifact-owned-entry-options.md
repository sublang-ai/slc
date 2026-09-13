<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-046: Artifact-owned Entry Options

## Status

Complete

## Intent

Make deterministic entry validation reflect the linked artifact's real option contract while preserving legacy entry behavior and exposing missing new-output contracts to existing repair.

## Deliverables

- [x] Artifact-owned validation and explicit new-entry execution requirement.
- [x] Strict typed entries and real same-Coder repair coverage.
- [x] Coordinated upstream public-validator and source-bootstrap guidance.

## Tasks

1. [x] Synchronize the option boundary, implement entry and performing-call integration, and verify typed/runtime and legacy behavior.

## Verification

Targeted entry, self-hosting, interpreted and compiled executor integration passes: 126 cases, followed by all seven option cases after the reviewed sparse-array regression.
The producer type-checks without emission; ESLint and Spex pass.
The coordinated production build and full suite remain for the owning root task.
Upstream IR082 commit `f167cbf5067b9e550729fec9474fef17be6597f2` exposes the same pure snapshot validator without an engine change.
Preserve CKr2Ni and every frozen cohort; its separate source-requiredness and authored-question issues are not repaired by this intent.

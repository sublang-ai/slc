<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-034: Definition Reference Origin

## Status

Completed

## Intent

Make definition-relative helpers and references discoverable from ordinary interpreted and compiled phase execution.

## Deliverables

- [x] Host-owned definition location context at both execution strategies.
- [x] Integration evidence for sibling reference access and isolated control calls.

## Tasks

1. [x] Specify and implement definition reference context, then verify real sibling reads through both execution boundaries.

## Verification

Six integration cases read real definition-relative helpers and references outside the workspace through interpreted compile/link, compiled player compile/link, and compiled direct-Captain compile/link execution.
They preserve source and definition bytes, configured options, working directory, and control-call isolation.
All 120 relevant tests, strict TypeScript, ESLint, formatting, and global Spex 3 lint pass.
The failed compact-link measurement requires a new completed comparison before any performance conclusion; the reference-context correction itself carries no speed claim.

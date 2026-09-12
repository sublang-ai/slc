<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-028: Noninteractive source clarification

## Status

Completed.

## Intent

Make unresolved source behavior actionable through compiler diagnostics at any phase.

## Deliverables

- [x] Generic clarification protocol, executor integration, and noninteractive CLI reporting.
- [x] Integration coverage for early and later questions, edited-source reruns, review, and compiled execution.

## Tasks

1. Specify and implement source clarification with focused acceptance coverage.

## Verification

Passed 304 tests across the clarification and eight affected suites, including the committed schema-3 phase with the installed Playbook engine.
Passed the TypeScript build, focused ESLint, diff whitespace checks, and Spex 3 lint.

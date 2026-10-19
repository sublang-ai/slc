<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-107: Expanded Child Composition Diagnostic

## Status

Implementation and focused verification complete; independent and root review accepted.

## Intent

Distinguish an unproved expanded child-input composition from missing authored template text without changing acceptance or exposing reached baseline payloads.

## Deliverables

- [x] Clarify dynamic composition findings while retaining static-text and specific structured-substitution diagnostics.
- [x] Verify existing structured-relay refusals and canonical/scalar controls.

## Tasks

1. Clarify the verification contract and dynamic diagnostic wording, omitting reached baseline payload snippets.
2. Strengthen the existing public integration assertions and record focused checks.

## Verification

The two existing public nested/structured child integration suites passed all 35 tests, including canonical and scalar controls, the noncanonical rendering diagnostic and absence of actual fixture payload fragments.
Source type checking, changed TypeScript ESLint, formatting and whitespace checks passed.
Sparse spec lint retains 15 deliberately excluded completion-package reference errors and is not a full lint pass.
No matcher, acceptance, search budget, model policy or historical production-cause conclusion changes.

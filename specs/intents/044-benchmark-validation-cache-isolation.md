<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-044: Benchmark Validation Cache Isolation

## Status

Complete

## Intent

Prevent full-compilation benchmark validation from mutating a shared frozen dependency cache through its workspace symlink, while preserving all artifact and runtime acceptance checks.

## Deliverables

- [x] Private validation cache and disabled result caching.
- [x] Real emitted-suite regression for preserved dependency-cache bytes.
- [x] Bounded timeout correction for the existing runtime-validation subprocess test.

## Tasks

1. [x] Isolate validation caches, verify real passing and failing suites, and give the existing 15-second-abort runtime validation test sufficient outer time for cleanup.

## Verification

- The prior full-suite run recorded 1,343 passing tests, two skips, and only the runtime-validation integration failure at its inherited 5-second test limit; its subprocess already used a 15-second abort signal.
- The unchanged isolated runtime suite subsequently passed all 12 cases, distinguishing the scheduling timeout from a runtime defect.
- Keep the internal abort unchanged and use a 20-second outer test limit for that one case.
- Both benchmark integration suites pass all 32 cases, including real emitted-suite success/failure with preserved dependency-cache bytes and the runtime-validation subprocess; formatter, linter, and Spex pass.
- All frozen C1/C2 scripts and inputs remain unchanged; this is a validation-isolation correction with no provider call or performance claim.

The combined final repository suite passes 1,344 tests with two skips across 72 files; full lint and formatting checks also pass.

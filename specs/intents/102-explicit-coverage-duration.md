<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-102: Explicit Coverage Duration

## Status

Implemented, independently reviewed and locally verified; integration pending.

## Intent

Allow an explicit finite duration ceiling for larger coverage checks while retaining default timing, shorter derived allowances and caller bounds.

## Deliverables

- [x] Validated API, YAML and environment duration setting with a 300,000 ms default and 1,800,000 ms cap.
- [x] Consistent cooperative lifetime, compiler and emitted-suite policy propagation with unchanged finite exploration and reuse semantics.
- [x] Public-entry integration evidence for validation, timing policy, cleanup, isolation and auxiliary regeneration.

## Tasks

1. Specify and implement the duration policy, document its supported settings, and verify the public coverage and compiler boundaries.

## Verification

The focused coverage-policy, configuration and CLI suite passes 142 tests.
Two actual English/Chinese retained-completion tests pass with serialized duration settings.
The duration-only all-phase reuse test passes with no agent calls and every history file byte unchanged after auxiliary restoration.
Real public-entry fixtures verify finite ceilings, smaller derived allowances, shortened caller deadlines, actor cleanup, independent concurrent policies, pre-artifact validation and portable emitted-suite execution.

The full deterministic suite passes 1,884 tests across 88 files with two existing skips.
All ten local gates pass: build, formatting, lint, full deterministic tests, definition parity, release-workflow checks, artifact verification, pin currency, English/Chinese demo acceptance and installed-package acceptance.

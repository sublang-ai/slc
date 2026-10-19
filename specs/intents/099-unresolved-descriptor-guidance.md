<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-099: Unresolved Descriptor Guidance

## Status

Implemented, independently reviewed and locally verified; integration pending.

## Intent

Retain unresolved child-output descriptor guidance when a guard later reads an already assigned descriptor, without changing actual guard acceptance or bounded replay.

## Deliverables

- [x] Preserve the unresolved descriptor hint within existing probe bounds.
- [x] Integrate real public-entry XState replay and descriptor-order refusal controls.

## Tasks

1. Specify the hint rule, reproduce the missing legal route, implement the bounded correction and verify real replay and negative guards.

## Verification

The unchanged parent rejects both descriptor-read orders although both real XState routes complete; five refusal controls pass.
The corrected candidate passes all 11 new integration cases and the related coverage, structured-relay and finite-budget suites: 336 distinct tests across four files.
The first related run retained one missing-build-output failure; building the new checkout and rerunning its affected 30-test portable/budget file passes.
Build, full lint, formatting, definitions, release checks, artifact reviews, pin verification, English and Chinese demos, and installed-package acceptance pass.
The full suite passes 1,845 tests with two existing skips.
The initial demo scratch-commit failure remains unexplained because its checker discarded Git stderr; an ordinary commit diagnostic and the subsequent demo checks pass with signing settings unchanged.
The initial package attempt failed on registry DNS resolution; a fresh package check passes after DNS recovery.
Specification lint retains exactly 15 known missing protected-document references and no warnings; the excluded body is neither read nor restored.
The public integration suite is agentless; separate unchanged-artifact diagnostics do not establish compiler or workflow acceptance.

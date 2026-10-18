<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-078: Target Arm Shape Hints

## Status

Complete.

## Intent

Combining preceding child-arm schemas with the selected arm can exceed bounded shape discovery even when the selected output fits the existing limit.
Use the selected guard only as a shape hint while preserving the original ordered predicate for concrete candidates, ordinary value guidance and actual target replay.

## Deliverables

- [x] Specify selected-arm-only bounded shape discovery.
- [x] Supply that hint only for guarded raw-child completion outputs.
- [x] Verify real XState disjoint shapes and ordered refusal controls.

## Tasks

1. Separate selected-arm shape hints from ordered acceptance.

## Verification

A retained-artifact diagnostic observes six names under the combined predicate but four under the selected guard, whose concrete candidate still passes the original ordered predicate.
The unchanged parent rejects a valid later child arm whose fields differ from the earlier arm.
An initial hint fixed the small fixture but later padding still exhausted the shared probe budget with 96 unrelated literals; that failed regression is retained.
Applying the selected hint consistently to every padding trace passes all eight focused cases and all 214 affected coverage and completion cases, including contradictory and shadowed-arm controls.
Build, lint and formatting pass.
The unchanged retained-artifact check removes the disjoint-shape finding, reducing four findings to three without introducing a finding; nested error and bounded delivery replay remain unproved.
The complete checkout passes global spec validation, all 1,672 tests (two existing skips), and all eleven required checks.
The earlier sparse-checkout diagnostics remain preserved as qualified evidence.

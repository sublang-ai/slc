<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-071: Child Output Value Guidance

## Status

Completed (2026-10-17).

## Intent

An exact-key child guard can require all four fields before reading a value.
Depth-first candidate combinations can exhaust the bounded search under an early wrong value without reaching a later valid discriminant.
Discovering the named shape before guiding values shall retain concrete ordered-guard acceptance and real XState replay under the existing limits.

## Deliverables

- [x] Specify bounded shape-first value guidance and its refusal cases.
- [x] Implement the generic raw-child search without changing fixed context or original seed descriptors.
- [x] Verify real XState positive and negative cases, build, lint and spec structure.

## Tasks

1. Correct bounded child-output value guidance with integration evidence.

## Verification

The isolated model-free reproduction reaches the child target with one real XState invocation while the former checker exhausts candidates under the first wrong field value.
The new integration regression first failed at the expected unsatisfiable-arm assertion, then passed with the correction; contradictory counts, shadowed arms and a fifth required field remain refused.
The affected coverage and completion suites passed all 189 cases; the TypeScript build, ESLint, changed-file formatting, Spex 3.0.0 spec lint and diff check passed.
Public model-free coverage of unchanged external artifacts removes the remaining finding from one artifact and reduces another artifact's findings from 29 to 15, with those unresolved arms still refused.
No provider call, compilation or external artifact edit was performed.
Independent review found no blocking issue.
The repository gate accounts for 1,645 passing tests and two existing skips across the full run and the necessary self-hosting rerun.
The isolated checkout initially exposed a saved dependency symlink to test discovery and let dependency links escape the pin-input boundary; those environment failures were preserved, the saved links moved outside discovery, and byte-identical local dependency copies restored containment without a product change.
The formerly failing self-hosting case, 181-file package smoke, full formatting, definitions, release workflow, compiled artifacts, pins and both language demos passed after that correction.

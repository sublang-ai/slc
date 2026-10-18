<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-089: Descriptor Read Hints

## Status

Implemented.

## Intent

A valid public entry can read required payload values through own-data descriptors that ordinary guard probing does not observe.
Treat those missing-field reads as bounded hints without fabricating a descriptor, changing context or weakening concrete acceptance.

## Deliverables

- [x] Specify ordinary missing-descriptor read guidance and unchanged boundaries.
- [x] Record descriptor reads without enabling broader shape discovery.
- [x] Verify real entry replay, negative controls and retained limits.

## Tasks

1. Guide ordinary assignable payload fields read through own descriptors.

## Verification

A retained failed producer's original entry guard accepts a concrete event, and real START or interrupt actions reach its intended admission states, while the unchanged public probe rejects descriptor reads and accepts equivalent direct property reads.
On the unchanged parent, the generic real-XState positive fails while six refusal and field-bound controls pass.
With descriptor-read hints, all 12 focused cases and all 268 affected coverage and retained-completion cases pass.
Inherited-only fields, false guards, ordered shadowing, immutable context, incompatible descriptor attributes and a fifth missing field remain refused.
Build, lint and changed-file formatting pass.
One public check of the unchanged retained failed output reports zero findings; the preserved final Reviewer reported 48 findings, rather than a separately rerun parent public check.
The original compiler attempt remains failed; this deterministic result is not compiler acceptance or runtime readiness.
Complete-checkout spec validation and all eleven repository gates pass, including 1726 tests with two existing skips; the full-checkout run closes the sparse-checkout citation qualification.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-088: Public Entry After Interrupt

## Status

Implemented.

## Intent

A satisfying interrupt drive can establish context that excludes a target while suppressing public entry routes that actually reach it.
Retain the exact interrupt first drive and the existing lazy public-entry iterator within the unchanged search bounds.

## Deliverables

- [x] Specify public-route retention after a satisfying interrupt.
- [x] Attach the existing iterator without widening search or duplicating seeds.
- [x] Verify actual multi-step routes, refusals and unchanged limits.

## Tasks

1. Keep lawful public entries available behind a valid interrupt plan.

## Verification

Read-only retained-artifact and generic real-XState witnesses distinguish a valid interrupt's dead route from actual public START actions reaching the intended target, without private context assignments.
On the unchanged parent, the cohesive alternate-route regression fails while three ordered, rejected-entry and fixed-context refusal controls pass.
All eight focused cases and all 253 affected coverage and retained-completion cases pass with the existing iterator retained behind the interrupt.
The first interrupt route and alternate public-action route both execute, while the preserved complex preemptive fixture explicitly exhausts the unchanged 64-attempt bound rather than claiming exhaustive coverage.
The original complex positive expectation and an input-mapper discovery-observation fixture correction remain preserved separately; neither is counted as passing regression evidence.
Build, lint and formatting pass.
One unchanged retained failed artifact has zero coverage findings versus its immediate parent's preserved 20 findings; no compiler execution, acceptance or runtime readiness is claimed.
Complete-checkout spec validation and all eleven repository gates pass, including 1719 tests with two existing skips; the sparse-checkout citation qualification is closed by that full-checkout run.

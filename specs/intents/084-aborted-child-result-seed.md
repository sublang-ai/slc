<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-084: Aborted Child Result Seed

## Status

Complete.

## Intent

The public nested-call contract distinguishes an aborted child from an error and a successful failure terminal, but the finite error seeds omit its bare result.
Add that public shape for the actual invoked child without invented optional data or relaxed acceptance, accounting for its extra probe in the existing capped derived timeout.

## Deliverables

- [x] Specify the finite aborted-result seed boundary.
- [x] Supply the bare aborted result only to nested error probes.
- [x] Verify actual child rejection with identity and ordered-refusal controls.

## Tasks

1. Add the missing public child-abort seed within existing bounds.

## Verification

The public result union permits a bare aborted result and the bridge routes that exact validated result through an Error to the caller's error arm.
On the unchanged parent, the real-XState bare-abort case fails its intended arm while three identity and shadowed-arm controls retain findings.
All four focused cases and all 227 affected coverage and completion cases pass with the finite seed; the actual reached Error validates to the exact bare result without optional data.
Build, lint and formatting pass, and the derived timeout accounts for the fourth child-error seed without changing the search limits or cap.
The unchanged retained-artifact check removes only two aborted-child findings, reducing 22 findings to 20 without new findings; another actual child rejection reaches its authored aborted terminal once.
The complete integration checkout passes all eleven repository gates, including specification validation and 1,685 tests with two skips; the sparse missing-target diagnostics are resolved by the complete checkout.

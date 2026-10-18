<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-085: Conditional Child Value Guidance

## Status

Implemented.

## Intent

Earlier ordered arms can consume the finite probe budget on fields unrelated to a selected child's incomplete output shape.
Guide values through the selected arm until its concrete guard accepts, then use the ordered predicate to discover fields needed to reject earlier arms, without changing acceptance or search capacity.

## Deliverables

- [x] Specify conditional value guidance within the existing shared bounds.
- [x] Charge selected-guard checks without changing masks or final acceptance.
- [x] Verify actual child targets and ordered or fixed-context refusals.

## Tasks

1. Preserve bounded selected-child value search before ordered exclusion.

## Verification

Diagnostic-only actual-XState replay preserves the original ordered guard and reaches the selected target after 435 charged probes, where the existing search exhausts 30,001 probes before reaching the complete observed shape.
A separate real-child counterexample rejects unconditional selected-only guidance: a selected guard first needs a value, then the ordered predicate must discover another field to reject an earlier arm.
On the unchanged combined parent, the intended own-field-order regression reports the missed second child arm while the three ordered and fixed-context controls pass.
All four focused cases and all 242 affected coverage and completion cases pass with conditional guidance; actual selected-arm actions observe both its accepted value and the earlier-arm exclusion field.
Build, lint and formatting pass, and the same four-field, sixteen-mask and shared probe limits remain unchanged.
An unchanged retained-artifact check covers its child failure and abort arms while preserving 21 alternate-entry depth findings; its older 25-finding checkpoint predates intervening fixes and is not intent-only attribution.
Full-checkout integration passes spec validation, all 1,700 tests with two existing skips, and all eleven required repository checks; the earlier sparse-checkout limitation remains recorded in its original evidence.

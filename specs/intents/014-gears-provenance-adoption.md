<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-014: Adopt Spex-Shipped GEARS Grammar Provenance

## Status

Done

## Intent

Implement [DR-016](../decisions/016-gears-grammar-provenance.md) by sourcing the pinned English and Chinese GEARS grammar from the installed `@sublang/spex` package and synchronizing the vendored definitions with Playbook 1.2.0's citation and language-rule changes.
Three task boundaries separated dependency locking, definition and Pin Inputs synchronization, and reproducible pin regeneration.
At completion, the reviewed meta-phase artifacts still derived from the pre-citation definition text; a later immutable reviewed-asset rebuild discharged that deliberate deferral.
The grammar authority remains owned by [DR-016](../decisions/016-gears-grammar-provenance.md), while current closure, reviewed-asset, and gate behavior is owned by the [`pinning`](../packages/pinning.md), [`self-hosting`](../packages/self-hosting.md), and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] `@sublang/spex` became a locked runtime dependency and its two shipped GEARS definitions resolved from the repository.
- [x] Vendored `text2gears.md` and `optimize.md` carried Playbook 1.2.0's Spex citation and unified language rule verbatim, with the vendored `## Pin Inputs` switched to the Spex-shipped files.
- [x] All compile pins regenerated as current with the new semantic-input closure, and a second generation was byte-identical.
- [x] The reviewed meta-phase artifacts were recorded at completion as compiled from the pre-citation definitions, with recompilation deferred until the next immutable reviewed-asset rebuild.

## Tasks

1. Add the dependency and refresh the lock.
2. Sync the vendored definitions from upstream and swap the grammar Pin Inputs.
3. Regenerate pins and re-anchor any tests pinning the old closure.

## Verification

- The four checked deliverables and three task boundaries establish completion of the grammar-provenance adoption and its explicit artifact-rebuild deferral.
- Commit `c81895a` records the exact `@sublang/spex@0.3.0` lock, bilingual definition synchronization, Pin Inputs swap, and byte-reproducible pin generation.
- At completion, `npm test`, the pin reproducibility gate, all three artifact audits, and the then-current demo reference checker were recorded as passing.
- The manifest still declares `@sublang/spex@^0.3.0`, the lock still resolves exact 0.3.0, and the current pin index records both Spex-shipped grammar paths while recording no local `../../specs/meta.md` grammar input.
- Commit `097ab8c` records the later rebuild of all three meta-phase bundles from synchronized definitions, discharging the completion-time deferral.
- Current semantic-input generation is exercised by [[pinning-16](../packages/pinning.md#pinning-16)], while the surviving reviewed-asset and no-mixed-set mechanisms over the current immutable set are exercised by [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)] and audited by [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)].
- [DR-016](../decisions/016-gears-grammar-provenance.md) retains the accepted bilingual grammar authority and atomic Spex-release coupling.

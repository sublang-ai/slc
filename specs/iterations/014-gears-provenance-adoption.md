<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-014: Adopt spex-shipped GEARS grammar provenance

## Goal

Implement [DR-016](../decisions/016-gears-grammar-provenance.md): source the pinned GEARS grammar from the installed `@sublang/spex` package (English and Chinese), syncing the vendored definitions from upstream Playbook 1.2.0's citation and language-rule edits.

## Deliverables

- [x] `@sublang/spex` is a locked runtime dependency and its two shipped GEARS definitions resolve from the repo.
- [x] Vendored `text2gears.md` and `optimize.md` carry upstream's spex citation and unified language rule verbatim, with the vendored `## Pin Inputs` swapped to the spex-shipped files.
- [x] All compile pins regenerate as current with the new closure; the pin gate stays byte-reproducible.
- [x] The meta-phase artifacts are noted as compiled from the pre-citation definitions; recompiling under the updated text is deferred to the next reference rebuild.

## Tasks

1. Add the dependency and refresh the lock.
2. Sync the vendored definitions from upstream and swap the grammar Pin Inputs.
3. Regenerate pins and re-anchor any tests pinning the old closure.

## Acceptance criteria

- `npm test`, the pin reproducibility gate, `scripts/verify-artifacts.mjs` on all three bundles, and `node demo/reference/check.mjs` all pass.
- `pipelines/playbook/slc.pins.json` records the spex-shipped grammar files among `text2gears`'s semantic inputs and no longer references `../../specs/meta.md`.

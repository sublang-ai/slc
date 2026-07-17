<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-011: Adopt the Playbook 0.10 generation

## Goal

Move the release-vendored definitions, reviewed artifacts, and pins from the retired Playbook 0.9 legacy contract to the 0.10 generation — the release that carries the final six-port composed contract, `playbook run`, and the DR-016 script actors — so `slc playbook` output runs under the Playbook one-shot host.

## Deliverables

- [x] `src/playbook-contract.ts` freezes the retired 0.9 legacy shapes as local structural types instead of importing them from the moving `@sublang/playbook/runtime` module.
- [x] `PHEXEC-30` and `runtimeContractForPin` map exact `@sublang/playbook@0.10.0` provenance to the `composed-v2` profile.
- [x] `pipelines/playbook/` re-synced with Playbook's maintained definitions (0.10 generation, script actors, single-outcome default contract), keeping the local `## Pin Inputs` sections.
- [ ] `text2gears.slc/`, `gears2fsm.slc/`, and `link.slc/` rebuilt from the synced definitions via interpreted `slc slc` runs, reviewed with `scripts/verify-artifacts.mjs`.
- [ ] `pipelines/playbook/slc.pins.json` regenerated over the rebuilt set; CI's reproducible-pins gate green.
- [x] Reference-equivalence acceptance updated: the released reference detects as `composed-v2`, with fresh produced evidence regenerated under the new definitions.

## Tasks

1. Freeze the legacy contract locally and remap pin provenance.
2. Sync the vendored definitions and remove the stale pins.
3. Rebuild the three compiled meta-phase artifacts with real agents; verify and install.
4. Regenerate pins and re-run the full gate set.

## Acceptance criteria

- `npm test`, `npm run lint`, and `npm run format:check` pass.
- `node scripts/verify-artifacts.mjs pipelines/playbook/<phase>.slc <phase>` reports no findings for each rebuilt artifact.
- `node scripts/generate-pins.mjs` reproduces the committed `slc.pins.json` byte-identically.
- A compiled full-pipeline `slc playbook` run selects the compiled artifacts through current pins and emits a `composed-v2` runtime the Playbook `run` host loads.

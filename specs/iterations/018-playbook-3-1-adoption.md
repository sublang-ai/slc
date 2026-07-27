<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-018: Adopt Playbook 3.1 and prepare 0.2.0

## Goal

Implement [DR-018](../decisions/018-playbook-3-1-adoption.md): move the
dependency closure, vendored definitions, meta-phase bundles, and pins from
Playbook 2.0.0 to 3.1.0 as one reviewed unit; regenerate the Chinese demo
reference through the packed candidate as end-user acceptance; and prepare
the 0.2.0 release.

## Deliverables

- [ ] `@sublang/playbook` at `^3.1.0`, locked to 3.1.0; `demo/package.json`
      at the same majors with `@sublang/slc` at `^0.2.0`.
- [ ] Vendored `link.md` re-synced (judge-prompt envelope, `spec.compat`
      stamping) with `## Pin Inputs` retained; the other three definitions
      confirmed normatively unchanged.
- [ ] All three bundles rebuilt via interpreted `slc slc` runs and verified;
      pins regenerated with exact 3.1.0 provenance, byte-reproducible.
- [ ] `runtimeContractForPin` maps exact 3.1.0 to `composed-v2`; 1.3.0 and
      3.0.0 stay fail-closed with test coverage; PHEXEC-30/28, SELFHOST-11
      and its acceptance, and CI-4 name 3.1.0.
- [ ] `demo/reference/workflow.zh.*` regenerated through the packed 0.2.0
      candidate installed into `demo/` exactly as an end user would compile;
      `check.mjs zh` passes and joins `verify:demo`.
- [ ] READMEs concise and global-first: provisioning attributed to
      playbook 3.1, trimmed install prose pointing at spec items, zh mirror
      updated with its restored native reference entry.
- [ ] `CHANGELOG.md` 0.2.0 section; version 0.2.0; `release:check` green;
      release steps per [RELEASE-13](../dev/release.md#release-13).

## Acceptance criteria

- `npm run release:check` exits zero from a clean locked install.
- Every pin records exact `@sublang/playbook@3.1.0` link-target provenance;
  `generate-pins.mjs` reproduces the committed index byte-identically.
- `node demo/reference/check.mjs en` and `node demo/reference/check.mjs zh`
  both pass all stages.
- Reverting any dependency, definition, bundle, or pin component to its
  2.0.0 form fails the gate set rather than passing as a mixed version.

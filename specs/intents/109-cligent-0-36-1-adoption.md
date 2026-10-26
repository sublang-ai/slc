<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-109: Cligent 0.36.1 Adoption

## Status

Preparation only: the dependency floor, specification, repository adoption refusal and Unreleased notes are authored.
The registry lock and installed closure are verified; formatting, lint and one source build pass.
The initial full suite failed against pre-refresh pins; the reviewed official refresh and changed-candidate local verification now pass.
SLC 0.19.1 metadata is prepared for 2026-10-25; its affected metadata, pin, provenance-case and installed-package checks and required prepush pass.
No commit or publication is complete.
The existing SLC checkout and its branch are untouched.

## Intent

Consume the published Cligent 0.36.1 browser-readiness correction and patched runtime dependency through the direct minimum [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)].
Retain the current Playbook 17.11.0 definition and reviewed artifact set under the existing adoption contract [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)].

## Deliverables

- [x] Specify the minimum, raise the manifest to `^0.36.1`, enforce its refusal in the repository adoption verifier, and add Unreleased notes.
- [x] Resolve the real registry lock to Cligent 0.36.1 and its required Zod 4.6.6 closure, preserving Playbook, xstate and agent SDK versions.
- [x] Regenerate current provenance pins from the resolved closure without recompiling retained definitions or bundles.
- [x] Complete adoption verification and the existing local release-check stages against the refreshed candidate.
- [ ] Merge on green; prepare and publish a separately authorized SLC patch release before claiming registry consumers inherit the raised minimum.

## Tasks

1. Prepare the spec, minimum, notes and npm-resolved lock; once installs are permitted, verify the installed closure and refresh pins as one adoption change.
2. Run the affected and release gates, review the complete change, and merge through the protected branch workflow.
3. Prepare the audited SLC 0.19.1 patch metadata, complete its affected gates and required exact CI, and publish through the separately authorized trusted tag workflow.

## Verification

The authorized lock-only npm resolution changed only the root requirement, Cligent 0.36.0 to 0.36.1, and Zod 4.4.3 to 4.6.6; both new registry URLs and integrity values match official metadata.
Playbook 17.11.0, xstate 5.33.0, Claude SDK 0.3.284 and Codex SDK 0.159.0 entries are unchanged.
The clean locked install passes, and direct SLC and transitive Playbook ESM resolution reach the same Cligent 0.36.1.
The first formatting check failed only on the new floor condition; formatting that file made the changed-input check pass, followed by lint and the single source build.
The initial one-worker full suite passed 1,928 tests, skipped two and failed the existing self-hosting provenance flow while repository pins still named the previous lock digest; that incomplete-candidate failure is retained and is not waived.
Read-only pin evaluation confirmed all three records stale at `../../package-lock.json`.
The authorized official generator ran once after that diagnosis, replacing only the three lock digests and reporting every pin current; all 84 retained compiler and demo files remain byte-identical.
After root reviewed the exact three-digest pin change, only that file was staged for the prescribed reproducibility gate.
The changed-candidate full suite passed all 93 files and 1,929 tests, with two skips, using one file worker and unchanged assertions and timeouts.
Definition verification, release-workflow audit, retained-artifact review, reproducible pins, both demo references and installed-package smoke then passed sequentially.
Together with the prior successful formatting, lint and single build, these cover the local `release:check` stages; no uninterrupted literal `npm run release:check` invocation is claimed.
The release audit reviewed every message and changed file of the four commits from v0.19.0 to the current main baseline; these are non-notable merge-policy, CI and pre-push maintenance.
The chosen patch 0.19.1 changes only the version trio, dated changelog and comparison links, this status record and the official lock-digest pins; the dependency graph and retained artifacts stay unchanged.
The recorded 1,929-test success precedes this version-only metadata change; its unchanged runtime and clean-install evidence is retained rather than claimed as a new full 0.19.1 run.
After root metadata review, tag-context release audit, prescribed pin reproducibility, the selected self-hosting provenance regression and the newly versioned installed-package smoke passed.
The selected regression passed one case with 45 other cases unselected; the package smoke checked 181 payload files and the installed executable reporting SLC 0.19.1, without executing phases or publishing build history.
Required prepush passed before this verification-only status update; root commit review and all remote gates remain pending.
Exact final-head PR CI, main CI and the tag workflow's clean full release checks remain mandatory before publication.
No model recompilation, commit, push, tag or publication has run.
Never hand-author resolved dependency entries, integrity values or provenance pins.

| Boundary | Required evidence after checks are authorized |
| --- | --- |
| Registry closure | The direct `^0.36.1` minimum, exact Cligent 0.36.1 lock and installed version agree; SLC and unchanged Playbook share that Cligent, its required Zod is 4.6.6, and existing SDK identities remain unchanged [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)]. |
| Retained compiler inputs | `verify:definitions`, `verify:artifacts` and both `verify:demo` flows pass against the unchanged Playbook release [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)]. |
| Pins | The official generator refreshes the lock-dependent provenance, and `verify:pins` reproduces it [[pinning-15](../packages/pinning.md#pinning-15)]. |
| Transport and package | The affected Cligent transport and self-hosting integration suites, then the clean locked `release:check` including installed-package smoke, pass [[release-12](../packages/release.md#release-12)]. |
| Publication | A later SLC patch release requires its release checklist and exact-main CI before its tag workflow publishes [[release-13](../packages/release.md#release-13)] [[release-7](../packages/release.md#release-7)]; compiler-execution changes in that release additionally require the opt-in local acceptance gate [[release-13](../packages/release.md#release-13)]. |

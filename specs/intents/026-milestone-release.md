<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-026: Milestone Release After Contract-Based Adoption

## Status

In progress — the contract-based adoption has landed.

## Intent

Publish the compiler milestone the demo depends on: the contract-based adoption regime, the adopted Playbook 12.1.0 set with compiled-execution bundles, and the published host-capabilities facade in place of local copies.

## Deliverables

- [x] Adapter-scoped fast mode is configurable for the coder and the reviewer (`fastMode`, `reviewerFastMode`, `SLC_FAST_MODE`, `SLC_REVIEWER_FAST_MODE`), delegated to the installed cligent capability contract like effort.
- [ ] Version, changelog, and regenerated pins prepared on the adopted set.
- [ ] `npm run release:check` and both demo reference checkers pass on the release commit.
- [ ] The release is tagged and published.

## Tasks

1. [x] Add the fast-mode configuration keys with their spec items and tests.
2. [ ] Prepare the release commit and verify the full gate.
3. [ ] Tag, push, and confirm publication.

## Verification

- `npm run release:check` exits zero on the tagged commit and the registry serves the version.

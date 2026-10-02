<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-068: Retained Bundle Release

## Status

In progress — 0.16.0 preparation; tagging and publication pending.

## Intent

Publish deterministic retained-bundle completion and the compiler corrections since 0.15.1 as one minor release [[release-1](../packages/release.md#release-1)], [[completion-1](../packages/completion.md#completion-1)].
The 0.15.2 version was a preparation candidate and was never published; its fixes belong to 0.16.0.

## Deliverables

- [x] Reviewed completion behavior and authoritative output-clause probing [[completion-6](../packages/completion.md#completion-6)], [[verification-53](../packages/verification.md#verification-53)].
- [ ] Version, demo requirement, consolidated changelog and package checks for 0.16.0 [[release-2](../packages/release.md#release-2)], [[release-4](../packages/release.md#release-4)].
- [ ] Clean locked gates, exact release-commit CI and actual installed live acceptance [[release-13](../packages/release.md#release-13)], [[release-17](../packages/release.md#release-17)].
- [ ] Trusted tag publication and verified registry/GitHub release [[release-7](../packages/release.md#release-7)].

## Tasks

1. [ ] Prepare the minor version and current-bundle consumer release contract, preserving prior published changelog links.
2. [ ] Record verified release gates and actual publication after the required main integration and CI.

## Verification

- The pre-version candidate passed 78 test files, 1,573 tests and two existing skips, real English/Chinese runtime checks, definition/artifact/pin gates, and a fresh installed consumer containing 181 files [[completion-6](../packages/completion.md#completion-6)], [[release-12](../packages/release.md#release-12)].
- Preserve the failed startup-order and logical macOS scratch-path checks separately from their reviewed corrections; the final consumer retains exact entry and no-config assertions [[cli-30](../packages/cli.md#cli-30)], [[completion-2](../packages/completion.md#completion-2)].
- Live acceptance must belong to the actual 0.16.0 candidate and bind only allowed workshop models explicitly; the earlier 214233e live result remains historical evidence [[release-17](../packages/release.md#release-17)].
- No tag or publication occurs before clean locked release checks and exact main CI succeed [[release-13](../packages/release.md#release-13)].

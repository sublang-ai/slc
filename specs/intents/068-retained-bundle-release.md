<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-068: Retained Bundle Release

## Status

Completed: SLC 0.16.0 is tagged `v0.16.0` from merge `6386150` and published to npm as `latest` and on GitHub after locked release checks, exact release-commit CI and trusted publication passed; its live acceptance is recorded only in the Spex workshop status.

## Intent

Publish deterministic retained-bundle completion and the compiler corrections since 0.15.1 as one minor release [[release-1](../packages/release.md#release-1)], [[completion-1](../packages/completion.md#completion-1)].
The 0.15.2 version was a preparation candidate and was never published; its fixes belong to 0.16.0.

## Deliverables

- [x] Reviewed completion behavior and authoritative output-clause probing [[completion-6](../packages/completion.md#completion-6)], [[verification-53](../packages/verification.md#verification-53)].
- [x] Version, demo requirement, consolidated changelog and package checks for 0.16.0 [[release-2](../packages/release.md#release-2)], [[release-4](../packages/release.md#release-4)].
- [x] Clean locked gates, exact release-commit CI and actual installed live acceptance [[release-13](../packages/release.md#release-13)], [[release-17](../packages/release.md#release-17)].
- [x] Trusted tag publication and verified registry/GitHub release [[release-7](../packages/release.md#release-7)].

## Tasks

1. [x] Prepare the minor version and current-bundle consumer release contract, preserving prior published changelog links.
2. [x] Record verified release gates and actual publication after the required main integration and CI.

## Verification

- The pre-version candidate passed 78 test files, 1,573 tests and two existing skips, real English/Chinese runtime checks, definition/artifact/pin gates, and a fresh installed consumer containing 181 files [[completion-6](../packages/completion.md#completion-6)], [[release-12](../packages/release.md#release-12)].
- Preserve the failed startup-order and logical macOS scratch-path checks separately from their reviewed corrections; the final consumer retains exact entry and no-config assertions [[cli-30](../packages/cli.md#cli-30)], [[completion-2](../packages/completion.md#completion-2)].
- Live acceptance must belong to the actual 0.16.0 candidate and bind only allowed workshop models explicitly; the earlier 214233e live result remains historical evidence [[release-17](../packages/release.md#release-17)].
- No tag or publication occurs before clean locked release checks and exact main CI succeed [[release-13](../packages/release.md#release-13)].
- Release [v0.16.0](https://github.com/sublang-ai/slc/releases/tag/v0.16.0) was tagged from `6386150f7ad5ba90326695c5f260fe0dd4b06355`, the merge of [PR #41](https://github.com/sublang-ai/slc/pull/41), after its [exact main CI](https://github.com/sublang-ai/slc/actions/runs/37074757163) passed [[release-13](../packages/release.md#release-13)].
- [Trusted publication](https://github.com/sublang-ai/slc/actions/runs/37076839354) matched the tag to the package version, required that commit's passing CI, reran the locked release checks, published through trusted OIDC and created the GitHub release at 2026-10-02T23:20:10Z [[release-7](../packages/release.md#release-7)].
- npm serves `@sublang/slc@0.16.0` as `latest` with `gitHead` `6386150f7ad5ba90326695c5f260fe0dd4b06355` and an SLSA provenance attestation.
- The only live-acceptance record for this candidate is the Spex workshop status at Spex commit `2973bc8` (`docs/workshops/2026-10-02/issues.md`, SLC-04): installed cold compile in 1,204 seconds, exact reuse, manual GEARS update with reuse and a live host run passed for `6386150`, and a fresh npm consumer completed a retained bundle with verified signatures and provenance.
- That record names neither the bound models nor retained evidence, so this repository holds no proof of the explicit allowed-model binding [[release-17](../packages/release.md#release-17)].

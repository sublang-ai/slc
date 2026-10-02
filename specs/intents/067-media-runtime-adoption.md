<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-067: Media and Approval Runtime Adoption

## Status

Completed: SLC 0.15.1 adopts the published Cligent 0.33.1 and Playbook 17.4.0 registry closure; retained-artifact checks, candidate release checks, the single installed live acceptance, trusted publication and fresh public-consumer verification pass.

## Intent

Adopt Cligent `^0.33.1` and Playbook `^17.4.0` through [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), so hosts using media and live approvals resolve one Cligent and one Playbook with SLC.

## Deliverables

- [x] Both dependency ranges and the lock updated from the registry, without a sibling checkout or development tarball.
- [x] The five definitions and published sidecar inputs synchronized byte-identically, including the Inspector workflow contract.
- [x] Existing compiled bundles and both demo references retained by verified equivalence, with every pin regenerated current.
- [x] Demo dependency ranges, changelog, and release version updated together.
- [x] Installed-package release checks and live acceptance completed before publication.
- [x] Approval forwarding reviewed as a host capability without new compiler or workflow semantics.

## Tasks

1. [x] Adopt the published dependency set, synchronize its compiler inputs, regenerate pins, and record verification.
2. [x] Prepare the release, complete candidate acceptance and CI, then publish through the existing release workflow.

## Verification

| Boundary | Required evidence |
| --- | --- |
| Registry closure | A clean locked install contains one Cligent 0.33.1 and one Playbook 17.4.0, with no local package resolution. |
| Engine and definitions | The installed engine declares ABI 1 and schema 3; all vendored definitions and sidecar inputs match the installed release. |
| Retained artifacts | The three generated verification suites, independent artifact reviews, compiled-execution fidelity checks, and both demo checkers pass against the installed engine. |
| Pin provenance | The regenerated index records the exact installed dependency closure and remains unchanged when regenerated again. |
| Candidate | The complete release checks pass after a clean locked install; installed-package live acceptance covers cold compilation, unchanged reuse, incremental update, and a real workflow run. |
| Publication | The release commit passes CI on main before the matching tag starts trusted publication. |

The installed public Playbook 17.4.0 release confirms that it preserves the five definitions, published pin-input sidecar, helper scripts, and public runtime TypeScript bytes from installed 17.3.0, while its workflow catalog adds `inspect` and its literal binding without changing prior contracts.
Live approval forwarding changes the session-host facade and host implementation, leaving those semantic inputs and every authored or compiled workflow unchanged from the reviewed media implementation.
SLC supplies no live approval callback and needs no compiler feature for an embedding host to use that separate Playbook capability.
The installed registry closure passes the retention checks, 1,535 tests with two existing skips, both demo checks, package smoke and one complete installed live acceptance.
Release [v0.15.1](https://github.com/sublang-ai/slc/releases/tag/v0.15.1) was published from `82846aa22c11e48efdc24c39bbdea32e31f25791` after [PR #34](https://github.com/sublang-ai/slc/pull/34), [exact main CI](https://github.com/sublang-ai/slc/actions/runs/37023297714) and [trusted publication](https://github.com/sublang-ai/slc/actions/runs/37023854614) passed.
The fresh public consumer verifies all shipped bytes against the accepted candidate, exact dependency resolution, both exports, CLI version and the Inspect catalog; npm's returned verified provenance binds the archive to that source, tag and publisher attempt.

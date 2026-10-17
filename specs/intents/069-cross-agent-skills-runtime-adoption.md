<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-069: Cross-Agent Skills Runtime Adoption

## Status

In progress: the registry adoption and composed local deterministic release gate are complete; installed live acceptance, exact release-commit CI and trusted publication remain pending.
The release tag remains gated on all pending checks.

## Intent

Adopt Cligent `^0.34.0` and Playbook `^17.10.1` through [DR-028](../decisions/028-contract-based-adoption-without-recompilation.md), so SLC and Playbook consumers resolve one current runtime closure with native skill delivery owned by the agent host.
Release the adoption and existing compiler corrections as SLC 0.16.2 under [[release-1](../packages/release.md#release-1)].

## Deliverables

- [x] Direct dependency ranges and the lock resolved from the published registry releases.
- [x] All five definitions and published sidecar inputs synchronized byte-identically with the installed Playbook release.
- [x] Three reviewed meta-phase bundles and both demo references retained by verified equivalence, or rebuilt only where the existing retention checks require it.
- [x] All pins regenerated for the adopted closure, with current demo dependencies, version and changelog.
- [ ] Clean locked release checks, installed live acceptance, exact main CI and trusted publication completed.

## Tasks

1. [x] Adopt the published dependencies, synchronize compiler inputs, verify retained artifacts, and regenerate pins as one set.
2. [ ] Prepare SLC 0.16.2, complete its existing release and live gates, then publish through the trusted tag workflow.

## Verification

The complete eight-commit range `v0.16.1..65c6bfd5713db02553d7dcb70d57991fee2de89a` was reviewed through its messages and changes.
Both notable groups are included in the 0.16.2 changelog; fixture maintenance, spec-ID reconciliation, merge and formatting changes support those fixes.

| Release-range group | Commit evidence |
| --- | --- |
| Topology-selected schema-3 question storage and actual reached-question validation | `f2bf3a5`, `c448dc2`, `d954a50`, `35e1f48`, `a826f94`, `7d9cdac` |
| Role parsing stays inside Markdown fences until the matching closing run | `08c9d31`, `65c6bfd` |

| Boundary | Required evidence |
| --- | --- |
| Registry closure | One Cligent 0.34.0 and one Playbook 17.10.1 from a clean locked registry install, without sibling checkout or development tarball resolution. |
| Definitions and retained artifacts | Installed ABI/schema declarations, definition bytes, compiled-execution sections, generated verification, independent artifact review and both demo checkers satisfy [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)]. |
| Pins | Every regenerated pin names the adopted closure and remains stable under the release gate's regeneration [[pinning-15](../packages/pinning.md#pinning-15)]. |
| Release candidate | The composed local release gate covers every `release:check` stage from a clean locked install, crediting acceptance's clean build and disjoint ordinary/demo test coverage, including installed-tarball smoke; the compiler fixes since 0.16.1 require the existing live acceptance [[release-13](../packages/release.md#release-13)], [[release-17](../packages/release.md#release-17)]. |
| Publication | Exact release-commit CI passes on main before the matching tag triggers publication, followed by fresh public-consumer verification [[release-7](../packages/release.md#release-7)]. |

The native-skills configuration and real-provider delivery test belong to Playbook's installed workflow gate.
This adoption adds no SLC configuration field, compiler instruction or adapter test for skills.

Local evidence is composed from disjoint or changed-input checks rather than an uninterrupted literal `npm run release:check` invocation:

| Check | Evidence |
| --- | --- |
| Clean closure and build | `npm ci` installed 321 packages from the registry lock; the final stock acceptance invocation rebuilt and packed the corrected candidate. |
| Ordinary integration suite | The initial run excluding `demo/reference/**` passed 1610 cases and skipped two; its two failures were resolved by the published Playbook 17.10.1 correction and the updated CODE relay expectation. The changed placeholder case passed, then all seven cases consuming the corrected reference or changed provenance/pins passed; unchanged passing cases were retained. |
| Formatting and lint | Full checks passed, followed by focused checks of the changed test and final formatted metadata; `spex lint` validates this record. |
| Retained artifacts | All five definitions and three published sidecar inputs match the installed release; its ABI is 1 and schema list is `[3]`; all three artifact reviews, reproducible pin checks and complete English/Chinese demo gates passed. Independent review confirmed unchanged compiled-execution sections and retained bundles. |
| Release machinery and package | Trusted-publication verification passed; fresh installed-tarball smoke passed for SLC 0.16.2 with 181 payload files. |
| Live acceptance | Running the stock full gate with compiler `claude-code:claude-opus-5-5@high`, player `claude:claude-opus-5-5@high` and Captain `codex:gpt-6-sol@high`; the final compile, reuse, update and run result is pending. |

The initial ordinary-suite conformance failure exposed source-owned `needsBossReply` results in Playbook 17.10.0's CODE GEARS; Playbook 17.10.1 removes them while preserving the compiled suspension, and SLC's zero-finding assertion remains unchanged.
An earlier acceptance attempt stopped after build, pack and install because `SLC_AGENT=claude` is not a supported compiler CLI name; it made no model calls and is not counted as successful acceptance.
The corrected dependency closure justifies the final stock gate's clean rebuild.
Fresh consumer caches receive only retained, integrity-verified npm `content-v2` bytes through a temporary launcher restricted to this task's scratch caches; it preserves npm's arguments and environment, copies no indexes or registry metadata, and changes no assertion or consumer dependency resolution.

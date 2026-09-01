<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-026: SLC-Owned Pin-Input Declarations

## Status

Accepted

## Context

[DR-007](007-slc-phase-artifact-pinning.md) derives a phase's semantic-input closure from `## Pin Inputs` inside the definition and binds each pin key to a definition path directly inside the pipeline directory.
That coupling forces SLC to modify package-owned definitions solely to declare repository-local inputs such as the dependency lock, even when the remaining definition bytes equal the immutable installed package.
The existing path boundary already admits installed-package link targets, runtime dependencies, and semantic inputs, so definitions need the same bounded path treatment.
The declaration source also contributes to incremental input identity and target protection under [DR-021](021-incremental-compilation.md).

## Decision

- A pipeline may contain an SLC-owned `slc.pin-inputs.json` semantic-input declaration beside `slc.pins.json`.
- The sidecar shall be a regular non-symbolic-link strict-JSON file with schema `sublang.slc.pin-inputs.v1`, no unknown fields, and one `closures` object mapping portable phase or pass names, including reserved `link`, to arrays of unique relative POSIX-style paths.
- Each `closures` entry shall list the phase's complete flattened local semantic-input closure other than the definition itself; its paths use the pipeline directory's coordinate system and must resolve inside the same recorded or generation-time path boundary as every other local pin path.
- A present entry is authoritative for that phase: closure derivation adds the separately recorded definition and the entry's paths without reading any `## Pin Inputs` section for transitive expansion.
- Where the sidecar or the phase's entry is absent, closure derivation shall retain [DR-007](007-slc-phase-artifact-pinning.md)'s existing transitive inline `## Pin Inputs` behavior.
- The same applicable declaration shall govern pin generation, pin-currency validation, incremental input identity, and protected local-input discovery; explicit Markdown reference inputs that are not the phase definition retain their inline transitive declarations.
- The applicable sidecar entry's canonical resolved member-locator set and exact member bytes — but not unrelated entries or JSON presentation — shall contribute to incremental identity, and the sidecar path remains protected from output aliasing.
- A pin key shall bind its definition by portable POSIX basename rather than by its complete locator: phase `<phase>` requires a definition basename `<phase>.md`, while the definition locator may resolve anywhere inside the path boundary.
- Artifact-bundle and linked-entry paths remain the canonical pipeline-local `<phase>.slc` and `<phase>.slc/<phase>.playbook.ts` paths.
- External definition locators do not change pipeline discovery in this decision: execution shall fail closed unless the selected phase definition resolves to the pin-recorded definition locator, leaving activation of installed-package definition resolution to the later de-vendoring cutover.

This decision narrowly supersedes [DR-007](007-slc-phase-artifact-pinning.md)'s requirement that the root closure declaration live in the definition body and that the complete definition locator equal `<phase>.md`.
It supersedes [DR-021](021-incremental-compilation.md)'s inline-only phase-definition closure source while retaining its inline behavior for explicit Markdown references.
For future Playbook 10 activation only, it supersedes [DR-024](024-playbook-10-schema-3-adoption.md)'s requirement that synchronized definitions retain SLC's inline `## Pin Inputs`; the applicable SLC-owned declaration may instead carry that closure without changing package-owned definition bytes.
It does not activate that cutover: the current vendored Playbook 4 definitions, inline declarations, reviewed bundles, pins, dependency ranges, and resolution behavior remain unchanged under [DR-025](025-defer-playbook-10-activation.md).

## Consequences

- SLC can pin an immutable installed-package definition while keeping repository-specific closure facts under SLC ownership.
- Existing pipelines without a sidecar entry keep their current inline closure behavior and pin bytes.
- A sidecar entry is reviewable as a complete closure rather than requiring transitive reconstruction across package-owned documents.
- Moving a definition outside its pipeline directory does not loosen path containment because the recorded boundary remains authoritative.
- De-vendoring and the resulting artifact rebuild and pin regeneration remain a separate atomic change.

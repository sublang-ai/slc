<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# pinning: Phase Artifact Pin Currency

## Intent

This package specifies the host-side validator that decides whether a pipeline's committed compiled-phase pins are current under [DR-007](../decisions/007-slc-phase-artifact-pinning.md).
Given a pipeline directory, the validator reads `slc.pins.json` and the committed inputs it records, and reports for each pinned phase a verdict of current, stale, or malformed.
It runs no compiled artifact and selects no execution strategy — that is the compiled executor's role under [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) — but beyond existing and matching its recorded hash, the compiled artifact must resolve to the linked `playbook` format, recognized from its committed bytes, or the phase is stale.
Verification evaluates fixture pipeline directories end-to-end over a committed `slc.pins.json` and the inputs it records, using ordinary committed files because the validator decides currency from bytes and paths and runs no compiled artifact.
Essential project-specific references are `slc`, this project's compiler; the `slc.pins.json` pin file and currency contract of [DR-007](../decisions/007-slc-phase-artifact-pinning.md); and the reserved `slc.link` phase and `playbook` artifact of [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).

## External Behavior

### Presence

#### pinning-1

Where a pipeline directory contains no `slc.pins.json`, when the validator evaluates the pipeline, the validator shall report no pins and treat every phase as unpinned, without raising an error ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

### Currency

#### pinning-2

Where a pipeline directory's `slc.pins.json` is well-formed and, for a phase or format-preserving pass, the portable phase/pass map key matches the record's canonical definition basename, artifact-bundle, and artifact paths, the recorded definition, compiled artifact, semantic inputs, and local runtime dependencies each resolve inside the recorded path boundary and match their recorded exact-byte or canonical tree SHA-256 identities, every package runtime-dependency specifier resolves from the compiled entry module to its recorded locator, the compiled artifact is a `.playbook.ts` module that resolves to the linked `playbook` format [[self-hosting-3](self-hosting.md#self-hosting-3)], its recorded artifact-bundle directory directly contains that entry module plus its canonical local FSM, GEARS, and four verification files, has the matching deterministic tree hash, and contains no symbolic links or unsupported entries, the recorded link-target locator resolves and its identity matches the recorded identity, the recorded semantic-input closure equals the closure derived from the definition's `## Pin Inputs` section, and every recorded external input carries a well-formed immutable content-addressed identity, when the validator evaluates that phase or pass, the validator shall report it current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-3

Where a phase's recorded definition, compiled artifact, artifact bundle, semantic input, runtime dependency, or link target no longer matches its recorded `sha256:` identity, or a package runtime dependency resolves to a different package root — counting any byte difference, including a line-ending change, since the validator applies no content normalization before hashing — when the validator evaluates that phase, the validator shall report it stale with a diagnostic naming the changed input, and shall not report it current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-4

Where a phase's recorded semantic-input closure differs from the closure derived from the definition's `## Pin Inputs` section and the transitive `## Pin Inputs` of its local Markdown inputs, when the validator evaluates that phase, the validator shall report it stale with a diagnostic naming the closure difference ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-13

Where a phase's recorded compiled artifact exists and matches its recorded hash but its committed bytes do not resolve to the linked `playbook` format — a module exposing a `createPlaybookRuntime` factory produced by the reserved `slc.link` phase [[self-hosting-3](self-hosting.md#self-hosting-3)] — when the validator evaluates that phase, the validator shall report it stale, and shall report it current only when the artifact resolves to that format ([DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)).

### Rejection

#### pinning-5

Where `slc.pins.json` is not a regular non-symbolic-link file, is not strict JSON, declares an unsupported schema identifier or hash algorithm, omits a required field, carries an unknown or wrong-typed field, uses a pin-map key other than `link` or a non-empty portable phase/pass name without a path separator, NUL, or ASCII drive prefix and other than `.` or `..`, maps a phase key to another phase's definition, artifact bundle, or artifact paths, records an empty or non-portable path, an absolute path, a path that lexically or through symbolic links escapes the recorded path boundary, omits a package runtime dependency's bare import specifier or records a non-bare one, records a file or tree hash that is not a well-formed `sha256:` digest, or records a link-target identity that is not a well-formed content-addressed identity, when the validator evaluates it, the validator shall report the pin malformed with a diagnostic naming the offending field and shall report no phase current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-6

Where a phase records external content, the validator shall report that phase current only when every external input carries a well-formed immutable content-addressed identity, and shall report the pin malformed — naming the external input — where an external input is a bare URL or an unvendored mutable reference rather than such an identity; ordinary validation shall not fetch network content ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

### Generation

#### pinning-15

When the build-and-review flow generates a pin for a built and reviewed compiled artifact, it shall record over committed bytes the definition, the compiled `.playbook.ts` artifact entry module, its reviewed artifact-bundle tree directly containing the canonical local FSM, GEARS, and four verification files, the semantic-input closure derived from the definition's `## Pin Inputs`, every local executable runtime dependency outside the bundle, and the link-target identity — recording a widened path boundary when a dependency or link target lies outside the pipeline directory, such as an installed package module — so the written pin validates as current; where an installed package owns a versioned runtime or linked-format contract, the repository's generation flow shall reject a version that differs from both the dependency lock and the accepted contract version; an ordinary pipeline run shall neither generate nor rewrite a pin ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

## Verification

### Presence acceptance

#### pinning-7

Where a fixture pipeline directory has no `slc.pins.json`, when the validator evaluates it, the validator shall report no pins and every phase unpinned, without error [[pinning-1](#pinning-1)].

### Currency acceptance

#### pinning-8

Where fixture pipeline directories' `slc.pins.json` records respectively a transform phase and a portable format-preserving pass such as `optimize` whose map key matches its canonical definition basename, artifact-bundle, and artifact paths, whose definition, compiled `.playbook.ts` artifact, artifact-bundle tree directly containing that entry plus its canonical local FSM, GEARS, and four verification files, semantic inputs, runtime dependencies, link-target identity, semantic-input closure, and external inputs all match the committed files, and whose compiled artifact resolves to the linked `playbook` format, when the validator evaluates each, the validator shall report that phase or pass current [[pinning-2](#pinning-2)].

#### pinning-9

Where a fixture phase's committed definition, compiled artifact, any file in its artifact bundle, semantic input, runtime dependency, or link-target content is changed by any bytes after pinning, or a nearer package changes runtime-dependency resolution, when the validator evaluates it, the validator shall report that phase stale with a diagnostic naming the changed input [[pinning-3](#pinning-3)].

#### pinning-10

Where a fixture phase's recorded semantic-input closure omits or adds a file relative to the definition's `## Pin Inputs` closure, when the validator evaluates it, the validator shall report that phase stale, naming the closure difference [[pinning-4](#pinning-4)].

#### pinning-14

Where a fixture phase's pinned artifact matches its recorded hash but its bytes are not a `playbook` module — they do not expose a `createPlaybookRuntime` factory — when the validator evaluates it, the validator shall report that phase stale [[pinning-13](#pinning-13)].

### Rejection acceptance

#### pinning-11

Where a fixture `slc.pins.json` is a symbolic link or other non-regular file, is not JSON, declares an unsupported schema or hash algorithm, carries an unknown or wrong-typed field, uses a key outside `link` and non-empty portable phase/pass names, maps a phase key to another phase's canonical definition, bundle, or artifact paths, records an empty, backslash-containing, absolute, or boundary-escaping path including a symbolic-link escape, omits or misstates a package runtime dependency's bare import specifier, or records a file hash, tree hash, or link-target identity that is not a well-formed content-addressed digest, when the validator evaluates it, the validator shall report the pin malformed, naming the field, and report no phase current [[pinning-5](#pinning-5)].

#### pinning-12

Where a fixture phase records an external input as a bare URL or an unvendored mutable reference, when the validator evaluates it, the validator shall report the pin malformed, naming the external input, and the validation shall issue no network request [[pinning-6](#pinning-6)].

### Generation acceptance

#### pinning-16

Where a fixture phase's definition, its `## Pin Inputs` closure, a `.playbook.ts` artifact and reviewed artifact bundle directly containing the canonical local FSM, GEARS, and four verification files, its local executable runtime dependencies, and a link target are committed, when the build-and-review flow generates and writes the pin, the validator shall report that phase current [[pinning-15](#pinning-15)].

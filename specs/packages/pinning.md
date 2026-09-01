<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# pinning: Phase Artifact Pin Currency

## Intent

This package specifies SLC-owned semantic-input closure declarations and derivation, explicit build-and-review pin generation, and the host-side validator that decides whether a pipeline's committed compiled-phase pins are current under [DR-007](../decisions/007-slc-phase-artifact-pinning.md) and [DR-026](../decisions/026-slc-owned-pin-input-declarations.md).
Given a pipeline directory, the validator reads `slc.pins.json`, the optional SLC-owned `slc.pin-inputs.json` semantic-input declaration, and the committed inputs they identify, and reports for each pinned phase a verdict of current, stale, or malformed.
It runs no compiled artifact and selects no execution strategy — that is the compiled executor's role under [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) — but beyond existing and matching its recorded hash, the compiled artifact must resolve to the linked `playbook` format, recognized from its committed bytes, or the phase is stale.
Verification exercises generation and validation end-to-end over fixture pipeline directories and ordinary committed files because pin currency is decided from bytes and paths without running a compiled artifact.
Essential project-specific references are `slc`, this project's compiler; the `slc.pins.json` pin file and currency contract of [DR-007](../decisions/007-slc-phase-artifact-pinning.md); and the reserved `slc.link` phase and `playbook` artifact of [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).

## External Behavior

### Presence

#### pinning-1

Where a pipeline directory contains no `slc.pins.json`, when the validator evaluates the pipeline, the validator shall report no pins and treat every phase as unpinned, without raising an error ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

### Currency

#### pinning-17

When closure derivation derives a phase or pass's semantic-input closure, it shall add the separately supplied definition and select the remaining local closure by the applicable declaration case ([DR-026](../decisions/026-slc-owned-pin-input-declarations.md)):

| Declaration case | Remaining local closure |
| --- | --- |
| A well-formed `slc.pin-inputs.json` contains a `closures` entry keyed by the phase or pass name whose lexically normalized absolute host paths are distinct from the definition and one another. | Exactly the entry's complete flattened set of pipeline-relative paths, without transitive expansion from any `## Pin Inputs` section. |
| The sidecar or the keyed entry is absent. | Every path in the definition's `## Pin Inputs` section and the transitive `## Pin Inputs` sections of its local Markdown inputs, terminating at non-Markdown and sectionless Markdown inputs. |

#### pinning-18

Where `slc.pin-inputs.json` is present, when pin generation or pin-currency validation loads it, the loader shall accept only a regular non-symbolic-link strict-JSON file with schema `sublang.slc.pin-inputs.v1`, no unknown fields, and a `closures` object whose keys are `link` or portable phase/pass names and whose values contain only unique literal non-empty relative POSIX-style path locators resolving inside the recorded validation boundary or the requested generation boundary that defaults to the pipeline directory, and shall otherwise refuse generation or report the pin malformed with a diagnostic naming the offending field and no phase current ([DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

#### pinning-2

Where a pipeline directory's `slc.pins.json` is well-formed and, for a phase or format-preserving pass, the portable phase/pass map key requires and matches the recorded definition's portable POSIX basename `<key>.md` and the record's canonical artifact-bundle and artifact paths, the recorded definition, compiled artifact, semantic inputs, and local runtime dependencies each resolve inside the recorded path boundary and match their recorded exact-byte or canonical tree SHA-256 identities, every package runtime-dependency specifier resolves from the compiled entry module to its recorded locator, the compiled artifact is a `.playbook.ts` module that resolves to the linked `playbook` format [[self-hosting-3](self-hosting.md#self-hosting-3)], its recorded artifact-bundle directory directly contains that entry module plus its canonical local FSM, GEARS, and four verification files, has the matching deterministic tree hash, and contains no symbolic links or unsupported entries, the recorded link-target locator resolves and its identity matches the recorded identity, the recorded semantic-input closure equals the closure derived from the applicable declaration [[pinning-17](#pinning-17)], and every recorded external input carries a well-formed immutable content-addressed identity, when the validator evaluates that phase or pass, the validator shall report it current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

#### pinning-3

Where a phase's recorded definition, compiled artifact, artifact bundle, semantic input, runtime dependency, or link target no longer matches its recorded `sha256:` identity, or a package runtime dependency resolves to a different package root — counting any byte difference, including a line-ending change, since the validator applies no content normalization before hashing — when the validator evaluates that phase, the validator shall report it stale with a diagnostic naming the changed input, and shall not report it current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-4

Where a phase's recorded semantic-input closure differs from the closure derived from its applicable sidecar or inline declaration [[pinning-17](#pinning-17)], when the validator evaluates that phase, the validator shall report it stale with a diagnostic naming the closure difference ([DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

#### pinning-13

Where a phase's recorded compiled artifact exists and matches its recorded hash but its committed bytes do not resolve to the linked `playbook` format — a module exposing a `createPlaybookRuntime` factory produced by the reserved `slc.link` phase [[self-hosting-3](self-hosting.md#self-hosting-3)] — when the validator evaluates that phase, the validator shall report it stale, and shall report it current only when the artifact resolves to that format ([DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)).

### Rejection

#### pinning-5

Where `slc.pins.json` is not a regular non-symbolic-link file, is not strict JSON, declares an unsupported schema identifier or hash algorithm, omits a required field, carries an unknown or wrong-typed field, uses a pin-map key other than `link` or a non-empty portable phase/pass name without a path separator, NUL, or ASCII drive prefix and other than `.` or `..`, maps a phase key to another phase's definition, artifact bundle, or artifact paths, records an empty or non-portable path, an absolute path, a path that lexically or through symbolic links escapes the recorded path boundary, omits a package runtime dependency's bare import specifier or records a non-bare one, records a file or tree hash that is not a well-formed `sha256:` digest, or records a link-target identity that is not a well-formed content-addressed identity, when the validator evaluates it, the validator shall report the pin malformed with a diagnostic naming the offending field and shall report no phase current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-6

Where a phase records external content, the validator shall report that phase current only when every external input carries a well-formed immutable content-addressed identity, and shall report the pin malformed — naming the external input — where an external input is a bare URL or an unvendored mutable reference rather than such an identity; ordinary validation shall not fetch network content ([DR-007](../decisions/007-slc-phase-artifact-pinning.md)).

#### pinning-20

Where an applicable sidecar entry contains a member locator whose lexically normalized absolute host path equals the supplied definition's or two distinct literal member locators whose lexically normalized absolute host paths are equal, when closure derivation evaluates that entry, it shall reject the declaration with a diagnostic naming the offending member, so pin generation refuses and pin-currency validation reports malformed with no phase current ([DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

### Generation

#### pinning-15

When the build-and-review flow generates a pin for a built and reviewed compiled artifact, it shall record over committed bytes the definition, the compiled `.playbook.ts` artifact entry module, its reviewed artifact-bundle tree directly containing the canonical local FSM, GEARS, and four verification files, the semantic-input closure derived from the applicable declaration [[pinning-17](#pinning-17)], every local executable runtime dependency outside the bundle, and the link-target identity — recording a widened path boundary when the definition, a semantic input, a dependency, or a link target lies outside the pipeline directory, such as an installed package module — so the written pin validates as current; where an installed package owns a versioned runtime or linked-format contract, the repository's generation flow shall reject a version that differs from both the dependency lock and the accepted contract version; an ordinary pipeline run shall neither generate nor rewrite a pin ([DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

## Verification

### Presence acceptance

#### pinning-7

Where a fixture pipeline directory has no `slc.pins.json`, when the validator evaluates it, the validator shall report no pins and every phase unpinned, without error [[pinning-1](#pinning-1)].

### Currency acceptance

#### pinning-8

Where fixture pipeline directories' `slc.pins.json` records an inline-declared transform phase, a portable format-preserving pass such as `optimize`, and a sidecar-declared phase whose matching-basename definition lies outside the pipeline directory but inside its recorded boundary, whose map keys match their definition basenames and canonical artifact-bundle and artifact paths, whose definition, compiled `.playbook.ts` artifact, artifact-bundle tree directly containing that entry plus its canonical local FSM, GEARS, and four verification files, semantic inputs, runtime dependencies, link-target identity, semantic-input closure, and external inputs all match the committed files, and whose compiled artifact resolves to the linked `playbook` format, when the validator evaluates each, the validator shall report that phase or pass current [[pinning-2](#pinning-2)] under the applicable declaration [[pinning-17](#pinning-17)].

#### pinning-9

Where a fixture phase's committed definition, compiled artifact, any file in its artifact bundle, semantic input, runtime dependency, or link-target content is changed by any bytes after pinning, or a nearer package changes runtime-dependency resolution, when the validator evaluates it, the validator shall report that phase stale with a diagnostic naming the changed input [[pinning-3](#pinning-3)].

#### pinning-10

Where fixture phases' recorded semantic-input closures omit or add a file relative to their applicable sidecar and inline declarations [[pinning-17](#pinning-17)], when the validator evaluates them, the validator shall report each phase stale, naming the closure difference [[pinning-4](#pinning-4)].

#### pinning-14

Where a fixture phase's pinned artifact matches its recorded hash but its bytes are not a `playbook` module — they do not expose a `createPlaybookRuntime` factory — when the validator evaluates it, the validator shall report that phase stale [[pinning-13](#pinning-13)].

### Rejection acceptance

#### pinning-11

Where a fixture `slc.pins.json` is a symbolic link or other non-regular file, is not JSON, declares an unsupported schema or hash algorithm, carries an unknown or wrong-typed field, uses a key outside `link` and non-empty portable phase/pass names, maps a phase key to another phase's canonical definition, bundle, or artifact paths, records an empty, backslash-containing, absolute, or boundary-escaping path including a symbolic-link escape, omits or misstates a package runtime dependency's bare import specifier, or records a file hash, tree hash, or link-target identity that is not a well-formed content-addressed digest, when the validator evaluates it, the validator shall report the pin malformed, naming the field, and report no phase current [[pinning-5](#pinning-5)].

#### pinning-12

Where a fixture phase records an external input as a bare URL or an unvendored mutable reference, when the validator evaluates it, the validator shall report the pin malformed, naming the external input, and the validation shall issue no network request [[pinning-6](#pinning-6)].

### Generation acceptance

#### pinning-16

Where fixture phases include an inline-declared definition and a matching-basename definition outside the pipeline directory whose complete closure is declared by `slc.pin-inputs.json`, and each has a `.playbook.ts` artifact and reviewed artifact bundle directly containing the canonical local FSM, GEARS, and four verification files, local executable runtime dependencies, and a link target committed inside its boundary, when the build-and-review flow generates and writes each pin, the validator shall report both phases current [[pinning-15](#pinning-15)] under the applicable declaration [[pinning-17](#pinning-17)].

#### pinning-19

Where fixture `slc.pin-inputs.json` files exercise a symbolic link, invalid JSON, an unsupported schema, an unknown or wrong-typed field, a non-portable closure key, a duplicate literal closure path, a member locator lexically normalizing to the definition locator, two distinct literal member locators lexically normalizing to one absolute host path, and an empty, absolute, backslash-containing, or boundary-escaping closure path, when pin-currency validation and pin generation process each fixture, the validator shall report the pin malformed with no phase current and the generator shall refuse, each with a diagnostic naming the offending field [[pinning-18](#pinning-18)], [[pinning-20](#pinning-20)].

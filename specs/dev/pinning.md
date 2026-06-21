<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PIN: Phase Artifact Pin Currency

## Intent

This package specifies the host-side validator that decides whether a pipeline's
committed compiled-phase pins are current, per
[DR-007](../decisions/007-slc-phase-artifact-pinning.md).
Given a pipeline directory, the validator reads `slc.pins.json` and the committed
inputs it records, and reports for each pinned phase a verdict of current, stale,
or malformed.
It runs no compiled artifact and selects no execution strategy — that is the
compiled executor's role
([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)) — but beyond
existing and matching its recorded hash, the compiled artifact must resolve to
the linked `phase` format, recognized from its committed bytes, or the phase is
stale.

Essential project-specific references: `slc`, this project's compiler; the
`slc.pins.json` pin file and currency contract of
[DR-007](../decisions/007-slc-phase-artifact-pinning.md); and the reserved
`slc.link` phase and `phase` artifact of
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).

## Presence

### PIN-1

Where a pipeline directory contains no `slc.pins.json`, when the validator evaluates the pipeline, the validator shall report no pins and treat every phase as unpinned, without raising an error ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#pin-file)).

## Currency

### PIN-2

Where a pipeline directory's `slc.pins.json` is well-formed and, for a phase, the recorded definition, compiled artifact, and semantic inputs each resolve inside the recorded path boundary and match their recorded exact-byte SHA-256 hashes, the compiled artifact resolves to the linked `phase` format, the recorded link-target locator resolves and its identity matches the recorded identity, the recorded semantic-input closure equals the closure derived from the definition's `## Pin Inputs` section, and every recorded external input carries a well-formed immutable content-addressed identity, when the validator evaluates that phase, the validator shall report it current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#currency-and-selection)).

### PIN-3

Where a phase's recorded definition, compiled artifact, or semantic input no longer matches its recorded `sha256:` hash, or its link target no longer matches the recorded identity — counting any byte difference, including a line-ending change, since the validator applies no content normalization before hashing — when the validator evaluates that phase, the validator shall report it stale with a diagnostic naming the changed input, and shall not report it current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#hashing-and-portability)).

### PIN-4

Where a phase's recorded semantic-input closure differs from the closure derived from the definition's `## Pin Inputs` section and the transitive `## Pin Inputs` of its local Markdown inputs, when the validator evaluates that phase, the validator shall report it stale with a diagnostic naming the closure difference ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#semantic-input-closure)).

### PIN-13

Where a phase's recorded compiled artifact exists and matches its recorded hash but its committed bytes do not resolve to the linked `phase` format — a module exposing the phase-runner facade produced by the reserved `slc.link` phase — when the validator evaluates that phase, the validator shall report it stale, and shall report it current only when the artifact resolves to that format ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#currency-and-selection), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract)).

## Rejection

### PIN-5

Where `slc.pins.json` is not strict JSON, declares an unsupported schema identifier or hash algorithm, omits a required field, carries an unknown or wrong-typed field, records an absolute path or a path that escapes the recorded path boundary, records a file hash that is not a well-formed `sha256:` digest, or records a link-target identity that is not a well-formed content-addressed identity, when the validator evaluates it, the validator shall report the pin malformed with a diagnostic naming the offending field and shall report no phase current ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#path-resolution), [DR-007](../decisions/007-slc-phase-artifact-pinning.md#hashing-and-portability), [DR-007](../decisions/007-slc-phase-artifact-pinning.md#link-target-identity)).

### PIN-6

Where a phase records external content, the validator shall report that phase current only when every external input carries a well-formed immutable content-addressed identity, and shall report the pin malformed — naming the external input — where an external input is a bare URL or an unvendored mutable reference rather than such an identity; ordinary validation shall not fetch network content ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#external-inputs)).

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-004: SLC Pin Model and Currency Validator

## Goal

Implement the portion of [DR-007](../decisions/007-slc-phase-artifact-pinning.md) that does not depend on running compiled artifacts: the committed `slc.pins.json` model and the host-side pin-currency validator.
The validator loads the pin file, hashes committed bytes, resolves the path boundary, derives and compares the `## Pin Inputs` semantic-input closure, and emits a per-phase verdict of `current`, `stale`, or `malformed` with a diagnostic naming the changed input or malformed field.
This is a standalone, deterministic, `slc`-side library; it changes no runtime execution behavior, so every phase still interprets.

- Context: [DR-007](../decisions/007-slc-phase-artifact-pinning.md) settles pinning; [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) defines compiled artifacts, the reserved `slc.link` phase, the `phase` format, and strategy selection; and a dedicated capability DR defines the artifact-facing file capability.
- State today: `slc` has no pinning code and no compiled executor; the `PhaseExecutor` seam exists with only the interpreted executor, so every phase interprets.
- Why a validator is implementable alone: pin currency is computed from committed bytes and definitions, which `slc` reads directly; it needs neither the compiled executor nor the host-supplied file capability (which sandboxes the artifact at run time, not the host-side validator).
- Constraint: additive library only — the `runSlc` core, the interpreted executor, and the execution boundary ([DR-003](../decisions/003-slc-phase-execution.md)) are untouched.
- Out of scope (deferred to later IRs; most blocked on the DR-005 compiled executor and meta-pipeline):
  - compiled execution, the `PhaseRunner` facade, `slc.link`, and the `phase` format;
  - the package-manager integrity-digest link-target identity that [DR-007](../decisions/007-slc-phase-artifact-pinning.md#link-target-identity) permits for directory or package targets; this iteration's validator recomputes only a `sha256:` content or tree hash and does not yet validate integrity-digest identities, deferring that support to a later IR;
  - wiring the verdict into runtime strategy selection (no pin → interpret, current → run compiled, stale/malformed → fail closed);
  - pin generation and the build-and-review flow that writes pins;
  - the currency sub-check that the artifact "resolves to the linked `phase` format" (the validator does existence and exact-byte hash only, deferring format resolution to when the `phase` format lands);
  - the `FileCapability`, deferred to a dedicated capability DR, which the host-side validator does not use.

## Deliverables

- [x] A `PINNING` spec package (`dev`, `test`), short form `PIN`, registered in `map.md`
- [x] A strict `slc.pins.json` model and parser — schema identifier, hash algorithm, `pathBoundary`, and the phase-to-record map — that rejects a malformed file with a diagnostic naming the field
- [x] Exact-byte SHA-256 hashing written as `sha256:` plus 64 lowercase hex, with no content transformation, and path-boundary resolution: relative POSIX paths from the pipeline directory, absolute paths rejected, `..` allowed only inside the recorded boundary
- [x] Semantic-input closure derivation from each definition's `## Pin Inputs` section (transitive, terminating at non-Markdown or sectionless inputs) and the check that the recorded closure matches it
- [x] A currency engine producing a per-phase `current`/`stale`/`malformed` verdict with a diagnostic naming the stale input or malformed field, covering external-input well-formedness and link-target identity over committed bytes
- [x] Integration/acceptance tests over fixture pipeline directories: current, each stale variant, malformed variants, and an absent pin file

## Tasks

1. **Author the `PINNING` spec package (`dev`, `test`).**
   Write `specs/dev/pinning.md` (pin-file presence and the no-pins case; strict schema and supported hash algorithm; exact-byte hashing format; path-boundary resolution and absolute/escape rejection; the semantic-input closure and the closure-match check; the per-phase currency verdict with fail-closed `stale`/`malformed` reasons; external-input well-formedness without network fetch; link-target identity over committed bytes; and an explicit note that the artifact-format-resolution check and runtime strategy selection are deferred to the compiled executor) and `specs/test/pinning.md` (integration items, each with a `Verifies:` line per [META-20](../meta.md#meta-20)/[META-21](../meta.md#meta-21)).
   Reference [DR-007](../decisions/007-slc-phase-artifact-pinning.md) in the package `## Intent`, citing [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and [DR-003](../decisions/003-slc-phase-execution.md) in preconditions where relevant.
   Register the `PIN` package in `map.md` and add SPDX headers per [LIC-1](../dev/licensing.md#lic-1)/[LIC-2](../dev/licensing.md#lic-2).

2. **Pin-file model and strict parser.**
   Implement a typed model of `slc.pins.json` and a strict-JSON parser validating the schema identifier, the hash algorithm, the optional `pathBoundary`, and each phase record's shape (`artifact`, `definition`, `semanticInputs`, `externalInputs`, `linkTarget`, `producer`), with the reserved `link` key for the link phase.
   Reject an unsupported schema/algorithm, an unknown field, or a wrong-typed field with a diagnostic naming the field; an absent file yields an empty pin set.
   Unit-test the valid, absent, unsupported-schema, unknown-field, and bad-shape cases.

3. **Hashing and path-boundary resolution.**
   Implement exact-byte SHA-256 hashing emitted as `sha256:<64 lowercase hex>` with no line-ending or text normalization, and path-boundary resolution that maps each pin path as a relative POSIX path from the pipeline directory, rejects absolute paths, defaults `pathBoundary` to `.`, and permits `..` only when the resolved path stays inside the recorded boundary.
   Unit-test hash determinism and format, absolute rejection, boundary escape, and an in-boundary `..`.

4. **Semantic-input closure.**
   Parse a definition's `## Pin Inputs` section, derive the transitive local closure (the definition file plus each cited local Markdown input that itself declares `## Pin Inputs`, terminating at non-Markdown inputs and Markdown inputs without the section), and compare the derived closure to the pin's recorded `definition` plus `semanticInputs`.
   Unit-test closure derivation, transitivity, termination, and a recorded-vs-derived mismatch.

5. **Currency engine.**
   Combine the checks into a per-phase verdict: supported schema/algorithm; every local path inside the boundary; definition exists and hash matches; artifact exists and hash matches (format resolution deferred); every semantic input exists and hash matches; recorded closure matches the derived closure; every external input carries a well-formed immutable content-addressed identity without any network fetch; the `linkTarget` locator resolves and its identity matches the committed content (file content hash, or directory or package tree hash; integrity-digest identities deferred).
   Emit `current`, `stale` with the offending input, or `malformed` with the offending field; a phase absent from the pin file is unpinned.
   Unit-test that each failing check yields the expected verdict and names its input or field.

6. **Acceptance tests over fixtures.**
   Implement the Task 1 test items against fixture pipeline directories: a fully-matching pin validates `current`; mutating the definition, a semantic input, the artifact, or a link-target identity yields `stale` naming it; a closure mismatch yields `stale`; an unsupported schema, unknown field, wrong-typed field, or absolute/escaping path yields `malformed` naming the field; and an absent `slc.pins.json` yields no pins without error.

## Acceptance criteria

- Where a pipeline directory holds an `slc.pins.json` whose recorded inputs all match the committed files, the validator reports every pinned phase `current`.
- Changing a definition, a semantic input, the artifact, or a link-target's committed identity makes that phase `stale` with a diagnostic naming the changed input, and a recorded closure differing from the definition's `## Pin Inputs` closure is `stale`.
- A malformed pin file — unsupported schema or hash algorithm, unknown field, wrong-typed field, or absolute or boundary-escaping path — is `malformed` with a diagnostic naming the field, and ordinary validation performs no network fetch.
- An absent `slc.pins.json` yields no pins, with every phase unpinned and no error.
- The validator is deterministic and `slc`-side; compiled execution, runtime strategy selection, pin generation, and the file capability remain out of scope, and the `runSlc` core, the interpreted executor, and the execution boundary are unchanged.

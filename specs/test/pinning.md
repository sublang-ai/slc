<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PIN: Phase Artifact Pin Currency

## Intent

This package specifies integration and system acceptance tests for the pin
validator in the `pinning` dev package, evaluating fixture pipeline directories
end-to-end over a committed `slc.pins.json` and the inputs it records.
The fixtures use ordinary committed files for each recorded input, since the
validator decides currency from bytes and paths and runs no compiled artifact.

Essential project-specific references: `slc`, this project's compiler; and the
`slc.pins.json` pin file of
[DR-007](../decisions/007-slc-phase-artifact-pinning.md).

## Presence

### PIN-7
Verifies: [PIN-1](../dev/pinning.md#pin-1)

Where a fixture pipeline directory has no `slc.pins.json`, when the validator evaluates it, the validator shall report no pins and every phase unpinned, without error.

## Currency

### PIN-8
Verifies: [PIN-2](../dev/pinning.md#pin-2)

Where a fixture pipeline directory's `slc.pins.json` records a phase whose definition, compiled artifact, semantic inputs, link-target identity, semantic-input closure, and external inputs all match the committed files, when the validator evaluates it, the validator shall report that phase current.

### PIN-9
Verifies: [PIN-3](../dev/pinning.md#pin-3)

Where a fixture phase's committed definition, compiled artifact, semantic input, or link-target content is changed by any bytes after pinning, when the validator evaluates it, the validator shall report that phase stale with a diagnostic naming the changed input.

### PIN-10
Verifies: [PIN-4](../dev/pinning.md#pin-4)

Where a fixture phase's recorded semantic-input closure omits or adds a file relative to the definition's `## Pin Inputs` closure, when the validator evaluates it, the validator shall report that phase stale, naming the closure difference.

## Rejection

### PIN-11
Verifies: [PIN-5](../dev/pinning.md#pin-5)

Where a fixture `slc.pins.json` is not JSON, declares an unsupported schema or hash algorithm, carries an unknown or wrong-typed field, records an absolute or boundary-escaping path, or records a file hash or link-target identity that is not a well-formed content-addressed digest, when the validator evaluates it, the validator shall report the pin malformed, naming the field, and report no phase current.

### PIN-12
Verifies: [PIN-6](../dev/pinning.md#pin-6)

Where a fixture phase records an external input as a bare URL or an unvendored mutable reference, when the validator evaluates it, the validator shall report the pin malformed, naming the external input, and the validation shall issue no network request.

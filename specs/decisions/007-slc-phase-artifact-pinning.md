<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-007: SLC Phase Artifact Pinning

## Status

Accepted

## Context

[DR-005](005-slc-self-hosting-meta-pipeline.md) defines compiled phase artifacts but defers the concrete pinning contract.
With this pinning contract and the file capability contract ([DR-008](008-slc-file-capability.md)) both settled, compiled selection follows [DR-005](005-slc-self-hosting-meta-pipeline.md#strategy-selection).
This DR settles only pinning: how a pipeline records a compiled phase artifact, the inputs that produced it, and the checks that make the pin current.
The concrete `FileCapability` shape and any structured tool port are settled by [DR-008](008-slc-file-capability.md).

Interpreted execution remains the reference semantics of a phase definition per [DR-004](004-slc-interpreted-phase-execution.md).
A current pin therefore certifies that a committed compiled artifact is still tied to the current phase definition and the semantic input closure an interpreted run may read.
Runtime sources, objects, options, and runtime link targets are ordinary run inputs guarded by [DR-003](003-slc-phase-execution.md), not pin inputs.

## Decision

### Pin file

Each pipeline directory may contain one committed pin file named `slc.pins.json`.
The pipeline directory is the directory resolved for the domain pipeline, not the reserved `slc` meta-pipeline unless the meta-pipeline itself is being pinned.
If `slc.pins.json` is absent, the pipeline has no pins and every phase is interpreted.
If the file is present, it is the selection index for compiled execution in that pipeline.

The file shall be strict JSON with a schema identifier, a hash algorithm, and a map from phase name to pin record.
The reserved key `link` represents the pipeline's `link.md` phase.

```json
{
  "schema": "sublang.slc.pins.v1",
  "hashAlgorithm": "sha256",
  "pathBoundary": {
    "path": "."
  },
  "pins": {
    "text2gears": {
      "artifact": {
        "path": "text2gears.slc/text2gears.playbook.ts",
        "hash": "sha256:<hex>"
      },
      "definition": {
        "path": "text2gears.md",
        "hash": "sha256:<hex>"
      },
      "semanticInputs": [
        {
          "path": "reference/gears.md",
          "hash": "sha256:<hex>",
          "role": "reference"
        }
      ],
      "externalInputs": [],
      "linkTarget": {
        "kind": "file",
        "locator": "reference/sdlc/code.playbook/code.playbook.ts",
        "identity": "sha256:<hex>",
        "provenance": "playbook-runtime name-or-version if available"
      },
      "producer": {
        "pipeline": "slc",
        "slcVersion": "optional",
        "metaPipelineRevision": "optional"
      }
    }
  }
}
```

The `producer` object is provenance only.
It shall not be a currency input, because equivalence is judged against the current definition and recorded inputs, not against the compiler version that emitted an already reviewed artifact.

### Hashing and portability

Pin hashes shall use SHA-256 over exact file bytes and shall be written as `sha256:` followed by 64 lowercase hexadecimal characters.
The hash algorithm name is recorded for schema agility.
The validator shall not normalize line endings, parse text, or otherwise transform content before hashing.

A repository or workspace that commits pins shall enforce stable checkout bytes for pinnable text inputs and artifacts, normally with `.gitattributes`.
This portability requirement prevents routine checkout policy differences from making every pinned text artifact stale while preserving exact-byte identity for validation.

### Path resolution

All pin paths shall be relative POSIX-style paths resolved from the pipeline directory that contains `slc.pins.json`.
Absolute paths shall be rejected.
The pin file records one `pathBoundary` as a relative POSIX-style path from the pipeline directory; when absent, it defaults to `.` and means the pipeline directory.
Every local pin path shall resolve inside that recorded boundary.
Relative paths containing `..` are allowed only when `pathBoundary.path` records a wider boundary that contains the resolved path.
Validators shall not depend on an unrecorded host workspace root to decide whether a committed pin path is valid.
Hosts may still reject a pin whose recorded boundary violates host policy, but that is an environment refusal rather than pin currency.

The artifact path shall identify a linked `playbook` artifact produced by the reserved `slc.link` phase.
It shall resolve to the `playbook` linked format declared by the reserved meta-pipeline link phase.

### Semantic input closure

The semantic input closure for a pinned phase is:

- the phase definition file, or `link.md` for the reserved link phase;
- every local file explicitly named by the definition's `## Pin Inputs` section;
- every transitive local file explicitly named by a pinned input's own `## Pin Inputs` section, where that input format supports the section.

The definition file is always an input and is recorded separately from `semanticInputs`.
The `semanticInputs` array records the remaining local closure files with a path, hash, and role.
Roles are descriptive metadata for review and diagnostics; they do not change currentness.

`## Pin Inputs` is the precise citation mechanism for pinnability.
A phase definition that depends on referenced content outside its definition but does not declare that content in `## Pin Inputs` is interpretable but not pinnable.
Non-Markdown inputs and Markdown inputs without `## Pin Inputs` terminate transitive closure.

At build time, the meta-pipeline should derive a candidate closure for review where possible.
The committed pin remains explicit and reviewable, because an omitted semantic input is the primary way a pin could appear current while diverging from interpretation.

### External inputs

Mutable external references shall not be currentness inputs by URL alone.
If a phase depends on external content, that content shall either be vendored or snapshotted into a local hashed semantic input, or identified by an immutable content-addressed reference whose digest binds the bytes.
A phase depending on unvendored mutable external content is not pinnable and remains interpreted.

The `externalInputs` array is reserved for immutable content-addressed references and provenance.
A bare URL in `externalInputs` shall not make a pin current.
Ordinary currency validation shall not fetch mutable network content.
For immutable content-addressed external inputs, currentness means the committed pin contains a well-formed immutable identity; any later unavailability of the external source is a liveness failure that vendoring avoids, not a currency change.

### Link-target identity

The `linkTarget` record identifies the exact target consumed by `slc.link` when producing the phase artifact.
Its `locator` names the file, directory, package, or other immutable source of the consumed target, and its `identity` records the consumed content.
For a file target, the identity shall be a content hash of the consumed bytes.
For a directory or package target, the identity shall be a deterministic tree hash or package-manager integrity digest of the consumed content.
Names and versions such as `name@version` may be recorded as provenance but shall not stand alone as currentness identity.

The runtime `linkTarget` passed to a compiled link phase in `PhaseInput` remains a run input.
It is not part of the producing pin.

### Currency and selection

A pin is current only when all of these checks pass:

- the pin file schema and hash algorithm are supported;
- every local pin path resolves inside the recorded path boundary;
- the phase definition path exists and its hash matches;
- the compiled artifact path exists, its hash matches, and it resolves to the linked `playbook` format;
- every local semantic input path exists and its hash matches;
- the semantic input closure set recorded in the pin matches the definition's declared `## Pin Inputs` closure;
- every immutable external input, if any, has a well-formed immutable content-addressed identity;
- the `linkTarget` locator can be resolved and its identity matches the content consumed by the reserved `slc.link` target.

When a phase has no pin, `slc` shall interpret it.
When a phase has a current pin, `slc` shall run the compiled artifact.
When a phase has a malformed, missing, or stale pin, `slc` shall fail with a diagnostic naming the stale input or malformed field and shall not silently interpret that phase.

### Lifecycle

`slc` shall not regenerate compiled artifacts or pins during ordinary pipeline runs.
Pins are written or updated only as part of an explicit build and review flow for the compiled artifact.
The artifact and its pin are committed together per pipeline version.

## Consequences

- Compiled selection is explicit and reproducible: a pinned phase runs the reviewed artifact only while its producing inputs still match.
- Stale pins fail closed, so a pinned pipeline does not silently change execution strategy.
- The central pin file gives reviewers and `slc` one deterministic index of pinned phases in a pipeline.
- Exact-byte hashes make the validator simple and conservative, while `.gitattributes` or equivalent checkout policy is required for cross-platform stability of pinned text files.
- External mutable content must be snapshotted or content-addressed before a phase can be pinned.
- The compiler version remains auditable without forcing churn across all pins on every meta-pipeline change.
- Compiled selection follows [DR-005](005-slc-self-hosting-meta-pipeline.md#strategy-selection) now that the pinning and file capability ([DR-008](008-slc-file-capability.md)) contracts both exist; an unpinned phase interprets per [DR-004](004-slc-interpreted-phase-execution.md).

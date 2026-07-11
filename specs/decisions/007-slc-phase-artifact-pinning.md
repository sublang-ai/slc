<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-007: SLC Phase Artifact Pinning

## Status

Accepted

## Context

[DR-005](005-slc-self-hosting-meta-pipeline.md) defines compiled phase artifacts but defers the concrete pinning contract.
With this pinning contract settled, compiled selection follows [DR-005](005-slc-self-hosting-meta-pipeline.md#strategy-selection).
This DR settles only pinning: how a pipeline records a compiled phase artifact, the inputs that produced it, and the checks that make the pin current.

Interpreted execution remains the reference semantics of a phase definition per [DR-004](004-slc-interpreted-phase-execution.md).
A current pin therefore certifies that a committed compiled artifact is still tied to the current phase definition and the semantic input closure an interpreted run may read.
Runtime sources, objects, options, and runtime link targets are ordinary run inputs guarded by [DR-003](003-slc-phase-execution.md), not pin inputs.

## Decision

### Pin file

Each pipeline directory may contain one committed pin file named `slc.pins.json`.
The pipeline directory is the directory resolved for the domain pipeline, not the reserved `slc` meta-pipeline unless the meta-pipeline itself is being pinned.
If `slc.pins.json` is absent, the pipeline has no pins and every phase is interpreted.
If the file is present, it is the selection index for compiled execution in that pipeline.
The present index shall be a regular file and shall not be a symbolic link.

The file shall be strict JSON with a schema identifier, a hash algorithm, and a map from phase name to pin record.
The reserved key `link` represents the pipeline's `link.md` phase.
Each map key shall bind to that phase's canonical definition, artifact bundle, and linked entry paths (`<phase>.md`, `<phase>.slc`, and `<phase>.slc/<phase>.playbook.ts`); swapping otherwise-current records shall therefore be malformed rather than selecting another phase's compiled semantics.

```json
{
  "schema": "sublang.slc.pins.v2",
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
      "artifactBundle": {
        "path": "text2gears.slc",
        "hash": "sha256:<tree-hex>"
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
      "runtimeDependencies": [
        {
          "kind": "package",
          "locator": "../../node_modules/xstate",
          "specifier": "xstate",
          "identity": "sha256:<tree-hex>",
          "provenance": "xstate@<version>"
        }
      ],
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
Tree hashes shall use this canonical byte framing:

- one compact JSON array per entry with no insignificant whitespace: `["file","<relative-posix-path>","sha256:<exact-byte-hash>"]` for a file, or `["symlink","<relative-posix-path>","<lowercase-hex-raw-link-target-bytes>"]` for a recorded symbolic link;
- each JSON string shall escape `"` and `\\` with one preceding backslash, encode every U+0000 through U+001F control character as lowercase `\\u00xx`, leave every other Unicode scalar value unescaped, and reject unpaired surrogates; the resulting scalar values are encoded as UTF-8, so optional JSON escapes and ASCII-only substitutions are not equivalent encodings;
- records sorted by the bytewise order of their UTF-8 relative paths, joined by one LF byte with no trailing LF, then hashed as exact UTF-8 bytes with SHA-256;
- the empty tree hashes the empty byte string;
- a root symbolic link, where allowed, contributes the relative path `.` and the files reached through that directory root are also recorded; a nested symbolic link contributes its link-target record and is not traversed.

Tree entry names shall be valid UTF-8 and shall be rejected rather than decoded lossily, so distinct raw filesystem names cannot collapse to the same serialized path.

Artifact-bundle tree hashing shall reject every symbolic link and other non-file/non-directory entry.
Directory and package link targets or runtime dependencies shall record symbolic-link targets with the canonical symlink record rather than ignore or reject them.

A repository or workspace that commits pins shall enforce stable checkout bytes for pinnable text inputs and artifacts, normally with `.gitattributes`.
This portability requirement prevents routine checkout policy differences from making every pinned text artifact stale while preserving exact-byte identity for validation.

### Path resolution

All pin paths shall be relative POSIX-style paths resolved from the pipeline directory that contains `slc.pins.json`.
Absolute paths shall be rejected.
Empty paths, NUL bytes, and backslashes shall be rejected so a committed pin resolves identically on POSIX and Windows hosts.
The pin file records one `pathBoundary` as a relative POSIX-style path from the pipeline directory; when absent, it defaults to `.` and means the pipeline directory.
Every local pin path shall resolve inside that recorded boundary.
Relative paths containing `..` are allowed only when `pathBoundary.path` records a wider boundary that contains the resolved path.
Validators shall not depend on an unrecorded host workspace root to decide whether a committed pin path is valid.
Hosts may still reject a pin whose recorded boundary violates host policy, but that is an environment refusal rather than pin currency.

The artifact path shall identify the canonical `.playbook.ts` linked `playbook` entry module produced by the reserved `slc.link` phase.
It shall resolve to the `playbook` linked format declared by the reserved meta-pipeline link phase.
The artifact-bundle path shall identify the reviewed artifact directory directly containing that entry module and its canonical local FSM, GEARS, GEARS↔FSM, FSM-introspection, prompt-contract, and FSM-coverage files, so changing a runtime dependency beside the entry module makes the pin stale even when the entry module's own bytes do not change.

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

### Runtime dependencies

The `runtimeDependencies` array records local executable files, directories, or packages that the compiled artifact imports but that are not files inside its reviewed artifact bundle.
Each entry uses the link-target `kind`, `locator`, `identity`, and optional `provenance` shape, resolves within the recorded path boundary, and is a currentness input.
The array is required even when empty, so a v2 record explicitly attests that its reviewed artifact has no out-of-bundle executable dependency.
A package dependency shall also record its bare import `specifier`; generation and validation shall resolve that specifier from the compiled entry module and require the selected package root to equal the recorded locator, so adding a nearer shadow package makes the pin stale.
For the reviewed Playbook meta artifacts this includes the installed XState package, while the dependency lock is also a local semantic input so both intended and installed runtime dependency identity are bound.

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
- the compiled artifact path identifies the bundle's direct-child `.playbook.ts` entry module, exists, its hash matches, and it resolves to the linked `playbook` format;
- the artifact-bundle directory exists, directly contains the entry module and its canonical local FSM, GEARS, GEARS↔FSM, FSM-introspection, prompt-contract, and FSM-coverage files, contains no symbolic links or other unsupported entries, and its deterministic tree hash matches;
- every local semantic input path exists and its hash matches;
- the semantic input closure set recorded in the pin matches the definition's declared `## Pin Inputs` closure;
- every immutable external input, if any, has a well-formed immutable content-addressed identity;
- every local runtime dependency, if any, exists and matches its recorded file or canonical tree identity;
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
- Compiled selection follows [DR-005](005-slc-self-hosting-meta-pipeline.md#strategy-selection) now that the pinning contract exists; an unpinned phase interprets per [DR-004](004-slc-interpreted-phase-execution.md).

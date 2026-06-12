<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-003: SLC Phase Execution Boundary

## Status

Accepted

## Context

[DR-001](001-slc-pipeline-layout-naming-invocation.md) defines ordinary pipeline layout, phase ordering, format declarations, source naming, and artifact locations.
[DR-002](002-slc-link-phases.md) defines reserved link phases and link-target invocation.

Phase definitions are markdown files that describe semantic transformations.
Some transformations require judgment suitable for a coding agent; others, including verification steps, may be deterministic scripts or tools.

`slc` needs a clear boundary between generic pipeline mechanics and phase-specific execution.
Without that boundary, phase-specific rules leak into the `slc` command as hard-coded validators, prompt fragments, or repair loops.
That would make new phases require command changes and create duplicate sources of truth.

This DR fixes that boundary.
How a phase actually runs is a separate decision: interpreted ([DR-004](004-slc-interpreted-phase-execution.md)) or compiled ([DR-005](005-slc-self-hosting-meta-pipeline.md)).

## Decision

### Generic vs phase-specific

The `slc` command shall perform generic pipeline mechanics only.
It shall not contain phase-specific transformation rules, phase-specific prompt notes, or phase-specific semantic validators.

The phase definition file shall be the semantic source of truth for an ordinary compile phase.
The pipeline's `link.md` shall be the semantic source of truth for a link phase.

A phase shall be executed either by interpreting its definition directly ([DR-004](004-slc-interpreted-phase-execution.md)) or by a compiled runnable artifact ([DR-005](005-slc-self-hosting-meta-pipeline.md)).
Both strategies shall honor this boundary; the choice of strategy shall not change what `slc` validates or how artifacts are placed.

Every executing phase, interpreted or compiled, shall write only its declared target or linked artifact.
It shall not modify sources, phase or link definitions, specs, object artifacts, link targets, or unrelated files.
Scratch space that does not persist past the run is not a write under this rule; ensuring it does not persist is the executing phase's responsibility.

### `slc` responsibilities

For ordinary compile phases, `slc` shall use [DR-001](001-slc-pipeline-layout-naming-invocation.md) and phase `## Formats` metadata to:

- resolve the pipeline directory and phase files;
- validate phase filename and `## Formats` consistency;
- infer and validate the linear phase chain;
- validate source filename conventions;
- compute canonical artifact paths;
- run the phase against its source and target path;
- validate generic checks.

For link phases, `slc` shall use [DR-002](002-slc-link-phases.md) and `link.md` metadata to:

- resolve ordered object artifacts and the link target;
- pass `--link-option` values to the link execution;
- compute the linked-artifact path;
- run the link against its objects and target path;
- validate generic checks.

### Generic checks

Generic checks are checks derivable without domain knowledge.
They include output postconditions:

- the expected target artifact exists;
- the target artifact extension matches the declared target extension.

They also include defensive integrity checks for inputs and pipeline metadata that an executing phase is not allowed to modify:

- the source, any object inputs, and the link target are unchanged from before the run;
- the pipeline chain remains valid.

These checks defend the inputs whose silent mutation would corrupt later phases; they do not prove the full write scope.
`slc` or its host may additionally enforce that scope with sandboxes, snapshots, or write allowlists, and a write-scope violation detected by any means shall fail like a failed generic check.

Any semantic or format-aware verification beyond generic checks shall belong to the phase or link definition.
The executing phase carries out that verification while following the definition; it is not a separate opaque hook executed by `slc`.

### Blocked protocol

An executing phase may resolve benign ambiguity when doing so does not change domain semantics, and shall report any ambiguity it resolves.

When the source, object artifacts, link target, or options are malformed under the applicable definition, or the definition is incompatible with the inputs, the executing phase shall stop and report `BLOCKED` with concrete diagnostics.
It shall not guess through semantic incompatibility.

When an executing phase reports `BLOCKED`, or a generic check fails, `slc` shall stop the pipeline and emit a failure report naming the phase, target path, and reasons.

## Consequences

- New phases are introduced by adding phase definition files rather than changing the `slc` command.
- Phase definitions remain the only home for domain rules, reducing drift between specs, prompts, and validators.
- `slc` remains responsible for generic pipeline mechanics and artifact placement.
- Semantic correctness depends on the executing phase following its definition.
- Interpreted and compiled execution ([DR-004](004-slc-interpreted-phase-execution.md), [DR-005](005-slc-self-hosting-meta-pipeline.md)) plug into the same boundary without changing `slc`.

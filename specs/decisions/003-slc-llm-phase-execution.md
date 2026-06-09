<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-003: SLC LLM Phase Execution

## Status

Accepted

## Context

[DR-001](001-slc-pipeline-layout-naming-invocation.md) defines ordinary pipeline layout, phase ordering, format declarations, source naming, and artifact locations.
[DR-002](002-slc-link-phases.md) defines reserved link phases and link-target invocation.

Phase definitions are markdown files that describe semantic transformations.
Some transformations, such as natural language to GEARS or GEARS to an FSM, require judgment that is suitable for a coding-agent LLM.

`slc` needs a clear boundary between deterministic orchestration work and LLM-executed semantic work.
Without that boundary, phase-specific rules can leak into the driver as hard-coded validators, prompt fragments, or repair loops.
That would make new phases require driver changes and create duplicate sources of truth.

## Decision

### Boundary

The `slc` compiler process shall include a domain-blind deterministic driver and an LLM coding-agent phase worker.
The driver shall not contain phase-specific transformation rules, phase-specific prompt notes, or phase-specific semantic validators.
The phase worker is the part of the compiler process that applies phase-specific semantic rules.

The phase definition file shall be the semantic source of truth for an ordinary compile phase.
The pipeline's `link.md` shall be the semantic source of truth for a link phase.

For ordinary compile phases, the driver shall use [DR-001](001-slc-pipeline-layout-naming-invocation.md) and phase `## Formats` metadata to:

- resolve the pipeline directory and phase files;
- validate phase filename and `## Formats` consistency;
- infer and validate the linear phase chain;
- validate source filename conventions;
- compute canonical artifact paths;
- prompt and invoke the phase worker;
- validate generic checks.

For link phases, the driver shall use [DR-002](002-slc-link-phases.md) and `link.md` metadata to:

- resolve ordered object artifacts and the link target;
- pass `--link-option` values to the link worker;
- compute the linked-artifact path;
- prompt and invoke the link worker;
- validate generic checks.

Generic checks are checks derivable without domain knowledge.
They include output postconditions:

- the expected target artifact exists;
- the target artifact extension matches the declared target extension;

They also include defensive integrity checks for inputs and pipeline metadata that the worker was not allowed to modify:

- the source remains valid for the consuming phase;
- the pipeline chain remains valid.

Any semantic or format-aware verification beyond those generic checks shall belong to the phase or link definition.
The coding agent carries out that verification while following the definition, including running concrete commands with its own tools when the definition calls for them; the deterministic driver does not execute phase-authored commands.
The worker shall report command failures or unavailable tools as diagnostics, or as `BLOCKED` when they prevent faithful compilation.

### Agent execution

Within this DR's scope, `slc` shall invoke one coding agent once per ordinary compile phase.
The coding agent shall compile exactly one phase from one source artifact to one target artifact.

Within this DR's scope, `slc` shall invoke one coding agent once per link phase.
The coding agent shall link ordered object artifacts, a link target, and link options into one linked artifact.

The coding agent shall read the phase definition or link definition by path and follow any references it cites.
The driver is not required to inline phase definitions or source artifacts into prompts.

The coding agent prompt shall establish this contract:

- the phase or link definition is authoritative;
- the worker writes only the requested target or linked artifact;
- the worker does not edit sources, phase definitions, specs, link targets, object artifacts, or unrelated files;
- the worker does not commit;
- the worker produces a complete artifact, not a sketch;
- the worker adds no domain semantics except those the source implies or the definition requires, and drops nothing the source states;
- the worker preserves verbatim content wherever the definition requires it;
- the worker verifies the produced artifact against the definition before finishing;
- the worker reports a concise summary and diagnostics.

### Blocked protocol

The coding agent may resolve benign ambiguity when doing so does not change domain semantics.
It shall report any ambiguity it resolves.

When the source, object artifacts, link target, or options are malformed under the applicable definition, or when the applicable definition is incompatible with the inputs, the coding agent shall stop and report `BLOCKED` with concrete diagnostics.
It shall not guess through semantic incompatibility.

When a worker reports `BLOCKED`, or a generic check fails, `slc` shall stop the pipeline and emit a failure report naming the phase, target path, and reasons.
Automatic multi-call audit and repair orchestration is out of scope for this DR.

## Consequences

- New phases can be introduced by adding phase definition files rather than changing the driver.
- Phase definitions remain the only home for domain rules, reducing drift between specs, prompts, and validators.
- The driver remains responsible for deterministic pipeline mechanics and artifact placement.
- Semantic correctness depends on the phase worker following the phase definition's transformation and verification instructions.
- This DR favors a minimal one-agent execution model; later designs may add audit or repair orchestration without changing the driver/domain boundary.

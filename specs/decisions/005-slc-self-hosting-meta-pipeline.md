<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-005: SLC Self-Hosting Meta-Pipeline

## Status

Accepted

## Context

Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) is the default but re-runs the agent on every invocation and gives a phase no fixed, inspectable control flow.
A phase benefits from compilation when it wants determinism, speed, fixed and auditable control flow, or per-step model binding — for example a phase with internal draft-then-verify structure.
`slc` can compile phase definitions with the same pipeline machinery it uses for any pipeline, making the compiler self-hosting.

This DR builds on [DR-003](003-slc-phase-execution.md) and [DR-004](004-slc-interpreted-phase-execution.md): interpreted execution stays the reference semantics and the fallback, and compiled execution is a later layer that does not change the execution boundary.
Implementation sequencing across these DRs is tracked in iteration records, not in this DR.

## Decision

### Reserved `slc` pipeline

The pipeline name `slc` shall be reserved for the meta pipeline that compiles phase and link definitions into runnable phase artifacts.
Its phase definitions are distinct from any domain pipeline's like-named phases: their source is a phase or link definition rather than a domain workflow, so a single `slc.text2gears` accepts any phase definition (for example `text2gears.md`, `gears2fsm.md`, or `link.md`).
Where the `slc` pipeline directory resolves from is consumer-defined per [DR-001](001-slc-pipeline-layout-naming-invocation.md).

When `slc` is invoked without an explicit pipeline argument, the command shall use the `slc` pipeline.
`slc <source>` is equivalent to `slc slc <source>`, and `slc slc.<phase> <source>` runs one named phase per [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli).
This amends the [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli) grammar to make `<pipeline>` optional with default `slc`.
Because a pipeline run always takes a source, a single positional is the source under the default pipeline and a leading positional before the source is the explicit pipeline, so the form stays unambiguous.

The `slc` pipeline shall chain `text2gears` (`text` `.md` to `gears` `.md`) and `gears2fsm` (`gears` `.md` to `fsm` `.ts`), plus a reserved `link.md` link phase (`fsm` `.ts` to `phase` `.ts`) per [DR-002](002-slc-link-phases.md).
Each phase's transformation rules live in its own definition, not in this DR.
This DR constrains only the properties self-hosting depends on:

- `gears2fsm` shall preserve the GEARS-to-phase mapping in machine-readable form, so a generated phase artifact can be audited against its phase definition.
- The link phase shall emit the distinct `phase` linked format, whose runnable artifact exposes the interface `slc` needs to run that phase against its declared inputs and output path. Per [DR-002](002-slc-link-phases.md#cli), full-pipeline invocation without `--link` stops at the `fsm` object artifact.

### Compiled phase execution

A non-`slc` pipeline may execute its phases through compiled phase artifacts produced by the `slc` pipeline.
Compilation is chosen for phases that need fixed control flow, statefulness, or determinism.
Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) remains available for all other phases and as the fallback.

A compiled phase artifact shall be behavior-equivalent to interpreting its definition, per the [DR-004](004-slc-interpreted-phase-execution.md) reference semantics.

### Artifact stability

Because `slc.gears2fsm` is itself a judgment-based transformation, a phase artifact is a generated program.
Phase artifacts shall be built once, reviewed, committed, and pinned per pipeline version.
`slc` shall not regenerate them per invocation.

### Locations

Artifacts for the `slc` pipeline follow [DR-001](001-slc-pipeline-layout-naming-invocation.md#output-locations).
For example:

- `slc playbook/text2gears.md` writes `playbook/text2gears.slc/text2gears.gears.md` and `playbook/text2gears.slc/text2gears.fsm.ts`.
- `slc slc.link playbook/text2gears.slc/text2gears.fsm.ts <link-target>` writes `playbook/text2gears.slc/text2gears.phase.ts`, unless `-o` overrides.

## Consequences

- A pipeline can be bootstrapped by compiling its own phase definitions, then run through the resulting artifacts.
- Compiled phases gain auditable control flow (the GEARS-to-phase mapping) and can mix deterministic and agentic steps.
- Phase artifacts must be version-pinned to keep the toolchain stable across runs.
- Interpreted execution ([DR-004](004-slc-interpreted-phase-execution.md)) remains the reference semantics and the fallback for uncompiled phases.

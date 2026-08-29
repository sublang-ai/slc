<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# compiler: Compiler Usage

## Intent

This package specifies the user-facing contract of the `slc` compiler: how a user compiles content through a named pipeline of phases and what artifacts and outcomes result.
It owns invocation-level compile outcomes and guarantees; generic pipeline mechanics, phase execution, pin validation, and incremental selection belong to peer packages.
Essential project-specific reference: `slc`, this project's compiler CLI.

## External Behavior

### compiler-1

When the user runs a pipeline on a source, the slc command shall transform the source through the pipeline's ordered phases [[PIPE-4](../dev/pipeline.md#pipe-4)] and produce the pipeline output, leaving each non-final phase's result as an inspectable intermediate [[PIPE-8](../dev/pipeline.md#pipe-8)] in the invocation working directory's artifact directory [[PIPE-7](../dev/pipeline.md#pipe-7)], so compiling from another directory never rewrites artifacts committed beside the source ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### compiler-2

The slc command shall let the user run the whole pipeline or a single named phase [[PIPE-9](../dev/pipeline.md#pipe-9)], or the direct or full link step [[PIPE-12](../dev/pipeline.md#pipe-12)], [[PIPE-13](../dev/pipeline.md#pipe-13)], and shall place each artifact at the location it would occupy in a full run [[PIPE-8](../dev/pipeline.md#pipe-8)], [[PIPE-15](../dev/pipeline.md#pipe-15)], [[PIPE-18](../dev/pipeline.md#pipe-18)], so an artifact's role does not depend on the invocation form ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md)).

### compiler-3

When the user supplies an output-path override, the slc command shall write the final pipeline output [[PIPE-8](../dev/pipeline.md#pipe-8)] or linked output [[PIPE-15](../dev/pipeline.md#pipe-15)], [[PIPE-18](../dev/pipeline.md#pipe-18)] to that path while leaving intermediates at their default locations ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### compiler-4

When a run cannot complete — because the invocation or pipeline is rejected, or a phase fails — the slc command shall stop and report the reason, naming the failing phase and its target artifact when a phase is at fault [[PHEXEC-9](../dev/phase-execution.md#phexec-9)], and shall leave the inputs it read and the pipeline definitions unchanged [[PHEXEC-3](../dev/phase-execution.md#phexec-3)], [[PHEXEC-5](../dev/phase-execution.md#phexec-5)] ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-003](../decisions/003-slc-phase-execution.md)).

### compiler-5

When a phase is selected for execution rather than incremental reuse [[incremental-compilation-2](incremental-compilation.md#incremental-compilation-2)], the slc command shall carry it out with a coding agent [[PHEXEC-11](../dev/phase-execution.md#phexec-11)], [[PHEXEC-25](../dev/phase-execution.md#phexec-25)] that follows the phase's definition [[PHEXEC-2](../dev/phase-execution.md#phexec-2)], so the user supplies only the source and the phase definitions and writes no transformation code ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-021](../decisions/021-incremental-compilation.md)).

### compiler-6

Where a pipeline pins a phase to a reviewed compiled artifact, when the user runs the pipeline, the slc command shall require the pin to be current before reuse or execution [[pinning-2](pinning.md#pinning-2)], shall run that artifact when execution is selected, and shall stop with a diagnostic rather than silently interpreting [[PHEXEC-27](../dev/phase-execution.md#phexec-27)] when the pin is stale [[pinning-3](pinning.md#pinning-3)] or malformed [[pinning-5](pinning.md#pinning-5)] or the pin file is unreadable ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-021](../decisions/021-incremental-compilation.md)).

### compiler-7

When the user runs a full pipeline with `--normalize` or on a raw source whose extension is not the entry phase's [[PIPE-6](../dev/pipeline.md#pipe-6)], [[PIPE-34](../dev/pipeline.md#pipe-34)], the slc command shall first rewrite the raw source into a document satisfying the entry phase's stated source requirements [[PHEXEC-2](../dev/phase-execution.md#phexec-2)], [[PHEXEC-33](../dev/phase-execution.md#phexec-33)] — preserving the input's meaning, order, and language, surfacing only implicit structure and implicit executability preconditions — and compile from that normalized source, leaving the user's raw input unchanged ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### compiler-8

When the user runs a full pipeline, the slc command shall run the pipeline's optimization pass phases between the ordinary phases by default — producing the same canonical artifact names as an unoptimized run plus the inspectable pre-pass intermediates — and shall run the chain without passes when the user gives `--no-optimize` [[PIPE-32](../dev/pipeline.md#pipe-32)] ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### compiler-9

Where an independent Reviewer is configured, when a phase is selected for Update [[incremental-compilation-5](incremental-compilation.md#incremental-compilation-5)], Ordinary [[incremental-compilation-3](incremental-compilation.md#incremental-compilation-3)], or `--rebuild` execution [[incremental-compilation-7](incremental-compilation.md#incremental-compilation-7)], the slc command shall have the Coder perform each transformation, obtain independent read-only review of successful non-`BLOCKED` work, return material findings to the Coder for evidenced disposition and minimal root-cause repair, complete when no unsettled finding remains, and fail the phase if the third Reviewer call still reports findings [[PHEXEC-46](../dev/phase-execution.md#phexec-46)]; whereas incremental Reuse shall invoke neither agent [[incremental-compilation-2](incremental-compilation.md#incremental-compilation-2)] ([DR-022](../decisions/022-two-agent-reviewed-compilation.md), [DR-021](../decisions/021-incremental-compilation.md)).

## Verification

### compiler-10

Where fixture pipelines provide interpreted and current-pinned execution, canonical and raw sources, a format-preserving pass, output overrides, failure cases, incremental states, and an optional independent Reviewer, when the compiler integration and system suite runs each case through `slc`, each case shall produce its listed outcome:

| Case | Required outcome |
| --- | --- |
| Full run | Ordered phases produce the final output and inspectable intermediates in the invocation working directory without rewriting artifacts committed beside the source [[compiler-1](#compiler-1)]. |
| Invocation forms | Whole-pipeline, single-phase, direct-link, and full-link runs retain the same canonical artifact roles and locations [[compiler-2](#compiler-2)]. |
| Output override | `-o` relocates only the final pipeline or linked output and leaves intermediates at their canonical locations [[compiler-3](#compiler-3)]. |
| Failure | Rejected invocations and pipelines and failed phases stop with the cause, name the phase and target when applicable, and preserve inputs and definitions [[compiler-4](#compiler-4)]. |
| Agent execution | Each selected transformation is performed by a coding agent from the authoritative phase definition without user-supplied transformation code [[compiler-5](#compiler-5)]. |
| Pin currency | A pin is current before Reuse or execution, a selected current artifact executes without interpretation, and a stale, malformed, or unreadable pin fails closed with a diagnostic [[compiler-6](#compiler-6)]. |
| Normalization | Explicit and raw-source normalization runs first, preserves meaning, order, and language within the stated limits, supplies the normalized entry source, and leaves the raw input unchanged [[compiler-7](#compiler-7)]. |
| Optimization | Passes run by default with inspectable pre-pass output, while `--no-optimize` skips them without changing canonical artifact names [[compiler-8](#compiler-8)]. |
| Independent review | Update, Ordinary, and `--rebuild` performing calls receive independent review, correction, and re-review and fail on third-call findings, while Reuse invokes neither agent [[compiler-9](#compiler-9)]. |

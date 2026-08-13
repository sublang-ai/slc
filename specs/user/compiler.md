<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# COMPILE: Compiler Usage

## Intent

This package specifies the user-facing contract of the `slc` compiler: how a
user compiles content through a named pipeline of phases and what artifacts and
outcomes result. How `slc` parses, validates, places, and executes those phases
internally is specified in the `pipeline` and `phase-execution` packages.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Compiling

### COMPILE-1

When the user runs a pipeline on a source, the slc command shall produce the pipeline output through the ordered phase semantics — executing a phase or exactly reusing its recorded result under [DR-021](../decisions/021-incremental-build-records-scoped-updates.md) — and leave each non-final phase's result as an inspectable intermediate in the invocation working directory's artifact directory, so compiling from another directory never rewrites artifacts committed beside the source ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### COMPILE-2

The slc command shall let the user run the whole pipeline, a single named phase, or the link step, and shall place each artifact at the location it would occupy in a full run, so an artifact's role does not depend on the invocation form ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md)).

### COMPILE-3

When the user supplies an output-path override, the slc command shall write the final pipeline or linked output to that path while leaving intermediates at their default locations ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### COMPILE-4

When a run cannot complete — because the invocation or pipeline is rejected, or a phase fails — the slc command shall stop and report the reason, naming the failing phase and its target artifact when a phase is at fault, and shall leave the inputs it read and the pipeline definitions unchanged ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-003](../decisions/003-slc-phase-execution.md)).

### COMPILE-5

When a phase requires semantic execution rather than exact recorded reuse, the slc command shall carry it out with a coding agent that follows the phase's definition, so the user supplies only the source and the phase definitions and writes no transformation code ([DR-004](../decisions/004-slc-interpreted-phase-execution.md), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

### COMPILE-6

Where a pipeline pins a phase to a reviewed compiled artifact, when the user runs the pipeline, the slc command shall validate and select that artifact before either executing or reusing the phase, shall run it when execution is required, and shall stop the run with a diagnostic — rather than reuse output or silently interpret the phase — when the pin is stale or malformed or the pin file is unreadable ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

### COMPILE-7

When the user runs a full pipeline with `--normalize` or on a raw source whose extension is not the entry phase's, the slc command shall make a normalized document satisfying the entry phase's stated source requirements available to the chain — preserving the input's meaning, order, and language, surfacing only implicit structure and implicit executability preconditions, reusing an exact current normalized artifact when eligible and otherwise rewriting it — and shall leave the user's raw input unchanged ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

### COMPILE-8

When the user runs a full pipeline, the slc command shall schedule the pipeline's optimization pass phases between the ordinary phases by default — executing or exactly reusing each scheduled step under the build-lineage rules, producing the same canonical artifact names as an unoptimized run plus the inspectable pre-pass intermediates — and shall schedule no pass when the user gives `--no-optimize` ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

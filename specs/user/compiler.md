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

When the user runs a pipeline on a source, the slc command shall transform the source through the pipeline's ordered phases and produce the pipeline output, leaving each non-final phase's result as an inspectable intermediate beside the source ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### COMPILE-2

The slc command shall let the user run the whole pipeline, a single named phase, or the link step, and shall place each artifact at the location it would occupy in a full run, so an artifact's role does not depend on the invocation form ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md)).

### COMPILE-3

When the user supplies an output-path override, the slc command shall write the final pipeline or linked output to that path while leaving intermediates at their default locations ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### COMPILE-4

When a run cannot complete, the slc command shall stop and report which phase failed, the artifact it targeted, and the reasons, and shall leave the source, the previously produced artifacts, and the pipeline definitions unchanged ([DR-003](../decisions/003-slc-phase-execution.md)).

### COMPILE-5

The slc command shall carry out each phase with a coding agent that follows the phase's definition, so the user supplies only the source and the phase definitions and writes no transformation code ([DR-004](../decisions/004-slc-interpreted-phase-execution.md)).

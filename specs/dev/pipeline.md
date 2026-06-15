<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PIPE: Pipeline Mechanics

## Intent

This package specifies the generic pipeline mechanics of the `slc` command:
pipeline and phase resolution, format and filename validation, chain inference,
source-name validation, artifact-path computation, CLI parsing, and link-phase
handling, per [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)
and [DR-002](../decisions/002-slc-link-phases.md).
These are the generic half of the execution boundary in
[DR-003](../decisions/003-slc-phase-execution.md); phase transformation behavior
is specified in the `phase-execution` package.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Phases and formats

### PIPE-1

When loading a phase file, the slc command shall read its `## Formats` table to map each role (source, target) to a format token and canonical extension, and shall treat those declarations as authoritative for extension mapping, chain composition, and source verification ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#phase-format-declarations)).

### PIPE-2

When loading a phase file, the slc command shall refuse it unless its `<source-format>2<target-format>.md` filename tokens match its `## Formats` table ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#phase-filename-convention)).

### PIPE-3

While composing a pipeline, the slc command shall refuse to run when two phases declare conflicting extensions for the same format token ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#phase-format-declarations)).

## Chain inference

### PIPE-4

When running a full pipeline, the slc command shall infer a single linear phase order by chaining each phase's target format to the next phase's source format, taking the entry phase as the one whose source format no phase produces and the exit phase as the one whose target format no phase consumes ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#full-pipeline-ordering)).

### PIPE-5

While inferring phase order, the slc command shall refuse a pipeline whose chain is incomplete, branches, or contains a cycle ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#full-pipeline-ordering)).

## Sources and artifact paths

### PIPE-6

When given a source path, the slc command shall accept it only if it matches `<basename>.<source-format>.<ext>` or, for the entry phase, the plain form `<basename>[.<source-format>].<ext>`, and shall refuse any name matching no applicable form ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#source-filename-convention)).

### PIPE-7

Where the source directory's leaf name is not `<basename>.<pipeline>`, the slc command shall use `<src-dir>/<basename>.<pipeline>/` as the artifact directory; where the leaf name is already `<basename>.<pipeline>`, the slc command shall reuse that directory without nesting another inside it ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations)).

### PIPE-8

When writing artifacts, the slc command shall write each intermediate to `<art-dir>/<basename>.<format>.<ext>` and the pipeline output to `<art-dir>/<basename>.<target-format>.<ext>`, unless `-o <target>` overrides the output path while leaving intermediate placement unchanged ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations)).

## CLI

### PIPE-9

When invoked, the slc command shall parse `slc <pipeline>[.<phase>] <source> [-o <target>]`, running the pipeline end-to-end for `<pipeline>` and a single named phase for `<pipeline>.<phase>` ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli)).

## Link phases

### PIPE-10

Where a pipeline directory contains `link.md`, the slc command shall load it as the reserved link phase, excluded from compile-chain inference and from the `<source-format>2<target-format>.md` filename rule ([DR-002](../decisions/002-slc-link-phases.md#link-phase)).

### PIPE-11

When loading `link.md`, the slc command shall read its `## Formats` (object source format and a distinct linked target format) and `## Link Targets` (target form, required symbols, supported option names, and validation rules), and shall refuse a linked format token equal to any accepted object format token ([DR-002](../decisions/002-slc-link-phases.md#link-phase)).

### PIPE-12

When invoked as `slc <pipeline>.link <object>... <target> [-o <linked-target>]`, the slc command shall treat the final positional operand as the link target and all earlier operands as ordered object artifacts, require at least one object operand, and shall not infer positional roles by extension, file existence, or `--` ([DR-002](../decisions/002-slc-link-phases.md#cli)).

### PIPE-13

When invoked as `slc <pipeline> <source> --link <target>`, the slc command shall run the compile chain to its exit artifact and then the link phase; when invoked without `--link`, the slc command shall stop at the compile-chain output ([DR-002](../decisions/002-slc-link-phases.md#cli)).

### PIPE-14

When given `--link-option <name>=<value>` pairs on either invocation form, the slc command shall pass them to the link phase without interpreting them ([DR-002](../decisions/002-slc-link-phases.md#cli)).

### PIPE-15

When a link phase runs, the slc command shall write the linked artifact to `<art-dir>/<basename>.<target-format>.<ext>` unless `-o <linked-target>` overrides it, and shall treat the compile-chain exit artifact as the object-artifact intermediate ([DR-002](../decisions/002-slc-link-phases.md#output-locations)).

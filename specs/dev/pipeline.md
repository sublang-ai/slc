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

## Discovery

### PIPE-16

When a `<pipeline>` reference cannot be resolved to exactly one pipeline directory through the consumer-provided resolution ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#directory-layout)), the slc command shall stop with a diagnostic naming the reference.

### PIPE-17

Where a pipeline directory is resolved, the slc command shall treat each `.md` file directly inside it as a phase file, reserve `link.md` as the link phase ([PIPE-10](#pipe-10)), and shall not descend into subdirectories ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#directory-layout)).

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

When loading `link.md`, the slc command shall read its `## Formats` (the object source format and the linked target format) and its `## Link Targets` section, whose target-form table is required — except when the linked target format is the Playbook-owned `playbook` format (used by the reserved `slc` and the `playbook` pipeline), whose target validation Playbook owns and which therefore declares none, so the exception keys on that linked format and not on the pipeline name ([SELFHOST-2](self-hosting.md#selfhost-2), [SELFHOST-6](self-hosting.md#selfhost-6), [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)) — and whose required symbols, supported `--link-option` names, and validation rules are optional ([DR-002](../decisions/002-slc-link-phases.md#link-phase)).

### PIPE-19

While loading `link.md`, the slc command shall refuse a linked format token equal to the object source format token declared in `## Formats`, even when they share a file extension; accepting any additional object formats and validating object count and compatibility are the link phase's responsibility ([DR-002](../decisions/002-slc-link-phases.md#link-phase), [PHEXEC-7](phase-execution.md#phexec-7)).

### PIPE-12

When invoked as `slc <pipeline>.link <object>... <target> [-o <linked-target>]`, the slc command shall treat the final positional operand as the link target and all earlier operands as ordered object artifacts, require at least one object operand, and shall not infer positional roles by extension, file existence, or `--` ([DR-002](../decisions/002-slc-link-phases.md#cli)).

### PIPE-13

When invoked as `slc <pipeline> <source> --link <target>`, the slc command shall run the compile chain to its exit artifact and then the link phase; when invoked without `--link`, the slc command shall stop at the compile-chain output ([DR-002](../decisions/002-slc-link-phases.md#cli)).

### PIPE-14

When given `--link-option <name>=<value>` pairs on either invocation form, the slc command shall pass them to the link phase without interpreting them ([DR-002](../decisions/002-slc-link-phases.md#cli)).

### PIPE-15

When a link phase runs in a full-pipeline invocation, the slc command shall treat the compile-chain exit artifact as the object artifact, write the linked artifact to `<art-dir>/<basename>.<target-format>.<ext>` unless `-o <linked-target>` overrides it, and let `-o <linked-target>` control only the linked artifact ([DR-002](../decisions/002-slc-link-phases.md#output-locations)).

### PIPE-18

When invoked as `slc <pipeline>.link` with exactly one object, the slc command shall place the linked artifact by DR-001's source-adjacent directory and basename rules unless `-o <linked-target>` overrides the linked-artifact path; with more than one object, the slc command shall require `-o <linked-target>`, refuse the invocation when it is absent, and write the linked artifact to that path ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations), [DR-002](../decisions/002-slc-link-phases.md#output-locations)).

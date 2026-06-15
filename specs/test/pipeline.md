<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PIPE: Pipeline Mechanics

## Intent

This package specifies integration and system acceptance tests for the generic
pipeline mechanics in the `pipeline` dev package, exercising the `slc` command
end-to-end over sample pipelines per [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)
and [DR-002](../decisions/002-slc-link-phases.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## Pipeline runs

### PIPE-20

Verifies: [PIPE-4](../dev/pipeline.md#pipe-4), [PIPE-8](../dev/pipeline.md#pipe-8), [PIPE-17](../dev/pipeline.md#pipe-17)

Where a pipeline directory holds a valid linear chain, when the slc command runs the full pipeline on a conforming source, the slc command shall write each intermediate and the output to their canonical `<art-dir>` paths and exit zero.

### PIPE-21

Verifies: [PIPE-5](../dev/pipeline.md#pipe-5)

Where a pipeline directory's phase files form a branching, cyclic, or incomplete chain, when the slc command runs it, the slc command shall exit non-zero with a diagnostic naming the chain fault and write no artifacts.

### PIPE-22

Verifies: [PIPE-6](../dev/pipeline.md#pipe-6)

When the slc command is given a source whose filename matches no applicable form, the slc command shall exit non-zero with a diagnostic and write no artifacts.

### PIPE-23

Verifies: [PIPE-2](../dev/pipeline.md#pipe-2)

Where a phase file's `<source-format>2<target-format>.md` filename disagrees with its `## Formats` table, when the slc command loads the pipeline, the slc command shall refuse the run with a diagnostic naming the phase.

### PIPE-24

Verifies: [PIPE-7](../dev/pipeline.md#pipe-7), [PIPE-9](../dev/pipeline.md#pipe-9)

When the slc command runs `slc <pipeline>.<phase>` on an intermediate already inside a `<basename>.<pipeline>/` directory, the slc command shall write only that phase's target into the same artifact directory without nesting another inside it.

### PIPE-25

Verifies: [PIPE-12](../dev/pipeline.md#pipe-12), [PIPE-18](../dev/pipeline.md#pipe-18)

When the slc command runs `slc <pipeline>.link` with exactly one object, the slc command shall write the linked artifact by DR-001's source-adjacent rules; when run with more than one object and no `-o`, the slc command shall exit non-zero with a diagnostic.

### PIPE-26

Verifies: [PIPE-13](../dev/pipeline.md#pipe-13), [PIPE-15](../dev/pipeline.md#pipe-15)

When the slc command runs `slc <pipeline> <source> --link <target>`, the slc command shall write the compile-chain exit artifact as an intermediate object and the linked artifact as the output.

### PIPE-27

Verifies: [PIPE-16](../dev/pipeline.md#pipe-16)

When a `<pipeline>` reference resolves to no directory or to more than one, the slc command shall exit non-zero with a diagnostic naming the reference and write no artifacts.

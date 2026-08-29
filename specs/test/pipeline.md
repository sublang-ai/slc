<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# PIPE: Pipeline Mechanics

## Intent

This package specifies integration and system acceptance tests for the generic
pipeline mechanics in the `pipeline` dev package, exercising the `slc` command
end-to-end over sample pipelines per [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)
and [DR-002](../decisions/002-slc-link-phases.md), including post-link
completion per
[DR-023](../decisions/023-host-settled-link-object-imports.md).

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

When the slc command is given a non-entry source whose filename matches no applicable form, the slc command shall exit non-zero with a diagnostic and write no artifacts.

### PIPE-38
Verifies: [PIPE-6](../dev/pipeline.md#pipe-6), [PIPE-7](../dev/pipeline.md#pipe-7)

When the slc command runs a full pipeline from a working directory other than the source's, the slc command shall create the artifact directory under the working directory — leaving the source's own directory unwritten — and reuse the working directory itself when its leaf name is already `<basename>.<pipeline>`.

### PIPE-39
Verifies: [PIPE-6](../dev/pipeline.md#pipe-6), [PIPE-34](../dev/pipeline.md#pipe-34)

When the slc command runs a full pipeline on an entry source whose extension is not the entry phase's, the slc command shall schedule normalization without `--normalize`, derive `<basename>` from the name minus its actual extension, and leave the raw source unchanged.

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

### PIPE-28
Verifies: [PIPE-8](../dev/pipeline.md#pipe-8), [PIPE-15](../dev/pipeline.md#pipe-15), [PIPE-18](../dev/pipeline.md#pipe-18)

When the slc command is run with `-o <target>`, the slc command shall write the pipeline output, or the linked artifact, to that path while leaving intermediates at their canonical locations.

### PIPE-29
Verifies: [PIPE-14](../dev/pipeline.md#pipe-14)

When the slc command is run with `--link-option <name>=<value>` pairs, the slc command shall convey them unaltered to the link phase.

### PIPE-41
Verifies: [PIPE-40](../dev/pipeline.md#pipe-40)

Where a link phase writes a linked module beside only a declared `.ts` object, when the module imports the missing `.js` counterpart, the slc command shall rewrite the specifier to `.ts`, report the module, original specifier, and replacement, and complete successfully.
Where both `.js` and `.ts` siblings of a declared link object exist, when the module imports the `.ts` sibling, the slc command shall rewrite the specifier to `.js`, report the module, original specifier, and replacement, and complete successfully.
Where a linked module imports a `.js` or `.ts` path unrelated to every declared link object, when post-link completion runs, the slc command shall leave that import unchanged.

### PIPE-35
Verifies: [PIPE-30](../dev/pipeline.md#pipe-30), [PIPE-31](../dev/pipeline.md#pipe-31), [PIPE-32](../dev/pipeline.md#pipe-32), [PIPE-33](../dev/pipeline.md#pipe-33)

Where a pipeline directory contains a format-preserving phase file, when the slc command loads or runs that pipeline, it shall refuse the file unless its basename is a portable pass name; otherwise it shall run the pass by default between the producing and consuming phases — the producing phase writing the `.raw` intermediate and the pass the canonical path — run the chain without passes under `--no-optimize`, and write the `.opt` sibling under `slc <pipeline>.<pass>`.

### PIPE-36
Verifies: [PIPE-34](../dev/pipeline.md#pipe-34), [PHEXEC-33](../dev/phase-execution.md#phexec-33)

When the slc command is run with `--normalize`, the slc command shall execute the built-in normalization definition first — receiving the raw source and the entry-phase definition as a read-only reference — write the normalized source into the artifact directory under the entry phase's source name, and run the entry phase from that file.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# pipeline: Pipeline Mechanics

## Intent

This package specifies the generic pipeline mechanics of the `slc` command: pipeline and phase resolution, format and filename validation, chain inference, source-name validation, artifact-path computation, CLI parsing, and link-phase handling, per [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) and [DR-002](../decisions/002-slc-link-phases.md).
These are the generic half of the execution boundary in [DR-003](../decisions/003-slc-phase-execution.md); phase transformation behavior is specified in the `phase-execution` package.
Verification exercises the `slc` command end to end over sample pipelines.
Essential project-specific reference: `slc`, this project's compiler CLI.

## External Behavior

### Discovery

#### pipeline-16

When a `<pipeline>` reference cannot be resolved to exactly one pipeline directory through the consumer-provided resolution, the slc command shall stop with a diagnostic naming the reference ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

#### pipeline-17

Where a pipeline directory is resolved, the slc command shall treat each `.md` file directly inside it as a phase file, reserve `link.md` as the link phase [[pipeline-10](#pipeline-10)], and shall not descend into subdirectories ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### Phases and formats

#### pipeline-1

When loading a phase file, the slc command shall read its `## Formats` table to map each role (source, target) to a format token and canonical extension, and shall treat those declarations as authoritative for extension mapping, chain composition, and source verification ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

#### pipeline-2

When loading a phase file, the slc command shall refuse it unless its `<source-format>2<target-format>.md` filename tokens match its `## Formats` table; a pass phase [[pipeline-30](#pipeline-30)] is exempt from this rule ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

#### pipeline-30

Where a phase file's `## Formats` table declares equal source and target formats and its filename without `.md` is a non-empty portable direct-child name other than `.` or `..`, the slc command shall load it as a pass phase with that name, and shall otherwise refuse it ([DR-013](../decisions/013-normalize-and-pass-phases.md)).

#### pipeline-3

While composing a pipeline, the slc command shall refuse to run when two phases declare conflicting extensions for the same format token ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### Chain inference

#### pipeline-4

When running a full pipeline, the slc command shall infer a single linear phase order by chaining each phase's target format to the next phase's source format, taking the entry phase as the one whose source format no phase produces and the exit phase as the one whose target format no phase consumes ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

#### pipeline-5

While inferring phase order, the slc command shall refuse a pipeline whose chain is incomplete, branches, or contains a cycle ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

#### pipeline-31

While inferring phase order, the slc command shall exclude pass phases from chain inference — entry/exit selection and the incomplete/branch/cycle refusals consider only format-changing phases ([DR-013](../decisions/013-normalize-and-pass-phases.md)).

### Sources and artifact paths

#### pipeline-6

When given a non-entry source path, the slc command shall accept it only if it matches `<basename>.<source-format>.<ext>` and shall refuse any other name; when given an entry source path, the slc command shall accept `<basename>[.<source-format>].<ext>` as before and shall treat a name with any other extension as a raw input whose `<basename>` is the name minus its actual extension ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### pipeline-7

Where the invocation working directory's leaf name is not `<basename>.<pipeline>`, the slc command shall use `<cwd>/<basename>.<pipeline>/` as the artifact directory; where the leaf name is already `<basename>.<pipeline>`, the slc command shall reuse the working directory without nesting another inside it ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### pipeline-8

When writing artifacts, the slc command shall write each intermediate to `<art-dir>/<basename>.<format>.<ext>` and the pipeline output to `<art-dir>/<basename>.<target-format>.<ext>`, unless `-o <target>` overrides the output path while leaving intermediate placement unchanged ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md)).

### CLI

#### pipeline-9

When invoked, the slc command shall parse `slc <pipeline>[.<phase>] <source> [-o <target>] [--rebuild]`, running the pipeline end to end for `<pipeline>`, a single named phase for `<pipeline>.<phase>`, and accepting `--rebuild` only for a full or full-link invocation without `-o` ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-021](../decisions/021-incremental-compilation.md)).

### Link phases

#### pipeline-10

Where a pipeline directory contains `link.md`, the slc command shall load it as the reserved link phase, excluded from compile-chain inference and from the `<source-format>2<target-format>.md` filename rule ([DR-002](../decisions/002-slc-link-phases.md)).

#### pipeline-11

When loading `link.md`, the slc command shall read its `## Formats` (the object source format and the linked target format) and its `## Link Targets` section, whose target-form table is required — except when the linked target format is the Playbook-owned `playbook` format used by the reserved `slc` and the `playbook` pipeline, whose target validation Playbook owns and which therefore declares none, so the exception keys on that linked format and not on the pipeline name [[SELFHOST-2](../dev/self-hosting.md#selfhost-2)], [[SELFHOST-6](../dev/self-hosting.md#selfhost-6)] — and whose required symbols, supported `--link-option` names, and validation rules are optional ([DR-002](../decisions/002-slc-link-phases.md), [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

#### pipeline-19

While loading `link.md`, the slc command shall refuse a linked format token equal to the object source format token declared in `## Formats`, even when they share a file extension; accepting any additional object formats and validating object count and compatibility are the link phase's responsibility [[phase-execution-7](phase-execution.md#phase-execution-7)] ([DR-002](../decisions/002-slc-link-phases.md)).

#### pipeline-12

When invoked as `slc <pipeline>.link <object>... <target> [-o <linked-target>]`, the slc command shall treat the final positional operand as the link target and all earlier operands as ordered object artifacts, require at least one object operand, and shall not infer positional roles by extension, file existence, or `--` ([DR-002](../decisions/002-slc-link-phases.md)).

#### pipeline-13

When invoked as `slc <pipeline> <source> --link <target>`, the slc command shall run the compile chain to its exit artifact and then the link phase; when invoked without `--link`, the slc command shall stop at the compile-chain output, except where the resolved pipeline supplies a default link target [[SELFHOST-13](../dev/self-hosting.md#selfhost-13)], in which case the slc command shall run the full-link form against that default ([DR-002](../decisions/002-slc-link-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### pipeline-14

When given `--link-option <name>=<value>` pairs on either invocation form, the slc command shall pass them to the link phase without interpreting them ([DR-002](../decisions/002-slc-link-phases.md)).

#### pipeline-15

When a link phase runs in a full-pipeline invocation, the slc command shall treat the compile-chain exit artifact as the object artifact, write the linked artifact to `<art-dir>/<basename>.<target-format>.<ext>` unless `-o <linked-target>` overrides it, and let `-o <linked-target>` control only the linked artifact ([DR-002](../decisions/002-slc-link-phases.md)).

#### pipeline-18

When invoked as `slc <pipeline>.link` with exactly one object, the slc command shall place the linked artifact by DR-001's source-adjacent directory and basename rules unless `-o <linked-target>` overrides the linked-artifact path; with more than one object, the slc command shall require `-o <linked-target>`, refuse the invocation when it is absent, and write the linked artifact to that path ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md)).

### Passes and normalization

#### pipeline-32

On a full or full-link invocation without `--no-optimize`, the slc command shall schedule every discovered pass phase after the chain phase producing its format, in pass-name order: the producing phase shall write `<art-dir>/<basename>.<format>.raw<ext>`, each non-final pass `<art-dir>/<basename>.<format>.opt<k><ext>`, and the final pass the format's canonical artifact path, so downstream phases and verification consume identical paths with or without optimization; when the invocation carries `--no-optimize`, the slc command shall run the chain with no passes, and `-O`/`--optimize` shall remain accepted as an explicit statement of the default ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### pipeline-33

When invoked as `slc <pipeline>.<pass> <source>`, the slc command shall run the named pass alone and write `<art-dir>/<basename>.<format>.opt<ext>` unless `-o <target>` overrides the output path, and shall not overwrite the pass's own source ([DR-003](../decisions/003-slc-phase-execution.md), [DR-013](../decisions/013-normalize-and-pass-phases.md)).

#### pipeline-34

When a full or full-link invocation carries `--normalize` or its entry source is a raw input [[pipeline-6](#pipeline-6)], the slc command shall schedule one generic normalization step ahead of the entry phase, driven by the pipeline-agnostic definition shipped with slc, writing `<art-dir>/<basename>.<entry-source-format><entry-source-ext>` as the entry phase's source and supplying the entry-phase definition as a protected read-only reference input [[phase-execution-33](phase-execution.md#phase-execution-33)] ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

#### pipeline-37

When `-O`/`--optimize`, `--no-optimize`, or `--normalize` accompanies a single-phase or `.link` invocation, the slc command shall refuse the invocation ([DR-013](../decisions/013-normalize-and-pass-phases.md), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

## Verification

### Pipeline-run acceptance

#### pipeline-20

Where a pipeline directory holds a valid linear chain [[pipeline-4](#pipeline-4)], when the slc command runs the full pipeline on a conforming source, the slc command shall write each intermediate and the output to their canonical `<art-dir>` paths [[pipeline-8](#pipeline-8)] and exit zero after discovering only the direct phase files [[pipeline-17](#pipeline-17)].

#### pipeline-21

Where a fixture pipeline is invalid by extension declarations or chain shape, when the slc command runs it, each case shall exit non-zero before execution, write no artifacts, and produce its listed diagnostic:

| Case | Required diagnostic |
| --- | --- |
| Conflicting extensions | The diagnostic names the format whose phase declarations disagree [[pipeline-3](#pipeline-3)]. |
| Branching, cyclic, or incomplete chain | The diagnostic names the chain fault [[pipeline-5](#pipeline-5)]. |

#### pipeline-22

When the slc command is given a non-entry source whose filename matches no applicable form [[pipeline-6](#pipeline-6)], the slc command shall exit non-zero with a diagnostic and write no artifacts.

#### pipeline-38

When the slc command runs a full pipeline from a working directory other than the source's, the slc command shall create the artifact directory under the working directory — leaving the source's own directory unwritten — and reuse the working directory itself when its leaf name is already `<basename>.<pipeline>` [[pipeline-6](#pipeline-6)], [[pipeline-7](#pipeline-7)].

#### pipeline-39

When the slc command runs a full pipeline on an entry source whose extension is not the entry phase's [[pipeline-6](#pipeline-6)], the slc command shall schedule normalization [[pipeline-34](#pipeline-34)] without `--normalize`, derive `<basename>` from the name minus its actual extension, and leave the raw source unchanged.

#### pipeline-23

Where a phase file's authoritative `## Formats` declaration [[pipeline-1](#pipeline-1)] disagrees with its `<source-format>2<target-format>.md` filename, when the slc command loads the pipeline, the slc command shall refuse the run with a diagnostic naming the phase [[pipeline-2](#pipeline-2)].

#### pipeline-24

When the slc command runs `slc <pipeline>.<phase>` [[pipeline-9](#pipeline-9)] on an intermediate already inside a `<basename>.<pipeline>/` directory [[pipeline-7](#pipeline-7)], the slc command shall write only that phase's target into the same artifact directory without nesting another inside it.

#### pipeline-25

Where direct-link fixture invocations assign positional roles without inference [[pipeline-12](#pipeline-12)], when the slc command runs each case, it shall produce its listed outcome:

| Case | Required outcome |
| --- | --- |
| One object | The linked artifact is written by the source-adjacent rules [[pipeline-18](#pipeline-18)]. |
| Multiple objects without `-o` | The invocation exits non-zero with a diagnostic [[pipeline-18](#pipeline-18)]. |
| Equal object and linked formats | The invocation is refused before execution with a diagnostic naming the format collision [[pipeline-19](#pipeline-19)]. |

#### pipeline-26

When the slc command runs `slc <pipeline> <source> --link <target>` [[pipeline-13](#pipeline-13)], the slc command shall keep the reserved `link.md` out of compile-chain inference until the chain finishes [[pipeline-10](#pipeline-10)], write the compile-chain exit artifact as an intermediate object, and write the linked artifact as the output [[pipeline-15](#pipeline-15)].

#### pipeline-27

When a `<pipeline>` reference resolves to no directory or to more than one [[pipeline-16](#pipeline-16)], the slc command shall exit non-zero with a diagnostic naming the reference and write no artifacts.

#### pipeline-28

When the slc command is run with `-o <target>`, the slc command shall write the pipeline output [[pipeline-8](#pipeline-8)], or the linked artifact [[pipeline-15](#pipeline-15)], [[pipeline-18](#pipeline-18)], to that path while leaving intermediates at their canonical locations.

#### pipeline-29

When the slc command is run with `--link-option <name>=<value>` pairs [[pipeline-14](#pipeline-14)], the slc command shall convey them unaltered to the link phase.

#### pipeline-35

Where fixture invocations exercise passes and mode flags, when the slc command loads or runs each case, it shall produce its listed outcome:

| Case | Required outcome |
| --- | --- |
| Non-portable pass name | The file is refused [[pipeline-30](#pipeline-30)]. |
| Full pipeline with a pass | The pass is excluded from chain inference [[pipeline-31](#pipeline-31)] and runs by default between the producing and consuming phases, with the producer writing the `.raw` intermediate and the pass writing the canonical path [[pipeline-32](#pipeline-32)]. |
| Full pipeline with `--no-optimize` | The chain runs without passes [[pipeline-32](#pipeline-32)]. |
| Standalone pass | The pass writes the `.opt` sibling [[pipeline-33](#pipeline-33)]. |
| Single phase or direct link with `-O`/`--optimize`, `--no-optimize`, or `--normalize` | The invocation is refused before execution [[pipeline-37](#pipeline-37)]. |

#### pipeline-36

When the slc command is run with `--normalize`, the slc command shall execute the built-in normalization definition first [[pipeline-34](#pipeline-34)] — receiving the raw source and the entry-phase definition as a read-only reference — write the normalized source into the artifact directory under the entry phase's source name, and run the entry phase from that file.

#### pipeline-40

Where fixture pipelines exercise ordinary and Playbook-owned link definitions, when the pipeline integration and system suite runs each case through `slc`, each case shall produce its listed outcome:

| Case | Required outcome |
| --- | --- |
| Ordinary linked format | The link reads its required target-form table and optional metadata [[pipeline-11](#pipeline-11)]. |
| Playbook-owned linked format | A `playbook`-format link may omit the target-form table regardless of pipeline name [[pipeline-11](#pipeline-11)]. |
| Invalid omission | A link for any other linked format without a target-form table is refused [[pipeline-11](#pipeline-11)]. |

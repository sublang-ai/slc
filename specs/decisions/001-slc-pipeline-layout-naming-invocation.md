<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-001: SLC Pipeline Layout, Naming, and Invocation

## Status

Accepted

## Context

`slc` (the SubLang Compiler) translates content from one language to another via an ordered sequence of phases. A target language may be another spec, executable code, or any structured representation. The first such pipeline, `playbook`, runs `text2gears` (natural language → GEARS spec items) and then `gears2fsm` (GEARS → XState machine).

Intermediate artifacts (e.g., GEARS items between `text2gears` and `gears2fsm`) are meant for human inspection and refinement, not disposable build cache — which shapes where the compiler should write them.

We need a consistent vocabulary and CLI shape for defining, composing, and invoking these pipelines.

## Decision

### Terminology

| Term | Meaning |
| ---- | ------- |
| **Pipeline** | An ordered chain of compilation steps targeting one domain (e.g., `playbook`). |
| **Phase** | One compilation step within a pipeline, defined by a single `.md` file. |
| **Source** | A phase's input content. For the first phase, equals the pipeline input. |
| **Target** | A phase's output content. For the last phase, equals the pipeline output. |

Between phases, one phase's target is the next phase's source; such files are intermediates of the overall compilation.

### Directory layout

Pipeline definitions live under `pipelines/` at the repo root, with
phase definitions inside each pipeline directory:

```text
pipelines/
    <pipeline>/
        <phase>.md
```

### Phase filename convention

Each phase file shall be named `<source-format>2<target-format>.md`, where a format is a short kebab-case token identifying a language (e.g., `text`, `gears`, `fsm`).

Examples: `text2gears.md`, `gears2fsm.md`.

### Phase format declarations

Each phase file shall declare its source and target formats — including canonical file extensions — in a `## Formats` section near the top:

```markdown
## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | text | .md |
| target | gears | .md |
```

These declarations are authoritative: `slc` reads them to resolve format tokens to file extensions, to validate chain composition when running a full pipeline, and to verify source inputs when running a single phase. `slc` shall refuse to run a pipeline if any two phases in it declare conflicting extensions for the same format token.

The filename tokens and the `## Formats` table describe the same pair and shall agree: the `<source-format>` in the filename shall equal the `source` format in the table, and likewise for target. `slc` shall refuse to load a phase whose filename tokens do not match its declarations.

### Source filename convention

A source file supplied to `slc` shall be named in one of the following forms, where `<source-format>` is the consuming phase's declared source format and `<ext>` is its declared extension:

- Non-entry-phase sources: `<basename>.<source-format>.<ext>`. This makes intermediates self-identifying as they flow through the pipeline.
- Entry-phase sources: `<basename>[.<source-format>].<ext>`. The plain form lets users author original sources without learning the convention up front.

`slc` shall refuse any source whose name matches none of the applicable forms.

### Full-pipeline ordering

When running a full pipeline, `slc` shall infer phase order by chaining each phase's target format to the next phase's source format. The result shall be a single linear chain — one entry, one exit, no branches or cycles:

- The entry phase is the one whose source format is not produced by any other phase in the pipeline.
- The exit phase is the one whose target format is not consumed by any other phase.
- `slc` shall refuse to run the pipeline if the chain is incomplete, branches, or contains a cycle.

### CLI

```text
slc <pipeline>[.<phase>] <source> [-o <target>]
```

- `slc <pipeline> <source>` runs the whole pipeline end-to-end, starting from the entry phase.
- `slc <pipeline>.<phase> <source>` runs one named phase.
- `-o <target>` sets the final output path explicitly. Intermediate placement is unaffected (see below).

The source filename shall comply with the [source filename convention](#source-filename-convention).

### Output locations

Let `<source-dir>` be the directory containing `<source>`, or that containing `.<pipeline>/` when `<source>` resides inside an intermediate directory.
Let `<basename>` be the basename with any trailing `.<source-format>` stem stripped.

When `-o` is omitted:

- The final output is placed next to the source as `<source-dir>/<basename>.<target-format>.<ext>`.
- Intermediates from a full-pipeline run go to `<source-dir>/.<pipeline>/<basename>.<format>.<ext>`.

When `-o <target>` is supplied, the final artifact is written to `<target>`. Intermediates still go to `<source-dir>/.<pipeline>/`, independent of `-o`.

```text
<source-dir>/
    <basename>[.<source-format>].<ext>      # source
    <basename>.<target-format>.<ext>        # final output (when -o omitted)
    .<pipeline>/
        <basename>.<format>.<ext>           # intermediates only
```

Example: running `slc playbook flows/onboarding.md` produces:

- `flows/.playbook/onboarding.gears.md` (intermediate)
- `flows/onboarding.fsm.ts` (final output, next to source)

## Consequences

- A single, compiler-native vocabulary (pipeline, phase, source, target) reduces cognitive overhead.
- Chain inference keeps linear pipelines manifest-free; every phase filename must carry correct format tokens.
- Users regenerate or iterate on any single phase by invoking `slc <pipeline>.<phase>` directly.
- Default output locations are source-relative (finals next to the source, intermediates in `.<pipeline>/`), keeping sources and derivatives co-located for human review and refinement. Locations are stable across invocations from different working directories and isolated per source directory, avoiding basename collisions (e.g., `flows/onboarding.md` and `policies/onboarding.md` cannot clobber each other's outputs).
- Phase format declarations make the format-to-extension mapping authoritative and per-phase, so new formats do not require amending this DR.
- Basename normalization lets users iterate on intermediates: editing `flows/.playbook/onboarding.gears.md` and rerunning phase 2 produces `flows/onboarding.fsm.ts`, not `onboarding.gears.fsm.ts`.
- Entry-phase sources may be plain `<name>.<ext>` so users can author original inputs without learning a convention up front.

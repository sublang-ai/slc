<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-001: SLC Pipeline Layout, Naming, and Invocation

## Status

Accepted

## Context

`slc` (the SubLang Compiler) translates content through an ordered sequence of phases; targets may be specs, executable code, or any structured representation. The first pipeline, `playbook`, runs `text2gears` (natural language → GEARS) then `gears2fsm` (GEARS → XState machine).

Intermediates (e.g., GEARS between those phases) are for human inspection and refinement, not disposable build cache — which shapes where the compiler writes them.

We need a consistent vocabulary and CLI shape for these pipelines.

## Decision

### Terminology

| Term | Meaning |
| ---- | ------- |
| **Pipeline** | An ordered chain of phases for one domain (e.g., `playbook`). |
| **Phase** | One compilation step, defined by a single `.md` file. |
| **Source** | A phase's input; the entry phase's source is the pipeline input. |
| **Target** | A phase's output; the exit phase's target is the pipeline output. |
| **Intermediate** | A non-exit phase's target (also the next phase's source). |

### Directory layout

Pipeline and phase definitions live under `pipelines/`:

```text
pipelines/
    <pipeline>/
        <phase>.md
```

### Phase filename convention

Each phase file shall be named `<source-format>2<target-format>.md`, where each token is a short kebab-case language identifier. Examples: `text2gears.md`, `gears2fsm.md`.

### Phase format declarations

Each phase file shall declare its source and target formats with canonical extensions in a `## Formats` section:

```markdown
## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | text | .md |
| target | gears | .md |
```

These declarations are authoritative: `slc` uses them to map formats to extensions, validate chain composition, and verify sources. `slc` shall refuse to run a pipeline whose phases declare conflicting extensions for the same format token.

A phase's filename tokens shall match its `## Formats` table; `slc` shall refuse to load any phase that violates this.

### Source filename convention

A source file shall conform to one of these forms, using the consuming phase's `<source-format>` and `<ext>`:

- Non-entry-phase: `<basename>.<source-format>.<ext>` — makes intermediates self-identifying as they flow through the pipeline.
- Entry-phase: `<basename>[.<source-format>].<ext>` — the plain form lets users write original inputs without learning the convention.

`slc` shall refuse any source whose name matches no applicable form.

### Full-pipeline ordering

When running a full pipeline, `slc` shall infer phase order by chaining each phase's target format to the next phase's source format — a single linear chain:

- The **entry phase** is the one whose source format no other phase produces.
- The **exit phase** is the one whose target format no other phase consumes.
- `slc` shall refuse to run a pipeline whose chain is incomplete, branches, or contains a cycle.

### CLI

```text
slc <pipeline>[.<phase>] <source> [-o <target>]
```

- `slc <pipeline> <source>` runs the pipeline end-to-end.
- `slc <pipeline>.<phase> <source>` runs one named phase.
- `-o <target>` overrides the pipeline output path; intermediate placement is unaffected.

`<source>` shall comply with the [source filename convention](#source-filename-convention).

### Output locations

Each artifact's location depends on its role in the pipeline, not on invocation
mode. The pipeline output is the artifact emitted by the terminal phase, and
all earlier artifacts are intermediates.

Let `<source-dir>` be the directory containing `<source>` (or containing `.<pipeline>/` when `<source>` is inside the intermediate directory). Let `<basename>` be `<source>`'s basename with any trailing `.<source-format>` stripped.

- The pipeline output goes next to the source as `<source-dir>/<basename>.<target-format>.<ext>`, unless `-o <target>` overrides.
- Intermediates go to `<source-dir>/.<pipeline>/<basename>.<format>.<ext>` regardless of `-o`.

```text
<source-dir>/
    <basename>[.<source-format>].<ext>      # source
    <basename>.<target-format>.<ext>        # pipeline output (when -o omitted)
    .<pipeline>/
        <basename>.<format>.<ext>           # intermediates
```

Examples:

- `slc playbook flows/onboarding.md` → `flows/.playbook/onboarding.gears.md` (intermediate) + `flows/onboarding.fsm.ts` (output).
- `slc playbook.text2gears flows/onboarding.md` → `flows/.playbook/onboarding.gears.md` only; same location as the full run.

## Consequences

- A single vocabulary (pipeline, phase, source, target, intermediate) reduces cognitive overhead.
- Chain inference keeps linear pipelines manifest-free.
- Single-phase and full-pipeline runs write to the same locations, so users can iterate on any phase without file shuffling.
- Outputs are source-relative, co-locating sources and derivatives for human review. Per-source-directory isolation prevents basename collisions (e.g., `flows/onboarding.md` and `policies/onboarding.md` cannot clobber each other).
- Per-phase format declarations are authoritative, so new formats do not require amending this DR.
- Basename normalization lets users edit `flows/.playbook/onboarding.gears.md` and rerun phase 2 to produce `flows/onboarding.fsm.ts` (not `onboarding.gears.fsm.ts`).
- Entry-phase sources may be plain `<name>.<ext>`, so users needn't learn a convention to start authoring.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-001: SLC I/O Architecture

## Status

Accepted

## Context

`slc` (the SubLang Compiler) translates content from one language to another via an ordered sequence of compilation steps, preserving meaning across forms. A target language may be another spec, executable code, or any structured representation. The first such pipeline, `playbook`, runs `text2gears` (natural language → GEARS spec items) and then `gears2fsm` (GEARS → XState machine).

Intermediate artifacts (e.g., GEARS items between `text2gears` and `gears2fsm`) are semi-durable — meant for human inspection and refinement, not disposable build cache — which shapes where the compiler should write them.

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

Each phase file shall be named `<source-format>2<target-format>.md`, where a format is a short kebab-case token identifying a language (e.g., `text`, `gears`, `fsm`). Each format has a canonical file extension (e.g., `gears` → `.md`, `fsm` → `.ts`) used when writing generated files.

Examples: `text2gears.md`, `gears2fsm.md`.

### Full-pipeline ordering

When running a full pipeline, `slc` shall infer phase order by chaining each phase's target format to the next phase's source format. The result shall be a single linear chain — one entry, one exit, no branches or cycles:

- The entry phase is the one whose source format is not produced by any other phase in the pipeline.
- The exit phase is the one whose target format is not consumed by any other phase.
- `slc` shall refuse to run the pipeline if the chain is incomplete, branches, or contains a cycle.

### CLI

```text
slc <pipeline>[.<phase>] <source> [-o <target>]
```

- `slc <pipeline> <source>` runs the whole pipeline end-to-end.
- `slc <pipeline>.<phase> <source>` runs one named phase.
- `-o <target>` sets the output path explicitly. When omitted, output locations follow the convention below.

### Output locations

When `-o` is omitted:

- The final output goes to the current working directory.
- Intermediates from a full-pipeline run go to a `.<pipeline>/` directory sibling to the source.

Filenames derive from the source basename and the target format.

```text
./                                  # current working directory
    <basename>.<format>.<ext>       # final output

<source-dir>/
    <basename>.<ext>                # source
    .<pipeline>/
        <basename>.<format>.<ext>   # intermediates only
```

Example: running `slc playbook flows/onboarding.md` from the repo root produces:

- `flows/.playbook/onboarding.gears.md` (intermediate)
- `./onboarding.fsm.ts` (final output, in pwd)

## Consequences

- A single, compiler-native vocabulary (pipeline, phase, source, target) reduces cognitive overhead.
- Chain inference keeps linear pipelines manifest-free; every phase filename must carry correct format tokens.
- Users regenerate or iterate on any single phase by invoking `slc <pipeline>.<phase>` directly.
- Intermediates live in `.<pipeline>/` next to their source, keeping sources and derivatives co-located for human review and refinement. Their locations are stable across invocations from different working directories and isolated per source directory, avoiding basename collisions.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# Input Normalization

Generic pre-phase of any slc pipeline.
Rewrites a raw user description into a source document that satisfies the
target pipeline's entry-phase requirements, so free-form input compiles
reliably regardless of which pipeline consumes it.

- Source: raw free-form user input, in any language and layout.
- Target: a pipeline-ready source document for the pipeline's entry phase.

This definition is pipeline-agnostic.
The concrete requirements come from the **entry-phase definition supplied as a
read-only reference input**: the normalizer shall read that definition and
produce a source satisfying its stated Source expectations (declared sections,
naming rules, structural conventions).

## Formats

| Role   | Format | Extension |
| ------ | ------ | --------- |
| source | text   | .md       |
| target | text   | .md       |

The concrete target format token and extension are the entry phase's declared
source format and extension; the driver supplies the exact target path.

## Fidelity

Normalization restructures; it does not reinterpret:

- Preserve the described procedure's meaning, ordering, actors, and
  terminology exactly. Do not add, drop, merge, or reorder steps.
- Keep the target in the same language as the raw input. Do not translate.
- Do not invent actors, conditions, or requirements the input does not state
  or directly assume.
- Quote or restate the input's own wording where the entry phase permits
  prose; prefer the original phrasing over paraphrase.

## Structure

Where the entry-phase definition supports declared structure, make the raw
input's implicit structure explicit:

- Declare each distinct actor the input describes, following the entry
  phase's naming rules (e.g. an opening `Players:` section), assigning each a
  stable name in the source language when the input leaves actors unnamed.
- Present the procedure as clearly delimited steps or clauses when the entry
  phase benefits from them, preserving the input's order.

## Preconditions

An action's implicit executability precondition — state the action requires
of the environment before it can succeed — may be surfaced as one explicit
setup step that establishes the precondition when absent.
E.g., a procedure that commits to a version-control repository assumes the
working directory is such a repository; normalization may add a setup step
that checks for the repository and initializes it when missing.
Surface only preconditions the described actions directly require; do not
speculate about the wider environment.

## Output

Write only the normalized source document to the target path.
Do not emit commentary, the entry-phase definition, or this definition's text
into the target.

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

## Pin Inputs

This definition cites no local file. Its output-affecting readable inputs are
the raw compile operand and the entry-phase definition the driver supplies as
an explicit read-only reference, both already recorded as semantic inputs, so
the declaration below is deliberately empty.

## Update

```json
{"schema":"sublang.slc.update-contract.v1","traceSchema":"sublang.slc.update.v1"}
```

### Stable input units

One unit per top-level block of the raw source, in source order: a paragraph,
a list, a heading and the prose that follows it until the next heading, a
fenced code block, or a table. A unit's name is stable across runs as long as
the block survives; name it from its ordinal position among blocks of its own
kind, so inserting a paragraph does not rename an unrelated list.

### Target scopes

One scope per emitted normalized block, in target order, named by the same
rule as the input unit it came from. A block that merges several input units
takes the name of the first, and is a structural scope.

### Dependency closure

Each input unit's closure is every target scope its content reaches. For an
ordinary block that is the single scope emitted from it. For a unit whose
content is referenced by later blocks — a heading that scopes the prose under
it, or a list continued after an interruption — the closure additionally names
each dependent scope, in target order.

### Structural and global scopes

The document's title and any front matter are global: a change to either can
alter every emitted block, so classify them `global` and never `local`. A
heading that establishes the section a later block belongs to is `structural`.
Everything else is `local`.

### Update instructions

Rewrite only the target scopes named in the request's allowed closure, taking
the changed input bytes from the supplied hunks. Leave every other byte of the
prior target exactly as it stands, including whitespace. Emit the complete
normalized document, never a patch.

### Semantic verification

Confirm the rewritten scopes carry the same meaning the changed source states,
that no unchanged scope's bytes moved, and that the whole document still
satisfies the fidelity, structure, and output rules below. If any of those
fail, block rather than emitting a candidate.

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

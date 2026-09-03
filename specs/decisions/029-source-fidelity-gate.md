<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-029: Deterministic Source-Fidelity Gate at the text2gears Seam

## Status

Accepted

## Context

The text2gears phase must conserve every prompt fragment the Source authors: fenced instruction blocks and blockquotes reach the GEARS items verbatim, in Source order, and a GEARS prompt line that the Source never authored is an invention.
This conservation is mechanically decidable, yet slc verifies nothing about a text2gears output today; the reviewed loop's Reviewer is the only check.
A reviewed compile of a maintained playbook Source produced an invented item whose prompt lines the Source never authored, and the Reviewer accepted it; a deterministic check written outside slc rejected it at once.
The same reviewed loop already relays numbered findings to the Coder for evidenced disposition and minimal repair ([DR-022](022-two-agent-reviewed-compilation.md)), so mechanical findings need no new correction protocol.
Not every Source authors fragments: the demo Sources are plain prose, leaving prompt wording to the compiler's judgment, and the reserved meta-pipeline compiles a definition's `## Compiled execution` section under its own fidelity gate ([DR-028](028-contract-based-adoption-without-recompilation.md)).

## Decision

- After a text2gears phase outside the reserved meta-pipeline produces a Coder result, and before any Reviewer call on that result, the host runs a deterministic conservation check of the current live target against the invocation Source:
  - every authored fragment — a fenced `markdown` block or a blockquote, with Markdown escapes of `<` and `>` resolved and a blockquote that prose introduces "in quotes (`>`)" kept with its literal `>` markers — appears contiguously in at least one item's prompt;
  - within one item, authored fragments appear in Source order;
  - where the Source authors at least one fragment, every non-empty prompt line of every item is an authored line or a bare quoted relay placeholder `> <name>`;
  - every output property a result description names matches the ASCII identifier pattern a guard name matches, since downstream artifacts and calling playbooks consume those properties by name;
  - a result field is not declared verbatim-owned in one item and judge-authored in another;
  - a placeholder that the Source relays in quotes carries a literal quote marker wherever an item's prompt reads it.
- Findings are mechanical Reviewer findings: under a reviewed loop they are relayed to the Coder as a numbered findings list in place of the Reviewer call for that round and count as one of the permitted Reviewer calls, so the loop's bound is unchanged; a result with no mechanical finding proceeds to the Reviewer as before.
- Without a reviewed loop, mechanical findings fail the phase closed with the findings as its diagnostic.
- The check is a pure function of the Source text and the GEARS text, exported for standalone artifact review, and it never consults the definition, the installed engine, or any prior artifact.

## Consequences

- An invented, dropped, reordered, or unquoted authored fragment is caught deterministically before any agent judges the artifact, and the Coder receives an exact finding to repair.
- Plain-prose Sources, which author no fragment, pass the check vacuously and keep the compiler's judgment over prompt wording.
- Semantic item partitioning, condition wording, and result descriptions remain the Reviewer's concern; the gate decides only what is mechanically decidable.
- A bare relay placeholder names a value the compiler chose to thread, so one the Source never relays passes the gate; whether a relayed value is authored remains the Reviewer's concern.

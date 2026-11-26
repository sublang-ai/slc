<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-029: Deterministic Source-Fidelity Gate at the text2gears Seam

## Status

Accepted.
Amended by [DR-033](033-early-conformance-and-mechanical-repair.md), [DR-052](052-prefixed-prompt-acceptance.md), [DR-055](055-mixed-source-prompt-fidelity.md), [DR-057](057-language-neutral-relay-marker.md).

## Context

The text2gears phase must conserve every prompt fragment the Source authors: fenced instruction blocks and blockquotes reach the GEARS items verbatim, in Source order, and a GEARS prompt line that the Source never authored is an invention.
This conservation is mechanically decidable, yet slc verifies nothing about a text2gears output today; the reviewed loop's Reviewer is the only check.
A reviewed compile of a maintained playbook Source produced an invented item whose prompt lines the Source never authored, and the Reviewer accepted it; a deterministic check written outside slc rejected it at once.
The same reviewed loop already relays numbered findings to the Coder for evidenced disposition and minimal repair ([DR-022](022-two-agent-reviewed-compilation.md)), so mechanical findings need no new correction protocol.
Not every Source authors fragments: the demo Sources are plain prose, leaving prompt wording to the compiler's judgment, and the reserved meta-pipeline compiles a definition's `## Compiled execution` section under its own fidelity gate ([DR-028](028-contract-based-adoption-without-recompilation.md)).

## Decision

- After a text2gears phase outside the reserved meta-pipeline produces a Coder result, and before any Reviewer call on that result, the host runs a deterministic conservation check of the current live target against the invocation Source:
  - every authored fragment — a fenced `markdown` block or a blockquote, with Markdown escapes of `<` and `>` resolved and a blockquote whose introducing prose carries the relay marker `` (`>`) `` ([DR-057](057-language-neutral-relay-marker.md)) kept with its literal `>` markers — appears in at least one item's prompt, contiguously or as a whole fragment of an item accepted in the prefix-first layout ([DR-052](052-prefixed-prompt-acceptance.md));
  - within one item not accepted in the prefix-first layout, complete nonoverlapping authored fragments appear in Source order; an occurrence contained in a larger fully matched fragment belongs to that larger fragment, and identical fragments pass when their occurrences have an order-preserving Source attribution;
  - where the Source authors at least one fragment, every non-empty prompt line of an item carrying at least one complete authored fragment is an authored line or a bare quoted relay placeholder `> <name>` ([DR-055](055-mixed-source-prompt-fidelity.md));
  - every output property a result description names matches the ASCII identifier pattern a guard name matches, since downstream artifacts and calling playbooks consume those properties by name;
  - a result field is not declared verbatim-owned in one item and judge-authored in another;
  - a placeholder that the Source relays in quotes carries a literal quote marker wherever a prompt line the compiler composed reads it; a line the Source itself authored — a command comparing the value as a single-quoted shell word, for instance — keeps the Source's form, and a script item's shell text, read by no agent, is exempt.
- Findings are mechanical findings relayed to the same Coder as a numbered findings list through bounded mechanical repair, with or without a reviewed loop ([DR-033](033-early-conformance-and-mechanical-repair.md)); under a reviewed loop they take the place of that round's Reviewer call within the loop's unchanged bound, and a result with no mechanical finding proceeds to the Reviewer.
- Findings that remain after the bounded corrections fail the phase closed with the findings as its diagnostic.
- The check is a pure function of the Source text and the GEARS text, exported for standalone artifact review, and it never consults the definition, the installed engine, or any prior artifact.

## Consequences

- An invented, dropped, reordered, or unquoted authored fragment is caught deterministically before any agent judges the artifact, and the Coder receives an exact finding to repair.
- Plain-prose Sources, which author no fragment, pass the check vacuously and keep the compiler's judgment over prompt wording.
- Semantic item partitioning, condition wording, and result descriptions remain the Reviewer's concern; the gate decides only what is mechanically decidable.
- A bare relay placeholder names a value the compiler chose to thread, so one the Source never relays passes the gate; whether a relayed value is authored remains the Reviewer's concern.

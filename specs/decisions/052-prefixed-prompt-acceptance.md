<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-052: Prefixed-Prompt Acceptance in the Source-Fidelity Check

## Status

Accepted.

## Context

[DR-029](029-source-fidelity-gate.md) holds a compiled GEARS package to its Source's authored fragments in Source order, and the same check runs as a test contract over the installed Playbook maintained bundles ([[verification-26](../packages/verification.md#verification-26)]).
Playbook's prompt-prefix pass [[1]] — a format-preserving pass under [DR-013](013-normalize-and-pass-phases.md) that runs after the gate has accepted the raw GEARS — moves each eligible prompt's relayed runtime values after its instructions so every run of the item shares a cacheable prompt prefix.
Without a matching rule, the check would name every such item as out of Source order the first time an adopted release ships prefixed maintained bundles, and the two copies of the check — Playbook's and this one — would disagree.
Playbook 15.1 revised its rule from matching units by text to tiling the prompt with whole fragments, conserved by text count, after review found shared paragraphs, repeated relays, and identical fragments misjudged; the copy here follows that revision.
The 15.1 pass also listed its rewritten items in an appended `## Prefixed prompts` section, and the rule accepted the layout only for a listed item.
Playbook then dropped that section: a compiled GEARS prompt is the composition the linked runtime follows verbatim, so the layout is decidable from the prompt itself and the list carried nothing more.

## Decision

- The Source-fidelity check accepts every item in the Source-order layout of [DR-029](029-source-fidelity-gate.md) or, unless it is a script item, in the prefix-first layout, read from the prompt alone and defined over the same unit the pass moves: a quoted relay fragment whole; in an instruction or plain-blockquote fragment, each blank-separated paragraph of only quoted lines a relay unit, and the lines between relay units, without their bounding blank lines, one instruction unit keeping its interior blank lines.
  Whole fragments taken in Source order tile the item's prompt — instruction units before the trailing relay blocks, relay units among them or in place where the raw layout kept a relay beside instruction text, each occurrence used once, blank and bare quoted placeholder lines free among the trailing blocks — with exactly the one blank line the pass leaves, the blank lines the Source authored, or the boundary it composed before each unit; a relay block before an instruction line admits no tiling, every alternative tiling is kept as the fragment texts it carries, and an item not in Source order that admits more than the checker enumerates is reported rather than judged.
- A script item stays held to Source order: its blockquote is shell text whose line order is its behavior, and the pass never moves it.
- Conservation counts by fragment text: each authored text is carried as many times as the Source authors it, each item carrying the texts of one layout it is accepted in — its contiguous occurrences when in Source order, or the fragments of one of its tilings — and an item accepted in neither its contiguous occurrences, with the choices made together so one occurrence never stands for two authored fragments.
- The check reads no provenance: a `## Prefixed prompts` section a Playbook 15.1 artifact carries is no GEARS item and is ignored, so no finding concerns a listing.
- The gate at the text-to-GEARS seam applies the same rule, so it also accepts a raw `text2gears` output already in the prefix-first layout; that layout conserves the Source by construction and leaves the pass a no-op, so nothing is lost, and `text2gears` still directs Source order.
- The rule mirrors Playbook's checker rule for rule; adopting a Playbook release that vendors the pass changes definitions, sidecar declarations, and pins, not this rule.

## Consequences

- The maintained-bundle contract survives bundles compiled with the pass, with or without a legacy section, and the check still catches a dropped, invented, or reordered fragment in a prefix-first item, including a relay moved before an instruction, while it catches a duplicated fragment only where no layout carries it.
- Every non-script item, not only one the pass rewrote, may carry any number of blank lines among its trailing relay blocks.
- A pass output receives only the GEARS contract checks at compile time; conservation of a prefix-first item is proven wherever the Source-fidelity check runs over the canonical GEARS.

## References

[1]: https://github.com/sublang-ai/playbook/blob/main/slc/prefix.md "Playbook — GEARS prompt-prefix pass definition"

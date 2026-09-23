<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-052: Prefixed-Prompt Acceptance in the Source-Fidelity Check

## Status

Accepted.

## Context

[DR-029](029-source-fidelity-gate.md) holds a compiled GEARS package to its Source's authored fragments in Source order, and the same check runs as a test contract over the installed Playbook maintained bundles ([[verification-26](../packages/verification.md#verification-26)]).
Playbook's prompt-prefix pass [[1]] — a format-preserving pass under [DR-013](013-normalize-and-pass-phases.md) that runs after the gate has accepted the raw GEARS — moves each eligible prompt's relayed runtime values after its instructions so every run of the item shares a cacheable prompt prefix, and lists the rewritten items in one appended `## Prefixed prompts` section.
Without a matching rule, the check would name every such item as out of Source order the first time an adopted release ships prefixed maintained bundles, and the two copies of the check — Playbook's and this one — would disagree.

## Decision

- The Source-fidelity check accepts, for an item the `## Prefixed prompts` section lists, the prefix-first layout defined over the same unit the pass moves: a quoted relay fragment whole, or one blank-separated paragraph of an instruction or plain-blockquote fragment, a paragraph of only quoted lines being a relay unit.
  Every unit of a fragment the item carries stays contiguous, the instruction units keep Source order, the relay units keep Source order, and every relay unit and bare quoted placeholder follows the last instruction unit.
- A listed item that is still relay-first, that is already in that order in the Source, that names no item, or whose entry is malformed is a finding, and an unlisted item is held to Source order exactly as before.
- The gate at the text-to-GEARS seam is unchanged: it checks the raw GEARS before any pass runs, so a `text2gears` result never carries the section.
- The rule mirrors Playbook's checker rule for rule; adopting a Playbook release that vendors the pass changes definitions, sidecar declarations, and pins, not this rule.

## Consequences

- The maintained-bundle contract survives a release whose bundles were compiled with the pass, and the check still catches a dropped, invented, or reordered fragment inside a prefixed item.
- A pass output receives only the GEARS contract checks at compile time; conservation of a prefixed item is proven wherever the Source-fidelity check runs over the canonical GEARS.

## References

[1]: https://github.com/sublang-ai/playbook/blob/main/slc/prefix.md "Playbook — GEARS prompt-prefix pass definition"

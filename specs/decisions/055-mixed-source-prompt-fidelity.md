<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-055: Mixed-Source Prompt Fidelity

## Status

Accepted. Amends [DR-029](029-source-fidelity-gate.md) in its foreign-line scope.

## Context

[DR-029](029-source-fidelity-gate.md) forbids a foreign prompt line in every GEARS item once Source authors any literal fragment.
A workshop Source combines narrative planning, design, implementation and verification with a complete fenced release prompt.
The compiler preserves that prompt, but the gate rejects the other items' narrative-derived instructions solely because the release fragment exists elsewhere.
Plain-prose compilation already entrusts prompt wording to the compiler and semantic review; mixed authoring needs the same boundary for its narrative behaviors.

## Decision

- Amend [DR-029](029-source-fidelity-gate.md)'s foreign-line prohibition to apply to an item carrying at least one complete authored fragment, contiguously or through an accepted prefix-first tiling under [DR-052](052-prefixed-prompt-acceptance.md).
- Keep global fragment conservation, order, multiplicity, result-field validity and ownership, and known-relayed-field quote checks unchanged; a dropped or changed complete literal still fails even when its item then carries no fragment.
- Keep the additional standalone raw-token quote diagnostic across every item of a fragment-bearing Source, independently of the foreign-line scope; plain-prose Sources retain their existing exemption.
- Leave a fragment-free item's prompt wording to the compiler and semantic review, including a wholly invented item in an otherwise literal Source: allowing narrative compilation makes that invention mechanically indistinguishable without interpreting Source semantics.

## Consequences

- Mixed narrative and literal Sources need no conversion of all behaviors into fenced prompts.
- An added foreign line inside an item carrying a complete literal remains a deterministic finding.
- The gate no longer claims to detect every invented whole item; it does not establish semantic correspondence or replace review.
- Existing fragment carriage and bounded tiling rules remain the only mechanical scope evidence; no role inference, prose classifier, or provenance mechanism is introduced.

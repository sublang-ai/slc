<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-028: Contract-Based Adoption Without Recompilation

## Status

Accepted

## Context

Adopting a Playbook release has cost a decision record, an exact-version provenance mapping, and a nondeterministic real-agent rebuild of all three meta-phase bundles whenever any definition changed, because each bundle's acting prompt transcribed its definition at compile time ([DR-018](018-playbook-3-1-adoption.md), [DR-024](024-playbook-10-schema-3-adoption.md)).
Playbook 11.0.0 changed nothing SLC compiles against and Playbook 12.0.0 changed only definition prose, yet under that regime each needed its own review and, for 12, a full rebuild before a one-paragraph relay fix could reach compiled runs.
Playbook's definitions now declare an explicit compiled-execution contract that relays the definition's exact text at run time, so a bundle is a stable control shell and rule edits reach compiled runs without a rebuild [[1]].
Playbook's engine declares its compatibility as `RUNTIME_ABI` and `SUPPORTED_ARTIFACT_SCHEMAS`, and linked artifacts carry a matching compatibility record, so the contract a compiled artifact needs is declared rather than inferred from a version number [[2]].
Playbook also publishes its worktree host capabilities as `@sublang/playbook/host-capabilities`, the single implementation of the classification SLC's own host had to copy and then repair [[3]].

## Decision

### Contract-based profile selection

A current pin whose link target resolves to an installed `@sublang/playbook` declaring `RUNTIME_ABI` `1` and `SUPPORTED_ARTIFACT_SCHEMAS` containing `3` shall select `composed-v3`, whatever the release version; the historical exact mappings to `legacy` and `composed-v2` stay as recorded, and a link target declaring another ABI or no schema `3` shall fail closed with the declaration named.
Pins keep recording the exact link-target provenance as evidence; it no longer gates selection for the schema-3 generation.

### Retention by verified equivalence

Across an adoption, each reviewed meta-phase bundle shall be retained when the definition's `## Compiled execution` section is preserved verbatim in the bundle's GEARS and the bundle passes its generated verification and the independent review against the installed engine; only a failed check warrants a rebuild through interpreted real-agent runs.
Both demo reference sets are retained under the same rule; their checkers re-run against the installed engine rather than recompiling.
Regenerated pins record the new closure hashes and provenance for every retained bundle.

### Run-time definition relay

Compiled execution shall supply the `<definition>` placeholder with the exact bytes of the definition file the request names as the compiled phase's single configured option `definition` — the one option a roleless meta-phase artifact may require — while the seeded Boss turn keeps carrying only the request paths.
The compiled-execution fidelity check compares the definition's acting prompt lines after the documented Markdown unescaping, so a Source-escaped placeholder matches its compiled form.

### Routine adoption

Adopting a Playbook release consists of raising the dependency, re-synchronizing the vendored definitions byte-identically, regenerating the pins, and running the verification chain; no decision record is needed unless the engine's declared contract or a definition's compiled-execution section changes.
The first adoption under this rule is the last rebuild: the bundles are rebuilt once from the definitions that carry the compiled-execution contract, and SLC's host-capability implementations — the demo host module and the compiled executor's inline fail-closed copy — are replaced by the published facade.

### Supersession

This decision supersedes the exact-provenance-only selection of [DR-010](010-playbook-runtime-contract-evolution.md) for the schema-3 generation, the unconditional rebuild-on-definition-change rule of [DR-018](018-playbook-3-1-adoption.md), the exact-10.0.0 profile boundary of [DR-024](024-playbook-10-schema-3-adoption.md), and the "adopting a later Playbook requires its own decision" rule of [DR-027](027-complete-playbook-10-activation.md).
[DR-016](016-gears-grammar-provenance.md)'s direct Spex grammar authority and [DR-026](026-slc-owned-pin-input-declarations.md)'s sidecar pin inputs remain in force.

## Consequences

- A Playbook patch or minor release that keeps its declared contract is adopted in minutes and never through an agent.
- A rule fix shipped in a definition takes effect in compiled runs at the next adoption, verified rather than re-rolled.
- SLC no longer owns a worktree classifier; engine-contract changes to receipt classification arrive with the dependency.

## References

[1]: https://github.com/sublang-ai/playbook/blob/main/specs/decisions/047-compiled-execution-contract-in-definitions.md "Playbook DR-047: compiled-execution contract in the shipped definitions"
[2]: https://github.com/sublang-ai/playbook/blob/main/specs/decisions/022-runtime-compatibility-contract.md "Playbook DR-022: runtime compatibility contract"
[3]: https://github.com/sublang-ai/playbook/blob/main/specs/decisions/046-public-worktree-host-capabilities.md "Playbook DR-046: public worktree host capabilities"

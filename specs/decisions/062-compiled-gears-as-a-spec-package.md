<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-062: Compiled GEARS as a Spec Package

## Status

Accepted
Amends [DR-009](009-slc-playbook-pipeline-compilation.md) in one scope: conformance requires each action item, not each `gears` item, to map to exactly one executable leaf.
Keeps [DR-016](016-gears-grammar-provenance.md): SLC still reads only fixed-English machine syntax and never parses condition or requirement prose.

## Context

A compiled `gears` artifact is what a person reviews and confirms, and Playbook's text2gears definition now emits it as a spec package: requirement items and test items stand beside the items that carry prompts, item headings are lowercase, and items sit under the package sections.
SLC's conformance check required every `gears` item to map to one executable leaf and compared an item ID with a leaf's `sourceItem` by exact equality.
Under that check a requirement item is a defect, and a package whose IDs were lowercased cannot be checked against a machine compiled earlier, whose citations are uppercase.
The machines Playbook maintains are verified and are not recompiled for a change of form, so a migrated package and its unchanged machine must remain conformant.

## Decision

- An item's kind is read from fixed machine syntax alone: an item with an unquoted line containing `Captain shall` is an action item; any other item is declarative, whether a requirement or a test.
- Conformance requires each action item to map to exactly one executable working leaf of its declared actor kind and every such leaf to bind an existing action item: by its `sourceItem`, or, for a nested-call leaf that carries none, by the call it makes — its literal target and input text, or the context fields a dynamic call names.
- A declarative item maps to no leaf and is no finding; SLC checks nothing in its text.
- A declarative item that carries a prompt blockquote or a `Results:` label, and a leaf that cites a declarative item, are findings, so an action that lost its acting clause is reported rather than read as a requirement.
- A leaf's `sourceItem` matches an item ID without regard to ASCII letter case, and two item IDs of one package that differ only in case are a finding.
- The findings that need no machine — a declarative item carrying a prompt or `Results:`, and IDs equal ignoring case — are also checked where a `gears` artifact is produced or consumed ([DR-035](035-gears-contract-at-producer.md)), so the phase that can still edit the artifact repairs them and no later phase receives it as protected input.
- Prose around an action item's statement remains accepted, so artifacts compiled before this record, including SLC's own phase bundles and demo references, stay conformant unchanged.
- Adopting the Playbook release that carries the reworded definitions is routine under [DR-028](028-contract-based-adoption-without-recompilation.md): the definitions resynchronize, the pins regenerate, and the phase bundles are retained because each definition's `## Compiled execution` section is unchanged.

## Consequences

A package and its machine can change form independently wherever the action items' IDs, acting clauses, prompts, and result contracts stay the same.
Conformance says nothing about whether a machine meets a requirement item; that evidence comes from tests on the machine.
An action that loses both its acting clause and its prompt becomes a declarative item to this check; the Source-fidelity gate still reports the prompt fragment that no item carries.
The checker copy emitted into a compiled bundle carries the same rules, so a bundle's generated conformance test must be re-emitted before it can check a migrated package.

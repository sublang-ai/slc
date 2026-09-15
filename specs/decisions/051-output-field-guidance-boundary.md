<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-051: Output Field Guidance Boundary

## Status

Accepted.

## Context

A real CODE compilation placed an explanatory backticked `code` inside parenthetical guidance following `Output shall include`.
The existing required-field grammar interpreted it as an additional output property, but the linker omitted it from outcome authority, so the compiled workflow failed before its first player call.
Ignoring that token at runtime would change the meaning of the protected result contract.

## Decision

Reserve output-clause backticks for field declarations and reject a backticked span within parenthetical guidance outside a complete backticked declaration.
The GEARS result parser scans only after the first literal `Output shall include`, counts ASCII parentheses outside complete backticked spans, and reports each span encountered at positive depth.
Guidance can remain plain parenthetical text or occur inside a field's complete annotation; bare field declarations and ordinary backticked prose before the output clause retain their existing meaning.
The diagnostic enters the existing producer-repair and protected-consumer boundaries under [DR-035](035-gears-contract-at-producer.md); it neither rewrites fields nor asks for Source clarification.
This amends the result syntax checked by [DR-035](035-gears-contract-at-producer.md), without changing required-field extraction, ownership, or the runtime's exact authority validation.

## Consequences

The observed generated syntax defect becomes repairable before FSM generation and linking.
Previously tolerated field declarations nested inside output-clause parentheses are rejected with guidance to move the declaration outside the parentheses.
This bounded syntactic check does not infer which other backticked names an author intended as prose or establish complete semantic fidelity.

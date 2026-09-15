<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-050: Required Child Relay Substitution

## Status

Accepted

## Context

A full CODE compilation passed mechanical validation but forwarded its literal child-input template to REVIEW without substituting the caller's request or Coder output.
The runtime correctly forwarded the FSM-owned composed text unchanged.
The whole-template check accepted unchanged tokens even in explicit quoted relay positions, leaving runtime acceptance to discover the loss.
Angle-bracket syntax alone also occurs in ordinary domain instructions and cannot establish that every token is a runtime slot.

## Decision

Amend [DR-041](041-composed-child-input-fidelity.md) at explicit child-template relay positions only.
A complete unescaped standalone `> <token>` or labelled `> Label: <token>` line requires observable runtime substitution, with the same correspondence for repeated occurrences.
Static object-valued inputs, constant functions, and partial composers cannot leave a required relay unresolved.
Ordinary literal text, inline-code or escaped tokens, and other domain metavariables retain their existing treatment.
Keep context-field names unconstrained and preserve literal placeholder-looking text inside inserted runtime values through the existing single-pass probes.
Report missing composition as a generated-artifact conformance finding through existing repair and consumer-preflight paths, without asking the source author to clarify sufficient behavior.
The behavior is specified in [[verification-39](../packages/verification.md#verification-39)].

## Consequences

The compiler can reject raw quoted relay templates before linking without interpreting arbitrary domain prose or banning angle-bracket text from runtime values.
This check does not establish the domain meaning of a mapped field or prove provenance for every inline semantic slot.
Source-aware runtime acceptance remains necessary.

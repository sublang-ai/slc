<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-041: Composed Child-input Fidelity

## Status

Accepted

## Context

The Playbook FSM producer requires literal child calls to compose their GEARS text with runtime values before invoking the nested bridge.
The existing SLC gate instead compares text evaluated against initial context to the unsubstituted template, rejecting valid maintained and generated child-input composers.
A real CODE compilation reached this conflict after completing its FSM work.

## Decision

Require exact equality for static object-valued child inputs.
Verify literal child-input composition through exact whole-template matching and observable context probes, retaining literal target and one-to-one item binding.
Infer placeholder correspondence from probe positions rather than context-field naming conventions.
Preserve non-string context shapes and use a second set of literal values to verify stable substitution and absence of recursive replacement or JSON encoding of string relays.
Probe complete quoted relay slots with multiline prose and inline slots with single-line values, so an inline identifier is not given an invented multiline domain value.
Keep source-defined empty standalone relay omission distinct from required startup configuration.
Fail closed when this bounded surface cannot establish composition; do not waive source fidelity or infer a child output ABI from this check.
Dynamic child target/text metadata and player/Captain prompt contracts remain separate existing requirements.
The behavior is specified in [[verification-39](../packages/verification.md#verification-39)].

## Consequences

Valid composed child text no longer fails merely because initial context lacks values produced before that child runs.
The check proves template and observed dataflow fidelity, while source-aware review still determines whether a field represents the correct domain value and whether caller predicates match the child's public result contract.
No runtime, workflow artifact, or provider invocation is changed by this correction.

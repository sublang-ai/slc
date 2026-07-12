<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-011: Adopt the Playbook 1.0 Captain Contract

## Status

Accepted

## Context

[DR-010](010-playbook-runtime-contract-evolution.md) prepared SLC for Playbook's causal composed runtime while deferring production selection and reviewed-asset refresh until an immutable release existed.
Its `composed-v2` seam had five ports and could represent nested calls, but it could not distinguish direct Captain work from delegated player work.

Playbook 1.0 adopts the default Captain workflow of Playbook DR-012 [[1]].
It finalizes `composed-v2` with a sixth `callCaptain` port, distinct `captain`, `player`, and `playbook` FSM actors, and dynamic nested targets whose runtime values come from typed context.
It also requires a compiler to verify real nested-call completion and failure paths rather than report every child transition as unsupported.

SLC's committed definitions, reviewed meta-phase artifact bundles, dependency lock, and pin index still form one Playbook 0.9.0 provenance set.
Refreshing only part of that set would mix incompatible compiler and runtime contracts and could make a stale judgment-produced artifact appear current.

## Decision

### Immutable profile boundary

SLC shall adopt exact immutable `@sublang/playbook@1.0.0` provenance as `composed-v2`.
The final profile shall initialize a causal root session with exactly six ports: `callPlayer`, `callCaptain`, `callJudge`, `callPlaybook`, `emitStatus`, and `emitTelemetry`.
Its runtime shall retain the structured turn result and callable `resumePlaybookCall` boundaries established by [DR-010](010-playbook-runtime-contract-evolution.md).

Absent provenance and exact `@sublang/playbook@0.9.0` provenance shall continue to select `legacy`.
Exact `@sublang/playbook@1.0.0` provenance shall select the final six-port `composed-v2` profile.
Every other provenance shall fail closed until a later decision maps it, without shape inference or initialization retry.
The `session-v1` profile shall remain an explicit compatibility and test seam, not a configured production selection.

This decision supersedes [DR-005](005-slc-self-hosting-meta-pipeline.md)'s five-port composed adapter listing, [DR-009](009-slc-playbook-pipeline-compilation.md)'s Captain-as-player and unsupported nested-coverage assumptions, and [DR-010](010-playbook-runtime-contract-evolution.md)'s provisional five-port `composed-v2` boundary and release deferral.
DR-010's structured-result validation, trace privacy, unsupported nested phase-host policy, and exact-profile probing remain in force.

### Direct Captain phase execution

The compiled phase host shall implement `callCaptain` as a first-class agent call returning Playbook's Captain status, final text, and error shape without player identity or resume-token semantics.
It shall honor the call's abort signal and required visibility option even though SLC has no interactive Boss pane.
Captain and judge calls shall share one abort-aware concurrency-one queue because they use the same configured Captain transport; player calls retain their independent player semantics.

SLC remains a non-interactive root phase host rather than a nested-playbook host.
Its `callPlaybook` port shall therefore keep settling with the deterministic unsupported-operation error required by [DR-010](010-playbook-runtime-contract-evolution.md).

### Actor and dynamic-call verification

GEARS-to-FSM conformance shall treat the actor kind as part of compilation correctness.
Direct Captain behavior shall map to `src: 'captain'` with no player binding, delegated behavior shall map to `src: 'player'` with its declared player, and a child call shall map to `src: 'playbook'`.
The prompt and result contracts shall remain verbatim and state-local for both agent actor kinds.

A dynamic nested call shall carry literal `playbookIdContext` and `textContext` metadata naming typed context fields.
Verification shall compare those names with the GEARS target-field name and sole child-input placeholder, evaluate the invocation with independent sentinel values in the named context fields, and require the resulting `playbookId` and `text` to equal the corresponding sentinels.
It shall not inspect function source or mistake a metadata field name for a runtime target or input.

Generated transition coverage shall provide distinct scripted Captain, player, and playbook actors.
For every nested invocation it shall drive successful child output through declared `onDone` routing and child rejection through `onError`, including dynamic targets after their context has been populated.
An uncovered nested transition shall be a finding rather than an accepted unsupported notice.

Generated verification shall not make Playbook depend on SLC while SLC still depends on the immutable Playbook 0.9 compiler contract.
SLC shall emit its compiled checker closure under each new artifact directory and generate relative imports to that support, preserving the destination's own `xstate` resolution and Node floor.
Current Playbook 0.9 reviewed bundles and pins shall retain their existing layout until the complete Playbook 1.0 refresh replaces them atomically.

### Atomic reviewed-asset adoption

The dependency manifest and lock, Playbook-authored `text2gears`, `gears2fsm`, and `link` definitions, all three reviewed meta-phase artifact bundles, and `slc.pins.json` shall move to Playbook 1.0 as one review unit.
The definition refresh shall start from the immutable installed package, retain SLC's explicit `## Pin Inputs`, rebuild all three bundles, independently run all generated verification, and regenerate pins with exact `@sublang/playbook@1.0.0` link-target provenance.

The adoption shall run from a clean registry install and shall not read a sibling checkout.
No mixed 0.9.0/1.0.0 definition, artifact, dependency, or pin set shall pass review or be committed as the adopted state.
CI shall repeat independent artifact review and byte-identical pin regeneration over the adopted set.

## Consequences

- Compiled transformation definitions can assign work directly to Captain without inventing a player named `Captain`.
- Dynamic child selection remains inspectable and bounded while its target and input stay runtime values.
- Nested-call `onDone` and `onError` regressions become deterministic verification failures.
- SLC can execute Playbook 1.0 phase artifacts without acquiring a child registry or live playbook stack.
- The reviewed bundles and pin index change together, while published 0.9.0 artifacts remain executable through the explicit legacy profile.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v1.0.0/specs/decisions/012-default-captain-playbook.md "Playbook DR-012: Default Captain playbook (v1.0.0)"

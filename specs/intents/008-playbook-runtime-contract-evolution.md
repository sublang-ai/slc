<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-008: Reconcile Playbook Session and Composition Contracts

## Status

Done

## Intent

Prepare SLC's compiled phase host and artifact verification for Playbook's causal session, explicit player continuation, structured result, parallel-state, and nested-call contracts under [DR-010](../decisions/010-playbook-runtime-contract-evolution.md) while retaining the immutable published 0.9.0 definitions, reviewed artifacts, and pins until a complete release existed.
At the outset, the upstream session and trace change was committed and the composition contract was accepted, but the complete composed implementation existed only in an unreleased dirty sibling checkout that still reported 0.9.0.
Because CI installed the registry lock and pin generation hashed that installed runtime, copying the sibling implementation would not have been reproducible.
Five commit-sized tasks separated forward-compatible host and verifier work from the later review-gated dependency, definition, artifact, and pin refresh.
The existing locked-install, full-suite, artifact-review, and pin-reproduction gates exercised the future-profile fixtures without a new workflow step while the deferral held.
[DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md) later superseded the provisional five-port composed adapter with the final six-port Captain boundary and ended the release deferral through later immutable adoptions.
The surviving behavior and evidence are now owned by the [`phase-execution`](../packages/phase-execution.md), [`verification`](../packages/verification.md), and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), the behavior and evidence now owned by the `phase-execution`, `verification`, and `continuous-integration` packages, and the then-current `map.md` recorded the three exact runtime profiles, provenance-driven fail-closed selection, result mapping, nested-call policy, trace privacy, structured verification, CI choice, and release boundary.
- [x] The compiled executor implemented explicit `legacy`, `session-v1`, and `composed-v2` boundaries, mapped only `composed-v2` structured results directly, retained void-result compatibility for the first two profiles, and configured the then-current pins as `legacy` without runtime-shape inference or retry heuristics.
- [x] The Playbook ports adapter forwards explicit player continuation and returned tokens, serializes judge calls, rejects nested phase calls deterministically, and excludes trace payloads from diagnostics.
- [x] At completion, verification traversed nested and parallel state nodes, recorded structured topology without changing flat-artifact output, recognized nested playbook invocations, explicitly reported then-unsupported child-driving coverage, and compared all three exact runtime profiles by safely driving their boundaries, with an immutable marker only as an ambiguity seam.
- [x] Focused and full validation covered all three executor profiles, structured machines, diagnostic privacy, cleanup failures, reviewed artifacts, and reproducible pins.
- [x] Vendored definition, dependency, reviewed-artifact, and pin refresh remained deferred at completion until the complete Playbook contract had an immutable release.

## Tasks

1. **Record the evolving runtime boundary.**
   Add [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), amend [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and the affected package behavior and verification, and index this record before implementation.
2. **Drive both runtime generations.**
   Add exact legacy, traced-session, and causal composed initialization plus structured-result mapping while retaining an explicit legacy path for the currently pinned artifacts.
3. **Harden the host ports.**
   Preserve explicit player continuation, serialize the judge, fail nested calls closed, protect trace payloads, and surface relevant teardown failures.
4. **Harden artifact verification.**
   Traverse structured machines recursively, recognize parallel and nested actors, and compare runtime capability profiles without changing current flat-artifact pins.
5. **Validate and finalize.**
   Run source-quality, full tests, independent artifact review, and byte-identical pin regeneration; then close the deliverables and push for CI verification.

## Verification

- The six checked deliverables and five task boundaries establish completion of the compatibility transition while preserving its deliberate immutable-asset deferral.
- Compiled-profile, structured-result, port, privacy, and provenance-selection acceptance is now exercised by [[phase-execution-26](../packages/phase-execution.md#phase-execution-26)] and [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)].
- Structured conformance, topology, nested-transition, and exact-profile acceptance is now exercised by [[verification-11](../packages/verification.md#verification-11)], while [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)] audits the retained locked-install and future-profile gates.
- [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md) records the final six-port replacement, while [DR-010](../decisions/010-playbook-runtime-contract-evolution.md) retains the structured-result, trace-privacy, nested-host, and exact-probing design.

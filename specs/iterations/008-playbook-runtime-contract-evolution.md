<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-008: Reconcile Playbook Session and Composition Contracts

## Goal

Prepare SLC's compiled phase host and artifact verification for Playbook's causal session, explicit player continuation, structured result, parallel-state, and nested-call contracts while retaining the immutable published 0.9.0 definitions, reviewed artifacts, and pins until the complete upstream implementation is released.

- The upstream session/trace change is committed, and the composition contract is accepted, but the complete composed implementation is still an unreleased dirty sibling checkout reporting version 0.9.0.
- SLC CI installs the registry lock and pin generation hashes that installed runtime, so copying the sibling implementation would not be reproducible in CI.
- The transition therefore separates forward-compatible host and verifier work from the later review-gated definition, artifact, dependency, and pin refresh.

## Deliverables

- [ ] [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), `PHEXEC`, `VERIFY`, and `map.md` record the session boundary, result mapping, nested-call policy, trace privacy, structured verification, and release boundary.
- [ ] The compiled executor initializes session-contract runtimes with causal root identity, maps structured results directly, and remains compatible with current pinned legacy runtimes without retry heuristics.
- [ ] The Playbook ports adapter forwards explicit player continuation and returned tokens, serializes judge calls, rejects nested phase calls deterministically, and excludes trace payloads from diagnostics.
- [ ] Verification traverses nested and parallel state nodes, records structured topology without changing flat-artifact output, recognizes nested playbook invocations, and compares compatible runtime capability profiles.
- [ ] Focused and full validation cover both runtime generations, structured machines, diagnostic privacy, cleanup failures, reviewed artifacts, and reproducible pins.
- [x] Vendored definition, dependency, reviewed-artifact, and pin refresh is deferred until the complete Playbook contract has an immutable release.

## Tasks

1. **Record the evolving runtime boundary.**
   Add DR-010, amend DR-005 and the affected dev/test items, and index this iteration before implementation.
2. **Drive both runtime generations.**
   Add causal root-session initialization and structured-result mapping while retaining an explicit legacy path for the currently pinned artifacts.
3. **Harden the host ports.**
   Preserve explicit player continuation, serialize the judge, fail nested calls closed, protect trace payloads, and surface relevant teardown failures.
4. **Harden artifact verification.**
   Traverse structured machines recursively, recognize parallel and nested actors, and compare runtime capability profiles without changing current flat-artifact pins.
5. **Validate and finalize.**
   Run source-quality, full tests, independent artifact review, and byte-identical pin regeneration; then close the deliverables and push for CI verification.

## Acceptance criteria

- Current published 0.9.0 artifacts still execute and all committed pins remain current without byte changes.
- A structured fixture receives a unique root `PlaybookSession`, exact five-port adapter, and explicit player continuation, and its returned result controls the SLC outcome.
- `failed`, `aborted`, invalid, and unexpectedly suspended structured runs fail; a no-action or outputless quiescent run blocks; and a successful quiescent or terminal run proceeds only after producing its declared output.
- Exact trace prompts, replies, and resume tokens never appear in phase diagnostics, concurrent judge calls are serialized, and nested phase calls fail deterministically.
- Parallel and nested synthetic machines are traversed without the flat verifier's missing-state false findings, while current flat verification output stays unchanged.
- CI needs no new workflow step because the existing source, test, artifact-review, and pin-reproduction gates exercise the new coverage.

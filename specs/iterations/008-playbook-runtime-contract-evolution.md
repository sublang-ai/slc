<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-008: Reconcile Playbook Session and Composition Contracts

## Goal

Prepare SLC's compiled phase host and artifact verification for Playbook's causal session, explicit player continuation, structured result, parallel-state, and nested-call contracts while retaining the immutable published 0.9.0 definitions, reviewed artifacts, and pins until the complete upstream implementation is released.

- The upstream session/trace change is committed, and the composition contract is accepted, but the complete composed implementation is still an unreleased dirty sibling checkout reporting version 0.9.0.
- SLC CI installs the registry lock and pin generation hashes that installed runtime, so copying the sibling implementation would not be reproducible in CI.
- The transition therefore separates forward-compatible host and verifier work from the later review-gated definition, artifact, dependency, and pin refresh.
- No CI workflow change is needed during the deferral: its full suite exercises explicit future-profile fixtures, while its existing artifact-review and pin-reproduction gates remain bound to the installed 0.9.0 package.

## Deliverables

- [x] [DR-010](../decisions/010-playbook-runtime-contract-evolution.md), [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), `PHEXEC`, `VERIFY`, `CI`, and `map.md` record the three exact runtime profiles, provenance-driven fail-closed selection, result mapping, nested-call policy, trace privacy, structured verification, CI choice, and release boundary.
- [x] The compiled executor implements explicit `legacy`, `session-v1`, and `composed-v2` boundaries, maps only `composed-v2` structured results directly, retains void-result compatibility for the first two profiles, and configures current pins as `legacy` without runtime-shape inference or retry heuristics.
- [x] The Playbook ports adapter forwards explicit player continuation and returned tokens, serializes judge calls, rejects nested phase calls deterministically, and excludes trace payloads from diagnostics.
- [x] Verification traverses nested and parallel state nodes, records structured topology without changing flat-artifact output, recognizes nested playbook invocations, explicitly reports unsupported child-driving coverage, and compares all three exact runtime profiles by safely driving their boundaries, with an immutable marker only as an ambiguity seam.
- [x] Focused and full validation cover all three executor profiles, structured machines, diagnostic privacy, cleanup failures, reviewed artifacts, and reproducible pins.
- [x] Vendored definition, dependency, reviewed-artifact, and pin refresh is deferred until the complete Playbook contract has an immutable release.

## Tasks

1. **Record the evolving runtime boundary.**
   Add DR-010, amend DR-005 and the affected dev/test items, and index this iteration before implementation.
2. **Drive both runtime generations.**
   Add exact legacy, traced-session, and causal composed initialization plus structured-result mapping while retaining an explicit legacy path for the currently pinned artifacts.
3. **Harden the host ports.**
   Preserve explicit player continuation, serialize the judge, fail nested calls closed, protect trace payloads, and surface relevant teardown failures.
4. **Harden artifact verification.**
   Traverse structured machines recursively, recognize parallel and nested actors, and compare runtime capability profiles without changing current flat-artifact pins.
5. **Validate and finalize.**
   Run source-quality, full tests, independent artifact review, and byte-identical pin regeneration; then close the deliverables and push for CI verification.

## Acceptance criteria

- Current published 0.9.0 artifacts still execute and all committed pins remain current without byte changes.
- The `legacy` fixture receives four direct ports, `session-v1` receives its minimal session and four ports, and `composed-v2` receives a unique causal root `PlaybookSession` and the exact five-port adapter prepared by this iteration; explicit player continuation crosses the adapter and only the composed result controls the SLC outcome directly. IR-009 supersedes that provisional composed adapter with the final six-port Captain boundary.
- `failed`, `aborted`, invalid, and unexpectedly suspended structured runs fail; a no-action or outputless quiescent run blocks; and a successful quiescent or terminal run proceeds only after producing its declared output.
- Exact trace prompts, replies, and resume tokens never appear in phase diagnostics, concurrent judge calls are serialized, and nested phase calls fail deterministically.
- Parallel and nested synthetic machines are traversed through public ids without the flat verifier's missing-state false findings, nested calls are bound by target and reported unsupported for transition driving, keyed replies isolate pending branches, and current flat verification output stays unchanged.
- CI needs no new workflow step because the existing source, test, artifact-review, and pin-reproduction gates exercise the new coverage.

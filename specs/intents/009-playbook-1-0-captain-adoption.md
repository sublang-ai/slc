<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-009: Adopt Playbook 1.0 Captain Composition

## Status

Superseded — the local Captain and compiler seams landed, but the planned immutable Playbook 1.0 reviewed set did not; later immutable adoptions replaced its version-specific closeout.

## Intent

Adopt Playbook 1.0's final six-port composed runtime and compiler definitions under [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md) as one reproducible dependency, definition, reviewed-artifact, and pin set.
The iteration completed the local six-port compatibility surface, Captain transport and shared serialization, compiler conformance, dynamic-child verification, and full source suite.
It left exact 1.0 provenance adoption, the clean registry definition and reviewed-bundle refresh, pin regeneration, and final release evidence coordinated behind the immutable release gate.
Five task boundaries preserved two done, two in-progress, and one pending-release-gate states when the record stopped.
A later provenance-only 1.0 mapping deliberately recompiled nothing, and subsequent immutable Playbook adoptions superseded the incomplete version-specific set.
The accepted design remains in [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), while current behavior and evidence are owned by the [`phase-execution`](../packages/phase-execution.md), [`verification`](../packages/verification.md), [`self-hosting`](../packages/self-hosting.md), [`pinning`](../packages/pinning.md), and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), the behavior and evidence now owned by `phase-execution`, `verification`, `self-hosting`, and `continuous-integration`, and the then-current `map.md` recorded the immutable boundary and required verification.
- [ ] Exact `@sublang/playbook@1.0.0` provenance was to select the six-port `composed-v2` phase boundary while 0.9.0 remained legacy and every then-unmapped version failed closed as this record's adopted boundary.
- [x] The phase adapter implements first-class Captain calls and serializes Captain and judge work without player resume semantics or trace leakage.
- [x] Conformance distinguishes Captain, player, and playbook actors, validates dynamic context metadata and sentinel wiring, and drives nested success and failure transitions.
- [ ] The dependency lock, three shared definitions, all three reviewed artifact bundles, and the pin index were to form one clean-install Playbook 1.0 set.
- [ ] Full source, acceptance, artifact-review, pin-reproduction, and licensing checks were to pass for that reviewed 1.0 set.

## Tasks

1. **Record the immutable adoption.** _[done]_
   Add [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md) and this record, then amend the affected package behavior, verification, continuous-integration, and map content before implementation.
2. **Finalize the composed phase boundary.** _[in progress]_
   Import the released runtime contract, add `callCaptain`, share Captain/judge serialization, and map exact 1.0.0 provenance.
3. **Verify the new compiler primitives.** _[done]_
   Separate direct Captain and delegated player bindings, validate dynamic target/input context wiring, and script nested `onDone` and `onError` coverage.
4. **Refresh the reviewed set atomically.** _[pending release gate]_
   Install Playbook 1.0 from the registry, merge its three definitions while retaining pin inputs, rebuild and review every meta-phase bundle, and regenerate all pins.
5. **Validate and finalize.** _[in progress]_
   Run a clean install, source quality, the full suite, independent artifact review, byte-identical pin regeneration, and licensing checks before commit.

## Verification

- The six historical deliverables preserve three checked and three unchecked states, and the five task boundaries preserve two done, two in-progress, and one pending-release-gate annotations.
- Compiled six-port and provenance acceptance is now exercised by [[phase-execution-26](../packages/phase-execution.md#phase-execution-26)] and [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)], while Captain, actor-kind, dynamic-child, and nested-route acceptance is exercised by [[verification-11](../packages/verification.md#verification-11)].
- Current reviewed-set acceptance is exercised by [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)], [[pinning-16](../packages/pinning.md#pinning-16)], and [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)] under the later 4.0.0 adoption rather than a retroactive 1.0.0 closeout.
- Commit `6ba8f4d` later mapped exact 1.0.0 provenance but deliberately recompiled nothing and left definition resynchronization to later work, so the unchecked atomic-refresh and final-validation evidence remains historical.

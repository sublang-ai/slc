<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-009: Adopt Playbook 1.0 Captain Composition

## Goal

Adopt Playbook 1.0's final six-port composed runtime and compiler definitions as one reproducible dependency, definition, reviewed-artifact, and pin set.

## Deliverables

- [x] [DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md), `PHEXEC`, `VERIFY`, `SELFHOST`, `CI`, and `map.md` record the immutable boundary and required verification.
- [ ] Exact `@sublang/playbook@1.0.0` provenance selects the six-port `composed-v2` phase boundary while 0.9.0 remains legacy and other versions fail closed.
- [ ] The phase adapter implements first-class Captain calls and serializes Captain and judge work without player resume semantics or trace leakage.
- [ ] Conformance distinguishes Captain, player, and playbook actors, validates dynamic context metadata and sentinel wiring, and drives nested success and failure transitions.
- [ ] The dependency lock, three shared definitions, all three reviewed artifact bundles, and the pin index form one clean-install Playbook 1.0 set.
- [ ] Full source, acceptance, artifact-review, pin-reproduction, and licensing checks pass.

## Tasks

1. **Record the immutable adoption.** _[done]_
   Add DR-011 and this iteration, then amend the affected dev, test, CI, and map items before implementation.
2. **Finalize the composed phase boundary.**
   Import the released runtime contract, add `callCaptain`, share Captain/judge serialization, and map exact 1.0.0 provenance.
3. **Verify the new compiler primitives.**
   Separate direct Captain and delegated player bindings, validate dynamic target/input context wiring, and script nested `onDone` and `onError` coverage.
4. **Refresh the reviewed set atomically.**
   Install Playbook 1.0 from the registry, merge its three definitions while retaining pin inputs, rebuild and review every meta-phase bundle, and regenerate all pins.
5. **Validate and finalize.**
   Run a clean install, source quality, the full suite, independent artifact review, byte-identical pin regeneration, and licensing checks before commit.

## Acceptance criteria

- A pinned 1.0.0 phase receives one causal root session with exactly six ports, including a working direct-Captain port, and returns through the existing structured result boundary.
- A 0.9.0 pin still selects legacy, while every other unmapped provenance fails before runtime initialization.
- Conformance rejects swapping `captain` and `player`, invented Captain player bindings, and mismatched dynamic metadata or sentinel values.
- Coverage reaches nested success and failure routing for literal and dynamic child calls without an unsupported-coverage notice.
- A clean registry install resolves no sibling checkout, every reviewed artifact passes its generated tests, every pin is current with 1.0.0 provenance, and regeneration is byte-identical.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-010: Separate Playbook Routing and Control

## Status

Done

## Intent

Compile routing-only Captain workflows under [DR-012](../decisions/012-playbook-routing-control-separation.md) whose acting prompts exclude control schemas, whose Boss text is preserved exactly, and whose declared result contracts are verified deterministically.
The iteration added source-owned result metadata, exact Boss-text mapping, isolated Captain and judge calls, and deterministic conformance without changing SLC's release-vendored definitions, reviewed artifacts, dependency versions, lock, or pins.
Five task boundaries covered the decision and package contracts, compiler semantics in Playbook's maintained definitions, result verification, Captain isolation, and validation without release mutation.
The surviving behavior and evidence are now owned by the [`phase-execution`](../packages/phase-execution.md) and [`verification`](../packages/verification.md) packages.

## Deliverables

- [x] [DR-012](../decisions/012-playbook-routing-control-separation.md), the behavior and evidence now owned by `phase-execution` and `verification`, and the then-current `map.md` recorded the result-metadata, exact-text, isolated-call, and presentation contracts.
- [x] At completion, Playbook's maintained `text2gears`, `gears2fsm`, and `link` definitions defined the canonical metadata syntax and generated runtime behavior without changing SLC's release-vendored definitions, reviewed artifacts, or pins.
- [x] The conformance checker parses and compares explicit result contracts separately from acting prompts.
- [x] SLC's Captain adapter validates and forwards fresh-session and empty-tool options for visible Captain and hidden judge calls.
- [x] Focused and full source tests, build, lint, and formatting checks pass.

## Tasks

1. **Record routing/control separation.** _[done]_
   Add [DR-012](../decisions/012-playbook-routing-control-separation.md) and this record, then amend the affected package behavior, verification, and map content before implementation.
2. **Define compiler semantics.** _[done]_
   Add canonical result metadata, exact Boss-text mapping, control-only adjudication, and isolated Captain calls to Playbook's shared phase definitions while leaving SLC's pinned vendor immutable.
3. **Verify result metadata.** _[done]_
   Parse ordered result bullets, keep them out of prompts, and compare them to each FSM state's domain result map.
4. **Enforce Captain isolation.** _[done]_
   Extend the compatibility call options and forward the required fresh-session and no-tools selections through Cligent.
5. **Validate without release mutation.** _[done]_
   Run focused and full checks while leaving versions, dependencies, reviewed artifacts, locks, and pins unchanged.

## Verification

- The five checked deliverables and five task boundaries establish completion of the routing-and-control separation without release mutation.
- Result-metadata parsing, prompt separation, and drift rejection are now exercised by [[verification-14](../packages/verification.md#verification-14)].
- Fresh-session and empty-tool isolation for direct Captain and hidden judge calls is now exercised by [[phase-execution-32](../packages/phase-execution.md#phase-execution-32)].
- [DR-012](../decisions/012-playbook-routing-control-separation.md) retains the exact Boss-text and presentation-ownership design, and the iteration changed no reviewed bundle, pin, dependency version, lockfile, or release artifact.

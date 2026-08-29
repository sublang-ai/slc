<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-015: Adopt the Playbook 2.0 Generation

## Status

Done

## Intent

Implement [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md) by moving the dependency closure, vendored definitions, reviewed meta-phase bundles, and pins from Playbook 1.0.0 to 2.0.0 with Cligent 0.16.0 as one clean-registry review unit.
Close the emitted-entry role-identity gap, preserve structured Captain-failure and nullish control-plane semantics, bind thin artifacts to their shared runtime engine, and produce and run the English demo reference through the documented role flags.
Nine task boundaries separated the dependency and profile changes, entry role binding, definition and artifact refresh, pin closure, host reconciliation, demo reference, and adoption gates.
The exact 2.0 reviewed assets were later replaced by immutable 3.1 and 4.0 sets, while the 2.0 profile mapping, role binding, thin shared-engine closure, and clean atomic-adoption mechanics remain part of the current contracts.
The design remains in [DR-017](../decisions/017-playbook-2-0-thin-runtime-adoption.md), while surviving behavior and evidence are owned by the [`phase-execution`](../packages/phase-execution.md), [`self-hosting`](../packages/self-hosting.md), [`pinning`](../packages/pinning.md), [`verification`](../packages/verification.md), and [`continuous-integration`](../packages/continuous-integration.md) packages.

## Deliverables

- [x] At completion, `package.json` and `package-lock.json` adopted `@sublang/playbook@^2.0.0` and `@sublang/cligent@^0.16.0` from a clean registry install without a sibling checkout.
- [x] Exact `@sublang/playbook@2.0.0` provenance mapped to `composed-v2`, the stated set matched the selector, and 1.3.0 remained fail-closed with coverage [[phase-execution-30](../packages/phase-execution.md#phase-execution-30)].
- [x] The emitted entry module bound runtime-resolved player ids back to verbatim declared role ids at the `callPlayer` boundary, preserved optional runtime capabilities, and failed closed on case-insensitive player collisions [[self-hosting-15](../packages/self-hosting.md#self-hosting-15)].
- [x] At completion, `pipelines/playbook/` was synchronized with Playbook 2.0.0's maintained `text2gears`, `gears2fsm`, `link`, and `optimize` definitions while retaining the local `## Pin Inputs`, including the [DR-016](../decisions/016-gears-grammar-provenance.md) Spex grammar identities.
- [x] The three meta-phase bundles were rebuilt from the synchronized definitions as thin linked modules through interpreted `slc slc` runs and independently reviewed with no findings.
- [x] At completion, `scripts/generate-pins.mjs` expected 2.0.0, recorded `@sublang/playbook` as an out-of-bundle runtime dependency beside `xstate`, retired the packed-sibling fallback, and regenerated current pins with exact 2.0.0 link-target provenance.
- [x] Host acceptance covered 2.0.0 provenance selection, structured Captain-failure mapping through the `failed` outcome, nullish host-port rejection normalization at the SLC boundary, and equivalence against the thin reference artifact.
- [x] `demo/workflow.txt` compiled under the adopted set into the English reference, and the documented command sequence succeeded with both the default and explicit Coder, Reviewer, and Captain role bindings; a bilingual reference checker replaced the retired harness.
- [x] At completion, the adoption gates now owned by [[continuous-integration-4](../packages/continuous-integration.md#continuous-integration-4)] and [[self-hosting-11](../packages/self-hosting.md#self-hosting-11)] were restated so no mixed 1.0.0 and 2.0.0 dependency, definition, artifact, or pin set passed, with Chinese reference regeneration retained as the maintainer follow-up.

## Tasks

1. Bump the dependency manifest and lock to Playbook 2.0.0 and Cligent 0.16.0 from a clean registry install.
2. Map 2.0.0 provenance in `runtimeContractForPin`, correct the profile requirement and its verification, and pin 1.3.0 fail-closed in `config.test.ts`.
3. Implement the entry-module role binding with its emission and behavioral tests.
4. Sync the four vendored definitions from the installed package, retaining the explicit Pin Inputs.
5. Rebuild the three compiled meta-phase artifacts with real agents and run all generated verification.
6. Update `generate-pins.mjs` for the expected version and shared-engine runtime dependency, retire the packed-sibling fallback, and regenerate `slc.pins.json`.
7. Reconcile compiled-executor, ports, and equivalence tests with the resolved-`failed` Captain semantics, preserve nullish control-plane rejections at the SLC boundary, and use the thin reference artifact.
8. Compile the English demo reference, add the bilingual checker, and drive the documented README flow end to end with the documented role flags.
9. Restate the continuous-integration and self-hosting adoption gates for 2.0.0.

## Verification

- The nine checked deliverables and nine task boundaries establish completion of the clean-registry 2.0 adoption and its reviewed asset set.
- Exact 2.0 profile selection and explicit 1.3 rejection remain exercised by [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)], while structured-result, Captain-failure, and nullish control-plane behavior remains exercised by [[phase-execution-26](../packages/phase-execution.md#phase-execution-26)].
- Entry role binding and collision refusal remain exercised by [[self-hosting-16](../packages/self-hosting.md#self-hosting-16)].
- The generic current-pin and atomic-adoption mechanisms are exercised over the later immutable set by [[pinning-16](../packages/pinning.md#pinning-16)], [[self-hosting-12](../packages/self-hosting.md#self-hosting-12)], and [[continuous-integration-6](../packages/continuous-integration.md#continuous-integration-6)], not as retroactive evidence that the current assets remain 2.0.
- Runtime equivalence and exact-profile probing remain exercised by [[verification-9](../packages/verification.md#verification-9)] and [[verification-11](../packages/verification.md#verification-11)].
- Commits `097ab8c`, `efb7f94`, and `cc859cc` record the reviewed 2.0 set, English reference, and checked closeout, while commit `1f4ce65` records the final fail-closed definition, runtime, and continuous-integration corrections.

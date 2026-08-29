<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-007: `slc playbook` Pipeline Compilation, Verification, and Self-Hosting Bootstrap

## Status

Done

## Intent

Deliver the `playbook` domain pipeline end to end under [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md): generic pipeline invocation, interpreted and compiled execution through reviewed pins, deterministic compilation-correctness verification, and reference equivalence without byte identity.
The iteration began with generic mechanics and a provisional compiled driver but no resolvable domain pipeline, reviewed meta-phase pins, generated verification, or equivalence harness.
It limited compiler output to the compile-chain artifacts, linked `playbook` module, and required introspection support, leaving registry, Captain shell, executable host, configuration, and performing the produced workflow to Playbook's host infrastructure.
Ten task boundaries separated the decision, dependency alignment, interpreted pipeline, capability removal, real-agent artifact review, compiled wiring, verification generation, equivalence, and coherence work.
The player sandbox and file capability were removed under [DR-008](../decisions/008-slc-file-capability.md), while package-manager integrity-digest link-target support remained outside this iteration under [DR-007](../decisions/007-slc-phase-artifact-pinning.md).
Delivered behavior and evidence are now owned by the [`compiler`](../packages/compiler.md), [`pipeline`](../packages/pipeline.md), [`phase-execution`](../packages/phase-execution.md), [`pinning`](../packages/pinning.md), [`self-hosting`](../packages/self-hosting.md), and [`verification`](../packages/verification.md) packages.

## Deliverables

- [x] A decision record settling: `slc playbook` as the generic `playbook` pipeline (no new verb); the compile-output scope vs. host-performing infra; "performing" as compiled execution via pins; the non-reserved `playbook` link reconciliation; and the verification-test-generation contract — with the `@sublang/playbook` reference refreshed and `map.md` updated ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md))
- [x] `@sublang/playbook` installed and version-aligned (`^0.9.0`) to the release that ships the `slc/` definitions and the `./runtime` contract `slc` consumes, so the reserved `slc` resolves here (the `playbook` pipeline resolution lands with its own deliverable in Task 3)
- [x] The `playbook` domain pipeline resolvable in this repo (its `text2gears`/`gears2fsm`/`link` definitions reused from the installed package via `withReservedPipelines`), with [[pipeline-11](../packages/pipeline.md#pipeline-11)] reconciled so the Playbook-authored target-less `link.md` loads for the `playbook` pipeline, not only the reserved `slc` name ([[self-hosting-6](../packages/self-hosting.md#self-hosting-6)])
- [x] `slc playbook <source>` producing `<basename>.playbook/{<basename>.gears.md, <basename>.fsm.ts}` and `slc playbook <source> --link <target>` additionally linking `<basename>.playbook.ts`, under interpreted execution, with an integration test over a faked agent transport (extends `compiler`, `self-hosting`) ([[self-hosting-8](../packages/self-hosting.md#self-hosting-8)])
- [x] Compiled execution completed for real artifacts: the player sandbox and host-side file-capability/write-scope scope removed ([DR-008](../decisions/008-slc-file-capability.md) superseded, the file-capability package and code deleted), the `seedPhaseTurn`/`PhaseInput` contract settled against a real `playbook` artifact, and write scope left to the [DR-003](../decisions/003-slc-phase-execution.md) generic checks as for interpreted execution (extends `phase-execution`)
- [x] Reviewed, committed, and pinned compiled `playbook` artifacts for the meta phases (`text2gears`, `gears2fsm`, `link`) produced via `slc slc`, selecting the best of Claude Code + Opus 4.8 and Codex + GPT-5.5, with `slc.pins.json` per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and [DR-007](../decisions/007-slc-phase-artifact-pinning.md)
- [x] The `playbook` pipeline pinned to those compiled meta-phase artifacts so `slc playbook <source>` performs through compiled execution, with current pins running compiled and stale/missing pins failing closed (extends `phase-execution`, `compiler`)
- [x] Auto-generated compilation-correctness tests modeled on the reference (gears↔fsm verbatim-prompt and player-binding and `needsBossReply` coverage; fsm introspection; prompt-contract; fsm coverage), emitted beside the artifacts, in a new spec package
- [x] An equivalence harness comparing `slc playbook ../playbook/reference/sdlc/code.md` output to `../playbook/reference/sdlc/code.playbook/` for equivalence (states, verbatim prompts, player bindings, runtime contract), not byte-identity
- [x] `map.md` updated for the new decision record and spec packages

## Tasks

Each task is one-commit-sized and updates decisions, specs, code, and tests together as applicable.
Tasks gated on real agent runs or human review are flagged; they may split further during execution.

### A. Decision and scope

1. **Author the `playbook`-compilation decision record.**
   Settle, as a new DR (next free number) and any amendments it forces:
   `slc playbook` is the generic `playbook` pipeline invocation, not a new verb;
   `slc`'s compile output is the compile-chain plus linked artifact (and the introspection helper its tests need), with the reference's registry/captain/`bin`/config out of scope as `@sublang/playbook` host infra;
   "performing" the `playbook` pipeline is compiled execution via pins;
   the non-reserved `playbook` link reconciles with Playbook's target-less `link.md`;
   and the verification-test-generation contract (which invariants, generated deterministically from the artifacts, and where the tests live).
   Refresh the `@sublang/playbook` reference and update `map.md`.
   Doc-only.

### B. Resolve and run `slc playbook` interpreted

2. **Install and align `@sublang/playbook`.**
   Add the dependency to `node_modules` at the version that ships the `slc/` definitions and the `./runtime` contract `slc` imports, reconciling the declared range with the consumed release, so the reserved `slc` and the `playbook` pipeline resolve in this checkout.
   Confirm the existing `self-hosting` suite is green against the installed defs.

3. **Make the `playbook` pipeline resolve and load.**
   Resolve the `playbook` pipeline to the installed `@sublang/playbook/slc/` definitions (alias) or to a vendored copy in this repo per Task 1, and reconcile [[pipeline-11](../packages/pipeline.md#pipeline-11)] so the Playbook-authored `link.md` (no `## Link Targets`) loads for the `playbook` pipeline and not only the reserved `slc` name.
   Extend `pipeline`/`self-hosting` items and test pipeline resolution and link loading.

4. **Run `slc playbook <source>` interpreted end to end.**
   Drive `slc playbook code.md` to the `code.gears.md` and `code.fsm.ts` compile-chain artifacts, and `slc playbook code.md --link <target>` to the linked `code.playbook.ts`, through interpreted execution at their [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md) locations.
   Extend the `compiler` and `self-hosting` verification items with an integration test over a faked agent transport.

### C. Remove the sandbox scope

5. **Remove the player-sandbox and file-capability scope.**
   Per the Boss decision, drop the deferred player sandbox and host-side file-capability staging/write-scope enforcement rather than design around it: supersede [DR-008](../decisions/008-slc-file-capability.md), delete the file-capability package and the `file-capability`/`file-grants` code and tests, drop the reserved `ClosureInput`/`semanticInputs` plumbing from the compiled executor, and reconcile [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-007](../decisions/007-slc-phase-artifact-pinning.md), and `phase-execution` so a compiled phase writes through its agents and relies on the [DR-003](../decisions/003-slc-phase-execution.md) generic checks, like interpreted execution.
   The removed unit suites go with their code; the compiled-executor, ports, selection, and pinning suites stay green.

### D. Self-hosting compiled bootstrap (gated on real agent runs + review)

6. **Build, review, and pin the compiled meta-phase artifacts.**
   Produce compiled `playbook` artifacts for `text2gears`, `gears2fsm`, and `link` via `slc slc`, trying Claude Code + Opus 4.8 and Codex + GPT-5.5 and selecting the best, then commit the reviewed artifacts and `slc.pins.json` per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md) and the [DR-007](../decisions/007-slc-phase-artifact-pinning.md) pin model.
   Judgment-produced and human-reviewed; may split one task per phase.

7. **Settle the input contract, wire the executor, and perform through the pins.**
   Settle the `seedPhaseTurn`/`PhaseInput` contract against the first real artifact (Task 6) and wire `createCompiledExecutor` into `buildDeps`, then pin the `playbook` pipeline's phases to the Task 6 artifacts and run `slc playbook code.md` through compiled execution, so a current pin runs compiled and a stale or missing pin fails closed and never silently interprets ([[phase-execution-27](../packages/phase-execution.md#phase-execution-27)]).
   Extend `phase-execution`/`compiler`; add an integration test per verdict path.

### E. Verification test generation

8. **Generate compilation-correctness tests.**
   Implement deterministic generation of the reference's verification tests beside the artifacts — gears↔fsm conformance (verbatim prompt bodies, player bindings, `needsBossReply` coverage), fsm introspection (state/source-item coverage and transition counts), prompt-contract (wired fields, placeholders, block order), and fsm coverage (every `onDone`/`onError` arm) — in a new spec package per Task 1.
   Test the generator against the reference artifacts; may split per test kind.

### F. Equivalence verification

9. **Compare against the reference.**
   Add a harness that runs `slc playbook ../playbook/reference/sdlc/code.md` and asserts equivalence to `../playbook/reference/sdlc/code.playbook/` — same states and source-item coverage, verbatim prompts, player bindings, and `createPlaybookRuntime` runtime contract — accepting non-identical output.
   Record as an acceptance/integration test.

### G. Finalize

10. **Spec coherence and `map.md`.**
    Make a coherence pass over `compiler`, `pipeline`, `phase-execution`, `self-hosting`, `pinning`, and the new package(s) so items are complete, minimal, right-level, and well organized, and ensure `map.md` reflects every change.

## Verification

- The ten checked deliverables and task history establish completion of the domain-pipeline, compiled bootstrap, generated-verification, and equivalence work.
- Current domain-pipeline scenarios [[self-hosting-7](../packages/self-hosting.md#self-hosting-7)] and [[self-hosting-8](../packages/self-hosting.md#self-hosting-8)], compiled scenarios [[phase-execution-28](../packages/phase-execution.md#phase-execution-28)] and [[phase-execution-35](../packages/phase-execution.md#phase-execution-35)], pin-generation scenario [[pinning-16](../packages/pinning.md#pinning-16)], and reference, emission, and equivalence scenarios [[verification-7](../packages/verification.md#verification-7)], [[verification-8](../packages/verification.md#verification-8)], and [[verification-9](../packages/verification.md#verification-9)] preserve the iteration's acceptance coverage.
- [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md) owns the design, [DR-008](../decisions/008-slc-file-capability.md) records capability removal, and host infrastructure plus integrity-digest support remained outside this iteration.

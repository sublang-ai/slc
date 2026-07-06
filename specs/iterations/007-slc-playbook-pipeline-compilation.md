<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-007: `slc playbook` Pipeline Compilation, Verification, and Self-Hosting Bootstrap

## Goal

Deliver the `playbook` domain pipeline end to end so `slc playbook <source>` compiles a workflow description to the `fsm` object artifact and `slc playbook <source> --link <target>` links it into a runnable `playbook` artifact, performing that compilation through compiled meta-phase artifacts and verifying the result against the manual reference at `../playbook/reference/sdlc/code.playbook/`.
`slc playbook` is the generic `slc <pipeline> <source>` invocation ([DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli)) with the `playbook` pipeline — the `text2gears` → `gears2fsm` compile chain plus a reserved `link` phase selected by `--link` ([DR-002](../decisions/002-slc-link-phases.md#cli)) — not a new CLI verb; the reference `code.playbook/` directory is exactly its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) artifact directory.
This bootstraps self-hosting: `slc slc` compiles the meta-pipeline's own phase definitions into reviewed, pinned compiled `playbook` artifacts ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)), and `slc playbook` then runs through those pins via compiled execution rather than interpreting.

- Context: the boss intent is to make `slc playbook` work and compare to the reference — understand the reference and `../playbook/slc/`, compile the pipeline definition with `slc slc`, perform `slc playbook` from the compiled playbook(s), auto-generate verification tests, and compare outputs to the reference for equivalence (not byte-identity).
- The reference `code.playbook/` is a Playbook-0.9.0 host package: three core artifacts (`code.gears.md`, `code.fsm.ts` ≈1480 lines, `code.playbook.ts` ≈1183 lines), an introspection helper, host-performing infra (registry, captain shell, `bin/playbook.js`, config template), and ≈8 tests, of which four assert compilation correctness (gears↔fsm conformance, fsm introspection, prompt-contract, fsm coverage).
- State today:
  - `slc <pipeline>[.<phase>] <source>` generic mechanics exist ([PIPE](../dev/pipeline.md)); the reserved `slc` pipeline resolves to the installed `@sublang/playbook/slc/` defs and links via the reserved-link exception ([SELFHOST-2](../dev/self-hosting.md#selfhost-2), [PIPE-11](../dev/pipeline.md#pipe-11)).
  - `@sublang/playbook` is declared (`^0.7.0`) but **absent from `node_modules`** (only `@sublang/cligent` is installed), and the sibling source is at `0.9.0`; the dependency must be installed/aligned before the reserved `slc` or a `playbook` pipeline can resolve here.
  - Interpreted execution is the default and the fallback; the compiled path (`CompiledExecutor` + Cligent-backed `PlaybookPorts`) drives a `PlaybookRuntime` non-interactively, but the `seedPhaseTurn`/`PhaseInput` contract is provisional, `createCompiledExecutor` is not yet wired into `buildDeps`, and no reviewed compiled `playbook` artifact has ever been built or pinned ([IR-005](005-slc-compiled-execution.md) Task 10 carryover).
  - There is no `playbook` domain pipeline vendored/resolvable here, no verification-test generation, and no equivalence harness against the reference.
- Boss decision (after IR-007 drafting): the player sandbox and the host-side file-capability staging and `target`/`linked` write-scope enforcement IR-006 deferred are **dropped** (removed, not designed around); a compiled phase writes through its agents and relies on the [DR-003](../decisions/003-slc-phase-execution.md) generic checks, like interpreted execution, so [DR-008](../decisions/008-slc-file-capability.md) is superseded and the `FCAP` package and its code are removed.
- Why not one commit: it spans a new design decision, dependency alignment, pipeline resolution and link reconciliation, completing compiled execution (the input contract and executor wiring), building and reviewing judgment-produced compiled artifacts, a new test-generation subsystem, and an equivalence harness — each substantial and separately reviewable, several gated on real agent runs and human review.
- Scope boundary: `slc` compiles to the compile-chain artifacts (`gears`, `fsm`) plus the linked `playbook` module (and the introspection helper its tests need); the reference's registry, captain shell, `bin`, and config are `@sublang/playbook` host-performing infrastructure and are out of `slc`'s compile scope, so "equivalence" is defined over the in-scope artifacts.
- "Performed from the playbook(s)" means self-hosting compiled execution of the `playbook` pipeline through pinned meta-phase artifacts; performing the produced SDLC workflow itself (the Coder/Reviewer/Committer loop) is the `@sublang/playbook` host's job and is out of scope.
- Out of scope: the `@sublang/playbook` host-performing infra (registry/captain/bin/config); performing the produced SDLC workflow; the player sandbox and host-side write-scope enforcement (dropped per the Boss decision above); and the package-manager integrity-digest link-target identity ([DR-007](../decisions/007-slc-phase-artifact-pinning.md#link-target-identity)) deferred by a prior IR.
- Latitude: per the boss, the meta-pipeline definitions and `slc slc` may be optimized to serve `slc playbook` cleanly; unnecessary check-ins should be avoided, while vendoring the pipeline definition and committing reviewed compiled artifacts are sanctioned.

## Deliverables

- [x] A decision record settling: `slc playbook` as the generic `playbook` pipeline (no new verb); the compile-output scope vs. host-performing infra; "performing" as compiled execution via pins; the non-reserved `playbook` link reconciliation; and the verification-test-generation contract — with the `@sublang/playbook` reference refreshed and `map.md` updated ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md))
- [x] `@sublang/playbook` installed and version-aligned (`^0.9.0`) to the release that ships the `slc/` definitions and the `./runtime` contract `slc` consumes, so the reserved `slc` resolves here (the `playbook` pipeline resolution lands with its own deliverable in Task 3)
- [x] The `playbook` domain pipeline resolvable in this repo (its `text2gears`/`gears2fsm`/`link` definitions reused from the installed package via `withReservedPipelines`), with [PIPE-11](../dev/pipeline.md#pipe-11) reconciled so the Playbook-authored target-less `link.md` loads for the `playbook` pipeline, not only the reserved `slc` name ([SELFHOST-6](../dev/self-hosting.md#selfhost-6))
- [x] `slc playbook <source>` producing `<basename>.playbook/{<basename>.gears.md, <basename>.fsm.ts}` and `slc playbook <source> --link <target>` additionally linking `<basename>.playbook.ts`, under interpreted execution, with an integration test over a faked agent transport (extends `COMPILE`, `SELFHOST`) ([SELFHOST-8](../test/self-hosting.md#selfhost-8))
- [x] Compiled execution completed for real artifacts: the player sandbox and host-side file-capability/write-scope scope removed (DR-008 superseded, `FCAP` package and code deleted), the `seedPhaseTurn`/`PhaseInput` contract settled against a real `playbook` artifact, and write scope left to the [DR-003](../decisions/003-slc-phase-execution.md) generic checks as for interpreted execution (extends `PHEXEC`)
- [x] Reviewed, committed, and pinned compiled `playbook` artifacts for the meta phases (`text2gears`, `gears2fsm`, `link`) produced via `slc slc`, selecting the best of Claude Code + Opus 4.8 and Codex + GPT-5.5, with `slc.pins.json` per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#artifact-stability) and [DR-007](../decisions/007-slc-phase-artifact-pinning.md)
- [x] The `playbook` pipeline pinned to those compiled meta-phase artifacts so `slc playbook <source>` performs through compiled execution, with current pins running compiled and stale/missing pins failing closed (extends `PHEXEC`, `COMPILE`)
- [x] Auto-generated compilation-correctness tests modeled on the reference (gears↔fsm verbatim-prompt and player-binding and `needsBossReply` coverage; fsm introspection; prompt-contract; fsm coverage), emitted beside the artifacts, in a new spec package
- [x] An equivalence harness comparing `slc playbook ../playbook/reference/sdlc/code.md` output to `../playbook/reference/sdlc/code.playbook/` for equivalence (states, verbatim prompts, player bindings, runtime contract), not byte-identity
- [ ] `map.md` updated for IR-007, the new decision record, and any new spec package(s)

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
   Confirm the existing `SELFHOST` suite is green against the installed defs.

3. **Make the `playbook` pipeline resolve and load.**
   Resolve the `playbook` pipeline to the installed `@sublang/playbook/slc/` definitions (alias) or to a vendored copy in this repo per Task 1, and reconcile [PIPE-11](../dev/pipeline.md#pipe-11) so the Playbook-authored `link.md` (no `## Link Targets`) loads for the `playbook` pipeline and not only the reserved `slc` name.
   Extend `PIPE`/`SELFHOST` items and test pipeline resolution and link loading.

4. **Run `slc playbook <source>` interpreted end to end.**
   Drive `slc playbook code.md` to the `code.gears.md` and `code.fsm.ts` compile-chain artifacts, and `slc playbook code.md --link <target>` to the linked `code.playbook.ts`, through interpreted execution at their [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) locations.
   Extend `COMPILE`/`SELFHOST` test items with an integration test over a faked agent transport.

### C. Remove the sandbox scope

5. **Remove the player-sandbox and file-capability scope.**
   Per the Boss decision, drop the deferred player sandbox and host-side file-capability staging/write-scope enforcement rather than design around it: supersede [DR-008](../decisions/008-slc-file-capability.md), delete the `FCAP` package and the `file-capability`/`file-grants` code and tests, drop the reserved `ClosureInput`/`semanticInputs` plumbing from the compiled executor, and reconcile [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract)/[DR-007](../decisions/007-slc-phase-artifact-pinning.md)/`PHEXEC` so a compiled phase writes through its agents and relies on the [DR-003](../decisions/003-slc-phase-execution.md) generic checks, like interpreted execution.
   The removed unit suites go with their code; the compiled-executor, ports, selection, and pinning suites stay green.

### D. Self-hosting compiled bootstrap (gated on real agent runs + review)

6. **Build, review, and pin the compiled meta-phase artifacts.**
   Produce compiled `playbook` artifacts for `text2gears`, `gears2fsm`, and `link` via `slc slc`, trying Claude Code + Opus 4.8 and Codex + GPT-5.5 and selecting the best, then commit the reviewed artifacts and `slc.pins.json` per [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#artifact-stability) and the [DR-007](../decisions/007-slc-phase-artifact-pinning.md) pin model.
   Judgment-produced and human-reviewed; may split one task per phase.

7. **Settle the input contract, wire the executor, and perform through the pins.**
   Settle the `seedPhaseTurn`/`PhaseInput` contract against the first real artifact (Task 6) and wire `createCompiledExecutor` into `buildDeps`, then pin the `playbook` pipeline's phases to the Task 6 artifacts and run `slc playbook code.md` through compiled execution, so a current pin runs compiled and a stale or missing pin fails closed and never silently interprets ([PHEXEC-27](../dev/phase-execution.md#phexec-27)).
   Extend `PHEXEC`/`COMPILE`; add an integration test per verdict path.

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
    Make a coherence pass over `COMPILE`, `PIPE`, `PHEXEC`, `SELFHOST`, `PIN`, and the new package(s) so items are complete, minimal, right-level, and well organized, and ensure `map.md` reflects every change.

## Acceptance criteria

- `slc playbook <source>` runs the `playbook` pipeline end to end, writing `<basename>.playbook/{<basename>.gears.md, <basename>.fsm.ts}` and, with `--link <target>`, `<basename>.playbook.ts` resolving to a `createPlaybookRuntime` factory, at their [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) locations.
- With the meta-phase artifacts built, reviewed, and pinned, `slc playbook <source>` performs through compiled execution; a current pin runs the compiled artifact, and a stale, malformed, or missing pin stops with a diagnostic and never silently interprets.
- A compiled phase reaches agents, judges, status, and telemetry only through `PlaybookPorts` and receives no host capability beyond them; its run is expected to write only the `target` or `linked` path, relying on the same [DR-003](../decisions/003-slc-phase-execution.md) generic checks as interpreted execution — which defend the protected inputs, not the full write scope — with no additional host-side enforcement.
- The generated verification tests pass against the produced artifacts and detect injected drift (a changed prompt body, a dropped state, a mis-bound player).
- The equivalence harness confirms `slc playbook ../playbook/reference/sdlc/code.md` produces artifacts equivalent to `../playbook/reference/sdlc/code.playbook/` in states, verbatim prompts, player bindings, and runtime contract, without requiring byte-identity.
- Interpreted execution, the [DR-003](../decisions/003-slc-phase-execution.md) boundary and generic checks, and the [DR-004](../decisions/004-slc-interpreted-phase-execution.md) reference semantics are unchanged, and compiled execution stays behavior-equivalent to interpreting the definition (established by review).
- The decision record, the affected spec packages, and `map.md` consistently describe the `playbook` pipeline, the compile-output scope, compiled performing, and the verification contract, with no contradictions against [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md), [DR-002](../decisions/002-slc-link-phases.md), or [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md).

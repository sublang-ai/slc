<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-009: SLC `playbook` Pipeline Compilation and Verification

## Status

Accepted

## Context

`slc playbook <source>` should compile a domain workflow description through the `playbook` pipeline.
With `--link <target>`, it should produce a runnable Playbook runtime comparable to the manual reference at `../playbook/reference/sdlc/code.playbook/`.
The reserved `slc` meta-pipeline ([DR-005](005-slc-self-hosting-meta-pipeline.md)) already compiles phase and link definitions into `playbook` artifacts using Playbook's authored `slc/` definitions (`text2gears`, `gears2fsm`, `link`), which describe a generic procedure-to-runtime compilation.
Playbook 0.9.0 [[1]] owns the `playbook` linked format and the `PlaybookRuntime` contract, and ships a generic playbook CLI and registry [[2]] that performs a compiled runtime against host-supplied agents.

This DR settles the questions a `playbook` domain pipeline raises that prior DRs leave open:

- whether `slc playbook` is a new CLI verb or the generic pipeline invocation;
- what `slc` emits versus the Playbook host;
- what "performing the pipeline from the playbook(s)" means;
- how the non-reserved `playbook` link reconciles with Playbook's target-less `link.md`;
- how compilation correctness is verified.

It builds on [DR-001](001-slc-pipeline-layout-naming-invocation.md) (layout, naming, invocation), [DR-002](002-slc-link-phases.md) (link phases), [DR-005](005-slc-self-hosting-meta-pipeline.md) (the meta-pipeline and compiled execution), and [DR-007](007-slc-phase-artifact-pinning.md) (pinning).

## Decision

### `playbook` is a generic pipeline, not a new verb

`slc playbook <source>` is the [DR-001](001-slc-pipeline-layout-naming-invocation.md#cli) `slc <pipeline> <source>` invocation with the pipeline named `playbook`, and `slc playbook <source> --link <target>` adds the terminal link phase per [DR-002](002-slc-link-phases.md#cli).
The `playbook` pipeline's compile chain is `text2gears` (`text` → `gears`) then `gears2fsm` (`gears` → `fsm`); its reserved `link.md` emits the `playbook` linked format (`fsm` → `playbook`).
The `playbook` pipeline and the reserved `slc` pipeline share the same Playbook-authored phase and link definitions, differing only in the pipeline name — hence the [DR-001](001-slc-pipeline-layout-naming-invocation.md#output-locations) artifact directory `<basename>.playbook/` versus `<basename>.slc/` — and in the conceptual source, a domain workflow versus a phase or link definition.
No new transformation rules are introduced.

### Compile output versus host-performing infrastructure

`slc`'s compile output for the `playbook` pipeline is the compile-chain artifacts (the `gears` intermediate and the `fsm` object) and, with linking, the `playbook` linked module — a `createPlaybookRuntime` factory per [DR-005](005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract).
The reference's registry entry, captain shell, `bin/playbook.js` launcher, and config template are `@sublang/playbook` host-performing infrastructure [[2]]; `slc` does not emit them.
The compilation-correctness verification bundle (see [Verification](#verification-is-deterministic-and-artifact-derived)) is `slc` output, emitted beside the artifacts.
Equivalence to the manual reference is defined over `slc`'s in-scope output and need not be byte-identical.

### Performing is compiled execution via pins

Performing the `playbook` pipeline "from the playbook(s)" means running its phases through compiled, pinned phase artifacts under [DR-005](005-slc-self-hosting-meta-pipeline.md#strategy-selection) strategy selection and [DR-007](007-slc-phase-artifact-pinning.md#currency-and-selection) pinning: a current pin runs the compiled artifact, an unpinned phase interprets, and a stale, malformed, or missing pin fails closed.
Those compiled phase artifacts are produced by `slc slc` over the same definitions, the self-hosting bootstrap of [DR-005](005-slc-self-hosting-meta-pipeline.md#artifact-stability).
Performing the produced SDLC workflow itself — hosting the compiled runtime against live Boss and agents — is the Playbook host's role [[2]] and is out of `slc`'s scope.

### Reserved-link handling covers the `playbook` link

Playbook's authored `link.md` declares `## Formats` (`fsm` `.ts` → `playbook` `.ts`) but no `## Link Targets`, because target validation for the `playbook` format is Playbook-owned ([DR-002](002-slc-link-phases.md#playbook-example), [SELFHOST-2](../dev/self-hosting.md#selfhost-2)).
The `## Link Targets` exception applies to the Playbook-authored `playbook`-format link wherever it is used — both the reserved `slc` pipeline and the `playbook` pipeline — not narrowly to the name `slc`.
`slc` resolves both through [DR-005](005-slc-self-hosting-meta-pipeline.md)'s reserved-link handling, while the rule that the linked format token differ from the object source token ([PIPE-19](../dev/pipeline.md#pipe-19)) still holds.

### Verification is deterministic and artifact-derived

`slc` shall generate compilation-correctness tests deterministically from the compiled artifacts — the `gears` source, the `fsm` object, and the linked runtime — with no agent involvement, so every build re-checks faithfulness.
The invariants, modeled on the reference, are:

- GEARS↔FSM conformance: each `gears` item maps to one executable working leaf carrying the item's actor kind and verbatim prompt or child-input body; Captain leaves also carry the player binding, and `needsBossReply` results are present where the definition requires them.
- FSM introspection: every `gears` item maps to exactly one executable leaf; every node in a structured machine carries a non-empty explicit state id and matching `meta.playbook.stateId`; and the hierarchy, both config path and public id, state types, tags, parallel joins, actor kinds, and per-node transition surfaces are pinned so unintended topology or runtime-visible identity changes are caught.
- Prompt contract: each Captain state wires the declared context fields, substitutes the declared placeholders, and orders labelled blocks as the link definition requires.
- FSM coverage: Captain results, `onDone` and `onError` arms, parallel joins, root or keyed branch-local Boss replies, and interrupt targets are driven through public state identities; nested-playbook invocations and any other transition the bounded driver cannot exercise are reported explicitly as unsupported rather than silently counted as covered.

Verification shall traverse nested and parallel state nodes through their public stable metadata rather than assume every state is a root child or that every snapshot value is scalar.
Flat machines shall retain their existing deterministic verification representation so adding structured support does not churn reviewed artifacts that did not change.
Reference equivalence shall key nested-call content by the target playbook id and compare like observable runtime capability profiles.
Because `legacy` and `session-v1` expose the same three runtime methods, the harness shall initialize fresh runtimes through each candidate's exact boundary and drive one inert non-empty turn, requiring a void result from those two profiles and a valid structured result plus `resumePlaybookCall` from `composed-v2`.
An optional immutable named export `runtimeContractProfile` may disambiguate a runtime intentionally accepting more than one initialization shape, but the marker, callable surface, and driven result boundary shall agree, and produced and reference profiles shall match exactly.
This artifact probe or marker does not replace the pin-provenance execution selection settled by [DR-010](010-playbook-runtime-contract-evolution.md).

The tests verify structural faithfulness of artifacts to source, not domain behavior, and live beside the artifacts under `<basename>.playbook/`.
The verification contract is realized as a new spec package whose items are authored when the generator lands.

## Consequences

- `slc playbook` needs no new CLI surface; it reuses [DR-001](001-slc-pipeline-layout-naming-invocation.md)/[DR-002](002-slc-link-phases.md) mechanics, so the new work is pipeline resolution, the link reconciliation, completing compiled execution, and verification generation.
- Sharing definitions with the reserved `slc` pipeline keeps one source of truth and lets the same meta-phase artifacts serve both pipelines.
- Scoping host infrastructure out keeps `slc` a compiler; performing a compiled runtime stays a Playbook-host concern.
- Deterministic, artifact-derived verification makes a judgment-produced artifact auditable on every build and underpins the reference-equivalence check.
- Generalizing the reserved-link exception avoids a per-pipeline `## Link Targets` table for Playbook-owned links.

## References

[1]: https://github.com/sublang-ai/playbook/blob/v0.9.0/slc/link.md "Playbook slc/link.md: FSM-to-runtime contract (v0.9.0)"
[2]: https://github.com/sublang-ai/playbook/blob/v0.9.0/specs/decisions/009-generic-playbook-cli-and-registry.md "Playbook generic playbook CLI and registry (v0.9.0)"

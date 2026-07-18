<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# SELFHOST: Self-Hosting Meta-Pipeline

## Intent

This package specifies how `slc` realizes the reserved `slc` meta-pipeline and
its distinct `playbook` linked format, per
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md). The meta-pipeline
runs through the generic pipeline and link mechanics specified in the `pipeline`
package and produces an artifact that the `phase-execution` package executes and
the `pinning` package pins; this package fixes only the meta-pipeline's reserved
identity, its `playbook` output format, its locations, and the `playbook` domain
pipeline's resolution to those same definitions
([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)), including
their atomic Playbook 1.0 adoption under
[DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md).

Essential project-specific references: `slc`, this project's compiler; the
reserved `slc` pipeline, the `playbook` linked format, and the host-side phase-runner facade
of [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md); and
`@sublang/playbook`, which provides the meta-pipeline definitions `slc` consumes.

## Reserved pipeline

### SELFHOST-2

The slc command shall reserve the pipeline name `slc` for the meta-pipeline that compiles phase and link definitions into runnable artifacts, resolving that reference to the shared Playbook-authored definition set ([SELFHOST-9](#selfhost-9)) rather than a duplicate, requiring it to be named explicitly (claiming no default), and leaving the invocation grammar unchanged ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#reserved-slc-pipeline), [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#cli)).

### SELFHOST-6

When resolving a `playbook` pipeline reference, the slc command shall resolve it to the same shared definition set that backs the reserved `slc` ([SELFHOST-9](#selfhost-9)), so the `playbook` and `slc` pipelines share one definition set, one pin index, and the same compiled artifacts, differing only by name and thus by [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) artifact directory ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### SELFHOST-9

When resolving the reserved `slc` or the `playbook` pipeline reference, the slc command shall resolve to the pipeline-search-root directories named `playbook` when at least one exists — a committed vendor of Playbook's definitions, whose pin index can select compiled execution — and otherwise to the meta-pipeline definitions the installed `@sublang/playbook` provides ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#reserved-slc-pipeline), [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### SELFHOST-13

When a full invocation of the `playbook` pipeline carries no `--link`, the slc command shall supply the installed `@sublang/playbook` package's `src/runtime.ts` — located by the same package resolution the pin generator uses — as the default link target and run the full-link form against it; the reserved `slc` pipeline and every other pipeline shall keep requiring an explicit `--link` ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md), [PIPE-13](pipeline.md#pipe-13)).

## Playbook format

### SELFHOST-3

Where the reserved `slc` pipeline links an `fsm` `.ts` object, the slc command shall produce the distinct `playbook` linked format as a `.ts` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) output location, whose runnable module is a `createPlaybookRuntime` factory the host-side phase-runner facade drives, and so is the artifact a pin selects and the compiled executor runs ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract), [DR-002](../decisions/002-slc-link-phases.md)).

## Entry-module emission

### SELFHOST-15

When a full-link run of the `playbook` pipeline succeeds with the linked artifact at its canonical path, the slc command shall deterministically emit `<cwd>/<basename>.ts` — an erasable-TypeScript module importing the linked module via `./<basename>.<pipeline>/<basename>.playbook.ts` and default-exporting a Playbook registry entry with `id` and `command` set to `<basename>`, `requiredRoleIds` set to the source-declared players in source order, `intent` derived from the normalized source's title and lead line, `validateOptions` a fail-closed allowlist of the linked options not supplied by the Boss turn, and `createRuntime` calling the linked default factory with `cwd ?? process.cwd()` — and shall skip the emission when `-o` relocates the linked artifact ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

## Immutable definition adoption

### SELFHOST-11

Where the dependency lock resolves immutable `@sublang/playbook@1.0.0`, when the SLC repository adopts that release's shared definition set, the adopted set shall contain the released `text2gears`, `gears2fsm`, and `link` normative content with SLC's explicit `## Pin Inputs` retained, all three reviewed meta-phase artifact bundles rebuilt and independently verified from those definitions, and every corresponding pin regenerated with exact `@sublang/playbook@1.0.0` link-target provenance; the dependency manifest and lock, all three definitions, all three bundles, and `slc.pins.json` shall be accepted only as one current set produced from a clean registry install without a sibling checkout ([DR-011](../decisions/011-playbook-1-0-captain-contract-adoption.md#atomic-reviewed-asset-adoption), [PIN-15](pinning.md#pin-15)).

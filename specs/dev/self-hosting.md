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
([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

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

## Playbook format

### SELFHOST-3

Where the reserved `slc` pipeline links an `fsm` `.ts` object, the slc command shall produce the distinct `playbook` linked format as a `.ts` artifact at its [DR-001](../decisions/001-slc-pipeline-layout-naming-invocation.md#output-locations) output location, whose runnable module is a `createPlaybookRuntime` factory the host-side phase-runner facade drives, and so is the artifact a pin selects and the compiled executor runs ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md#linked-phase-artifact-contract), [DR-002](../decisions/002-slc-link-phases.md)).

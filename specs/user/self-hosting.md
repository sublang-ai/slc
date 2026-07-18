<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# SELFHOST: Self-Hosting Meta-Pipeline

## Intent

This package specifies the user-facing contract of the reserved `slc`
meta-pipeline: how a user compiles a phase or link definition into a runnable
compiled artifact, per
[DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md). The `slc`
meta-pipeline is just another pipeline the user names explicitly; how its phases
and the `playbook` linked format are realized internally is specified in the
`self-hosting` dev package and the `pipeline` and `phase-execution` packages.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Compiling definitions

### SELFHOST-1

When the user runs the reserved `slc` pipeline on a phase or link definition, the slc command shall compile that definition through the meta-pipeline's phases into an `fsm` object artifact in the invocation working directory's artifact directory, and, when the user links it against an explicit runtime target, into a runnable compiled `playbook` artifact, so the user authors no transformation code to obtain a reviewable compiled phase ([DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md), [DR-002](../decisions/002-slc-link-phases.md#cli), [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

### SELFHOST-14

When the user runs the `playbook` pipeline on a source without `--link` or `-o`, the slc command shall additionally produce a runnable entry module `<basename>.ts` beside the artifact directory, such that `playbook run ./<basename>.ts "<task>"` performs the compiled workflow with no hand-written wiring ([DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)).

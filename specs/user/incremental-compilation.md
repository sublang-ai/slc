<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies the user-visible incremental behavior of canonical full compiler runs, per [DR-021](../decisions/021-incremental-compilation.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## History and modes

### INCR-1

Where a full or full-link invocation has canonical output and its pipeline is not the reserved `slc` meta-pipeline, when the run succeeds after executing at least one phase, the slc command shall publish one new numbered build under `<art-dir>/.slc/` containing a manifest and verbatim source and phase-output copies, with `.slc/latest` committed after the complete build.

### INCR-2

While a usable active build matches every scheduled phase's current inputs and every live target is readable, when the user repeats the eligible invocation, the slc command shall report `up to date`, invoke no phase executor, preserve live phase outputs including manual refinements, and publish no build.

### INCR-3

While the active history names another pipeline or source, or its marker, manifest, source copy, or any recorded output copy is missing, malformed, or hash-inconsistent, when the user runs an eligible invocation, the slc command shall treat the whole active build as absent, execute ordinarily without reporting history corruption as the run failure, and publish fresh history on success.

### INCR-4

While a phase's recorded inputs match but its live target has been refined by the user, when the user repeats an eligible invocation, the slc command shall reuse the live target byte-for-byte and shall treat those live bytes as the chained input and future update baseline.

### INCR-5

While a compile phase has a matching record whose current inputs differ and whose prior chained-input copy and live target are readable, when that phase executes, the slc command shall give its ordinary executor the current definition, prior input, current input, a best-effort diff when renderable, and the live prior output, with one instruction to update the complete artifact while preserving unaffected content.

### INCR-6

While an eligible run has removed its active marker before executor work, when the run fails, is cancelled, or is interrupted, the slc command shall publish no build and shall leave history inactive so the next eligible invocation executes ordinarily.

## Rebuilds and exclusions

### INCR-7

When the user passes `--rebuild` to a canonical full or full-link invocation, the slc command shall execute every phase ordinarily without update context, retain normal pin validation, and publish one complete build only when the invocation succeeds.

### INCR-8

Where an invocation uses `-o`, the reserved `slc` meta-pipeline, a single-phase or standalone-pass form, or a direct-link form, when it runs, the slc command shall neither consult nor modify build history.

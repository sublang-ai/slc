<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies fixture-based integration acceptance for incremental compilation without live model calls.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Acceptance

### INCR-18
Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-9](../dev/incremental-compilation.md#incr-9), [INCR-11](../dev/incremental-compilation.md#incr-11)

Where a fixture pipeline has no history, when an eligible full run succeeds, the artifact directory shall contain build `1` with a strict manifest and byte-identical source and ordered phase-output copies, and `.slc/latest` shall name it.

### INCR-19
Verifies: [INCR-2](../user/incremental-compilation.md#incr-2), [INCR-4](../user/incremental-compilation.md#incr-4), [INCR-14](../dev/incremental-compilation.md#incr-14)

While a fixture's active build matches its inputs, when the invocation repeats after an optional manual edit to a live final output, the slc command shall invoke zero phase executors, report `up to date`, preserve the edit, and leave history unchanged.

### INCR-20
Verifies: [INCR-5](../user/incremental-compilation.md#incr-5), [INCR-13](../dev/incremental-compilation.md#incr-13), [INCR-15](../dev/incremental-compilation.md#incr-15), [INCR-16](../dev/incremental-compilation.md#incr-16)

While a fixture has a usable active build, when its source changes, the first affected compile request shall contain the recorded prior input and rendered diff while the live target remains in place, and a downstream phase shall reuse when its predecessor produces bytes matching that phase's recorded input.

### INCR-21
Verifies: [INCR-4](../user/incremental-compilation.md#incr-4), [INCR-5](../user/incremental-compilation.md#incr-5)

While a fixture has a usable active build, when the user edits a live intermediate without changing its producer's inputs, the producer shall Reuse and the first consumer shall Update from its recorded old input while treating its own live target as the prior output.

### INCR-22
Verifies: [INCR-3](../user/incremental-compilation.md#incr-3), [INCR-10](../dev/incremental-compilation.md#incr-10)

While an active build has a malformed manifest or any missing or hash-mismatched source/output copy, when the eligible invocation repeats with unchanged inputs, every phase shall execute ordinarily without update context and a fresh complete build shall become active.

### INCR-23
Verifies: [INCR-6](../user/incremental-compilation.md#incr-6), [INCR-12](../dev/incremental-compilation.md#incr-12)

While a usable active build exists, when an executor observes that `.slc/latest` is absent and then fails after writing, the run shall publish no build, the marker shall remain absent, and the next eligible invocation shall execute every phase ordinarily.

### INCR-24
Verifies: [INCR-7](../user/incremental-compilation.md#incr-7), [INCR-14](../dev/incremental-compilation.md#incr-14)

While a usable active build exists, when the user repeats the canonical invocation with `--rebuild`, every phase shall execute without update context and a successful invocation shall publish one fresh complete build.

### INCR-25
Verifies: [INCR-8](../user/incremental-compilation.md#incr-8)

Where an invocation uses `-o`, the reserved `slc` meta-pipeline, a single-phase or standalone-pass form, or a direct-link form, when it runs, no `.slc/` path shall be read, created, removed, or replaced.

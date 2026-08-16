<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies the user-visible incremental behavior of full compiler runs: recorded build history, step reuse, agent-performed updates, and rebuilds, per [DR-021](../decisions/021-incremental-compilation.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## Build history

### INCR-1

Where a full or full-link invocation targets canonical output of a non-reserved pipeline, when the run executes at least one step, the slc command shall record a new numbered build under `<art-dir>/.slc/` — a manifest plus verbatim copies of the source and every recorded step output — and shall name it in `.slc/latest` only after the build directory is complete.

### INCR-2

Where recorded history exists whose step records all match their current input bytes, while every step's target file exists, when the user repeats the invocation, the slc command shall report `up to date`, exit zero, invoke no agent, and write no file.

### INCR-3

Where history is missing, malformed, or inconsistent with the files it names, when the user runs the full pipeline, the slc command shall execute as a first compile without failing on the bad history, and shall record fresh history on success.

## Reuse and update

### INCR-4

While a step's recorded input identities match its current input bytes and its target file exists, when a full run executes, the slc command shall skip that step and preserve its on-disk output byte-for-byte, including output the user has refined by hand.

### INCR-5

While a compile step's recorded input identities differ from its current input bytes, and the recorded prior-input copy and the step's target file both exist, when the step executes, the slc command shall supply the executor the current definition, the prior input, and a diff of prior to current input, leave the existing target in place to be updated into a complete artifact, and apply the same generic checks as an ordinary run; a link step whose recorded inputs differ shall instead execute in full without update context.

### INCR-6

When a full run fails after executing at least one step, the slc command shall record the completed steps and carry forward the prior records of the rest, so that a repeat invocation reuses the completed work instead of re-executing it.

## Rebuilds and exclusions

### INCR-7

When the user passes `--rebuild` on a full or full-link invocation without `-o`, the slc command shall execute every step ordinarily — bypassing reuse and update but not pin validation — and shall record fresh history from the steps it completed, carrying no prior records forward.

### INCR-8

Where an invocation uses `-o`, the reserved `slc` meta-pipeline, or a single-phase, standalone-pass, or direct-link form, when it runs, the slc command shall neither consult nor write build history.

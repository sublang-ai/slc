<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies the complete-snapshot store, phase identities, selection, update context, and publication mechanics implementing [DR-021](../decisions/021-incremental-compilation.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## Complete snapshots

### INCR-9

When the slc command records an eligible build, the slc command shall write schema `sublang.slc.build.v1`, the pipeline, a source locator and exact-byte SHA-256 hash, and an ordered record per scheduled phase containing exactly its kind, name, target locator, ordered input hashes, and output hash; the build shall store the source at `source` and phase output `<index>` at `outputs/<index>`.

### INCR-10

When the slc command loads the build named by `.slc/latest`, the slc command shall validate the marker, strict manifest, source copy, every ordered output copy, and every recorded hash as one unit, returning no history rather than an error when any member is unusable.

### INCR-11

When the slc command publishes a build, the slc command shall claim a new positive numbered directory exclusively, write its complete fixed-path contents without traversing a pre-existing numbered entry, retain prior numbered builds, and rename a unique temporary marker to `.slc/latest` only after every build file is complete.

### INCR-12

While an eligible run has a valid active marker, when its first phase is selected for Update or Ordinary execution, the slc command shall remove that marker before invoking the executor and shall stop before executor work when the valid marker cannot be removed.

## Identity and selection

### INCR-13

When an eligible run computes a compile phase's current identities, the slc command shall hash exact bytes in this order: chained input, definition, explicit references, then the definition's declared local `## Pin Inputs`; for a link phase it shall hash ordered object locators and bytes, the link definition, link-target locator and content, and ordered option pairs with unambiguous framing.

### INCR-14

Where the active manifest names the invocation's pipeline and source locator, when an eligible run selects a scheduled phase, the slc command shall compare the record at the same schedule index and target: matching identities plus a readable live target selects Reuse; a matching compile record with differing identities, an intact prior-input copy, and a readable live target selects Update; every other case and every `--rebuild` phase selects Ordinary, while a link phase never selects Update.

## Update and publication

### INCR-15

When a compile phase executes in Update mode, the slc command shall extend its ordinary execution request with a read-only path to the recorded prior chained input and a host-computed unified line diff or an explicit unavailable value, and shall protect the prior copy like an ordinary reference input.

### INCR-16

Where a compile phase executes in Update mode, when its interpreted or compiled performing prompt is built, the slc command shall append one host-owned instruction naming the prior input and existing target, asking the agent to apply the input changes under the current definition, preserve unaffected content and refinements, and leave a complete artifact, without adding an update contract or changing ordinary acceptance.

### INCR-17

When an eligible invocation finishes successfully after executing at least one phase and completing required deterministic post-processing, the slc command shall materialize the current source and every scheduled live phase output into one complete build and publish it once.

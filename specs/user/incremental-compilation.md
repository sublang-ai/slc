<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies the user-visible build lineage, reuse, scoped-update, conflict, and rebuild behavior of an incremental compiler run.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Build lineage and reuse

### INCR-1

Where an invocation is a full or full-link pipeline run with canonical output or `-o`, when the run succeeds after executing at least one scheduled step or accepting an explicit adoption, the slc command shall for canonical output other than the reserved `slc` meta-pipeline leave a versioned build record and verbatim source snapshot in the invocation working directory's artifact directory — binding the accepted bundle to the source locator and bytes, pipeline build identity, invocation semantics, artifact bytes, and ordinary, updated, or explicitly adopted origin without changing [DR-014](../decisions/014-cwd-output-invocation-defaults-entry-emission.md)'s placement — and shall for `-o` or the reserved meta-pipeline retain non-incremental behavior without creating or advancing either lineage file ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#build-lineage)).

### INCR-2

Where the source locator and bytes, build identity, invocation semantics, snapshot, and every scheduled output match a supported build record and either every scheduled semantic step has a closed content-identified readable-input declaration or the complete lineage carries current explicit-adoption authority, when the user repeats the full or full-link invocation, the slc command shall report the bundle up to date, exit zero, invoke no agent, and rewrite no source, artifact, snapshot, or build record ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#explicit-adoption)).

## Changed sources

### INCR-3

Where a changed source belongs to a non-adopted lineage and maps completely through a current build record and the pipeline's update contracts to an eligible semantic scope closure, when the user repeats the full or full-link invocation, the slc command shall update that closure, preserve every protected scope byte-for-byte, rebuild or reuse downstream products according to their actual inputs, and accept the new bundle only after the complete applicable verification succeeds ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#deterministic-update-planning), [DR-021](../decisions/021-incremental-build-records-scoped-updates.md#scoped-execution-and-acceptance)).

### INCR-4

Where a changed source belongs to a non-adopted lineage and is not eligible for scoped update because its mapping, structure, or build identity requires ordinary execution, when the user repeats the full or full-link invocation, the slc command shall select ordinary execution before invoking an agent and shall reuse only downstream products whose recomputed inputs remain exact matches ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#deterministic-update-planning)).

### INCR-5

Where a scoped-update candidate whose execution honors the supplied physical workspace binding is blocked, changes a protected scope, fails a generic check, or fails applicable verification, when the slc command evaluates it, the slc command shall discard the candidate, write no candidate byte to the canonical bundle, source snapshot, or build record, exit non-zero with the reason and `--rebuild` guidance, and shall not automatically invoke ordinary execution as a retry; a detected write outside that binding shall fail without promotion but is not promised an unsafe rollback ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#scoped-execution-and-acceptance)).

## Conflicts and rebuilds

### INCR-6

Where an artifact directory has malformed, unsupported, orphaned, wrong-typed, or symbolic-link lineage metadata, is recorded for another source locator, has an inconsistent source snapshot, or contains a managed artifact changed outside an accepted incremental run, when the user runs the canonical full or full-link pipeline without `--adopt`, the slc command shall refuse to overwrite the bundle and identify the conflict if `--rebuild` is absent, and shall run the complete pipeline without reuse or scoped update and replace the binding only after success if `--rebuild` is present ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

## Explicit adoption

### INCR-33

Where a valid unchanged-source lineage contains manually refined semantic artifacts, when the user runs its canonical non-`slc` full or full-link invocation with `--adopt`, the slc command shall make the user's explicit attestation the authority for the complete current semantic bundle, invoke no agent, clear scoped-update traces, regenerate and run the applicable deterministic verification, preserve the semantic artifacts and source snapshot byte-for-byte, and record and report the adopted products only after success; the next exact invocation shall be an up-to-date no-op, while source or build-identity drift, invalid lineage, or an unsafe product shall be refused with `--rebuild` guidance ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#explicit-adoption)).

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies the generic build-record, currentness, incremental-planning, update-contract, protected-scope, and lineage mechanics used by incremental compiler runs.
Phase-specific update semantics remain owned by pipeline definitions under [DR-003](../decisions/003-slc-phase-execution.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## Build record

### INCR-7

Where an invocation is a full or full-link run with canonical output or `-o`, when it succeeds, the slc command shall, for canonical output other than the reserved `slc` meta-pipeline, write regular non-symbolic-link files `<art-dir>/.slc-build.json` and `<art-dir>/.slc-source`, the first as schema-exact JSON with schema `sublang.slc.build.v1` and hash algorithm `sha256` and the second as the verbatim source bytes, with the record containing exact `sha256:<64-lowercase-hex>` identities for the source and snapshot, a normalized relative POSIX locator derived from the resolved invocation source path, the ordered build plan and all output-affecting definition, selected-executor, declared-semantic-input, link-target, compatibility, and semantic-option identities, each step's input key and target path/hash, a complete artifact-product inventory and hashes that excludes both lineage metadata files, any validated update trace, producer provenance for `slc` and the resolved pipeline and link-runtime package versions, format compatibility such as Playbook `spec.compat`, and build/update generation provenance; inventory paths shall be derivable from the recorded canonical plan, managed paths shall be relative POSIX paths confined to the artifact directory except for the exact canonical entry path and shall resolve through no symbolic-link product or parent, timestamps and version labels without content or compatibility identity shall not establish currentness, and the slc command shall, for `-o` or the reserved meta-pipeline, write no build record ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#build-lineage), [DR-007](../decisions/007-slc-phase-artifact-pinning.md#hashing-and-portability)).

### INCR-8

Where a canonical full or full-link run produces candidate artifacts and verification products, when the run completes, the slc command shall isolate executed writes in staged state while presenting canonical logical source and target locators to phase semantics, keep staging locators out of artifact bytes and trace identity, make later steps consume staged or validated accepted predecessors, preserve unrecorded paths without replacing the artifact directory, omit formerly managed products absent from the candidate plan, revalidate the source, build inputs, accepted record, and managed bytes immediately before promotion, abort on a concurrent managed change, and promote only validated managed-path changes, the entry module, source snapshot, and build record under a recoverable lineage transaction, so rejection leaves prior accepted files byte-identical, concurrent unrecorded-file changes survive untouched, and an interrupted promotion is recovered to one complete lineage before reuse ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#build-lineage), [PHEXEC-3](phase-execution.md#phexec-3), [PHEXEC-34](phase-execution.md#phexec-34), [PIPE-8](pipeline.md#pipe-8)).

## Currentness and planning

### INCR-9

Where either reserved lineage-metadata path is present, when the slc command plans a full or full-link run, the slc command shall treat an orphaned record or snapshot, malformed JSON, a missing, unknown, or wrong-typed schema field, an unsupported schema or hash algorithm, either metadata path being a symbolic link or wrong file type, an invalid managed path, or an inventory path not derivable from the recorded canonical plan as a conflict; otherwise it shall validate every applicable pin before reuse, verify the source snapshot and every recorded input and managed output by exact bytes, classify an unexpected snapshot or managed-output mismatch as a conflict, classify changed source bytes or changed build-plan inputs as rebuild inputs rather than current state, and make a phase with no closed content-identified declaration of its output-affecting readable inputs ineligible for reuse or update ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts), [PHEXEC-27](phase-execution.md#phexec-27), [DR-007](../decisions/007-slc-phase-artifact-pinning.md#semantic-input-closure)).

### INCR-10

Where a recorded pipeline step's current input key, definition/executor identity, semantic options, and target bytes match its record, when the slc command walks the ordered build plan, the slc command shall reuse that step only after any applicable pin has passed [DR-007](../decisions/007-slc-phase-artifact-pinning.md#currency-and-selection)'s validation and selected the recorded executor; after executing a dirty step, it shall compute downstream currentness from the candidate's actual output hash so byte-identical regeneration does not invalidate an otherwise-current downstream step ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

### INCR-11

Where every applicable pin has passed validation and a dirty pipeline step either has no complete update contract and validated trace or has definition, executor, declared-semantic-input, link-target, compatibility, or semantic-option drift that remains valid for ordinary execution, when the slc command plans that step, the slc command shall select its ordinary execution without asking an agent to classify the change ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#deterministic-update-planning), [DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).

## Update contracts and execution

### INCR-12

Where a phase definition contains a `## Update` section, the definition shall use that section to specify its stable input units, target scopes, dependency expansion, structural or global scopes, semantic update instructions, and verification; the slc command shall treat the section as the phase's opt-in update contract and shall contain no format-specific update rule, change-ratio threshold, or generation threshold ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#deterministic-update-planning), [DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).

### INCR-13

Where a definition declares scoped-update support, when an ordinary or update execution succeeds through either the interpreted or compiled strategy, the shared host executor outcome shall allow one optional `sublang.slc.update.v1` metadata value rather than a filesystem output, with exact input and target identities, complete ordered non-overlapping byte-range partitions carrying stable opaque scope identifiers, and dependency and classification edges; interpreted execution shall return it directly, while compiled execution shall obtain it only by diverting the same reserved topic from Playbook's existing `emitTelemetry` port into a dedicated protected SLC-update metadata sink, without changing or relaxing the exact Playbook turn-result, `playbook.trace`, status, or diagnostic contracts; the slc command shall validate only the generic byte coverage and graph shape, shall disable later update when the strategy or runtime supplies no valid metadata, and shall reject an update candidate that omits or malforms its replacement metadata ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#trace-contract), [PHEXEC-3](phase-execution.md#phexec-3), [PHEXEC-39](phase-execution.md#phexec-39)).

### INCR-14

Where a prior accepted trace is available for a dirty step, when the slc command determines scoped-update eligibility, the slc command shall compute a provisional dirty-unit and target dependency closure without an agent call, select ordinary execution for a mechanically evident unmapped or ambiguous span, changed recorded structural or global scope, cross-unit edit, broken ordering, or incomplete trace, and otherwise let the update candidate's replacement trace prove that eligible input-unit structure, classifications, and dependency closure remain within the provisional boundary ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#deterministic-update-planning)).

### INCR-15

Where a dirty phase is eligible for scoped update, when the slc command executes its update contract, the slc command shall provide the complete current and prior inputs, their exact diff, the prior complete target, and the allowed target-scope closure; require a complete candidate target and out-of-band replacement trace; stage the candidate; and reject it unless the replacement trace preserves the eligible input-unit structure and classifications without expanding the allowed dependency closure, every target scope outside the allowed closure keeps the same identifier, order, and exact bytes, every added, removed, or changed target scope lies inside that closure, every protected input remains unchanged, the trace is structurally valid, and the ordinary generic and definition-owned semantic checks pass ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#scoped-execution-and-acceptance), [PHEXEC-5](phase-execution.md#phexec-5), [PHEXEC-6](phase-execution.md#phexec-6)).

### INCR-16

Where a scoped-update execution or its required downstream verification is blocked or rejected, when the slc command reports the failure, the slc command shall discard the complete staged run, leave the prior accepted bundle and build record byte-identical, recommend `--rebuild`, and make no automatic ordinary-phase invocation, so one failed update does not become a hidden second agent call ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#scoped-execution-and-acceptance), [PHEXEC-12](phase-execution.md#phexec-12)).

### INCR-17

Where an accepted step changes its output bytes, when the slc command continues the build, the slc command shall replan every downstream step from the changed bytes, execute every dirty link in full because link phases are not scoped-update-capable in this schema version, regenerate deterministic entry and verification products whose inputs changed, run the complete applicable emitted verification suite, and record the new lineage only after all required checks succeed ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#scoped-execution-and-acceptance), [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md#verification-is-deterministic-and-artifact-derived)).

## Playbook trace and explicit rebuild

### INCR-18

Where the `playbook` pipeline declares scoped-update support, when a full or full-link run records its traces, the Playbook-owned update contracts shall describe normalized steps, GEARS items, FSM states, and their dependencies through the generic opaque scopes and edges of [INCR-13](#incr-13); the slc command shall validate that generic trace without hard-coding those meanings and shall select ordinary execution when any contract-required edge or declared structural scope is absent or inconsistent ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#playbook-traceability), [DR-003](../decisions/003-slc-phase-execution.md#generic-vs-phase-specific)).

### INCR-19

Where an invocation carries `--rebuild`, when the slc command validates its form, the slc command shall accept only a canonical full or full-link invocation without `-o` — bypassing build-record reuse and scoped-update planning, permitting explicit replacement or source rebinding, and executing the complete ordinary plan; for a lineage-eligible pipeline it shall replace the snapshot and record entries themselves only after success without following their symbolic links or trusting an invalid prior inventory for deletion, while for the reserved `slc` meta-pipeline it shall write no lineage metadata — and shall refuse every other form ([DR-021](../decisions/021-incremental-build-records-scoped-updates.md#exact-reuse-and-conflicts)).

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies integration acceptance for build records, exact reuse, scoped updates, conflicts, and explicit rebuilds through the `slc` command.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Build records and reuse

### INCR-20
Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-7](../dev/incremental-compilation.md#incr-7), [INCR-8](../dev/incremental-compilation.md#incr-8), [INCR-13](../dev/incremental-compilation.md#incr-13), [PHEXEC-39](../dev/phase-execution.md#phexec-39)

Where interpreted and compiled fixture pipelines return valid, absent, or malformed optional trace metadata through their respective host-result and protected-telemetry channels, when canonical full and full-link runs succeed, the slc command shall for each valid channel leave `.slc-source` as the verbatim source and a strict `sublang.slc.build.v1` `.slc-build.json` whose artifact-directory-relative source locator, source, plan, step carrying `origin: "ordinary"`, managed intermediate, linked-product, verification-product, entry-product, generic trace, SLC and pipeline/runtime version provenance, and format compatibility match the accepted run without changing the compiled runtime's Playbook result or diagnostic mapping, and shall for absent or malformed metadata still accept an ordinary artifact with scoped update disabled and no trace sidecar.

### INCR-32
Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-7](../dev/incremental-compilation.md#incr-7), [SELFHOST-2](../dev/self-hosting.md#selfhost-2), [PIN-15](../dev/pinning.md#pin-15)

Where a deterministic fixture reserved `slc` meta-pipeline builds a reviewed phase-artifact bundle and its pin is regenerated, when the same self-host build and pin validation repeat, the slc command shall write no `.slc-build.json` or `.slc-source` inside the artifact bundle and the regenerated pin shall reach the same current artifact-tree identity rather than a lineage feedback cycle.

### INCR-21
Verifies: [INCR-2](../user/incremental-compilation.md#incr-2), [INCR-9](../dev/incremental-compilation.md#incr-9), [INCR-10](../dev/incremental-compilation.md#incr-10), [COMPILE-7](../user/compiler.md#compile-7), [COMPILE-8](../user/compiler.md#compile-8), [PIPE-32](../dev/pipeline.md#pipe-32), [PIPE-34](../dev/pipeline.md#pipe-34), [SELFHOST-15](../dev/self-hosting.md#selfhost-15)

Where independent successful fixture builds with closed readable-input declarations cover a reusable normalization step, discovered optimization pass, and canonical Playbook entry product and every recorded input and output remains byte-identical, when each full or full-link command repeats with executors and filesystem-write observers that fail if called, the slc command shall exit zero, report the bundle up to date, make no executor call, and perform no write to the source, managed artifacts including the entry, snapshot, or record.

### INCR-22
Verifies: [INCR-4](../user/incremental-compilation.md#incr-4), [INCR-10](../dev/incremental-compilation.md#incr-10), [INCR-11](../dev/incremental-compilation.md#incr-11)

Where a non-adopted lineage's recorded step becomes dirty because its definition, executor identity, options, or input changed and scoped update is unavailable, when the full pipeline runs, the slc command shall execute the earliest dirty step ordinarily and shall reuse a downstream step only when the candidate restores that step's exact recorded input key.

## Scoped updates

### INCR-23
Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-3](../user/incremental-compilation.md#incr-3), [INCR-7](../dev/incremental-compilation.md#incr-7), [INCR-12](../dev/incremental-compilation.md#incr-12), [INCR-13](../dev/incremental-compilation.md#incr-13), [INCR-14](../dev/incremental-compilation.md#incr-14), [INCR-15](../dev/incremental-compilation.md#incr-15), [INCR-17](../dev/incremental-compilation.md#incr-17)

Where a fixture `## Update` contract and prior trace map a localized source edit to a closed dirty scope, when the full pipeline runs, the slc command shall select update without a classification call, pass the complete prior/current inputs and allowed closure, accept a candidate that changes only that closure, preserve every other scope byte-for-byte, execute a dirty link in full, and rebuild or reuse each other downstream and deterministic product from its actual input identity before recording `origin: "updated"` for the scoped-updated step, preserving the prior origin for an exactly reused step, and recording `origin: "ordinary"` for a downstream step executed in full in the new lineage.

### INCR-24
Verifies: [INCR-4](../user/incremental-compilation.md#incr-4), [INCR-11](../dev/incremental-compilation.md#incr-11), [INCR-14](../dev/incremental-compilation.md#incr-14), [INCR-18](../dev/incremental-compilation.md#incr-18)

Where a non-adopted lineage's source edit is mechanically unmapped or ambiguous under the prior trace, touches a recorded structural or global scope, crosses stable-unit boundaries, breaks recorded ordering, or reaches a phase without a complete `## Update` contract and trace, when the full pipeline runs, the slc command shall choose ordinary execution before any update or classification agent call.

### INCR-25
Verifies: [INCR-5](../user/incremental-compilation.md#incr-5), [INCR-13](../dev/incremental-compilation.md#incr-13), [INCR-15](../dev/incremental-compilation.md#incr-15), [INCR-16](../dev/incremental-compilation.md#incr-16)

Where an update executor honors its physical workspace binding and returns `BLOCKED`, changes a protected target scope, emits a replacement trace that splits, merges, reorders, reclassifies, or expands the provisional eligible closure, emits any other invalid trace, or produces a candidate whose downstream step or applicable verification fails, when the full pipeline runs, the slc command shall discard the complete staged run, leave the prior accepted bundle, source snapshot, and build record byte-identical, exit non-zero with the reason and `--rebuild` guidance, and make no ordinary-phase retry; a companion executor that mutates a staged readable input shall fail as a scope violation without promoting any staged byte.

## Conflicts and rebuilds

### INCR-26
Verifies: [INCR-6](../user/incremental-compilation.md#incr-6), [INCR-9](../dev/incremental-compilation.md#incr-9), [INCR-19](../dev/incremental-compilation.md#incr-19)

Where fixture bundles have malformed or unsupported records including an unknown `origin`, an orphan record or snapshot, a wrong-typed or symbolic-link metadata path, another source locator, a snapshot identity mismatch, an adopted lineage with incompatible plan topology, a missing semantic product, or an unsafe managed path, when canonical full or full-link commands run respectively without and with `--rebuild`, the slc command shall for the first exit non-zero naming the conflict and only `--rebuild` guidance without overwriting it and shall for the second execute every ordinary step, replace the reserved metadata entries without following a symlink target, and replace the source binding and record while preserving unrecorded files.

### INCR-27
Verifies: [INCR-8](../dev/incremental-compilation.md#incr-8), [INCR-16](../dev/incremental-compilation.md#incr-16), [INCR-19](../dev/incremental-compilation.md#incr-19)

Where a prior accepted bundle exists and executing phases honor their physical workspace bindings, when an incremental or `--rebuild` candidate is rejected or lineage promotion is interrupted, the slc command shall preserve the accepted lineage for a staged rejection or recover one complete accepted lineage after interrupted host promotion and shall never treat mixed or unrecorded candidate bytes as current; a separately observed concurrent managed-file edit shall be detected without overwrite or rollback and shall block reuse as a conflict.

### INCR-28
Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-19](../dev/incremental-compilation.md#incr-19), [PIPE-9](../dev/pipeline.md#pipe-9)

Where fixture invocations cover a full or full-link run with `-o` and every unsupported `--rebuild` form, when the slc command runs them, the slc command shall retain the overridden output behavior without creating or advancing a build record or source snapshot in the first case and shall refuse `--rebuild` combined with `--adopt`, `-o`, a single-phase, standalone-pass, or direct-link invocation.

### INCR-29
Verifies: [INCR-9](../dev/incremental-compilation.md#incr-9), [INCR-10](../dev/incremental-compilation.md#incr-10), [COMPILE-6](../user/compiler.md#compile-6)

Where an otherwise-current non-adopted fixture has either a stale or malformed phase pin or a phase without a closed content-identified readable-input declaration, when the same full pipeline runs, the slc command shall fail before reuse in the pin case and execute rather than reuse the unclosed phase in the declaration case.

### INCR-30
Verifies: [INCR-8](../dev/incremental-compilation.md#incr-8), [INCR-17](../dev/incremental-compilation.md#incr-17)

Where a prior accepted bundle contains an unrecorded file that remains unchanged or is edited concurrently and a managed product absent from a changed successful plan, when the canonical full pipeline promotes the new lineage, the slc command shall preserve the latest unrecorded file byte-for-byte and remove the obsolete managed product.

### INCR-31
Verifies: [INCR-8](../dev/incremental-compilation.md#incr-8), [PHEXEC-3](../dev/phase-execution.md#phexec-3), [PHEXEC-6](../dev/phase-execution.md#phexec-6), [PHEXEC-25](../dev/phase-execution.md#phexec-25), [PHEXEC-29](../dev/phase-execution.md#phexec-29), [PHEXEC-34](../dev/phase-execution.md#phexec-34)

Where independent interpreted, compiled Player, and compiled direct-Captain fixture phases derive output bytes and trace identities from their supplied source and target locators, each reads both a changed candidate predecessor and an unchanged read-only input, and one fixture instead writes the canonical logical target while its staged sink differs, when canonical full or full-link candidates including a cold build execute through staged state, the slc command shall retain the canonical plan's logical locators in phase semantics and the compiled Boss request, bind each compliant performing agent to the staged predecessor, canonical unchanged read-only input, and staged write sink in its host workspace contract, accept compliant bytes containing no staging locator, and fail the direct canonical-path write as a scope violation without promoting its candidate, source snapshot, or record.

## Explicit adoption

### INCR-36
Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-2](../user/incremental-compilation.md#incr-2), [INCR-6](../user/incremental-compilation.md#incr-6), [INCR-7](../dev/incremental-compilation.md#incr-7), [INCR-9](../dev/incremental-compilation.md#incr-9), [INCR-33](../user/incremental-compilation.md#incr-33), [INCR-34](../dev/incremental-compilation.md#incr-34), [INCR-35](../dev/incremental-compilation.md#incr-35), [COMPILE-1](../user/compiler.md#compile-1), [COMPILE-7](../user/compiler.md#compile-7), [COMPILE-8](../user/compiler.md#compile-8), [PIPE-32](../dev/pipeline.md#pipe-32), [PIPE-34](../dev/pipeline.md#pipe-34), [SELFHOST-15](../dev/self-hosting.md#selfhost-15)

Where paired unchanged-source raw-source full-link fixture lineages have scheduled normalization and optimization-pass products, a manually refined intermediate, correspondingly refined downstream semantic products, at least one semantic step without a closed readable-input declaration, and respectively edited old verifier/entry products or one safe missing deterministic derivative, and one fixture's current definitions, declared semantic inputs, link target, compatibility, options, generators, checkers, and a new valid current pin's selected executor identity differ from the record without changing ordered semantic-product roles, formats, or target paths, when each canonical command first repeats without an option and then runs with `--adopt`, both under a semantic executor that fails if called, and finally repeats without an option under semantic-executor and filesystem-write observers that fail if called, the slc command shall on the first repeat refuse without a write and name both `--adopt` and `--rebuild`, shall during adoption invoke no semantic executor, leave every semantic product and the source snapshot byte-identical, replace or restore the deterministic verifier and entry from trusted current generators, pass the complete regenerated verification, record every scheduled semantic product including normalization and the pass with `origin: "user-adopted"` and no update trace, record the current build identity and the rebaselined fixture's prior-to-current transition, report those products, and shall on the final repeat report up to date without an executor call or filesystem write.

### INCR-37
Verifies: [INCR-6](../user/incremental-compilation.md#incr-6), [INCR-9](../dev/incremental-compilation.md#incr-9), [INCR-33](../user/incremental-compilation.md#incr-33), [INCR-34](../dev/incremental-compilation.md#incr-34), [INCR-35](../dev/incremental-compilation.md#incr-35), [COMPILE-6](../user/compiler.md#compile-6), [PIPE-9](../dev/pipeline.md#pipe-9), [PHEXEC-27](../dev/phase-execution.md#phexec-27)

Where adoption fixtures respectively use `-o`, `--rebuild`, the reserved `slc` meta-pipeline, a single-phase, standalone-pass, or direct-link form, absent, malformed, or orphaned lineage, changed source or snapshot bytes, another source locator, incompatible plan topology, a missing, wrong-typed, unsafe, or symbolic-link semantic product, or an otherwise-eligible product that fails a generic or load-integrity check, separate otherwise-eligible fixtures have semantically inconsistent current products or successfully adopted lineages followed by source, snapshot, locator, compatible build-identity, incompatible topology, or semantic-product drift, and separate invalid-current-pin fixtures cover automatic, `--adopt`, and `--rebuild` commands, when each command runs, the slc command shall reject every case without a semantic executor call or source rebinding and name the ineligible form or conflict; for a binding-compliant adoption failure it shall write no candidate byte to a canonical path, each otherwise-eligible adoption candidate shall regenerate trusted verification in staged state, the inconsistent fixture shall refuse adoption with guidance to repair it and retry `--adopt` or use `--rebuild`, each post-adoption automatic conflict shall perform no write, compatible build-identity or safe semantic-product drift shall name both `--adopt` and `--rebuild`, every other ineligible conflict shall name only `--rebuild`, and every invalid-pin command shall fail before execution with the pin diagnostic and explicit compiled-artifact build-and-review guidance rather than either lineage option.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# incremental-compilation: Incremental Compilation

## Intent

This package specifies the user-visible incremental behavior and the internal complete-snapshot store, phase identities, selection, update context, and publication mechanics of canonical full compiler runs under [DR-021](../decisions/021-incremental-compilation.md).
Essential project-specific reference: `slc`, this project's compiler CLI.

## External Behavior

### History and modes

#### incremental-compilation-1

Where a full invocation [[pipeline-9](pipeline.md#pipeline-9)] or full-link invocation [[pipeline-13](pipeline.md#pipeline-13)] has canonical output [[pipeline-8](pipeline.md#pipeline-8)], [[pipeline-15](pipeline.md#pipeline-15)] and its pipeline is not the reserved `slc` meta-pipeline, when the run succeeds after executing at least one phase, the slc command shall publish one new numbered build under `<art-dir>/.slc/` [[pipeline-7](pipeline.md#pipeline-7)] containing a manifest and verbatim source and phase-output copies [[incremental-compilation-9](#incremental-compilation-9)], with `.slc/latest` committed after the complete build [[incremental-compilation-11](#incremental-compilation-11)], [[incremental-compilation-17](#incremental-compilation-17)].

#### incremental-compilation-2

While a usable active build [[incremental-compilation-10](#incremental-compilation-10)] matches every scheduled phase's current inputs [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-14](#incremental-compilation-14)] and every live target is readable, when the user repeats the eligible invocation, the slc command shall report `up to date`, invoke no phase executor, preserve live phase outputs including manual refinements, and publish no build.

#### incremental-compilation-3

While the active history names another pipeline or source, or its history directory, marker, manifest, source copy, or any recorded output copy is missing, malformed, or hash-inconsistent [[incremental-compilation-10](#incremental-compilation-10)], when the user runs an eligible invocation, the slc command shall treat the whole active build as absent, execute ordinarily [[incremental-compilation-14](#incremental-compilation-14)] without reporting history corruption as the run failure, and treat any inability to publish fresh history as an advisory diagnostic [[incremental-compilation-17](#incremental-compilation-17)].

#### incremental-compilation-4

While a phase's recorded inputs match but its live target has been refined by the user, when the user repeats the eligible invocation, the slc command shall reuse the live target byte-for-byte [[incremental-compilation-14](#incremental-compilation-14)] and shall treat those live bytes as the chained input and future update baseline.

#### incremental-compilation-5

While a compile phase has a matching record whose current inputs differ and whose prior chained-input copy and live target are readable [[incremental-compilation-14](#incremental-compilation-14)], when that phase executes, the slc command shall give its ordinary executor [[phase-execution-11](phase-execution.md#phase-execution-11)], [[phase-execution-23](phase-execution.md#phase-execution-23)] the current definition [[phase-execution-2](phase-execution.md#phase-execution-2)], prior input, current input, a best-effort diff when renderable, and the live prior output [[incremental-compilation-15](#incremental-compilation-15)], with one instruction to update the complete artifact while preserving unaffected content [[incremental-compilation-16](#incremental-compilation-16)].

#### incremental-compilation-6

While an eligible run has removed its active marker before executor work [[incremental-compilation-12](#incremental-compilation-12)], when the run fails, is cancelled, or is interrupted, the slc command shall publish no build and shall leave history inactive [[incremental-compilation-17](#incremental-compilation-17)] so the next eligible invocation executes ordinarily.

### Rebuilds and exclusions

#### incremental-compilation-7

When the user passes `--rebuild` to a canonical full invocation [[pipeline-9](pipeline.md#pipeline-9)] or full-link invocation [[pipeline-13](pipeline.md#pipeline-13)], the slc command shall execute every phase ordinarily without update context [[incremental-compilation-14](#incremental-compilation-14)], retain normal pin validation [[phase-execution-27](phase-execution.md#phase-execution-27)], and publish one complete build only when the invocation succeeds [[incremental-compilation-17](#incremental-compilation-17)].

#### incremental-compilation-8

Where an invocation uses `-o` [[pipeline-8](pipeline.md#pipeline-8)], the reserved `slc` meta-pipeline, a single-phase form [[pipeline-9](pipeline.md#pipeline-9)], standalone-pass form [[pipeline-33](pipeline.md#pipeline-33)], or direct-link form [[pipeline-12](pipeline.md#pipeline-12)], when it runs, the slc command shall neither select execution from nor publish build history, but shall remove a usable active marker before overwriting a target recorded by that build [[incremental-compilation-26](#incremental-compilation-26)].

## Internal Behavior

### Complete snapshots

#### incremental-compilation-9

When the slc command records an eligible build, the slc command shall write schema `sublang.slc.build.v1`, the pipeline, a source locator and exact-byte SHA-256 hash, and an ordered record per scheduled phase [[pipeline-4](pipeline.md#pipeline-4)], [[pipeline-13](pipeline.md#pipeline-13)], [[pipeline-32](pipeline.md#pipeline-32)], [[pipeline-34](pipeline.md#pipeline-34)] containing exactly its kind, name, target locator, ordered input hashes, and output hash; the build shall store the source at `source` and phase output `<index>` at `outputs/<index>`.

#### incremental-compilation-10

When the slc command loads the build named by `.slc/latest`, the slc command shall validate the marker, strict manifest, source copy, every ordered output copy, and every recorded hash as one unit, returning no history rather than an error when any member is unusable.

#### incremental-compilation-11

When the slc command publishes a build, the slc command shall claim a new positive numbered directory exclusively, write its complete fixed-path contents without traversing a pre-existing numbered entry, retain prior numbered builds, and rename a unique temporary marker to `.slc/latest` only after every build file is complete.

#### incremental-compilation-12

While an eligible run has a valid active marker, when its first phase is selected for Update or Ordinary execution, the slc command shall remove that marker before invoking the executor and shall stop before executor work when the valid marker cannot be removed.

### Identity and selection

#### incremental-compilation-13

When an eligible run computes a compile phase's current identities, the slc command shall constrain local closure paths to the recorded pin boundary when present and otherwise to the pipeline directory, and hash in this order: chained-input exact bytes, definition exact bytes, explicit-reference exact bytes, then the phase definition's applicable local closure [[pinning-17](pinning.md#pinning-17)] — for a sidecar entry, an unambiguously framed identity of the phase key and resolved closure-member locators encoded as canonical pipeline-relative POSIX paths in ascending UTF-8 byte order followed by the members' exact-byte hashes in that order, with no well-formed unrelated entry or JSON presentation contributing, and for an inline declaration, the closure members' exact bytes in transitive declaration order — followed by the Markdown references' transitive inline `## Pin Inputs` closure bytes [[phase-execution-15](phase-execution.md#phase-execution-15)], [[phase-execution-33](phase-execution.md#phase-execution-33)]; for a link phase it shall hash ordered object locators and bytes, the link definition [[phase-execution-2](phase-execution.md#phase-execution-2)] and its applicable local closure under the same boundary and sidecar-or-inline rules, link-target locator and content [[pipeline-12](pipeline.md#pipeline-12)], and ordered option pairs with unambiguous framing [[pipeline-14](pipeline.md#pipeline-14)] ([DR-026](../decisions/026-slc-owned-pin-input-declarations.md)).

#### incremental-compilation-14

Where the active manifest names the invocation's pipeline and source locator, when an eligible run selects a scheduled phase [[pipeline-4](pipeline.md#pipeline-4)], [[pipeline-13](pipeline.md#pipeline-13)], [[pipeline-32](pipeline.md#pipeline-32)], [[pipeline-34](pipeline.md#pipeline-34)], the slc command shall compare the record at the same schedule index and target [[pipeline-8](pipeline.md#pipeline-8)], [[pipeline-15](pipeline.md#pipeline-15)]: matching identities plus a readable live target selects Reuse; a matching compile record with differing identities, an intact prior-input copy, and a readable live target selects Update; an identity that cannot be derived or read, every other unmatched case, and every `--rebuild` phase selects Ordinary, while a link phase never selects Update.

### Update and publication

#### incremental-compilation-15

When a compile phase executes in Update mode, the slc command shall extend its ordinary execution request with a read-only path to the recorded prior chained input and a host-computed unified line diff or an explicit unavailable value, and shall protect the prior copy like an ordinary reference input [[phase-execution-33](phase-execution.md#phase-execution-33)], [[phase-execution-39](phase-execution.md#phase-execution-39)].

#### incremental-compilation-16

Where a compile phase executes in Update mode, when its interpreted or compiled performing prompt is built [[phase-execution-11](phase-execution.md#phase-execution-11)], [[phase-execution-25](phase-execution.md#phase-execution-25)], the slc command shall append one host-owned instruction naming the prior input and existing target, asking the agent to apply the input changes under the current definition, preserve unaffected content and refinements, and leave a complete artifact, without adding an update contract or changing ordinary acceptance.

#### incremental-compilation-17

When an eligible invocation finishes successfully after executing at least one phase and completing required deterministic post-processing [[phase-execution-42](phase-execution.md#phase-execution-42)], the slc command shall materialize the current source and every scheduled live phase output into one complete build and publish it once when every phase identity and output byte sequence is available, or otherwise leave history inactive and report an advisory diagnostic.

#### incremental-compilation-26

Where a history-excluded invocation [[incremental-compilation-8](#incremental-compilation-8)] is about to execute a target named by a usable active build in that target's parent directory, when execution begins, the slc command shall remove that build's marker before invoking the executor without otherwise using or republishing the build.

## Verification

Verification uses fixture-based integration acceptance without live model calls.

### Acceptance

#### incremental-compilation-18

Where a fixture pipeline has no history, when an eligible full run succeeds, the artifact directory shall contain build `1` with a strict manifest and byte-identical source and ordered phase-output copies, and `.slc/latest` shall name it [[incremental-compilation-1](#incremental-compilation-1)], [[incremental-compilation-9](#incremental-compilation-9)], [[incremental-compilation-11](#incremental-compilation-11)].

#### incremental-compilation-19

While a fixture's active build matches its inputs, when the invocation repeats after an optional manual edit to a live final output, the slc command shall invoke zero phase executors, report `up to date`, preserve the edit, and leave history unchanged [[incremental-compilation-2](#incremental-compilation-2)], [[incremental-compilation-4](#incremental-compilation-4)], [[incremental-compilation-14](#incremental-compilation-14)].

#### incremental-compilation-20

While a fixture has a usable active build, when its source changes, the first affected compile request shall contain the recorded prior input and rendered diff while the live target remains in place, and a downstream phase shall reuse when its predecessor produces bytes matching that phase's recorded input [[incremental-compilation-5](#incremental-compilation-5)], [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-15](#incremental-compilation-15)], [[incremental-compilation-16](#incremental-compilation-16)].

#### incremental-compilation-21

While a fixture has a usable active build, when the user edits a live intermediate without changing its producer's inputs, the producer shall Reuse and the first consumer shall Update from its recorded old input while treating its own live target as the prior output [[incremental-compilation-4](#incremental-compilation-4)], [[incremental-compilation-5](#incremental-compilation-5)].

#### incremental-compilation-22

While an active build has a malformed manifest or any missing or hash-mismatched source/output copy, when the eligible invocation repeats with unchanged inputs, every phase shall execute ordinarily without update context and a fresh complete build shall become active [[incremental-compilation-3](#incremental-compilation-3)], [[incremental-compilation-10](#incremental-compilation-10)].

#### incremental-compilation-23

While a usable active build exists, when an executor observes that `.slc/latest` is absent and then fails after writing, the run shall publish no build, the marker shall remain absent, and the next eligible invocation shall execute every phase ordinarily [[incremental-compilation-6](#incremental-compilation-6)], [[incremental-compilation-12](#incremental-compilation-12)].

#### incremental-compilation-24

While a usable active build exists, when the user repeats the canonical invocation with `--rebuild`, every phase shall execute without update context and a successful invocation shall publish one fresh complete build [[incremental-compilation-7](#incremental-compilation-7)], [[incremental-compilation-14](#incremental-compilation-14)].

#### incremental-compilation-25

Where an invocation uses `-o`, the reserved `slc` meta-pipeline, a single-phase or standalone-pass form, or a direct-link form and none of its targets matches a usable active build record, when it runs, the invocation shall execute ordinarily without update context, shall publish no build history, and shall leave that active marker unchanged [[incremental-compilation-8](#incremental-compilation-8)].

#### incremental-compilation-27

While a usable active build exists, when a history-excluded invocation fails after writing one of that build's targets, `.slc/latest` shall already be absent and the next eligible invocation shall execute every phase ordinarily [[incremental-compilation-8](#incremental-compilation-8)], [[incremental-compilation-26](#incremental-compilation-26)].

#### incremental-compilation-28

While malformed `.slc` state structurally prevents fresh history from being recorded, when an eligible invocation runs, every phase shall execute ordinarily, the compile shall still succeed, the recording failure shall be diagnostic-only, and no active marker shall be published [[incremental-compilation-3](#incremental-compilation-3)].

#### incremental-compilation-29

Where an unpinned phase's declared local-input identity cannot be derived or read — including where an unpinned sidecar member escapes the pipeline-directory boundary — when an eligible invocation runs, the phase shall execute ordinarily, the compile shall remain successful, and history publication shall be skipped with an advisory diagnostic [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-14](#incremental-compilation-14)], [[incremental-compilation-17](#incremental-compilation-17)].

#### incremental-compilation-30

While a fixture pipeline has an active build whose phase definition uses a `slc.pin-inputs.json` closure entry, when a file in that flattened closure changes, the next eligible invocation shall include the changed exact bytes in its identity comparison and shall not select Reuse for that phase [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-14](#incremental-compilation-14)].

#### incremental-compilation-31

While a fixture pipeline has an active build whose phase definition uses a `slc.pin-inputs.json` closure entry, when that entry substitutes a different resolved member locator carrying byte-identical content, the next eligible invocation shall include the changed locator set in its identity comparison and shall not select Reuse for that phase [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-14](#incremental-compilation-14)].

#### incremental-compilation-32

While a fixture pipeline has an active build whose phase definition uses a multi-member `slc.pin-inputs.json` closure entry, when only the entry's array order changes, the next eligible invocation shall preserve the same identity and select Reuse [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-14](#incremental-compilation-14)].

#### incremental-compilation-33

While a fixture pipeline has an active build whose phase definition uses a `slc.pin-inputs.json` closure entry, when the suite applies each sidecar-only change below and runs the next eligible invocation, the invocation shall preserve the phase identities, select Reuse, report `up to date`, and publish no new build [[incremental-compilation-2](#incremental-compilation-2)], [[incremental-compilation-13](#incremental-compilation-13)], [[incremental-compilation-14](#incremental-compilation-14)]:

| Case | Sidecar-only change |
| --- | --- |
| Presentation | Change only the valid JSON presentation. |
| Unrelated entry | Add one well-formed entry that is not applicable to a scheduled phase. |

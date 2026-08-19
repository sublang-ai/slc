<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies integration acceptance for incremental compilation using fixture pipelines and counting fixture executors, without live agent calls.

Essential project-specific reference: `slc`, this project's compiler CLI.

## Acceptance

### INCR-18

Verifies: [INCR-1](../user/incremental-compilation.md#incr-1), [INCR-9](../dev/incremental-compilation.md#incr-9)

Where a fixture pipeline compiles at canonical output, when a first full run succeeds, the artifact directory shall contain `.slc/latest` naming build `1` and a build directory whose manifest records the pipeline, source, and every step with input identities and output hashes matching the on-disk bytes, plus byte-identical copies of the source and each step output.

### INCR-19

Verifies: [INCR-2](../user/incremental-compilation.md#incr-2)

While a recorded build matches the current source and artifacts, when the same invocation repeats, the slc command shall exit zero, print `up to date`, invoke zero executors, and leave every file's bytes and the history unchanged.

### INCR-20

Verifies: [INCR-4](../user/incremental-compilation.md#incr-4), [INCR-5](../user/incremental-compilation.md#incr-5), [INCR-14](../dev/incremental-compilation.md#incr-14)

While a recorded build exists, when the source changes and the run repeats, the first affected step's executor shall receive the prior-input copy path holding the recorded bytes and a best-effort diff naming the change while its target file still holds the prior output, and downstream steps whose executed predecessors reproduce byte-identical output shall be skipped.

### INCR-21

Verifies: [INCR-4](../user/incremental-compilation.md#incr-4), [INCR-12](../dev/incremental-compilation.md#incr-12)

While a recorded build exists and the user hand-edits an intermediate artifact, when the full run repeats with an unchanged source, steps upstream of the edit shall be skipped, and the first step consuming the edited artifact shall execute in update mode with the edited bytes as its current chained input and its own existing target as the prior output.

### INCR-22

Verifies: [INCR-3](../user/incremental-compilation.md#incr-3), [INCR-10](../dev/incremental-compilation.md#incr-10)

Where `.slc/` holds a garbage manifest, a wrong-schema record, or an orphaned build directory, when the full run repeats, the run shall succeed as a first compile, not report the bad history as an error, and record a fresh build; where only a recorded copy is missing or tampered, the repeat shall instead execute the affected step ordinarily while the rest of the history stands.

### INCR-23

Verifies: [INCR-6](../user/incremental-compilation.md#incr-6), [INCR-16](../dev/incremental-compilation.md#incr-16)

While a recorded build exists, when a repeat run's executor fails at a later step after earlier steps completed, the recorded history shall contain fresh records for the completed steps and no record for the failed step, and the next repeat shall skip the completed steps and re-execute the failed one — including when the failed executor wrote its target before failing.

### INCR-24

Verifies: [INCR-7](../user/incremental-compilation.md#incr-7), [INCR-13](../dev/incremental-compilation.md#incr-13)

While a current recorded build exists, when the user repeats the invocation with `--rebuild`, every step shall execute ordinarily without update context and a fresh build shall be recorded; where a scheduled step's pin is stale, the same invocation shall fail closed before executing that step.

### INCR-25

Verifies: [INCR-8](../user/incremental-compilation.md#incr-8)

Where an invocation uses `-o`, the reserved `slc` meta-pipeline, or a single-phase form, when it runs to success, no `.slc/` entry shall be created or consulted, and the reserved meta-pipeline's reviewed bundle shall remain byte-identical to its pinned tree.

### INCR-28

Verifies: [INCR-12](../dev/incremental-compilation.md#incr-12)

Where a recorded build exists, when any single result-affecting input changes — a declared semantic input resolved through a widened pin path boundary, the link definition, the link target's bytes or its location with identical bytes, an option list another list could alias under a naive encoding, or a normalization reference — the repeat shall execute the affected step rather than reuse it, and a mixed run's result shall list only written paths ([CLI-3](../user/cli.md#cli-3)).

### INCR-29

Verifies: [INCR-6](../user/incremental-compilation.md#incr-6), [INCR-30](../dev/incremental-compilation.md#incr-30)

While a recorded build exists, when a run that will execute begins its first executor, the history shall already be absent, observable mid-run.

### INCR-31

Verifies: [INCR-16](../dev/incremental-compilation.md#incr-16), [INCR-30](../dev/incremental-compilation.md#incr-30)

When a failure leaves zero recordable steps — including a `--rebuild` or a rebound-source run failing its first step — history shall remain absent so the retry re-executes instead of reusing what the failed executor left.

### INCR-32

Verifies: [INCR-3](../user/incremental-compilation.md#incr-3), [INCR-30](../dev/incremental-compilation.md#incr-30)

When `.slc` is a file or `.slc/latest` is a directory, the run shall compile fresh and succeed, reporting the blocked recording as an actionable diagnostic rather than an error.

### INCR-33

Verifies: [INCR-30](../dev/incremental-compilation.md#incr-30)

When an active marker can neither be removed nor observed, the run shall fail with zero executor calls.

### INCR-34

Verifies: [INCR-16](../dev/incremental-compilation.md#incr-16)

When a later executor changes an earlier completed target or a future planned target, the run shall fail that executor's step, publish no record for the future target, and keep the completed target's record only while its live bytes still match the identity accepted at completion, so the retry re-executes every step left without a record.

### INCR-36

Verifies: [INCR-30](../dev/incremental-compilation.md#incr-30)

When `.slc/latest` is a symbolic link, the run shall remove it as a stale marker and record fresh history.

### INCR-37

Verifies: [INCR-10](../dev/incremental-compilation.md#incr-10), [INCR-30](../dev/incremental-compilation.md#incr-30)

Where `.slc` is a symbolic link to another directory, when a full run executes, the run shall compile fresh, leave the linked directory's marker and builds untouched, and report the blocked recording as a diagnostic.

### INCR-38

Verifies: [INCR-16](../dev/incremental-compilation.md#incr-16)

While a recorded build exists, when a failing executor rewrites or replaces the invocation source during a repeat run, the published build shall embed the source bytes captured before any executor ran — never the rejected rewrite, and never blocking on a non-regular replacement.

### INCR-27

Verifies: [INCR-2](../user/incremental-compilation.md#incr-2)

While a recorded build matches the current source and artifacts of a `playbook` full-link bundle, when the user deletes the emitted entry module or a verification file and repeats the invocation, the run shall reuse every step with zero executor calls, re-derive the deleted files, and exit zero.

### INCR-26

Verifies: [INCR-17](../dev/incremental-compilation.md#incr-17), [INCR-5](../user/incremental-compilation.md#incr-5)

While recorded history names a different source path, when a full run compiles another source with the same basename into the same artifact directory, the run shall succeed as a first compile, report the rebind in diagnostics, and record a fresh build; when a link step's recorded inputs differ on repeat, the link step shall execute in full without update context.

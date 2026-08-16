<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# INCR: Incremental Compilation

## Intent

This package specifies the build-history store, step selection, update context, and recording mechanics that implement [DR-021](../decisions/021-incremental-compilation.md).

Essential project-specific reference: `slc`, this project's compiler CLI.

## History store

### INCR-9

Where a build is recorded, the slc command shall write `manifest.json` as strict JSON with exactly these top-level fields: `schema: "sublang.slc.build.v1"`, `pipeline`, `source: { path, hash }`, and `steps`, where each step record has exactly `kind`, `name`, `target`, `inputs` (ordered SHA-256 `sha256:<64 hex>` identities), `output` (SHA-256 of the target bytes), and `copy` (the stored copy's path inside the build directory); `source.path`, `target`, and `copy` shall be POSIX paths relative to the artifact directory and the build directory respectively.

### INCR-10

When the slc command loads history, it shall read the build named by `.slc/latest`; a missing pair, unparsable manifest, wrong schema, structurally invalid field, or a copy whose bytes do not match its recorded hash shall make history absent for the affected use rather than raise an error.

### INCR-11

When the slc command records a build, it shall choose a build number greater than both `.slc/latest` and every existing `builds/` entry, write the complete build directory before renaming a temporary file over `.slc/latest`, and leave any orphaned build directory from an interrupted recording ignored.

## Step selection

### INCR-12

When a full or full-link run walks its scheduled steps, the slc command shall compute each compile step's input identities as the exact bytes of its chained input (the invocation source for the first step, the predecessor's current target otherwise), its definition file, and its declared semantic inputs in declaration order, and each link step's as its object artifacts in order, its link target identity, and its options as canonical `name=value` pairs.

### INCR-13

When selecting a step's mode, the slc command shall match records by kind, name, and target path, and shall select reuse only when every recorded input identity equals the current identity and the target file exists; update only for a compile step whose matched record has an intact prior-input copy while the target file exists; and ordinary execution otherwise or under `--rebuild`, with pin validation preceding every mode so a stale or malformed pin fails closed regardless of history.

## Update context

### INCR-14

When a compile step executes in update mode, the slc command shall extend the execution request with the prior-input copy path and a host-computed unified line diff of prior to current input — omitting the rendered diff when either side exceeds the host's size budget — and shall protect the prior-input copy from executor writes like a reference input.

### INCR-15

Where a step executes in update mode, when the executor prompt is built, interpreted execution shall render a host-owned block stating that the target holds the previously accepted output and instructing the agent to update it under the definition, apply the input changes, preserve unaffected content, and write the complete artifact; compiled execution shall append the same host-owned text to transformation-performing Player and Captain prompts without changing the Boss request or the Playbook runtime contract.

## Recording

### INCR-16

When a full or full-link run at canonical output of a non-reserved pipeline finishes having executed at least one step, the slc command shall record every scheduled step — executed steps and reused steps from their current on-disk bytes, and, on failure, steps not completed from their prior records carried forward, except under `--rebuild`, which consults no prior records and records only completed steps — and shall copy the source and each recorded step's output into the build directory.

### INCR-17

While recorded history names a source path other than the invocation's, when a full run starts, the slc command shall report the rebind as a diagnostic, treat history as absent, and record a fresh build on success.

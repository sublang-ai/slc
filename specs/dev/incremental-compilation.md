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

When the slc command loads history, it shall read the build named by `.slc/latest`, traversing `.slc`, `builds`, and the build directory only as real directories — a symbolic link at any of them reads as another directory's store, so it makes history absent; a missing pair, unparsable manifest, wrong schema, or structurally invalid field shall likewise make history absent rather than raise an error, while a recorded copy is validated — its intermediate components as real directories, its bytes against the recorded hash — only when that copy is read, a failure degrading only the use that depended on it ([INCR-3](../user/incremental-compilation.md#incr-3)).

### INCR-11

When the slc command records a build, it shall choose a build number greater than both `.slc/latest` and every existing `builds/` entry, write the complete build directory before renaming a temporary file over `.slc/latest`, and leave any orphaned build directory from an interrupted recording ignored.

## Step selection

### INCR-12

When a history-eligible full or full-link run ([INCR-8](../user/incremental-compilation.md#incr-8)) walks its scheduled steps, the slc command shall compute, over the invocation's canonical absolute paths, each compile step's input identities as the exact bytes of its chained input (the invocation source for the first step, the predecessor's current target otherwise), its definition file, its references, and its declared semantic inputs in declaration order, and each link step's as its object artifacts in order, its link definition and declared semantic inputs, its link target's artifact-directory-relative locator and content identity (file bytes, or the deterministic tree for a directory), and its options under an encoding no option values can make ambiguous; declared closures shall resolve within the pin file's validated path boundary when one exists, and a step whose declared closure cannot be derived shall execute ordinarily rather than shrink its identity.

### INCR-13

When selecting a step's mode on a history-eligible run ([INCR-8](../user/incremental-compilation.md#incr-8)), the slc command shall match records by kind, name, and target path, observe the matched target once and atomically — type, link count, and bytes off a single no-follow, nonblocking descriptor — and shall select reuse only when every recorded input identity equals the current identity and the observation yielded a private regular file, recording that observation's bytes as the reused step's accepted identity; update only for a compile step whose matched record has an intact prior-input copy under the same observation; ordinary execution otherwise — genuine absence, an unsafe leaf, no matching record, a link step's mismatched inputs, a compile step's failed prior-input copy, or `--rebuild`; and shall fail the run before the step's executor when the observation is indeterminate — a recorded target is never silently skipped or rebuilt over. Pin validation precedes every mode so a stale or malformed pin fails closed regardless of history.

## Update context

### INCR-14

When a compile step executes in update mode, the slc command shall extend the execution request with the prior-input copy path and a host-computed best-effort unified line diff of prior to current input — omitted when the host cannot produce a useful rendering, the current and prior files remaining authoritative — and shall protect the prior-input copy from executor writes like a reference input.

### INCR-15

Where a step executes in update mode, when the executor prompt is built, interpreted execution shall render a host-owned block stating that the target holds the previously accepted output and instructing the agent to update it under the definition, apply the input changes, preserve unaffected content, and write the complete artifact; compiled execution shall append the same host-owned text to transformation-performing Player and Captain prompts without changing the Boss request or the Playbook runtime contract.

## Recording

### INCR-16

When a history-eligible run ([INCR-8](../user/incremental-compilation.md#incr-8)) finishes in an orderly way after invalidating ([INCR-30](#incr-30)), the slc command shall publish at most one new build — executed and reused steps republished through a no-follow, nonblocking read only when their bytes still match the output identity captured at acceptance, unreached steps carried forward from the in-memory prior records except under `--rebuild` or when a failed executor changed their target, and no record for a touched step without a recordable completion or for a completed target whose bytes drifted — copying each recorded step's output and the source bytes captured before the first executor could write — read following symbolic links, as a nonblocking regular file — into the build directory, so a rejected executor's rewrite of the source can never enter a build; with nothing recordable, or a source that was not readable at capture, it shall leave history absent, the unreadable source with a diagnostic.

### INCR-30

When a history-eligible run ([INCR-8](../user/incremental-compilation.md#incr-8)) is about to run its first executor, the slc command shall have removed `.slc/latest`, treating absence as success, leaving a `.slc` that is not a real directory untouched — it holds no marker of this bundle's own, and unlinking through a symbolic link would destroy another directory's — and failing the run before that executor when an active marker cannot be removed, so that an interruption at any later point leaves history absent rather than a record vouching for a target an executor may have changed.

### INCR-17

While recorded history names a source path other than the invocation's, when a history-eligible full run ([INCR-8](../user/incremental-compilation.md#incr-8)) starts, the slc command shall report the rebind as a diagnostic, treat history as absent, and record a fresh build on success.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-021: Incremental Compilation

## Status

Accepted

## Context

A full compile of an agent pipeline takes tens of minutes to hours ([DR-019](019-compile-progress-stall-watchdog.md)), and every full invocation re-executes the complete pipeline even for a one-line source edit.
Generation is nondeterministic, so a fresh compile also churns reviewed-good regions unrelated to the edit, and the intermediate artifacts it overwrites are refinable products, not disposable cache ([DR-001](001-slc-pipeline-layout-naming-invocation.md)).

An agent can revise its own prior output from a diff.
The host therefore does not need to understand a change semantically; it needs to remember what each accepted step consumed and produced, and hand that memory to the phase agent.

## Decision

### Build history

- After a full or full-link run at canonical output of a non-reserved pipeline executes at least one step, `slc` records build `N` under `<art-dir>/.slc/`:

| Path | Content |
| --- | --- |
| `.slc/builds/<N>/manifest.json` | manifest: schema `sublang.slc.build.v1`, pipeline, source locator and hash, per-step records |
| `.slc/builds/<N>/…` | verbatim copies of the source and every recorded step output |
| `.slc/latest` | the decimal `N` of the last recorded build, committed last via rename |

- A step record carries the step's kind, name, target path, input identities, output hash, and copy location.
  Input identities are SHA-256 over exact bytes: the chained input plus the definition and declared semantic inputs for a compile step; the objects, link target, and options for a link step.
  Recorded paths are POSIX locators relative to `<art-dir>`.
- `N` starts at 1 and increases with each recording run; prior builds are retained, versioning the lineage and doubling as recovery copies.
- History is memory, never authority.
  A missing, malformed, or inconsistent `.slc/` never fails or degrades a run: the run behaves as a first compile and re-records, so deleting `.slc/` is always safe.
- A run that fails after executing at least one step still records: completed steps get fresh records and the rest carry their previous records forward, so a late failure does not forfeit hours of earlier phases.
- The reserved `slc` meta-pipeline and `-o` invocations neither consult nor write history (reviewed-bundle purity under [DR-007](007-slc-phase-artifact-pinning.md); [DR-014](014-cwd-output-invocation-defaults-entry-emission.md)'s `-o` carve-outs).
  Single-phase, standalone-pass, and direct-link invocations are likewise outside history; the next full run absorbs whatever they changed through ordinary input comparison.
- The source copy makes the bundle at least as sensitive as its source; distribution and retention policy must treat it so.

### Step selection

On a full or full-link run, `slc` walks the scheduled chain in order, matching history records by step kind, name, and target path:

| Mode | Condition | Behavior |
| --- | --- | --- |
| Reuse | every recorded input identity matches the current bytes and the target file exists | skip the step; the on-disk bytes stand, refined or not |
| Update | a record matches but inputs differ, its prior-input copy is intact, and the target file exists | execute with update context |
| Ordinary | no matching record, missing copy or target, or `--rebuild` | execute as a first compile |

- Current identities are computed live: a step's chained input is its predecessor's actual current output, or the source for the first step, so refinement and update effects propagate downstream within one run.
- Link steps reuse or run in full; they take no update context.
- Pin validation ([DR-007](007-slc-phase-artifact-pinning.md)) precedes selection; recorded output never makes a stale or malformed pin runnable.
- Executor provenance — interpreted versus compiled, package versions — selects how a step runs, never whether: it does not enter input identity.
- When every step is reused, `slc` reports the bundle up to date, invokes no agent, and writes nothing; entry and verification derivation run only on runs that execute a step.

### Update execution

- An update-mode step executes exactly like an ordinary step — same executor selection, one-target write rule, generic checks and `BLOCKED` protocol ([DR-003](003-slc-phase-execution.md)) — with additional host-supplied read-only context: the prior accepted input (a history copy, protected like a reference) and a host-computed unified line diff of prior to current input.
  The existing target file is the prior output, in place, possibly user-refined.
- The host-owned instruction tells the agent: the target holds the previously accepted output; update it under the definition to reflect the input changes, preserve unaffected content, and write the complete artifact.
- The definition remains the sole semantic authority.
  There is no update contract in definitions, no trace, no protected-region enforcement, and no metadata beyond the ordinary result: update context is an optimization hint, and acceptance authority is identical to ordinary execution.
- Interpreted execution renders the context in its prompt.
  Compiled execution receives the same text appended to transformation-performing Player and Captain prompts; the Boss request and the Playbook runtime contract are unchanged, and an artifact that ignores the hint still produces a valid fresh output.
- When either side exceeds the host's diff budget, the context supplies the prior-input path without a rendered diff.

### Rebuild

- `--rebuild`, valid on full and full-link invocations without `-o`, bypasses reuse and update, executes the complete ordinary pipeline, and records fresh history from the steps it completes, carrying no prior records forward — including when the source was rebound.
  On the reserved `slc` meta-pipeline it is an ordinary run.
- A recorded source locator that no longer matches the invocation source is diagnosed, ignored as history, and superseded by the new run's record.
- There is no adoption flag.
  Hand-refined artifacts are reused as-is while their inputs are unchanged, and become the prior output of the next update once inputs change; refinement is a product, never a conflict.

## Consequences

- An unchanged repeat invocation is a no-op: `up to date`, no agent cost, no writes.
- A small source edit updates only its affected phases; steps whose recomputed inputs still match are reused, and manual refinements survive as the baseline the agent updates.
- Byte stability outside changed regions is the agent's responsibility, not host-enforced: deterministic scoped-update machinery — per-definition update contracts, trace partitions, protected-byte enforcement — is rejected as disproportionate.
  `--rebuild` and the retained build copies are the recovery path.
- An input the identities do not cover (content a definition reads beyond its declared semantic inputs) can change without invalidating reuse; `--rebuild` is the documented remedy.
- History grows the bundle by one source-plus-artifacts copy set per recorded build; users may prune old builds or delete `.slc/` freely.
- A same-basename source collision rebinds history with a diagnostic instead of conflicting; the prior lineage remains under `.slc/builds/`.
- An interrupted run leaves ordinary partial outputs exactly as full compilation always has; `latest` still names the prior complete build.

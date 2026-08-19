<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-021: Incremental Compilation

## Status

Accepted

## Context

A full agent pipeline can take tens of minutes or hours, yet a small source edit currently reruns every phase.
Fresh generation also replaces reviewed intermediate products even when most of their meaning did not change.

An agent can revise its prior output when it receives the old input, the current input and their diff.
The host therefore needs versioned memory and a per-phase execution choice, not a semantic change classifier or a second transformation contract.

## Decision

### Scope and history

- Canonical full and full-link runs use incremental history, except for the reserved `slc` meta-pipeline.
  Invocations with `-o`, single-phase or standalone-pass invocations, and direct-link invocations neither read nor write history.
- A successful eligible run that executes at least one phase publishes one complete numbered build under `<art-dir>/.slc/`:

| Path | Content |
| --- | --- |
| `.slc/builds/<N>/manifest.json` | pipeline, source identity, and ordered phase records |
| `.slc/builds/<N>/source` | verbatim invocation source |
| `.slc/builds/<N>/outputs/<index>` | verbatim output of phase `<index>` |
| `.slc/latest` | decimal `N`, committed after the complete build |

- Each phase record contains its kind, name, canonical target locator, ordered input identities, and output hash.
  Compile identities cover the current chained input, definition, explicit references, and declared local `## Pin Inputs`; link identities cover ordered objects, the link definition, link-target locator and content, and ordered options.
- The active build is usable only as a whole and only for the same pipeline and source locator.
  A missing marker, malformed manifest, mismatched pipeline or source, missing copy, or copy/hash mismatch makes history absent for that invocation; the run compiles ordinarily and may publish a fresh build.
  Older numbered builds are never consulted automatically and remain available for manual recovery.
- Source and output copies are as private as the source itself.

### Three execution modes

The host walks the current schedule in order and compares it with the active build at the same phase index:

| Mode | Condition | Behavior |
| --- | --- | --- |
| Reuse | the phase key and every input identity match, and the live target is readable | invoke no executor; accept the live target unchanged, including manual refinements |
| Update | a compile record matches, at least one input identity differs, the prior chained-input copy is intact, and the live target is readable | execute normally with update context |
| Ordinary | no usable history or matching record, a required live/copy file is absent, the step is a changed link, or `--rebuild` is active | execute normally without update context |

- A phase's current chained input is the invocation source or its predecessor's current live output.
  Change therefore propagates downstream inside one run and stops when a produced output again matches the recorded input of the next phase.
- Pin validation remains authoritative before reuse or execution; history never makes a stale or malformed pin runnable.
- When every phase reuses, the command reports `up to date`, invokes no phase executor, and publishes no build.
  Deterministic post-processing required by the existing pipeline contracts may still refresh its derived files.

### Update execution

- Update is the ordinary execution path with two read-only additions: the recorded copy of the phase's prior chained input and a best-effort unified diff from that copy to the current chained input.
  The current target remains in place as the prior output.
- One host-owned instruction tells the agent to update that target under the current definition, apply the input changes, preserve unaffected content and refinements, and leave a complete artifact.
- The phase definition remains the sole semantic authority.
  There is no `## Update` section, deterministic-update rule, changed-region threshold, trace, protected-region protocol, or separate acceptance standard.
- If a useful diff cannot be rendered within the host's prompt budget, the prior and current input paths are still supplied and the phase remains in Update mode.
- Interpreted execution includes the context in its prompt.
  Compiled execution appends the same host text only to transformation-performing Player and Captain prompts; its Boss request and runtime contract remain unchanged.

### Honest publication

- `.slc/latest` is the only active-history marker.
  It remains while phases only Reuse and is removed immediately before the first Update or Ordinary executor may write.
- If that run fails, is cancelled, or is interrupted, it publishes no build and leaves no active marker.
  The next eligible invocation therefore runs ordinarily; crash resume and completed-prefix salvage are deliberately not implemented.
- After every phase and required deterministic post-processing succeeds, the host copies the source and every current phase output into one new build and commits `latest` last.
  A recording failure does not turn a successful compile into a failed compile, but leaves history inactive and reports a diagnostic.
- `--rebuild` is valid only for canonical full and full-link invocations.
  It selects Ordinary for every phase, still applies normal pin validation, and publishes one complete build only on success.

## Consequences

- An unchanged run incurs no agent cost; a local edit pays only for phases whose inputs have not converged back to their recorded bytes.
- Hand-edited artifacts remain products: they are reused while their inputs match and become the live baseline for the next update.
- Reliability comes from a very small boundary: complete snapshots, marker removal before execution, and success-only publication.
  There is no recovery state machine, partial-build merge, conflict taxonomy, adoption command, or concurrency protocol.
- History can be deleted at any time to request an ordinary compile.
  `--rebuild` is the explicit equivalent that retains old numbered copies.
- Inputs not named by the execution request or the definition's declared local inputs cannot invalidate reuse; users can rebuild when a definition has undeclared dependencies.

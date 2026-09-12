<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-031: Measured Compilation Performance

## Status

Accepted

## Context

[DR-019](019-compile-progress-stall-watchdog.md) made long compilations observable without reducing their transformation cost.
Historical measurements do not distinguish current agent settings, cold compilation, incremental reuse, control calls, or generated-artifact validation.
A five-minute target for a simple workflow needs reproducible successful measurements and bounded failed experiments.

## Decision

- An opt-in local benchmark executes the ordinary compiler through its dependency-injection seams, recording phase timing and adapter-call timing, prompt byte counts and hashes, event counts, and provider-reported usage without changing production execution.
- The default workload is the minimal three-line acceptance workflow, compiled in a fresh directory with independent review disabled; explicit sources, pipeline roots, reviewer selection, and optimization settings permit attributable comparisons.
- Every run records its explicit requested model, effective agent settings, dependency versions, source and definition identities, completion, and separately timed generated-artifact validation.
- The default experiment deadline is twenty minutes, configurable only on the benchmark; expiry cooperatively aborts the ordinary compiler and records failure, preserving evidence.
- Machine-readable summaries omit prompts, responses, and diagnostics text; raw diagnostics remain in the local evidence directory.
- Candidate techniques are experiments until equivalent-input comparisons demonstrate improved successful compilation with the required fidelity and generated verification preserved; unfinished or failed runs are evidence of failure, never successful speed measurements.
- An optional benchmark-only fresh-phase-session experiment omits an inherited adapter continuation on the first call of each phase while preserving continuations within that phase; it does not change production defaults.

## Consequences

- Measurements separate cold success, timeouts, compilation, validation, and agent-call overhead instead of crediting cached or incomplete work toward the target.
- Benchmark instrumentation adds no production trace API and changes no phase semantics.
- A retained production optimization requires its own applicable behavior changes and comparative evidence; this decision alone authorizes no semantic shortcut.

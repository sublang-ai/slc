<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-021: Incremental Compilation

## Goal

Implement [DR-021](../decisions/021-incremental-compilation.md) as a thin success-only history layer over the existing runner: versioned complete snapshots, Reuse/Update/Ordinary selection, agent update context, and `--rebuild`.

## Deliverables

- [ ] Complete versioned build history that treats any unusable active build as absent.
- [ ] Exact phase reuse and ordinary phase execution augmented with prior-input/diff update context.
- [ ] Marker invalidation before executor work and one success-only publication after the complete invocation.
- [ ] `--rebuild`, exclusions, integration acceptance, user documentation, and a green release gate.

## Tasks

Tasks are ordered; each task shall land as one commit with its focused tests and named spec updates.

1. [x] **Specify the minimal design.** Add DR-021, the INCR user/dev/test package, this iteration, the map rows, and the small compiler/pipeline/CLI amendments.
2. [x] **Share the needed host helpers.** Reuse the archived error and exact-byte hash helpers without carrying incremental policy.
3. [ ] **Add complete-snapshot history and a best-effort diff.** Implement strict whole-build loading, exclusive numbered-directory creation, marker-last publication, and a bounded line diff.
4. [ ] **Carry update context through both executors.** Extend compile requests and interpreted/compiled performing prompts while keeping ordinary acceptance and the compiled Boss contract unchanged.
5. [ ] **Implement the three-mode runner.** Add live input identities, Reuse/Update/Ordinary selection, marker removal before the first executor, success-only final publication, `up to date`, exclusions, and `--rebuild`.
6. [ ] **Land acceptance and close.** Cover the complete state machine with fixture executors, update README and CHANGELOG, reconcile traceability, and pass `npm run release:check`.

## Acceptance criteria

- An unchanged eligible invocation invokes no phase executor and reports `up to date` without changing phase artifacts or history.
- A changed chained input supplies the phase's old input and best-effort diff while leaving its live output in place, and downstream execution stops when bytes converge.
- Manual artifact refinements are reused and later become the update baseline.
- Any unusable active build causes one ordinary compile, while any failed execution leaves no active marker and the next invocation runs ordinarily.
- A successful run that executed a phase publishes exactly one complete build after the complete invocation; a failed run publishes none.
- `--rebuild` runs every phase ordinarily, and `-o`, the `slc` meta-pipeline, and partial invocation forms remain outside history.
- Fixture acceptance uses no live model calls, and `npm run release:check` passes before the iteration closes.

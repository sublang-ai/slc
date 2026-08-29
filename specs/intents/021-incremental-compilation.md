<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-021: Incremental Compilation

## Status

Done

## Intent

Implement [DR-021](../decisions/021-incremental-compilation.md) as a thin success-only history layer over the existing runner: versioned complete snapshots, Reuse, Update, and Ordinary selection, agent update context, and `--rebuild`.
Six task boundaries separated the minimal design, shared host helpers, complete snapshots and bounded diffs, executor update context, three-mode runner selection, and fixture acceptance and closeout.
The design remains in [DR-021](../decisions/021-incremental-compilation.md), while surviving behavior and evidence are owned primarily by the [`incremental-compilation`](../packages/incremental-compilation.md) package with invocation, executable, execution-context, and release surfaces in the [`pipeline`](../packages/pipeline.md), [`cli`](../packages/cli.md), [`phase-execution`](../packages/phase-execution.md), and [`release`](../packages/release.md) packages.

## Deliverables

- [x] Complete versioned build history treats any unusable active build as absent [[incremental-compilation-1](../packages/incremental-compilation.md#incremental-compilation-1)], [[incremental-compilation-3](../packages/incremental-compilation.md#incremental-compilation-3)].
- [x] Exact phase reuse and ordinary phase execution carry prior-input and best-effort diff update context where applicable [[incremental-compilation-2](../packages/incremental-compilation.md#incremental-compilation-2)], [[incremental-compilation-5](../packages/incremental-compilation.md#incremental-compilation-5)].
- [x] Marker invalidation occurs before executor work and one success-only publication follows the complete invocation [[incremental-compilation-6](../packages/incremental-compilation.md#incremental-compilation-6)], [[incremental-compilation-17](../packages/incremental-compilation.md#incremental-compilation-17)].
- [x] `--rebuild`, exclusions, integration acceptance, user documentation, and a green completion-time release gate were delivered [[incremental-compilation-7](../packages/incremental-compilation.md#incremental-compilation-7)], [[incremental-compilation-8](../packages/incremental-compilation.md#incremental-compilation-8)].

## Tasks

1. [x] Specify the minimal design by adding the decision, incremental-compilation package, this record, then-current map entries, and the small compiler, pipeline, and CLI amendments.
2. [x] Share the needed host helpers by reusing archived error and exact-byte hash helpers without carrying incremental policy.
3. [x] Add complete-snapshot history and a best-effort bounded line diff with strict whole-build loading, exclusive numbered-directory creation, and marker-last publication.
4. [x] Carry update context through interpreted and compiled executors while keeping ordinary acceptance and the compiled Boss contract unchanged.
5. [x] Implement the three-mode runner with live input identities, Reuse, Update, and Ordinary selection, pre-executor marker removal, success-only publication, `up to date`, exclusions, and `--rebuild`.
6. [x] Land fixture acceptance, update README and CHANGELOG, reconcile traceability, and close with the release gate.

## Verification

- The four checked deliverables and six checked task states preserve completion of the success-only incremental history layer.
- Commits `20b2a8e`, `c563726`, `42121b7`, `9d6d6b4`, `71736e0`, and `d95463f` record those task boundaries in order.
- Snapshot publication and corruption recovery are exercised by [[incremental-compilation-18](../packages/incremental-compilation.md#incremental-compilation-18)] and [[incremental-compilation-22](../packages/incremental-compilation.md#incremental-compilation-22)], while exact Reuse, Update context, and manual refinement are exercised by [[incremental-compilation-19](../packages/incremental-compilation.md#incremental-compilation-19)], [[incremental-compilation-20](../packages/incremental-compilation.md#incremental-compilation-20)], and [[incremental-compilation-21](../packages/incremental-compilation.md#incremental-compilation-21)].
- Failure invalidation, rebuilds, exclusions, advisory history failure, and underivable inputs are exercised without live model calls by [[incremental-compilation-23](../packages/incremental-compilation.md#incremental-compilation-23)], [[incremental-compilation-24](../packages/incremental-compilation.md#incremental-compilation-24)], [[incremental-compilation-25](../packages/incremental-compilation.md#incremental-compilation-25)], [[incremental-compilation-27](../packages/incremental-compilation.md#incremental-compilation-27)], [[incremental-compilation-28](../packages/incremental-compilation.md#incremental-compilation-28)], and [[incremental-compilation-29](../packages/incremental-compilation.md#incremental-compilation-29)].
- Commit `d95463f` records the completion-time release gate, while tags `ir-021-v3` and `v0.4.0` point at later acceptance hardening commit `b49d8fa`, which records a clean install and `release:check` with 752 passing and two skipped tests.
- The installed-package acceptance flow now exercises unchanged Reuse and incremental Update before execution [[release-18](../packages/release.md#release-18)].

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-021: Incremental Compilation

## Goal

Implement [DR-021](../decisions/021-incremental-compilation.md): versioned build history, exact step reuse, agent-performed updates from prior input, diff, and prior output, and `--rebuild` — as a thin layer over the existing runner, with fixture-based acceptance and a green release gate.

## Deliverables

- [x] Versioned `.slc/` build history recorded after full runs, tolerant of any corruption.
- [x] Step reuse, update-mode execution with host-supplied prior input and diff, and the `up to date` no-op.
- [x] `--rebuild`, failure carry-forward, and non-lineage exclusions (`-o`, reserved `slc`, partial forms).
- [x] Coordinated specs, integration acceptance, user documentation, and a green deterministic release gate.

## Tasks

Tasks are ordered; each numbered task shall land as exactly one commit that also checks the task here, with focused tests and any named spec change atomic with the code.

1. [x] **Specify incremental compilation.** Land DR-021, the INCR user/dev/test packages, this record, and the map rows.
2. [x] **Share small host helpers.** Reapply the shared error-inspection helpers (`src/errors.ts` dedup) and the shared UTF-8 byte ordering plus frozen tree-record encoding in `src/hash.ts`.
3. [x] **Fix pass pin keys.** Accept portable pass names as pin keys (`src/pins.ts` key validation, `src/phase.ts` portable-name check) with the DR-013/PIN/PIPE spec corrections; a pinned pass phase currently makes `slc.pins.json` unloadable.
4. [x] **Add the build-history store and line diff.** New `src/build-history.ts` (lenient load, hash-verified copies, atomic `latest` recording) and `src/line-diff.ts` (unified line diff with a size budget), with unit tests covering INCR-9/10/11.
5. [x] **Carry update context to executors.** Extend the compile `ExecuteRequest` with optional prior-input path and diff, protect the prior input, render the interpreted update block, and append the same text to compiled performing prompts; cover INCR-14/15 with executor-level tests.
6. [x] **Reuse, update, and record in the runner.** Wire step selection (INCR-12/13), recording with carry-forward and rebind diagnostics (INCR-16/17), the `up to date` outcome, and `--rebuild` parsing/reporting through `runFull`/`runFullLink`, with the small CLI spec updates for the flag and outcome.
7. [x] **Land integration acceptance.** Fixture-pipeline coverage for INCR-18 through INCR-26.
8. [x] **Close the iteration.** README and changelog, final map/traceability corrections, deliverables checked, `npm run release:check` green, in one docs-only commit.

## Acceptance criteria

- Every task is one commit, and no implementation commit precedes the spec contract it implements.
- A repeated unchanged invocation reports `up to date` with zero executor invocations, rewriting nothing beyond re-derived deterministic derivatives.
- A changed source triggers update-mode execution whose request carries the prior input and diff; unaffected steps are reused byte-for-byte, including hand-refined outputs.
- Corrupt or missing history never fails a run; failed runs keep completed-step progress; `--rebuild` bypasses reuse but never pin validation.
- `-o`, reserved `slc`, and partial invocation forms stay outside history, and the reviewed self-host bundle keeps its pinned fixed point.
- Fixture pipelines cover the acceptance without live model calls, and `npm run release:check` passes before the iteration closes.

## Review

A post-close review (reviewer: GPT-5.6 Sol) converged on two foundational corrections, consolidated into one hardening commit over the eight-commit rewrite, then completed by four follow-up commits.
The first hardens history and identity: `.slc/latest` is the sole currentness marker, removed before the first executor and republished at most once per orderly run, so no failure, crash, rebind, or recording fault can leave a record vouching for touched targets; identities cover declared closures through the pin path boundary, link definitions, link-target locator and content, references, and unambiguous options; the diff is best-effort and bounded by its rendered size.
The second establishes one canonical-path, safe-leaf output boundary: every operand and the run directory resolve once, plans refuse colliding or input-aliasing outputs against a plan-wide immutable union including declared closures, executors must produce a single-link regular file they actually wrote, reuse accepts the same predicate, all deterministic writes go through one no-follow, no-hard-link, nonblocking writer, history reads are no-follow and nonblocking with malformed markers reading as absent, and the raw-`.ts` entry/source collision is skipped and reported.
The follow-ups closed the review's remaining gaps on the same two foundations: publication became end-to-end identity-gated — at most one build per orderly run and none when nothing recordable survived, every published byte re-read through the safe reader against the identity captured at acceptance, protected-path changes detected structurally and propagated so a failed executor's mutation also kills the carried record for its target — and the plan's read/write inventory was completed with the host-written entry and verification files, the reserved `.slc`/`.slc-verify` directories, the pin index, and every pin-selected locator, with containment decided lexically on canonical paths before directories are created.
The fourth follow-up made observation and inventory total: a protected path that cannot be fully observed fails its phase before the executor; the source bytes publication embeds are captured before any executor runs; the plan's reads cover every local path any pin record names — package locators included — plus the verifier-support sources, while its writes are exactly the invocation's own; `.slc` and `.slc-verify` are traversed only as real directories, so a symlinked store reads as foreign and is never unlinked or written through; and containment resolves prospective paths through the nearest existing ancestor, with every planned directory — the artifact directory included — created only after validation.

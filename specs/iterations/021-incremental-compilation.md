<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-021: Incremental Compilation

## Goal

Implement [DR-021](../decisions/021-incremental-compilation.md): versioned build history, exact step reuse, agent-performed updates from prior input, diff, and prior output, and `--rebuild` — as a thin layer over the existing runner, with fixture-based acceptance and a green release gate.

## Deliverables

- [ ] Versioned `.slc/` build history recorded after full runs, tolerant of any corruption.
- [ ] Step reuse, update-mode execution with host-supplied prior input and diff, and the `up to date` no-op.
- [ ] `--rebuild`, failure carry-forward, and non-lineage exclusions (`-o`, reserved `slc`, partial forms).
- [ ] Coordinated specs, integration acceptance, user documentation, and a green deterministic release gate.

## Tasks

Tasks are ordered; each numbered task shall land as exactly one commit that also checks the task here, with focused tests and any named spec change atomic with the code.

1. [x] **Specify incremental compilation.** Land DR-021, the INCR user/dev/test packages, this record, and the map rows.
2. [ ] **Share small host helpers.** Reapply the shared error-inspection helpers (`src/errors.ts` dedup) and the shared UTF-8 byte ordering plus frozen tree-record encoding in `src/hash.ts`.
3. [ ] **Fix pass pin keys.** Accept portable pass names as pin keys (`src/pins.ts` key validation, `src/phase.ts` portable-name check) with the DR-013/PIN/PIPE spec corrections; a pinned pass phase currently makes `slc.pins.json` unloadable.
4. [ ] **Add the build-history store and line diff.** New `src/build-history.ts` (lenient load, hash-verified copies, atomic `latest` recording) and `src/line-diff.ts` (unified line diff with a size budget), with unit tests covering INCR-9/10/11.
5. [ ] **Carry update context to executors.** Extend the compile `ExecuteRequest` with optional prior-input path and diff, protect the prior input, render the interpreted update block, and append the same text to compiled performing prompts; cover INCR-14/15 with executor-level tests.
6. [ ] **Reuse, update, and record in the runner.** Wire step selection (INCR-12/13), recording with carry-forward and rebind diagnostics (INCR-16/17), the `up to date` outcome, and `--rebuild` parsing/reporting through `runFull`/`runFullLink`, with the small CLI spec updates for the flag and outcome.
7. [ ] **Land integration acceptance.** Fixture-pipeline coverage for INCR-18 through INCR-26.
8. [ ] **Close the iteration.** README and changelog, final map/traceability corrections, deliverables checked, `npm run release:check` green, in one docs-only commit.

## Acceptance criteria

- Every task is one commit, and no implementation commit precedes the spec contract it implements.
- A repeated unchanged invocation reports `up to date` with zero executor invocations and zero writes.
- A changed source triggers update-mode execution whose request carries the prior input and diff; unaffected steps are reused byte-for-byte, including hand-refined outputs.
- Corrupt or missing history never fails a run; failed runs keep completed-step progress; `--rebuild` bypasses reuse but never pin validation.
- `-o`, reserved `slc`, and partial invocation forms stay outside history, and the reviewed self-host bundle keeps its pinned fixed point.
- Fixture pipelines cover the acceptance without live model calls, and `npm run release:check` passes before the iteration closes.

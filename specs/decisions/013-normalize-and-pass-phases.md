<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-013: Generic input normalization and optimization pass phases

## Status

Accepted.

## Context

Two gaps separate `slc` from the driver/pass architecture that makes classic compilers composable (LLVM's `clang` driver over `opt` passes over a fixed IR).

First, raw user input often under-determines a pipeline's entry phase.
The `playbook` entry phase accepts free-form prose, but an input that leaves actors unnamed, outcomes implicit, or environment preconditions unstated compiles leniently: the compile agent must guess structure the user never wrote down (players, `Results:` contracts, setup steps).
Other pipelines' entry phases may be stricter still.
`slc` has no generic way to turn raw input into the entry phase's expected source form.

Second, every compiled behavior runs an agent, even when the behavior is mechanical.
Playbook's DR-016 adds the target-side primitive — GEARS script items compiled to agent-free script states — but nothing in `slc` can schedule the transformation that introduces them: the chain model (PIPE-4) admits only format-changing phases, so a gears → gears rewrite cannot even be loaded (PIPE-2 rejects its filename, PIPE-5 its chain shape).

## Decision

### 1. Pass phases

- A phase whose `## Formats` source and target formats are equal is a **pass phase**.
  Its filename is its pass name (`<name>.md`, e.g. `optimize.md`); the `<source>2<target>.md` rule applies only to format-changing phases.
- Pass phases sit outside chain inference: entry/exit computation, branch and cycle refusals, and the single-linear-chain requirement consider only format-changing phases.
  A pass may not shadow a chain phase's name or the reserved `link`.
- Passes run only on request. `-O`/`--optimize` on a full or full-link run schedules every discovered pass after the phase producing its format, in pass-name order.
  With passes active on a format, the producing phase writes the `.raw` intermediate (`<basename>.<format>.raw<ext>`) and the final pass writes the canonical path, so downstream phases, verification, and pins see the canonical artifact with identical naming whether or not optimization ran.
- `slc <pipeline>.<pass> <source>` runs one pass standalone; it writes `<basename>.<format>.opt<ext>` (or `-o`) because a pass may not overwrite its own source (DR-003).
- A pass executes like any phase: interpreted without a pin, compiled through a current pin, fail-closed on a stale one (DR-007).
  Pass definitions are ordinary definitions — compilable by `slc slc`, ownable by the pipeline vendor (the `playbook` pipeline's `optimize.md` is Playbook's DR-016).

### 2. Generic input normalization

- `--normalize` on a full or full-link run schedules one generic normalization step ahead of the entry phase.
  Its definition ships with `slc` itself (`normalize.md` beside the compiled host), because its knowledge is pipeline-agnostic: rewrite raw input into a source satisfying the **entry-phase definition**, which the step receives as a read-only reference input.
- The step writes `<artifact-dir>/<basename>.<entry-format><entry-ext>` (the entry phase's non-entry source form); the entry phase consumes that file.
  The raw user input is never modified.
- Normalization is fidelity-bounded: same language, same meaning, same step order; it may only surface *implicit structure* (actors, delimitation) and *implicit executability preconditions* (e.g. a procedure that commits to version control assumes a repository; a setup step establishing it when absent may be made explicit).
- The `compile` execution request gains optional read-only `references`; the interpreter presents them beside the source and the DR-003 boundary protects them like definitions.

### 3. Division of labor (the LLVM analogy)

- **slc host (driver + pass manager)**: discovery of pass phases, `-O`/`--normalize` scheduling, artifact naming, protection, and executor selection — deterministic mechanics, spec'd here and in `PIPE`/`CLI`/`PHEXEC`.
- **Definitions (the passes and frontends themselves)**: what a pass does (`optimize.md`), what a phase accepts (`text2gears.md`), and the target-side primitives they compile to (script actors) — owned upstream with the pipeline, vendored and pinned like every definition, evolved through `slc slc`.
- The generic normalize definition is host-owned precisely because it binds to no pipeline: it is parameterized on whichever entry-phase definition the resolved pipeline supplies.

## Consequences

- `slc playbook workflow.md --normalize -O --link <runtime>` compiles raw prose end to end: normalization makes actors and preconditions explicit, the optimize pass rewrites mechanical steps into agent-free script states, and the emitted verification tests cover both (script conformance and coverage extend `VERIFY`).
- Unoptimized runs are byte-compatible with today: no pass phase in the directory, or no `-O`, changes nothing.
- A pipeline directory may now legally contain non-chain `.md` phase files; hosts older than this decision refuse such directories, which is the intended fail-closed behavior for a vendored pipeline they cannot schedule.
- Verification gains script-item parsing and script-state conformance/coverage so optimized artifacts verify as strictly as unoptimized ones.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-046: Bounded Child-Chain Coverage

## Status

Accepted.

## Context

The maintained DEV workflow has no preemption surface and chains planning, branch creation, decision, coding and pull-request children.
Its empty coverage findings previously skipped every child because selection depended on a root `BOSS_INTERRUPT`.
The one-predecessor correction in [DR-045](045-static-child-coverage-entry.md) does not enter a child behind another child.

## Decision

- Select ordinary nested-child coverage and ordinary acting-result coverage independently of a preemption event.
- Explore finite invocation paths from actual initialized or public entry routes, replaying each predecessor output or rejection through XState before observing the next context.
- Keep invocation entry discovery through eventless (`always`) transitions outside the supported coverage domain; entry expansion follows declared `initial` targets and parallel regions, so a runtime-valid FSM may receive an unsupported-entry or unsupported-parallel-join finding.
- Preserve distinct paths when different outcomes reach the same invocation with different context; do not assign child-context fields or jump to private states.
- Default each target-arm or declared acting-result search to 64 replay attempts and eight invocation steps; accept explicit positive integer limits up to 1024 attempts and 64 invocation steps, excluding repeated invocations from a simple path except successive canonical `needsBossReply` outcomes, each followed by its actual Boss wait and addressed nonblank `BOSS_REPLY` before revisiting the same invocation; every revisit consumes the existing path and replay budgets.
- Use existing bounded guard and runtime-valid result candidates in declaration order; no workflow-specific field names or source-semantic inference select a route.
- Recover identifier-like quoted routing values from the finite artifact source without an arbitrary identifier-length cutoff, retaining the same alphabet filter, first-occurrence deduplication and existing probe/path/depth budgets; every supplied value still requires the actual authored guard and ordered transition replay.
- For an ordinary declared result, preserve its complete seed and discriminator while guiding generic string placeholder values from own reached-context nonempty string data actually read after that output field; retain at most four distinct observed values and four variable overrides under the same probe budget, with no context mutation or additional field synthesis.
- Require actual actor completion to select the ordered arm and reach its declared target; verify the ordinary question result's parked wait and reply routing, including blank-reply rejection.
- Rotate queued path selections fairly among admitted families identified only by their declared root invocation, keeping distinct paths, contexts and lazy accepted public-entry alternatives within their family; modes and context values do not define families or merge paths, and an immediate charged replay after a failed target stays in its current selection.
- Within a family, check an entered target before probing its possible successors, stop at its first satisfying candidate, and charge a replay of the same prefix after a failed target check to the single existing attempt budget; prioritize successors whose declared next invocation is the audited target, including canonical question/reply successors, in candidate order before unrelated family-local FIFO prefixes.
- Keep the selected finite attempt and invocation limits shared across all families; fair scheduling does not guarantee completeness for every family or distinct mode sharing one root.
- Snapshot seed-object descriptors only within one guard-probe call, retaining fresh candidate objects, prototypes, accessors, symbols and property attributes without cross-call caching.
- Cap the derived generated coverage-test timeout at 300,000 milliseconds, retaining any smaller derived bound; exceeding this execution deadline leaves verification failed or unverified, without asserting an unsatisfiable arm or asking for Source clarification.
- Report exhausted budgets and cycle-dependent or unsupported entry paths explicitly rather than treating skipped work as success or proving semantic impossibility.
- Keep unsupported histories visible; bounded canonical question/reply revisits do not establish arbitrary loop or durable-session correctness.

## Consequences

DEV-like child chains receive real coverage without requiring invented interrupt surfaces.
Finite path replay increases verification work, and the generated timeout accounts for its explicit bounds.
Its uncapped scheduling estimate multiplies target searches by replay/settle limits and the existing per-candidate guard-probe allowance; the five-minute test deadline limits that conservative estimate and is not a promised elapsed time or a semantic verdict.
The benchmark's separate whole-experiment deadline and validation-child termination provide additional protection during live validation.
The depth and attempt limits bound exploration rather than asserting that larger workflows are incorrect.
Unsupported eventless-entry findings fail the producer and protected-input consumer coverage gates under [DR-049](049-early-transition-coverage.md), even when the FSM can execute successfully in XState.

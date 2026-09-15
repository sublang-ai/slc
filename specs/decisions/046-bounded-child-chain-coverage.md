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
- Bound each target-arm or declared acting-result search to 64 replay attempts and eight invocation steps, excluding repeated invocations from a simple path except one canonical `needsBossReply` outcome, actual Boss wait, and nonblank `BOSS_REPLY` revisit per replay.
- Use existing bounded guard and runtime-valid result candidates in declaration order; no workflow-specific field names or source-semantic inference select a route.
- Require actual actor completion to select the ordered arm and reach its declared target; verify the ordinary question result's parked wait and reply routing, including blank-reply rejection.
- Check an entered target before probing its possible successors, stop target probing at its first satisfying candidate, and replay the same prefix within the existing attempt budget when a failed target check may have advanced the actor.
- Snapshot seed-object descriptors only within one guard-probe call, retaining fresh candidate objects, prototypes, accessors, symbols and property attributes without cross-call caching.
- Cap the derived generated coverage-test timeout at 300,000 milliseconds, retaining any smaller derived bound; exceeding this execution deadline leaves verification failed or unverified, without asserting an unsatisfiable arm or asking for Source clarification.
- Report exhausted budgets and cycle-dependent or unsupported entry paths explicitly rather than treating skipped work as success or proving semantic impossibility.
- Keep unsupported histories visible; one question/reply revisit does not establish arbitrary loop or durable-session correctness.

## Consequences

DEV-like child chains receive real coverage without requiring invented interrupt surfaces.
Finite path replay increases verification work, and the generated timeout accounts for its explicit bounds.
Its uncapped scheduling estimate multiplies target searches by replay/settle limits and the existing per-candidate guard-probe allowance; the five-minute test deadline limits that conservative estimate and is not a promised elapsed time or a semantic verdict.
The benchmark's separate whole-experiment deadline and validation-child termination provide additional protection during live validation.
The depth and attempt limits bound exploration rather than asserting that larger workflows are incorrect.
Unsupported eventless-entry findings fail the producer and protected-input consumer coverage gates under [DR-049](049-early-transition-coverage.md), even when the FSM can execute successfully in XState.

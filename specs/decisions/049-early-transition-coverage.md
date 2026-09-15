<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-049: Early Transition Coverage

## Status

Accepted.
Extends [DR-033](033-early-conformance-and-mechanical-repair.md) and [DR-040](040-early-continuation-input-contract.md).

## Context

C7 CODE compilation spent 175.820 seconds linking an FSM whose unchanged coverage checker reported three unreachable or unsupported child-success arms in 500 milliseconds.
Public XState execution and the incoming-transition invariant independently established that all three were redundant fallbacks.
Definition guidance alone had not prevented their generation.

## Decision

- Run the existing exact coverage checker after the FSM producer's earlier checks pass, using its existing same-Coder repair budget and post-acceptance recheck.
- Apply the same check before consuming a supplied FSM; the consumer cannot repair its protected input.
- Preserve the existing finite search, verdict distinctions and generated verification obligations; no unsupported result becomes proof of impossibility or a Source clarification.
- Bound each check cooperatively by its derived deadline and optional caller cancellation, with independent resources and cleanup on every exit.
- Preserve the current in-process module-loading and TypeScript-checking model; synchronous artifact code is not preemptible, and this change introduces no worker loader or transpiler.
- Recheck protected inputs after every importing or executing preflight and producer acceptance recheck, prioritizing mutations over checker outcomes.

## Consequences

Known coverage defects can be repaired before downstream linking, and supplied FSMs cannot bypass this boundary.
Clean checks repeat where the existing acceptance contracts require revalidation.
Cooperative limits bound progressing checks and waits, but cannot interrupt an infinite synchronous guard or import.

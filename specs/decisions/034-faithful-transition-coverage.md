<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-034: Faithful Transition-Coverage Probes

## Status

Accepted.
Amended by [DR-049](049-early-transition-coverage.md), [DR-053](053-recovery-controller-discrimination.md).

## Context

A measured minimal compilation routed a script's zero exit to the next work state and its nonzero exit through an unguarded fallback to failure.
The coverage checker rejected the reachable fallback and omitted the script runtime's required exit status from its synthetic outputs.
An invalid synthetic success could therefore leave the working state through failure without establishing the declared success arm's coverage.

## Decision

- Evaluate declared outcomes against ordered XState arms, including a fallback only when every preceding guard rejects that valid output.
- Preserve controller action distinctness and rejection of missing, shadowed, unresolved, or unsatisfiable transitions; a defensive final unguarded fallback into the parked leaf reports invalid output rather than selecting a second action ([DR-053](053-recovery-controller-discrimination.md)).
- Give script probes the actual two-field runtime output: the first declared guard with exit status zero, and the second with representative nonzero exit statuses drawn from the bounded candidate set.
- Use the same bounded valid-output candidates for declared-result acceptance and arm auditing, and drive a directly accepting candidate; outcome reachability requires one satisfying representative rather than proving every possible exit status safe.
- Apply the candidate cap per arm, prioritizing that arm's constants over general artifact candidates, so unrelated arms cannot exhaust its search; combine only accepted candidates for runtime driving.
- Never invent additional script output fields or use a malformed bare script output to satisfy a guarded arm.
- Preserve the supplied top-level event payload in both candidate evaluation and read tracing, including its own-property descriptors; an authored guard may read known fields through descriptors without requiring new reflective-field inference.
- This correction changes verification accuracy; [DR-049](049-early-transition-coverage.md) runs the same coverage at the FSM boundary.

## Consequences

Valid failure fallbacks pass coverage, while guards that accept only impossible script outputs remain findings.
Coverage establishes artifact reachability rather than inferring an outcome's intended meaning from its name or prose.

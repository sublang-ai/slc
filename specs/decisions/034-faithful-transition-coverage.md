<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-034: Faithful Transition-Coverage Probes

## Status

Accepted.

## Context

A measured minimal compilation routed a script's zero exit to the next work state and its nonzero exit through an unguarded fallback to failure.
The coverage checker rejected the reachable fallback and omitted the script runtime's required exit status from its synthetic outputs.
An invalid synthetic success could therefore leave the working state through failure without establishing the declared success arm's coverage.

## Decision

- Evaluate declared outcomes against ordered XState arms, including a fallback only when every preceding guard rejects that valid output.
- Preserve controller action distinctness and rejection of missing, shadowed, unresolved, or unsatisfiable transitions.
- Give script probes the actual two-field runtime output: the first declared guard with exit status zero, and the second with representative nonzero exit statuses drawn from the bounded candidate set.
- Never invent additional script output fields or use a malformed bare script output to satisfy a guarded arm.
- Keep coverage outside the early compilation gates; this correction changes verification accuracy, not compilation policy.

## Consequences

Valid failure fallbacks pass coverage, while guards that accept only impossible script outputs remain findings.
Coverage establishes artifact reachability rather than inferring an outcome's intended meaning from its name or prose.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-045: Reached Context for Nested-Child Coverage

## Status

Accepted.

## Context

A generated CODE workflow enters static review calls only after a coding actor assigns its result to context.
The checker attempted unsupported direct interrupts into those child states and evaluated their outgoing guards against initial context.
Ten reported unreachable or unsatisfiable arms execute successfully through the unchanged machine's actual preceding coding transitions.

## Decision

- Within selected nested-call coverage, enter literal and dynamic child calls through an initially active invocation, an authored public entry, or one preceding Captain/player result that selects the call.
- Enumerate the finite declared predecessor results; different results may establish different contexts for the same child.
- Evaluate ordered child-result guards against the snapshot reached by actual predecessor execution, without assigning new child-context values.
- Resolve or reject the pending scripted child and require its authored target; neither a satisfying predicate alone nor a private state jump establishes coverage.
- Keep missing, shadowed, unsatisfiable and unentered transitions as findings, with input failures diagnosed at their real start boundary.
- Bound the search to one predecessor invocation and existing result, guard and settle budgets; deeper unsupported paths remain findings.
- Keep source-specific child acceptance and public-envelope correctness separate from generic transition reachability.

## Consequences

Valid non-root-jumpable child calls pass through their real accumulated context.
Coverage remains a bounded test rather than an exhaustive proof, and its generated-test timeout includes the finite predecessor attempts.
Selection of workflows without a preemption surface and paths through preceding children are outside this correction.

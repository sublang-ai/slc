<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-048: Canonical Actor Diagnostic

## Status

Accepted.

## Context

A real DEV compilation emitted `Captain shall first call playbook` for a nested call.
The existing parser treated that near-miss as direct Captain work because nested-playbook actor syntax is intentionally fixed and source interpretation must not infer actor kind from prose.
The source producer can repair the generated GEARS if the compiler reports the syntax defect at the GEARS boundary.

## Decision

SLC adds a pure GEARS actor-contract check beside the existing result-contract check.
The check reports item-scoped unquoted clause lines matching `Captain shall (first|then|next|finally) call playbook` with an actionable diagnostic that names the exact canonical `Captain shall call playbook ...:` form and preserves sequencing in the `When` or `While` clause or continuation prose.
The check does not change parser actor classification, infer arbitrary natural language, scan blockquotes or `Results:` descriptions, or alter existing result-contract API behavior.

## Consequences

Malformed generated GEARS fails before gears2fsm executor work and can be repaired by the bounded same-Coder mechanical loop.
Canonical nested calls, ordinary direct-Captain clauses, quoted literals, and control-result prose remain accepted.

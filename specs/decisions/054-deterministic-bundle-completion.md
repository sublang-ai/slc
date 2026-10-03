<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-054: Deterministic Bundle Completion

## Status

Accepted. Amends [DR-014](014-cwd-output-invocation-defaults-entry-emission.md) in emission eligibility; clarifies [DR-021](021-incremental-compilation.md) in history exclusion.

## Context

Named phases and direct linking preserve accepted intermediates after an expensive failed compile, but do not emit a registry entry or verification files.
[DR-014](014-cwd-output-invocation-defaults-entry-emission.md) limits that completion to full linking, and [DR-021](021-incremental-compilation.md) deliberately gives manual salvage no partial-build history.
Rerunning an already accepted model link only to emit derived files is unnecessary.

## Decision

- Add `slc playbook <entry-form-source> --complete`, optionally declaring the retained link target with `--link <target>`; the installed Playbook runtime remains the default.
- Require the explicitly selected Source and its canonical GEARS, FSM, and linked module under the invocation-directory naming rule; refuse raw normalization, output relocation, optimization, rebuilding, link options, other pipelines, and named-phase forms.
- Resolve definitions and configuration without selecting or constructing an agent, seeding configuration, executing a phase, or falling back to compilation.
- Validate the current artifacts using existing Source conservation, GEARS contracts, strict FSM typing, conformance, continuation, child suspension, transition coverage, linked composition/schema, retained entry-option boundary, and import-integrity checks before emitting the usual verification support, tests, and registry entry.
- Require the linked module's declared FSM object edge to import the selected TypeScript artifact; refuse a JavaScript object edge instead of probing TypeScript and emitting an entry that loads different runtime bytes, while permitting an unused JavaScript sibling.
- Protect those inputs and every derived output by the existing physical-alias rules; detect input mutation during module loading and probes before completion output, including when a probe fails, without claiming to undo arbitrary module side effects.
- Preserve retained-artifact validator fallback from [DR-044](044-artifact-owned-entry-options.md); a missing historical validator is not a newly executed link's output violation.
- Completion checks the operator-selected current bundle; it does not certify its original compilation, semantic review, or execution, and does not consume, invalidate, or publish build history.
- Mechanical Source conservation does not prove semantic correspondence of prose conditions, result descriptions, or item partitioning; a mechanically coherent but stale selection remains the operator's responsibility.

## Consequences

- This amends [DR-014](014-cwd-output-invocation-defaults-entry-emission.md)'s emission eligibility and explicitly excludes completion from [DR-021](021-incremental-compilation.md)'s history authority.
- Existing named phases and direct links retain their semantics and required operands.
- Missing or inconsistent artifacts fail without paid repair; the author uses the existing named phase or full compile explicitly.
- No provenance store, resume state, partial-build adoption, or cache is introduced.
- Registry emission does not perform host registration or establish runtime acceptance of a workflow.

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-035: GEARS Result Contracts at the Producer Boundary

## Status

Accepted.

## Context

A measured compilation emitted malformed GEARS result metadata, accepted an optimization pass that preserved it, and spent 283 seconds across three FSM-generation attempts trying to repair the protected GEARS input by changing only the FSM.
The existing parser identified the same producer defect in less than one millisecond.
Source-fidelity checks deliberately permit judged wording in plain-prose sources and do not validate the GEARS result syntax.

## Decision

- Expose the existing GEARS parser's result-contract findings independently of an FSM, without adding grammar, role inference, or natural-language interpretation.
- Check every compile phase producing the declared `gears` format, including normalization to a GEARS entry format, format-preserving passes, and the reserved meta-pipeline, through the existing bounded mechanical-repair loop and final acceptance recheck.
- Compose that check with applicable Source fidelity rather than replacing it.
- Before selecting an execution strategy for a phase consuming `gears`, reject existing parser findings in its protected source without invoking an executor or asking that consumer to repair another phase's artifact.
- Preserve ordinary incremental reuse, source and definition protection, and immediate clarification stopping; this check neither rewrites an artifact nor asks the user to resolve a compiler-generated syntax defect.
- Repair remains the producer's responsibility under its authoritative definition: source obligations must survive the corrected representation.

## Consequences

Generated result-contract defects reach the Coder while the artifact is still its writable target.
A direct invocation over malformed GEARS fails promptly with source-specific diagnostics rather than spending consumer calls on an impossible repair.
The check remains deliberately narrower than complete GEARS or source-semantic validation.

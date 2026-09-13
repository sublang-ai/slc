<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-039: Complex Workflow Performance

## Status

In progress

## Intent

Measure current CODE and DEV compilation and investigate their execution costs separately, retaining improvements only when comparable successful runs preserve authored behavior.

## Deliverables

- [ ] Bounded current-source compilation baselines with phase timing and artifact acceptance.
- [ ] Controlled candidate comparisons with retained, rejected, and unavailable results distinguished.
- [ ] Execution call topology and measured host overhead with required review, routing, and repository semantics preserved.
- [ ] Reproducible results, synchronized specifications, and validated commits.

## Tasks

1. [ ] Record exact current workflow sources, runtime and compiler identities, and baseline acceptance.
2. [ ] Measure omission of an unproductive optimization pass and any independently justified linker candidate.
3. [ ] Profile execution boundaries and implement only evidence-supported behavior-preserving improvements.
4. [ ] Publish separate compilation and execution conclusions with reproducible settings and outstanding limits.

## Verification

- Use the existing [measurement contract](../packages/compilation-measurement.md) and fresh private output directories with one Opus 5 or GPT-6 compilation agent.
- Preserve original CODE and current DEV source bytes, including DEV's pull-request paths; never compare its older source as the same workload.
- Run equivalent settings sequentially, retain failures and clarification outcomes, and require strict and generated-suite acceptance before claiming successful compilation savings.
- Record the C8 fixed-FSM DEV pair as raw `compile-oQuUMT` and `compile-tKSZCs` link observations only: both passed post-measurement generated and runtime controls, but the baseline public non-JSON option control failed, so no accepted speed ratio exists and the v11 pair remains pending.
- Check nested-child success proofs, exact quoted relays, and durable Boss discussion continuity against actual runtime contracts.
- Distinguish synthetic execution timing from model latency and full provider execution; preserve required nested reviews and repository effects.
- Keep historical reviewed high-effort measurements separate from current controlled comparisons.

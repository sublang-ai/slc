<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-039: Complex Workflow Performance

## Status

Complete

## Intent

Measure current CODE and DEV compilation and investigate their execution costs separately, retaining improvements only when comparable successful runs preserve authored behavior.

## Deliverables

- [x] Bounded current-source compilation baselines with phase timing and artifact acceptance.
- [x] Controlled candidate comparisons with retained, rejected, and unavailable results distinguished.
- [x] Execution call topology and measured host overhead with required review, routing, and repository semantics preserved.
- [x] Reproducible results, synchronized specifications, and validated commits.

## Tasks

1. [x] Record exact current workflow sources, runtime and compiler identities, and baseline acceptance.
2. [x] Measure omission of an unproductive optimization pass and any independently justified linker candidate.
3. [x] Profile execution boundaries and implement only evidence-supported behavior-preserving improvements.
4. [x] Publish separate compilation and execution conclusions with reproducible settings and outstanding limits.

## Verification

- Use the existing [measurement contract](../packages/compilation-measurement.md) and fresh private output directories with one Opus 5 or GPT-6 compilation agent.
- Preserve original CODE and current DEV source bytes, including DEV's pull-request paths; never compare its older source as the same workload.
- Run equivalent settings sequentially, retain failures and clarification outcomes, and require strict and generated-suite acceptance before claiming successful compilation savings.
- Record the C8 fixed-FSM DEV pair as raw `compile-oQuUMT` and `compile-tKSZCs` link observations only: both passed post-measurement generated and runtime controls, but the baseline public non-JSON option control failed, so that v9 comparison remains invalid.
- The v11 DEV baseline `4JLsmu` passed public option checks but invented a presentation annotation; its pair with `7694Jg` therefore supplies no accepted DEV speed ratio.
- Check nested-child success proofs, exact quoted relays, and durable Boss discussion continuity against actual runtime contracts.
- Distinguish synthetic execution timing from model latency and full provider execution; preserve required nested reviews and repository effects.
- Keep historical reviewed high-effort measurements separate from current controlled comparisons.

- C10/v13 records accepted CODE phase-chain evidence from accepted GEARS, not a cold full-source CODE timing: `phase-2E2YFN` produced FSM SHA-256 `1556aa693c13703898e44bc2284c10b547d882fd37ac94454374900f601dac0d`; matched links `crYwRj` and `aMUkFr` both passed strict, import, eight generated tests, metadata/options controls, and 18 runtime cases; the accepted link-only comparison is 638219 ms versus 206865 ms.
The [accepted pair report](../../docs/performance/code-link-pair-2026-09-14.json) records the final comparison; it supports only the scoped CODE link comparison from the accepted FSM.

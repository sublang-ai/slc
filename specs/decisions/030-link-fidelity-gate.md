<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-030: Deterministic Link-Fidelity Gate Before Review

## Status

Accepted

## Context

A full-link run emits a prompt-contract suite and loads the linked module only after the link phase has been accepted ([DR-021](021-incremental-compilation.md)), so the deterministic checks that suite performs — the module imports and constructs, and every player-invoking state's prompt composer runs on an ordinary turn and yields the authored prompt with its placeholders substituted per the link contract — arrive too late to correct the Coder.
A reviewed compile of a maintained playbook accepted a linked module after three hours whose Coder synthesis state composed its prompt under the wrong role identity; the Reviewer missed it, and the emitted suite reported it immediately afterwards.
[DR-029](029-source-fidelity-gate.md) already relays mechanical findings to the Coder in place of a Reviewer call through a hook the reviewed loop carries for text2gears; the same hook serves the link phase.
The FSM coverage verifier is excluded: it reports probing limits on valid artifacts, so it is not a gate until that noise is removed.

## Decision

- After a link phase produces a Coder result, and before any Reviewer call on that result, the host runs the deterministic link checks on the current live linked module beside its FSM: the module imports and its factory constructs under the verification harness, and every player-invoking state's prompt composer yields the authored prompt on an ordinary turn with each placeholder substituted per the link contract, exactly as the emitted prompt-contract suite would assert.
- Findings are mechanical Reviewer findings under the [DR-029](029-source-fidelity-gate.md) protocol: relayed to the Coder as a numbered findings list in place of that round's Reviewer call, counted as one permitted Reviewer call, and failing the phase closed without a reviewed loop; a result with no finding proceeds to the Reviewer as before.
- A module that cannot be loaded yields findings, not an error, so the Coder receives the import diagnostic as a finding.
- The emitted prompt-contract suite remains the post-link record; the gate reuses its checks and adds none.

## Consequences

- An unloadable module or a mis-composed player prompt is corrected inside the reviewed loop instead of surfacing after a multi-hour acceptance.
- The link phase's Reviewer judges only what is not mechanically decidable, as the text2gears Reviewer does under [DR-029](029-source-fidelity-gate.md).

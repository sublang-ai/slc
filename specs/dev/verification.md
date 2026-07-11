<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# VERIFY: Compilation-Correctness Verification

## Intent

This package specifies how `slc` verifies that a compiled `playbook` artifact
faithfully represents its source, per
[DR-009](../decisions/009-slc-playbook-pipeline-compilation.md).
A compiled artifact is judgment-produced, so `slc` re-checks it deterministically
against the `gears` and `fsm` it was built from and emits that check as a test
beside the artifacts (under `<basename>.playbook/`) so each build re-verifies
faithfulness.
This package covers GEARS↔FSM conformance; further invariants (FSM introspection
counts, prompt-contract, and transition coverage) extend it.

Essential project-specific reference: `slc`, this project's compiler CLI.

## GEARS↔FSM conformance

### VERIFY-1

When checking a compiled `playbook` artifact's GEARS↔FSM conformance, the slc command shall report a finding unless every `gears` item maps to exactly one captain-invoking FSM state that carries that item's player and its prompt body verbatim, and every captain-invoking FSM state references a `gears` item that exists ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### VERIFY-3

When checking a compiled `playbook` artifact's GEARS↔FSM conformance ([VERIFY-1](#verify-1)), the slc command shall report a finding for every captain-invoking FSM state whose `result` map does not declare the Boss-reply suspension key `needsBossReply`, or declares it with a description that lacks the adjudicator contract substring ``Output shall include `question:`` ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

## Test generation

### VERIFY-2

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall emit a test beside them, in `<basename>.playbook/`, that runs the GEARS↔FSM conformance check ([VERIFY-1](#verify-1)) over the artifact's `gears` file and the machine its `fsm` module exports, so each build re-checks faithfulness; when `-o` relocates the `fsm` out of that directory, the slc command shall emit no verification test ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### VERIFY-4

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall derive the machine's structural topology from the produced `fsm` — the captain-state bindings with their result keys, every `onDone`/`onError`/event transition arm, the quiescent and root event surfaces, and the `BOSS_INTERRUPT` jumpable set — and emit a test beside the artifacts that fails when the machine no longer matches that pinned topology; when the produced `fsm` module cannot be imported for derivation, the slc command shall report a diagnostic and emit no introspection test while leaving the run outcome unchanged ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### VERIFY-5

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall derive each captain state's prompt contract from the artifacts — its traced context reads, its sentinel-traced input wiring, and its prompt's placeholder tokens — and emit a test beside the artifacts that fails when the contract no longer matches; and where a linked `<basename>.playbook.ts` beside the artifacts exposes its prompt composer, the emitted test shall additionally fail when the composer stops substituting a placeholder it substituted at build time, stops preserving the complete prompt body verbatim as one contiguous ordered block, leaks the Boss-reply adjudicator contract into a player prompt, composes continuation blocks on an ordinary turn, or composes a continuation turn without the exact preamble and labelled Q&A blocks before the body, while a linked module exposing no composer degrades to the artifact-only test with a diagnostic ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

### VERIFY-6

When a compiled `playbook` artifact's `gears` and `fsm` are produced at their canonical `<basename>.playbook/` locations, the slc command shall emit a transition-coverage test beside the artifacts that drives the machine with a scripted captain and fails when a declared transition is unreachable: every captain state's result key shall fire a transition out of the state — `needsBossReply` suspending in the Boss-reply wait state, resuming on a Boss reply, and not resuming on a blank answer — every `onError` arm shall reach its target, every `BOSS_INTERRUPT` target shall be enterable, guard-free root entry events shall transition, and every guarded `onDone` arm shall be satisfiable under bounded probing seeded from the machine's state keys and the artifact's identifier literals; the check shall also fail when the machine declares no final state, no `BOSS_INTERRUPT` root event, or no Boss-reply wait state ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

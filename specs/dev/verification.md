<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# VERIFY: Compilation-Correctness Verification

## Intent

This package specifies how `slc` verifies that a compiled `playbook` artifact
faithfully represents its source, per
[DR-009](../decisions/009-slc-playbook-pipeline-compilation.md).
A compiled artifact is judgment-produced, so `slc` re-checks it deterministically
against the `gears` and `fsm` it was built from and can emit that check beside the
artifacts so each build re-verifies faithfulness.
This package covers GEARS↔FSM conformance; further invariants (FSM introspection
counts, prompt-contract, and transition coverage) extend it.

Essential project-specific reference: `slc`, this project's compiler CLI.

## GEARS↔FSM conformance

### VERIFY-1

When checking a compiled `playbook` artifact's GEARS↔FSM conformance, the slc command shall report a finding unless every `gears` item maps to exactly one captain-invoking FSM state that carries that item's player and its prompt body verbatim, and every captain-invoking FSM state references a `gears` item that exists ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

## Test generation

### VERIFY-2

When generating a compiled `playbook` artifact's verification, the slc command shall emit a test module, placeable beside the artifacts, that runs the GEARS↔FSM conformance check ([VERIFY-1](#verify-1)) over the artifact's `gears` file and the machine its `fsm` module exports, so each build re-checks faithfulness ([DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).

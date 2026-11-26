<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-064: Runtime-Owned Model Defaults

## Status

Accepted (2026-11-14).
Amends [DR-062](062-independent-ultracode-configuration.md), [DR-063](063-adapter-model-defaults-and-subagent-selection.md).

## Context

A compiler default must work with the runtime its installed Cligent admits.
Only the adapter knows the SDK floor and provider routing its model pair requires.
Control turns that prohibit tools have no use for a delegation request.

## Decision

Require Cligent `^0.39.0` for compiler transports and use its independent Ultracode capability directly.
For each role opting into model defaults, call its `defaultAgentModels(adapter, env, homeDir)` with the effective adapter, run environment and local user home.
Use the first nonempty `HOME` or `USERPROFILE`, falling back to the OS user home.
Apply the returned primary and child models only where their respective settings are omitted.
This lookup covers run environment and user-level settings only, not effective per-project, working-directory or managed provider configuration.
The SDKs still resolve their own run settings; SLC does not replicate that policy or claim that a returned pair proves the run uses a direct provider.
Projects using routing outside that lookup should set `modelDefaults: false` in their working-directory `slc.config.yaml` or explicitly select both models.
Preserve explicit per-field precedence and send child-model tuning only on calls that permit tools.

## Consequences

The compiler and its Playbook peer share the same Cligent model policy and adapter capabilities.
Both Coder and Reviewer use the same policy through the interpreted and compiled clients.

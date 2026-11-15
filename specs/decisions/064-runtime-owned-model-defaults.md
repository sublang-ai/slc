<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-064: Runtime-Owned Model Defaults

## Status

Accepted (2026-11-14).
Amends [DR-063](063-adapter-model-defaults-and-subagent-selection.md) in selection of implicit models.

## Context

A compiler default must work with the runtime its installed Cligent admits.
Only the adapter knows the SDK floor and provider routing its model pair requires.
Control turns that prohibit tools have no use for a delegation request.

## Decision

For each opted-in role, use the default pair supplied by Cligent for its adapter and provider.
A local run supplies its process environment and user home so the policy sees the same provider variables in Claude Code user settings as a run.
When Cligent supplies no model pair, including on releases that predate this contract, leave the corresponding settings to the provider.
Keep explicit per-field precedence and apply child tuning only on calls that permit tools.

## Consequences

A release supporting earlier Cligent installations can preserve their provider defaults and adopt the pair on installations with the newer runtime contract.
Both Coder and Reviewer use the same policy through the interpreted and compiled clients.

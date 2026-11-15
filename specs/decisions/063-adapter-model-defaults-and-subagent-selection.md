<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-063: Adapter Model Defaults and Subagent Selection

## Status

Accepted (2026-11-14).

Amended by [DR-064](064-runtime-owned-model-defaults.md) for the source and delivery of implicit model pairs, the Cligent floor and the omission of child-model requests on tool-free calls.

Amends [DR-015](015-first-run-config-seeding.md)'s starter defaults and extends [DR-006](006-slc-configuration-sources.md)'s schema.

## Context

Standalone compiler calls need the same model pairs as consuming applications, including independent Reviewer child selection.
Existing hand-authored configurations must retain provider defaults when they omit models.

## Decision

- Seed `modelDefaults: true` without pinning vendor-specific model fields in the starter.
- Resolve opted-in defaults by the effective adapter: Claude Fable 5.2 with Opus 5.5 subagents, or Codex GPT-6 Astra with GPT-6.1 Sol subagents.
- Fill primary and child defaults returned by required Cligent; explicit unsupported child requests refuse before execution.
- Preserve explicit model fields and independent Reviewer opt-in; omitted or false `modelDefaults` leaves omitted models to the provider.
- Suppress implicit model pins when Cligent detects a custom provider in the run environment or user-level settings, preserving explicit selections.
- Add `subagentModel` and `reviewerSubagentModel`, independently overridden by their matching `SLC_*` environment variables; `false` suppresses a child pin, `inherit` requests parent inheritance, and other nonblank strings name a model.
- Verify the repository against Claude Agent SDK 0.3.325, declared as `^0.3.325` in development only, retaining [DR-020](020-playbook-4-0-adoption.md)'s consumer-supplied SDK policy.
- Apply selections through the common client construction shared by interpreted and compiled execution.

## Consequences

A fresh installation receives the intended pairs without leaking Claude defaults into an environment-selected Codex adapter.
Existing configs without opt-in retain their prior omitted-model behavior.
Project and managed provider settings are outside the default resolver’s scope; projects using them can set `modelDefaults: false`.

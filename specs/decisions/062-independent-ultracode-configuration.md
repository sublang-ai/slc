<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-062: Independent Ultracode Configuration

## Status

Accepted (2026-11-14).
Extends [DR-006](006-slc-configuration-sources.md)'s configuration schema and [DR-022](022-two-agent-reviewed-compilation.md)'s independent role configuration without changing source precedence or review orchestration.

## Context

Claude workflow orchestration can be selected independently of reasoning effort.
Coder and Reviewer need separate controls, with environment overrides matching the existing YAML configuration model.
Some supported consumer-supplied Cligent versions expose only the legacy effort shorthand and cannot convey an independent boolean.
Ignoring explicit false on those versions can enable workflows through the shorthand despite the caller's disabling request.

## Decision

Coder accepts optional YAML `ultracode` and environment `SLC_ULTRACODE`; Reviewer accepts `reviewerUltracode` and `SLC_REVIEWER_ULTRACODE`.
YAML values are booleans; nonblank environment values are exactly `true` or `false` and override YAML independently per key.
Reviewer settings require a Reviewer agent.
Omission preserves existing defaults and the legacy effort shorthand.

Consumer-supplied Cligent's `isUltracodeSupported` is the authority for native transport support.
Supported booleans cross every configured role transport unchanged, including compiled execution and resumed calls.
Unsupported activation fails before execution; unsupported false is omitted at the transport boundary.
When the capability helper is absent, either explicit Claude boolean fails with upgrade guidance because the old transport cannot faithfully convey it; false on an unrelated adapter remains a harmless no-op.
The direct transport construction path repeats capability validation so injected or programmatic configuration cannot silently drop an activation request.
Native account, model, and workflow policy remain provider concerns.

Canonical behavior is specified by [[cli-46](../packages/cli.md#cli-46)] and [[cli-47](../packages/cli.md#cli-47)].

## Consequences

Existing configurations and defaults remain usable without upgrading Cligent.
Using the new independent Claude boolean requires a Cligent consumer version that exposes its capability helper.
No role receives a forced workflow default, and review semantics remain unchanged.

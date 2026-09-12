<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-037: Definition Reference Origin

## Status

Accepted.

## Context

A measured link phase received its definition text without the definition's location and stopped after 79 seconds because it could not find the cited sibling helper and contract.
The interpreter's contract permits definition-called tools and cited content, but relative references need their authoring file's location rather than the compilation workspace.
Compiled performing calls need the same host-owned context without changing their configured definition bytes or runtime ABI.

## Decision

- Supply the absolute definition file and its containing directory to interpreted calls and compiled transformation-performing player and direct-Captain calls.
- Resolve definition-relative references from that directory unless the definition explicitly specifies another base.
- Keep this context out of routing and judge calls, preserving definition bytes, configured options, artifact contracts, working directory, and input protections.

## Consequences

Agents can locate declared helpers and references directly without searching unrelated installations or inferring a path from embedded text.
The context identifies existing permitted inputs; it grants no new write scope or tool authority.

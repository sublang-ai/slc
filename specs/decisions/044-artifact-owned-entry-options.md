<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-044: Artifact-owned Entry Options

## Status

Accepted

## Context

The deterministic entry's fixed cwd-only allowlist cannot represent legitimate required catalogs or optional workflow inputs already validated by a linked artifact.
A generated CODE entry exposed this mismatch, alongside a separate source-inconsistent required Boss-task construction input.

## Decision

Delegate current entry option validation to a public pure linked validator reused by the artifact's option-snapshot boundary, with strict factory-derived return typing and no constructor call or inferred JSON schema.
Require the export on newly executed links that produce current entries; carry that explicit output requirement to both execution modes and existing mechanical repair.
Retain the old allowlist for artifacts without that capability outside the new-output requirement, without package-version, date or arity inference.
This boundary is specified by [[self-hosting-17](../packages/self-hosting.md#self-hosting-17)] and [[self-hosting-18](../packages/self-hosting.md#self-hosting-18)].
Do not legitimize a source-inconsistent startup requirement by exposing it as configuration: the phase definitions still distinguish immutable startup input from Boss-entry text.

## Consequences

Required and structured options remain under one artifact-owned validator.
Retained artifacts and engine ABI remain unchanged; new output-contract failures can be corrected before link acceptance.

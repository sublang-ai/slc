<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# DR-038: Quoted Task Runtime Acceptance

## Status

Accepted.

## Context

A cold compilation passed strict checking and all four generated suites, then the runtime benchmark rejected its complete Boss task because the canonical quoted relay prefixed each line with `> `.
The runtime probe required the unquoted task as one literal substring, incorrectly excluding that faithful representation.

## Decision

- Accept the minimal task either as an unchanged literal substring or as a contiguous block of whole lines formed by prefixing every original task line with exactly `> `.
- Record which representation satisfied the probe, while preserving every other task character and all repository, call-count, commit, and terminal checks.
- Reject altered, missing, reordered, or inconsistently quoted task lines rather than applying whitespace normalization or fuzzy matching.
- Keep original failed benchmark results unchanged and record corrected validation of unchanged artifacts separately.

## Consequences

The probe recognizes the existing quoted-relay contract without weakening text identity or changing compiled artifacts.
Retrospective acceptance does not replace historical timings or establish the five-minute target.

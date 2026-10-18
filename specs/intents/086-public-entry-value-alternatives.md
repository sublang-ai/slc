<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-086: Public Entry Value Alternatives

## Status

Implemented.

## Intent

One admitted public entry event can assign context that excludes a later route, even though another value passes the same entry arm and reaches that route through actual actions.
Explore finite one-field alternatives of the original entry assignment without inventing fields, assigning private context, or increasing search limits.

## Deliverables

- [x] Specify lazy alternatives with original admission and shared bounds.
- [x] Demonstrate the missing alternate route through real XState execution.
- [x] Preserve the first drive, ordered refusal and fixed-context boundaries.

## Tasks

1. Add bounded public-entry value alternatives to actual path replay.

## Verification

A read-only retained-artifact witness shows that the first admitted event fixes one mode and rejects a later arm; changing only an already assigned public event field passes the same ordered entry guard and actually reaches that arm's target with action-produced context.
On the unchanged parent, the alternate multi-step route fails while three refusal controls pass.
All six focused cases pass with lazy alternatives, including actual ordinary and alternate branch/decision/code/pull-request paths under a permissive input pool, ordered and rejected entry controls, impossible-context refusal, and the unchanged depth and replay limits.
All 247 affected coverage and retained-completion cases pass; build, lint and formatting pass after correcting an event-record type annotation.
One unchanged retained artifact has zero coverage findings versus its exact immediate parent's preserved 21 alternate-entry findings; no compiler execution or acceptance is claimed.
Global spec validation passes in the complete integration checkout, closing the sparse-checkout qualification.

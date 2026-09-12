<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-036: Strict FSM Boundary

## Status

Completed.

## Intent

Reject and repair strict FSM type errors before protected-input consumers spend agent work.

## Deliverables

- [x] Artifact-local strict checker and producer/consumer integration.
- [x] Real TypeScript repair, import-resolution, cancellation, and unchanged-artifact evidence.

## Tasks

1. [x] Specify and implement the strict FSM boundary, validate its existing repair and protection behavior, and replay the measured invalid and valid artifacts.

## Verification

All 1270 tests pass with two skips, including 15 strict-boundary cases covering real TypeScript repair, consumer rejection, relative-import module formats, cancellation, and protected-source changes; build and focused lint pass.
The unchanged `52Dess` FSM fails the real producer gate in 576 ms with zero link calls, while `aZda4G` passes and reaches the stubbed consumer in 772 ms; `/private/tmp/slc-fsm-strict-probe/gate-evidence.json` retains hashes and reproduction paths.
A locally packed installation without dev or optional dependencies checks a standalone artifact outside its dependency tree and rejects an invalid variant; evidence is in `/private/tmp/slc-fsm-strict-probe/packed-final/evidence.json`.
The root lock retains every exact package version, promotes only the existing Node declarations and their dependency to production, and refreshes only that lock hash in the three compiled pins; all three artifact verifications pass and every pin is current.

Independent review found no remaining issues and replayed the pending 20 ms deadline against unchanged `aZda4G`: the checker throws `TimeoutError` after yielding, before consumer execution.

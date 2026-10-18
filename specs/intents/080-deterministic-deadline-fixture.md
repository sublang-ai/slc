<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-080: Deterministic Deadline Fixture

## Status

Complete.

## Intent

Make the cooperative cancellation integration case establish its waiting adapter before expiring the experiment deadline.
A loaded CI runner can otherwise spend the entire 250 ms deadline in setup and correctly record zero calls, outside this case’s stated precondition.

## Deliverables

- [x] Control only timeout scheduling while preserving the real compiler and measured adapter boundary.
- [x] Verify cancellation and retained failure evidence without changing production deadlines.

## Tasks

1. Advance the test deadline after the real fixture adapter starts and restore timers afterward.

## Verification

The failing pull-request run retained a failed experiment with no measured call and then dereferenced its absent first call.
The local suite and branch CI had passed, exposing a scheduler-dependent test precondition rather than a demonstrated production cancellation failure.
The original failed run remains preserved; no failure is waived.
The corrected 20-case benchmark suite and full 1,668-test suite pass, with two existing skips; lint, formatting and spec validation also pass.

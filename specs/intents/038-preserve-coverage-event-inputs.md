<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-038: Preserve Coverage Event Inputs

## Status

Completed.

## Intent

Preserve the supplied fixed event fields during bounded transition-coverage probing.

## Deliverables

- [x] Shared event construction correction and real-transition regression cases.
- [x] Unchanged broader-FSM replay with remaining findings reported separately.

## Tasks

1. [x] Preserve top-level payload seeds in evaluation and read tracing, test matching and impossible events, and replay the measured artifact.

## Verification

- Full suite: 1,290 passed, 2 skipped; focused coverage suite: 78 passed.
- Build, changed-file ESLint and formatting, and global Spex 3 lint passed.
- `/private/tmp/slc-broader-complete-replay/replay-evidence.json` preserves the unchanged measured FSM, real `ready`→`failed`→`ready` counterexample, and removal of those two checker contradictions; total findings changed from 44 to 39, with all remaining findings reported without waiver.
- The separate complete-bundle replay passes strict TypeScript and three generated suites while coverage remains failing; independent real-host clean, agreement, and capped-failure scenarios pass without changing source, FSM, linked module, entry, or test assertions.

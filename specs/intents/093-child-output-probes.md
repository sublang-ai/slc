<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# IR-093: Child Output Probes

## Status

Implemented; deterministic verification passed; repository release checks remain pending.

## Intent

Child coverage misses legal outputs when an own-data descriptor supplies a variable value or a successful child has no output.
Guide those two cases without changing concrete acceptance, reached context or finite search limits.

## Deliverables

- [x] Specify descriptor-value guidance and absent successful child output.
- [x] Preserve descriptor semantics while guiding eligible variable values.
- [x] Replay an explicit absent-output candidate through actual ordered transitions.
- [x] Verify real child paths and refusal controls.

## Tasks

1. Cover descriptor-read values and absent child output within existing bounds.

## Verification

The unchanged parent fails both new real XState positive paths: present own-data descriptor values and absent successful child output followed by another child.
Seven refusal controls pass on that parent.
The candidate covers both positives, including mixed ordinary/descriptor reads, and retains shadowed, false-context, accessor-only, inherited-only, null-output and resolved-error refusals.
Existing descriptor-preservation, cardinality, four-field, depth, attempt and cancellation controls remain passing.

The first affected run preserved seven regressions caused by enumeration's incidental descriptor queries displacing existing value guidance.
Two deferred-hint trials remained failing; the final policy uses only the latest eligible concrete descriptor read as fallback, clears it on a later ordinary payload read, and excludes padding traces.
The corrected affected suites pass all 272 tests, and the complete deterministic suite passes 1,748 tests with two existing skips.
Build, changed-code lint, formatting and timeout-accounting checks pass.
The initial build's object-only question-helper type errors and corrected result are retained.

One public comparison on the unchanged retained failing FSM changes three findings to zero under the unchanged 300,000-millisecond cap; this is checker evidence, not compiler acceptance or workflow delivery.
The successful generic child envelope may omit output; maintained authored failure terminals still reject through onError and are not relabeled as successful onDone deliveries.
Sparse authoring lint reports exactly 15 missing protected-spec citation targets and no other errors; the protected body and object remain absent, so this is not a full spec-lint pass.

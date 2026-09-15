// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';

/** Check the installed host's durable result, independently of agent prose. */
export function assertSuccessfulWorkflow(recovery, stream, playbookId) {
  assert.equal(recovery.state, 'settled', 'session did not settle');
  assert.equal(
    recovery.snapshot.lastSettlementStatus,
    'ok',
    'workflow settlement was not successful',
  );
  assert.equal(recovery.snapshot.mode, 'chat', 'workflow remains engaged');
  assert.deepEqual(recovery.unresolvedEffects, [], 'unresolved effects remain');
  const settled = stream.entries
    .map(({ record }) => record)
    .filter(
      (record) =>
        record.type === 'captain_telemetry' &&
        record.topic === 'playbook.trace' &&
        record.payload?.playbookId === playbookId &&
        record.payload.depth === 0 &&
        record.payload.type === 'boss.input.settled',
    )
    .at(-1)?.payload.payload;
  assert.equal(settled?.outcome, 'terminal', 'root workflow was not terminal');
  assert.equal(settled.state?.status, 'done', 'root machine was not done');
  assert.equal(
    settled.terminal?.kind,
    'success',
    'root terminal was not success',
  );
}

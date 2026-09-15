// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { assertSuccessfulWorkflow } from '../scripts/acceptance-result.mjs';

const result = () => ({
  recovery: {
    state: 'settled',
    snapshot: { lastSettlementStatus: 'ok', mode: 'chat' },
    unresolvedEffects: [],
  },
  stream: {
    entries: [
      {
        record: {
          type: 'captain_telemetry',
          topic: 'playbook.trace',
          payload: {
            playbookId: 'minimal',
            depth: 0,
            type: 'boss.input.settled',
            payload: {
              outcome: 'terminal',
              state: { status: 'done' },
              terminal: { kind: 'success' },
            },
          },
        },
      },
    ],
  },
});

describe('live acceptance durable outcome', () => {
  it('accepts a successfully completed root workflow', () => {
    const { recovery, stream } = result();
    expect(() =>
      assertSuccessfulWorkflow(recovery, stream, 'minimal'),
    ).not.toThrow();
  });

  it.each([
    [
      'failed despite a successful CLI exit and commit',
      ({ recovery }) => {
        recovery.snapshot.lastSettlementStatus = 'failed';
        recovery.snapshot.mode = 'engaged.parked';
      },
    ],
    [
      'parked for a Boss answer',
      ({ recovery }) => {
        recovery.snapshot.mode = 'engaged.parked';
      },
    ],
    [
      'uncertain session',
      ({ recovery }) => {
        recovery.state = 'uncertain';
      },
    ],
    [
      'unresolved repository effect',
      ({ recovery }) => {
        recovery.unresolvedEffects.push({
          classification: 'observation-ambiguous',
        });
      },
    ],
    [
      'Captain terminal only',
      ({ stream }) => {
        stream.entries[0].record.payload.playbookId = 'captain';
      },
    ],
    [
      'nested terminal only',
      ({ stream }) => {
        stream.entries[0].record.payload.depth = 1;
      },
    ],
    [
      'failed terminal',
      ({ stream }) => {
        stream.entries[0].record.payload.payload.terminal.kind = 'failure';
      },
    ],
    [
      'later nonterminal root settlement',
      ({ stream }) => {
        const later = structuredClone(stream.entries[0]);
        later.record.payload.payload = {
          outcome: 'quiescent',
          state: { status: 'active' },
        };
        stream.entries.push(later);
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const evidence = result();
    mutate(evidence);
    expect(() =>
      assertSuccessfulWorkflow(evidence.recovery, evidence.stream, 'minimal'),
    ).toThrow();
  });
});

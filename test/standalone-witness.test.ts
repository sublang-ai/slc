// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { describe, expect, it } from 'vitest';
import { assign, fromPromise, setup } from 'xstate';
import { isAbsolute } from 'node:path';
import { checkFsmCoverage } from '../src/verify-coverage.js';
const coverage = { maxAttempts: 8, maxInvocations: 4, maxDurationMs: 10000 };
function machine() {
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw Error('unbound');
      }),
    },
  }).createMachine({
    initial: 'ready',
    context: { path: '' },
    states: {
      ready: {
        on: {
          START: {
            target: 'work',
            guard: ({ event }) =>
              typeof event.path === 'string' && isAbsolute(event.path),
            actions: assign({ path: ({ event }) => event.path }),
          },
        },
      },
      work: {
        id: 'work',
        meta: { playbook: { stateId: 'work' } },
        invoke: {
          src: 'captain',
          input: () => ({
            stateId: 'work',
            sourceItem: 'TASK-1',
            prompt: 'Read the task path.',
            result: { ok: 'Done.' },
          }),
          onDone: {
            target: 'done',
            guard: ({ event }) =>
              (event.output as { guard: string }).guard === 'ok',
          },
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: ['playbook.suspended'],
        on: { BOSS_REPLY: 'work' },
      },
      done: { type: 'final' },
      failed: { type: 'final' },
    },
  });
}
describe('public coverage witness authority', () => {
  it('replays an absolute path from the real public initial state', async () => {
    const path =
      process.platform === 'win32'
        ? 'C:\\slc-witness\\task.md'
        : '/tmp/slc-witness/task.md';
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [{ events: [{ type: 'START', path }] }],
        },
      },
      { coverage },
    );
    expect(findings).toEqual([]);
  });
  it.each([
    'enabledPlaybooks',
    'context',
    'snapshot',
    'hostCapabilities',
    'roleBindings',
  ])('refuses witness startup override of %s', async (key) => {
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [
            {
              input: {
                [key]: key === 'enabledPlaybooks' ? [{ id: 'fabricated' }] : {},
              },
              events: [],
            },
          ],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(
      /invalid public coverageWitnesses:.*host authority or private runtime state/,
    );
  });
  it('refuses private internal events rather than jumping into a state', async () => {
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [
            {
              events: [
                { type: 'xstate.done.actor.work', output: { guard: 'ok' } },
              ],
            },
          ],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(
      /only public input records and public event sequences/,
    );
  });
  it('keeps unvalidated renamed/nested startup options unverified', async () => {
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [
            {
              input: {
                startupSettings: {
                  allowedChildren: ['configured-child', 'undeclared-child'],
                },
              },
              events: [],
            },
          ],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(
      /unverified: public coverageWitnesses: nonempty witness startup options require an independent Source-derived validation contract/,
    );
  });
});

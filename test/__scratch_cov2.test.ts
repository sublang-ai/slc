// Scratch probe 2 — DO NOT COMMIT. Named (string) guards, the setup() style
// gears2fsm.md mandates: (d) a context-dependent named arm drives a false
// "fired no transition"; (e) an unsatisfiable named-guard arm is never probed.
import { describe, expect, it } from 'vitest';
import { fromPromise, setup } from 'xstate';

import { checkFsmCoverage } from '../src/verify-coverage.js';

const NEEDS_BOSS_REPLY_TEXT =
  "The player's prose surfaces a clarifying question for Boss. Output shall include `question: <verbatim question text>`.";

/* eslint-disable @typescript-eslint/no-explicit-any */

const namedGuardMachine = (opts: { unsatisfiableArm?: boolean } = {}) =>
  setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
    guards: {
      isOk: ({ event }: any) => event.output.guard === 'ok',
      isRedoFromReview: ({ context, event }: any) =>
        event.output.guard === 'redo' && context.changeOrigin === 'review',
      isNeedsBossReply: ({ event }: any) =>
        event.output.guard === 'needsBossReply' &&
        typeof event.output.question === 'string',
      never: () => false,
    },
  }).createMachine({
    id: 'flow',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: [
        {
          target: '#work',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'work',
        },
      ],
    },
    states: {
      ready: { id: 'ready', on: { GO: { target: 'work' } } },
      work: {
        id: 'work',
        invoke: {
          src: 'captain',
          input: () => ({
            player: 'Writer',
            sourceItem: 'X-1',
            prompt: 'Do the work.',
            result: {
              ok: 'The work is done.',
              redo: 'The work must be redone.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            { target: '#done', guard: 'isOk' },
            { target: '#work', reenter: true, guard: 'isRedoFromReview' },
            { target: '#awaitBossReply', guard: 'isNeedsBossReply' },
            ...(opts.unsatisfiableArm
              ? [{ target: '#done', guard: 'never' }]
              : []),
            { target: '#failed' },
          ],
          onError: { target: '#failed' },
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        on: {
          BOSS_REPLY: [
            {
              target: '#failed',
              guard: ({ event }: any) =>
                typeof event.answer !== 'string' || event.answer.trim() === '',
            },
            { target: '#work', reenter: true },
          ],
        },
      },
      failed: { id: 'failed', on: {} },
      done: { id: 'done', type: 'final' },
    },
  } as any);

/* eslint-enable @typescript-eslint/no-explicit-any */

describe('scratch: named guards', () => {
  it('(d) context-dependent named arm', async () => {
    const findings = await checkFsmCoverage({ machine: namedGuardMachine() });
    console.log('NAMED-GUARD FINDINGS:', JSON.stringify(findings, null, 2));
    expect(true).toBe(true);
  }, 60_000);

  it('(e) unsatisfiable named arm goes unflagged', async () => {
    const findings = await checkFsmCoverage({
      machine: namedGuardMachine({ unsatisfiableArm: true }),
    });
    console.log('UNSAT-NAMED FINDINGS:', JSON.stringify(findings, null, 2));
    expect(true).toBe(true);
  }, 60_000);
});

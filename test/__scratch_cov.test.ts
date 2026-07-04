// Scratch probe — DO NOT COMMIT. Verifies checkFsmCoverage behavior on
// (a) a machine whose initial state is captain-invoking (conformant per
// gears2fsm.md; the vendored codex bakeoff artifact has this shape), and
// (b) a machine whose state keys differ from their stable ids.
import { describe, expect, it } from 'vitest';
import { assign, fromPromise, setup } from 'xstate';

import { checkFsmCoverage } from '../src/verify-coverage.js';

const NEEDS_BOSS_REPLY_TEXT =
  "The player's prose surfaces a clarifying question for Boss. Output shall include `question: <verbatim question text>`.";

/* eslint-disable @typescript-eslint/no-explicit-any */

// (a) Initial state IS the captain state (mirrors codex gears2fsm.fsm.ts).
const initialCaptainMachine = () =>
  setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'flow',
    initial: 'work',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: [
        {
          target: '#work',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'work',
        },
        {
          target: '#failed',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'failed',
        },
      ],
    },
    states: {
      work: {
        id: 'work',
        invoke: {
          src: 'captain',
          input: ({ context }: any) => ({
            player: 'Writer',
            sourceItem: 'X-1',
            prompt: 'Do the work.',
            result: {
              ok: 'The work is done.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
          onDone: [
            {
              target: '#done',
              guard: ({ event }: any) => event.output.guard === 'ok',
            },
            {
              target: '#awaitBossReply',
              guard: ({ event }: any) =>
                event.output.guard === 'needsBossReply' &&
                typeof event.output.question === 'string',
              actions: assign({
                pendingBossQuestion: ({ event }: any) => ({
                  resumeStateId: 'work',
                  sourceItem: 'X-1',
                  player: 'Writer',
                  question: event.output.question,
                }),
              } as any),
            },
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
            {
              target: '#work',
              reenter: true,
              guard: ({ context }: any) =>
                context.pendingBossQuestion?.resumeStateId === 'work',
              actions: assign({
                bossReply: ({ event }: any) => event.answer,
              } as any),
            },
            { target: '#failed' },
          ],
        },
      },
      failed: { id: 'failed', on: {} },
      done: { id: 'done', type: 'final' },
    },
  } as any);

// (b) State keys differ from stable ids (gears2fsm.md: "a stable `id`", "an
// intuitive state key" — two distinct declarations). Interrupt guards compare
// event.targetId against the *id*, per the spec.
const keyVsIdMachine = () =>
  setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'flow',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: [
        {
          target: '#workItem',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'workItem',
        },
        {
          target: '#readyHub',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'readyHub',
        },
      ],
    },
    states: {
      ready: { id: 'readyHub', on: { GO: { target: 'work' } } },
      work: {
        id: 'workItem',
        invoke: {
          src: 'captain',
          input: ({ context }: any) => ({
            player: 'Writer',
            sourceItem: 'X-1',
            prompt: 'Do the work.',
            result: {
              ok: 'The work is done.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
          onDone: [
            {
              target: '#doneFinal',
              guard: ({ event }: any) => event.output.guard === 'ok',
            },
            {
              target: '#awaitBossReply',
              guard: ({ event }: any) =>
                event.output.guard === 'needsBossReply' &&
                typeof event.output.question === 'string',
              actions: assign({
                pendingBossQuestion: ({ event }: any) => ({
                  resumeStateId: 'workItem',
                  sourceItem: 'X-1',
                  player: 'Writer',
                  question: event.output.question,
                }),
              } as any),
            },
            { target: '#failedState' },
          ],
          onError: { target: '#failedState' },
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        on: {
          BOSS_REPLY: [
            {
              target: '#failedState',
              guard: ({ event }: any) =>
                typeof event.answer !== 'string' || event.answer.trim() === '',
            },
            {
              target: '#workItem',
              reenter: true,
              guard: ({ context }: any) =>
                context.pendingBossQuestion?.resumeStateId === 'workItem',
              actions: assign({
                bossReply: ({ event }: any) => event.answer,
              } as any),
            },
            { target: '#failedState' },
          ],
        },
      },
      failed: { id: 'failedState', on: {} },
      done: { id: 'doneFinal', type: 'final' },
    },
  } as any);

/* eslint-enable @typescript-eslint/no-explicit-any */

describe('scratch: checkFsmCoverage on conformant shapes', () => {
  it('(a) initial captain state', async () => {
    const findings = await checkFsmCoverage({ machine: initialCaptainMachine() });
    console.log('INITIAL-CAPTAIN FINDINGS:', JSON.stringify(findings, null, 2));
    expect(true).toBe(true);
  }, 60_000);

  it('(b) key differs from id', async () => {
    const findings = await checkFsmCoverage({ machine: keyVsIdMachine() });
    console.log('KEY-VS-ID FINDINGS:', JSON.stringify(findings, null, 2));
    expect(true).toBe(true);
  }, 60_000);

  it('(c) codex bakeoff artifact', async () => {
    const fsm: unknown = await import(
      '../.scratch/bakeoff/codex/gears2fsm.slc/gears2fsm.fsm.ts'
    );
    const findings = await checkFsmCoverage(fsm);
    console.log('CODEX FINDINGS:', JSON.stringify(findings, null, 2));
    expect(true).toBe(true);
  }, 60_000);
});

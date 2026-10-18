// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
/* eslint-disable @typescript-eslint/no-explicit-any */
import { assign, fromPromise, setup } from 'xstate';
export interface FairEntryOptions {
  trace?: { id: string; mode: string | null; kind: string }[];
  rejectedMode?: string;
  shadowFinish?: boolean;
  contradictoryReview?: boolean;
}
export function fairEntryMachine(options: FairEntryOptions = {}) {
  const QTEXT =
    'The player has a question. Output shall include `question: <text>`.';
  const trace = options.trace ?? [];
  const ids = ['entryA', 'entryB', 'entryC', 'verify', 'inspect', 'finish'];
  const modes = ['alpha', 'beta', 'gamma', 'delta'];
  const question = (id: string) => ({
    guard: ({ event }: any) =>
      event.output?.guard === 'needsBossReply' &&
      typeof event.output.question === 'string',
    target: '#awaitBossReply',
    actions: assign({
      pendingBossQuestion: ({ event }: any) => ({
        resumeStateId: id,
        sourceItem: id,
        player: 'Writer',
        question: event.output.question,
      }),
    }),
  });
  const ordinary = (
    id: string,
    result: Record<string, string>,
    onDone: any[],
    entry?: any,
  ) => ({
    id,
    entry: [
      ...(entry ? [entry] : []),
      ({ context }: any) =>
        trace.push({ id, mode: context.mode, kind: 'entry' }),
    ],
    meta: {
      playbook: { stateId: id, description: 'Generic bounded routing fixture' },
    },
    invoke: {
      src: 'captain',
      input: ({ context }: any) => ({
        stateId: id,
        sourceItem: id,
        player: 'Writer',
        prompt: 'Perform the declared work.',
        result: { ...result, needsBossReply: QTEXT },
        pendingBossQuestion: context.pendingBossQuestion,
        bossReply: context.bossReply,
      }),
      onDone: [...onDone, question(id)],
      onError: '#failed',
    },
  });
  const enter = (mode: string) => ({
    guard: ({ event }: any) =>
      options.rejectedMode !== mode &&
      typeof event.request === 'string' &&
      event.request.trim() !== '' &&
      event.mode === mode,
    target:
      mode === 'alpha' || mode === 'beta'
        ? '#entryA'
        : mode === 'gamma'
          ? '#entryB'
          : '#entryC',
    actions: assign(({ event }: any) => ({
      mode: event.mode,
      request: event.request,
      report: undefined,
      revision: undefined,
      accepted: undefined,
    })),
  });
  const start = modes.map(enter);
  const machine = setup({
    actors: {
      captain: fromPromise(async () => {
        throw Error('unbound');
      }),
      playbook: fromPromise(async () => {
        throw Error('unbound');
      }),
    },
  }).createMachine({
    id: 'generic-routing',
    initial: 'ready',
    context: { mode: null, request: '' } as Record<string, any>,
    on: {
      BOSS_INTERRUPT: [
        ...['entryA', 'entryB', 'entryC'].map((id) => ({
          target: '#' + id,
          guard: ({ event }: any) =>
            options.rejectedMode !==
              (id === 'entryA'
                ? 'alpha'
                : id === 'entryB'
                  ? 'gamma'
                  : 'delta') &&
            event.targetId === id &&
            typeof event.request === 'string' &&
            event.request.trim() !== '' &&
            (id === 'entryA'
              ? event.mode === 'alpha' || event.mode === 'beta'
              : event.mode === (id === 'entryB' ? 'gamma' : 'delta')),
          actions: assign(({ event }: any) => ({
            mode: event.mode,
            request: event.request,
          })),
        })),
        {
          target: '#verify',
          guard: ({ context, event }: any) =>
            event.targetId === 'verify' &&
            typeof context.report === 'string' &&
            modes.includes(context.mode),
        },
        {
          target: '#finish',
          guard: ({ context, event }: any) =>
            event.targetId === 'finish' && context.accepted === true,
        },
      ],
    },
    states: {
      ready: { id: 'ready', on: { START: start } },
      entryA: ordinary(
        'entryA',
        { admitted: 'Output shall include `report`.' },
        [
          {
            guard: ({ event }: any) =>
              event.output?.guard === 'admitted' &&
              typeof event.output.report === 'string',
            target: '#verify',
            actions: assign({
              report: ({ event }: any) => event.output.report,
            }),
          },
        ],
      ),
      entryB: ordinary(
        'entryB',
        { admitted: 'Output shall include `report`.' },
        [
          {
            guard: ({ event }: any) =>
              event.output?.guard === 'admitted' &&
              typeof event.output.report === 'string',
            target: '#verify',
            actions: assign({
              report: ({ event }: any) => event.output.report,
            }),
          },
        ],
      ),
      entryC: ordinary(
        'entryC',
        { admitted: 'Output shall include `report`.' },
        [
          {
            guard: ({ event }: any) =>
              event.output?.guard === 'admitted' &&
              typeof event.output.report === 'string',
            target: '#verify',
            actions: assign({
              report: ({ event }: any) => event.output.report,
            }),
          },
        ],
      ),
      verify: ordinary(
        'verify',
        { verified: 'Output shall include `revision`.' },
        [
          {
            guard: ({ event }: any) =>
              event.output?.guard === 'verified' &&
              typeof event.output.revision === 'string',
            target: '#inspect',
            actions: assign({
              revision: ({ event }: any) => event.output.revision,
            }),
          },
        ],
      ),
      inspect: {
        id: 'inspect',
        entry: ({ context }: any) =>
          trace.push({ id: 'inspect', mode: context.mode, kind: 'entry' }),
        meta: {
          playbook: {
            stateId: 'inspect',
            description: 'Independent generic child check',
          },
        },
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'inspect',
            sourceItem: 'CHECK-1',
            playbookId: 'check',
            text: 'Inspect the supplied revision.',
          }),
          onDone: [
            {
              guard: ({ context, event }: any) =>
                event.output?.accepted === true &&
                event.output?.revision === context.revision &&
                (!options.contradictoryReview ||
                  event.output.revision !== context.revision),
              target: '#finish',
              actions: assign({ accepted: true }),
            },
            { target: '#failed' },
          ],
          onError: '#failed',
        },
      },
      finish: ordinary(
        'finish',
        { ready: 'Output shall include `report`、`commit`.' },
        [
          {
            guard: ({ context, event }: any) =>
              (options.shadowFinish ||
                context.mode === 'alpha' ||
                context.mode === 'beta') &&
              event.output?.guard === 'ready' &&
              typeof event.output.report === 'string' &&
              event.output.commit !== context.revision,
            target: '#doneOrdinary',
          },
          {
            guard: ({ context, event }: any) =>
              context.mode === 'gamma' &&
              event.output?.guard === 'ready' &&
              typeof event.output.report === 'string' &&
              event.output.commit !== context.revision,
            target: '#doneGamma',
          },
          {
            guard: ({ context, event }: any) =>
              context.mode === 'delta' &&
              event.output?.guard === 'ready' &&
              typeof event.output.report === 'string' &&
              event.output.commit !== context.revision,
            target: '#doneDelta',
          },
        ],
      ),
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: [
            ...ids
              .filter((id) => id !== 'inspect')
              .map((id) => ({
                target: '#' + id,
                guard: ({ context, event }: any) =>
                  context.pendingBossQuestion?.resumeStateId === id &&
                  typeof event.answer === 'string' &&
                  event.answer.trim() !== '',
                actions: assign({
                  bossReply: ({ event }: any) => event.answer,
                }),
              })),
            { target: '#failed' },
          ],
          START: start,
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked', on: { START: start } },
      doneOrdinary: { id: 'doneOrdinary', type: 'final' },
      doneGamma: { id: 'doneGamma', type: 'final' },
      doneDelta: { id: 'doneDelta', type: 'final' },
    },
  });
  return machine;
}

/** One root's lazy public variants expose the shared replay accounting. */
export function lazyEntryBudgetMachine(
  variants: readonly string[],
  observed: string[] = [],
) {
  return setup({
    actors: { playbook: fromPromise(async () => ({ ok: true })) },
  }).createMachine({
    id: 'lazy-entry-budget',
    context: { mode: '' },
    initial: 'ready',
    on: { BOSS_INTERRUPT: { target: '#ready' } },
    states: {
      ready: {
        id: 'ready',
        on: {
          START: {
            target: '#child',
            guard: ({ event }: any) => variants.includes(event.mode),
            actions: assign({ mode: ({ event }: any) => event.mode }),
          },
        },
      },
      child: {
        id: 'child',
        entry: ({ context }: any) => observed.push(context.mode),
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'child',
            playbookId: 'inspect',
            text: 'Inspect the actual public-entry variant.',
          }),
          onDone: [
            {
              guard: ({ context, event }: any) =>
                context.mode === variants.at(-1) && event.output?.ok === true,
              target: '#done',
            },
            { target: '#failed' },
          ],
          onError: '#failed',
        },
      },
      awaitBossReply: { id: 'awaitBossReply' },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  });
}

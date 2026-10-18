// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { assign, fromPromise, setup } from 'xstate';
const questionText =
  'The player has a question. Output shall include `question: <text>`.';
const nonempty = (x) => typeof x === 'string' && x.trim() !== '';
export function branchingMachine({ strictEntry = false, trace = [] } = {}) {
  const actors = ['admit', 'afterPlan', 'afterBuild', 'afterBoth', 'verify'];
  const note =
    (id) =>
    ({ context }) =>
      trace.push({
        id,
        mode: context.mode,
        request: context.request,
        history: context.history,
        origin: context.origin ?? null,
        planned: context.planned,
        built: context.built,
        planAccepted: context.planAccepted,
        buildAccepted: context.buildAccepted,
        revision: context.revision ?? null,
      });
  const start = {
    target: '#admit',
    guard: strictEntry
      ? ({ event }) =>
          event.mode === 'fresh' &&
          event.request === 'actual request' &&
          event.history === 'actual history'
      : ({ event }) =>
          (event.mode === 'fresh' || event.mode === 'resume') &&
          nonempty(event.request) &&
          typeof event.history === 'string',
    actions: assign(({ event }) => ({
      mode: event.mode,
      request: event.request,
      history: event.history,
    })),
  };
  const question = (id) => ({
    target: '#awaitBossReply',
    guard: ({ event }) =>
      event.output?.guard === 'needsBossReply' &&
      nonempty(event.output.question),
    actions: assign({
      pendingBossQuestion: ({ event }) => ({
        resumeStateId: id,
        sourceItem: id,
        player: 'Writer',
        question: event.output.question,
      }),
    }),
  });
  const acting = (id, result, onDone) => ({
    id,
    entry: note(id),
    meta: {
      playbook: {
        stateId: id,
        description: 'Generic optional predecessor route',
      },
    },
    invoke: {
      src: 'captain',
      input: ({ context }) => ({
        stateId: id,
        sourceItem: id,
        player: 'Writer',
        prompt: 'Perform the declared stage.',
        result: { ...result, needsBossReply: questionText },
        pendingBossQuestion: context.pendingBossQuestion,
        bossReply: context.bossReply,
      }),
      onDone: [...onDone, question(id), { target: '#failed' }],
      onError: '#failed',
    },
  });
  const report = 'Output shall include `report`.';
  const ready = (id) => ({
    target: '#verify',
    guard: ({ event }) =>
      event.output?.guard === 'ready' && nonempty(event.output.report),
    actions: assign({ origin: id, report: ({ event }) => event.output.report }),
  });
  const build = () => ({
    target: '#build',
    guard: ({ context, event }) =>
      context.mode === 'fresh' &&
      !context.built &&
      event.output?.guard === 'build' &&
      nonempty(event.output.report),
    actions: assign({
      built: true,
      report: ({ event }) => event.output.report,
    }),
  });
  const child = (id, onDone) => ({
    id,
    entry: note(id),
    meta: { playbook: { stateId: id, description: 'Generic nested stage' } },
    invoke: {
      src: 'playbook',
      input: () => ({
        stateId: id,
        sourceItem: id,
        playbookId: id,
        text: 'Execute the declared generic child stage.',
      }),
      onDone: [...onDone, { target: '#failed' }],
      onError: '#failed',
    },
  });
  const routeReady = (c, id) =>
    id === 'admit'
      ? !c.planned && !c.built
      : id === 'afterPlan'
        ? c.planned && !c.built && c.planAccepted
        : id === 'afterBuild'
          ? !c.planned && c.built && c.buildAccepted
          : c.planned && c.built && c.planAccepted && c.buildAccepted;
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw Error('unbound');
      }),
      playbook: fromPromise(async () => {
        throw Error('unbound');
      }),
    },
  }).createMachine({
    id: 'generic-optional-route',
    initial: 'ready',
    context: {
      mode: '',
      request: '',
      history: '',
      planned: false,
      built: false,
      planAccepted: false,
      buildAccepted: false,
    },
    on: { BOSS_INTERRUPT: { target: '#ready' } },
    states: {
      ready: { id: 'ready', on: { START: start } },
      admit: acting('admit', { plan: report, build: report, ready: report }, [
        {
          target: '#plan',
          guard: ({ context, event }) =>
            context.mode === 'fresh' &&
            !context.planned &&
            !context.built &&
            event.output?.guard === 'plan' &&
            nonempty(event.output.report),
          actions: assign({
            planned: true,
            report: ({ event }) => event.output.report,
          }),
        },
        build('admit'),
        ready('admit'),
      ]),
      plan: child('plan', [
        {
          target: '#afterPlan',
          guard: ({ context, event }) =>
            context.planned &&
            !context.built &&
            event.output?.accepted === true,
          actions: assign({ planAccepted: true }),
        },
      ]),
      afterPlan: acting('afterPlan', { build: report, ready: report }, [
        build('afterPlan'),
        ready('afterPlan'),
      ]),
      build: child('build', [
        {
          target: '#afterBuild',
          guard: ({ context, event }) =>
            !context.planned &&
            context.built &&
            event.output?.accepted === true,
          actions: assign({ buildAccepted: true }),
        },
        {
          target: '#afterBoth',
          guard: ({ context, event }) =>
            context.planned &&
            context.built &&
            context.planAccepted &&
            event.output?.accepted === true,
          actions: assign({ buildAccepted: true }),
        },
      ]),
      afterBuild: acting('afterBuild', { ready: report }, [
        ready('afterBuild'),
      ]),
      afterBoth: acting('afterBoth', { ready: report }, [ready('afterBoth')]),
      verify: acting(
        'verify',
        { verified: 'Output shall include `revision`.' },
        [
          {
            target: '#inspect',
            guard: ({ event }) =>
              event.output?.guard === 'verified' &&
              nonempty(event.output.revision),
            actions: assign({ revision: ({ event }) => event.output.revision }),
          },
        ],
      ),
      inspect: child(
        'inspect',
        ['admit', 'afterPlan', 'afterBuild', 'afterBoth'].map((id, i) => ({
          target: '#done' + i,
          guard: ({ context, event }) =>
            context.origin === id &&
            routeReady(context, id) &&
            event.output?.accepted === true &&
            event.output?.revision === context.revision,
        })),
      ),
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: actors.map((id) => ({
            target: '#' + id,
            guard: ({ context, event }) =>
              context.pendingBossQuestion?.resumeStateId === id &&
              nonempty(event.answer),
            actions: assign({ bossReply: ({ event }) => event.answer }),
          })),
          START: start,
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done0: { id: 'done0', type: 'final' },
      done1: { id: 'done1', type: 'final' },
      done2: { id: 'done2', type: 'final' },
      done3: { id: 'done3', type: 'final' },
    },
  });
}

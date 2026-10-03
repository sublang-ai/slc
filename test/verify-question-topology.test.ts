// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { assign, fromPromise, setup } from 'xstate';

import {
  checkFsmCoverage,
  generateFsmCoverageTest,
} from '../src/verify-coverage.js';
import {
  checkFsmContinuationInputs,
  checkPromptComposition,
  usesKeyedBossQuestionContext,
  type MachineConfigLike,
} from '../src/verify.js';
import { defaultComposePlayerPrompt } from '@sublang/playbook/xstate-runtime';

const questionDescription =
  'The actor needs a Boss decision. Output shall include `question: <verbatim question text>`.';
type Storage = 'scalar' | 'keyed' | 'private';

/* eslint-disable @typescript-eslint/no-explicit-any */

// The real machine creates the question from actual done output. Only actor
// execution is scripted by coverage; topology, assignments and replies are real.
function questionMachine(
  options: {
    parallel?: boolean;
    storage?: Storage;
    wiring?: Storage;
    corrupt?:
      'questionId' | 'resumeStateId' | 'sourceItem' | 'asker' | 'question';
    captain?: boolean;
    historical?: boolean;
    publicEntry?: boolean;
  } = {},
) {
  const keyed = options.parallel === true;
  const storage = options.storage ?? (keyed ? 'keyed' : 'scalar');
  const wiring = options.wiring ?? (keyed ? 'keyed' : 'scalar');
  const answered: string[] = [];
  const recordFor = (stateId: string, role: string, question: unknown) => ({
    questionId: stateId,
    resumeStateId: stateId,
    sourceItem: `${stateId}-1`,
    asker:
      options.captain && stateId === 'work'
        ? { kind: 'captain' }
        : { kind: 'role', roleId: role },
    question,
    ...(options.corrupt === undefined
      ? {}
      : {
          [options.corrupt]:
            options.corrupt === 'asker'
              ? { kind: 'captain' }
              : 'wrong-question-value',
        }),
  });
  const read = (
    context: Record<string, any>,
    stateId: string,
    field: 'question' | 'reply',
  ) =>
    wiring === 'keyed'
      ? (field === 'question'
          ? context.pendingBossQuestions
          : context.bossReplies)?.[stateId]
      : wiring === 'private'
        ? context.continuation?.[
            field === 'question' ? 'pendingBossQuestion' : 'bossReply'
          ]
        : context[field === 'question' ? 'pendingBossQuestion' : 'bossReply'];
  const remember = (stateId: string, role: string) =>
    assign(({ context, event }: any) => {
      const question = recordFor(stateId, role, event.output.question);
      return storage === 'keyed'
        ? {
            pendingBossQuestions: {
              ...context.pendingBossQuestions,
              [stateId]: question,
            },
          }
        : storage === 'private'
          ? { continuation: { pendingBossQuestion: question } }
          : { pendingBossQuestion: question };
    });
  const answer = (stateId: string) =>
    assign(({ context, event }: any) => {
      answered.push(stateId);
      return storage === 'keyed'
        ? { bossReplies: { ...context.bossReplies, [stateId]: event.answer } }
        : storage === 'private'
          ? {
              continuation: {
                ...context.continuation,
                bossReply: event.answer,
              },
            }
          : { bossReply: event.answer };
    });
  const identity = (stateId: string, role?: string) => ({
    id: stateId,
    meta: { playbook: { stateId, ...(role ? { role } : {}) } },
  });
  const work = (stateId: string, role: string, wait: string, done: string) => ({
    ...identity(
      stateId,
      options.historical || (options.captain && stateId === 'work')
        ? undefined
        : role,
    ),
    tags: 'playbook.busy',
    invoke: {
      src: options.captain && stateId === 'work' ? 'captain' : 'player',
      input: ({ context }: any) => ({
        stateId,
        ...(options.historical
          ? { player: 'Writer' }
          : options.captain && stateId === 'work'
            ? {}
            : { role }),
        sourceItem: `${stateId}-1`,
        prompt: 'Perform the task.',
        result: { done: 'Completed.', needsBossReply: questionDescription },
        pendingBossQuestion: read(context, stateId, 'question'),
        bossReply: read(context, stateId, 'reply'),
      }),
      onDone: [
        {
          target: wait,
          guard: ({ event }: any) => event.output.guard === 'needsBossReply',
          actions: remember(stateId, role),
        },
        {
          target: done,
          guard: ({ event }: any) => event.output.guard === 'done',
        },
      ],
      onError: '#failed',
    },
  });
  const waiting = (id: string, stateId: string, target: string) => ({
    ...identity(id),
    tags: 'playbook.parked',
    on: {
      BOSS_REPLY: {
        target,
        guard: ({ event }: any) =>
          event.questionId === stateId &&
          typeof event.answer === 'string' &&
          event.answer.trim() !== '',
        actions: answer(stateId),
      },
    },
  });
  const region = (side: string) => ({
    ...identity(`${side}Region`),
    initial: 'work',
    states: {
      work: work(`${side}Work`, side, 'waiting', 'complete'),
      waiting: waiting(`${side}Wait`, `${side}Work`, 'work'),
      complete: { ...identity(`${side}Complete`), type: 'final' as const },
    },
  });
  const states = {
    ready: { ...identity('ready'), on: { GO: keyed ? 'proposals' : 'work' } },
    ...(keyed
      ? {
          proposals: {
            ...identity('proposals'),
            type: 'parallel',
            states: { left: region('left'), right: region('right') },
            onDone: 'work',
          },
        }
      : {}),
    work: work('work', 'writer', '#awaitBossReply', '#done'),
    awaitBossReply: waiting('awaitBossReply', 'work', '#work'),
    failed: { ...identity('failed'), tags: 'playbook.parked' },
    done: { ...identity('done'), type: 'final' as const },
  };
  const machine = setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('scripted actor required');
      }),
      player: fromPromise(async () => {
        throw new Error('scripted actor required');
      }),
    },
  }).createMachine({
    id: 'topology-fixture',
    initial: 'ready',
    context: {
      pendingBossQuestions: {},
      bossReplies: {},
      continuation: {},
      typed: [7],
    },
    ...(options.publicEntry === false
      ? {}
      : {
          on: {
            BOSS_INTERRUPT: [
              ...(keyed
                ? [
                    {
                      target: '.proposals',
                      guard: ({ event }: any) => event.targetId === 'proposals',
                    },
                  ]
                : []),
              {
                target: '.work',
                guard: ({ event }: any) => event.targetId === 'work',
              },
            ],
          },
        }),
    states,
  } as any);
  return { machine, answered };
}

describe('topology-bound Boss questions (verification-61)', () => {
  it.each([false, true])(
    'accepts canonical reached questions parallel=%s',
    async (parallel) => {
      const { machine } = questionMachine({ parallel });
      const config = machine.config as MachineConfigLike;
      expect(checkFsmContinuationInputs(config, 3)).toEqual([]);
      expect(
        checkPromptComposition({
          config,
          artifactSchema: 3,
          compose: defaultComposePlayerPrompt as never,
        }),
      ).toEqual([]);
      expect(
        await checkFsmCoverage({ machine }, { artifactSchema: 3 }),
      ).toEqual([]);
    },
  );

  it.each([false, true])(
    'refuses the wrong continuation representation parallel=%s',
    (parallel) => {
      const { machine } = questionMachine({
        parallel,
        wiring: parallel ? 'scalar' : 'keyed',
      });
      expect(
        checkFsmContinuationInputs(machine.config as MachineConfigLike, 3).join(
          '\n',
        ),
      ).toMatch(/does not carry/);
    },
  );

  it.each([
    [false, 'keyed'],
    [true, 'scalar'],
    [false, 'private'],
  ] as const)(
    'refuses reached noncanonical storage parallel=%s storage=%s before replying',
    async (parallel, storage) => {
      const { machine, answered } = questionMachine({ parallel, storage });
      expect(
        checkFsmContinuationInputs(machine.config as MachineConfigLike, 3),
      ).toEqual([]);
      expect(
        (await checkFsmCoverage({ machine }, { artifactSchema: 3 })).join('\n'),
      ).toMatch(/no matching canonical/);
      expect(answered).toEqual([]);
    },
  );

  it.each([
    'questionId',
    'resumeStateId',
    'sourceItem',
    'asker',
    'question',
  ] as const)('refuses reached mismatched %s before reply', async (corrupt) => {
    const { machine, answered } = questionMachine({ corrupt });
    expect(
      (await checkFsmCoverage({ machine }, { artifactSchema: 3 })).join('\n'),
    ).toMatch(/no matching canonical scalar/);
    expect(answered).toEqual([]);
  });

  it('checks the actual predecessor entry route without public preemption', async () => {
    const { machine, answered } = questionMachine({
      storage: 'private',
      publicEntry: false,
    });
    expect(
      (await checkFsmCoverage({ machine }, { artifactSchema: 3 })).join('\n'),
    ).toMatch(/no matching canonical scalar/);
    expect(answered).toEqual([]);
  });

  it('retains immutable historical player coverage and rejects schema disagreement', async () => {
    const { machine } = questionMachine({
      historical: true,
      storage: 'private',
    });
    expect(await checkFsmCoverage({ machine }, { artifactSchema: 1 })).toEqual(
      [],
    );
    expect(
      (await checkFsmCoverage({ machine }, { artifactSchema: 3 })).join('\n'),
    ).toMatch(/schema signals disagree/);
  });

  it('uses root children rather than the machine root or a nested parallel name', () => {
    const machine = setup({}).createMachine({
      type: 'parallel',
      states: { a: {}, b: {} },
    });
    expect(
      usesKeyedBossQuestionContext(machine.config as MachineConfigLike),
    ).toBe(false);
    const nested = setup({}).createMachine({
      initial: 'wrapper',
      states: {
        wrapper: {
          initial: 'group',
          states: { group: { type: 'parallel', states: { a: {}, b: {} } } },
        },
      },
    });
    expect(
      usesKeyedBossQuestionContext(nested.config as MachineConfigLike),
    ).toBe(false);
  });

  it.each([false, true])(
    'checks a known schema-3 direct Captain parallel=%s without optional player/role fields',
    async (parallel) => {
      const { machine } = questionMachine({ parallel, captain: true });
      expect(
        checkFsmContinuationInputs(machine.config as MachineConfigLike, 3),
      ).toEqual([]);
      expect(
        await checkFsmCoverage({ machine }, { artifactSchema: 3 }),
      ).toEqual([]);
      const malformed = questionMachine({ captain: true, storage: 'private' });
      expect(
        (
          await checkFsmCoverage(
            { machine: malformed.machine },
            { artifactSchema: 3 },
          )
        ).join('\n'),
      ).toMatch(/no matching canonical scalar/);
      expect(malformed.answered).toEqual([]);
    },
  );

  it('pins declared generation into the portable emitted coverage test', () => {
    expect(
      generateFsmCoverageTest({
        basename: 'fixture',
        fsmModule: './fixture.fsm.js',
        fsmSourceFile: './fixture.fsm.ts',
        verifyModule: './.slc-verify/verify.js',
        artifactSchema: 3,
      }),
    ).toContain('artifactSchema: 3');
  });
});

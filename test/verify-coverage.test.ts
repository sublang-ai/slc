// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { assign, fromPromise, setup } from 'xstate';

import {
  checkFsmCoverage,
  emitFsmCoverageTest,
  findMachine,
  fsmCoverageTestTimeout,
  generateFsmCoverageTest,
  guardSatisfiable,
  identifierLiterals,
} from '../src/verify-coverage.js';

const referenceDir = fileURLToPath(
  new URL(
    '../node_modules/@sublang/playbook/reference/sdlc/code.playbook/',
    import.meta.url,
  ),
);

const NEEDS_BOSS_REPLY_TEXT =
  "The player's prose surfaces a clarifying question for Boss. Output shall include `question: <verbatim question text>`.";
const CONTEXT_INTERRUPT_PHASE = 'reviewing';
const CONTEXT_INTERRUPT_SCOPE = 'specItems';

const contextInterruptReady = (context: Record<string, unknown>): boolean =>
  context.phase === CONTEXT_INTERRUPT_PHASE &&
  typeof context.topic === 'string' &&
  context.topic.trim() !== '' &&
  context.reviewScope === CONTEXT_INTERRUPT_SCOPE;

/* eslint-disable @typescript-eslint/no-explicit-any */

const needsBossReplyArm = (workId = 'work') => ({
  target: '#awaitBossReply',
  guard: ({ event }: any) =>
    event.output.guard === 'needsBossReply' &&
    typeof event.output.question === 'string',
  actions: assign({
    pendingBossQuestion: ({ event }: any) => ({
      resumeStateId: workId,
      sourceItem: 'X-1',
      player: 'Writer',
      question: event.output.question,
    }),
  } as any),
});

/**
 * A minimal machine in the gears2fsm shape: one captain state with a plain
 * result key and the Boss-reply suspension surfaces (interrupts, wait state,
 * resume and blank-answer arms).
 */
const goodMachine = (
  overrides: {
    onDone?: unknown[];
    onError?: unknown;
    dropWaitState?: boolean;
    guards?: Record<string, (...args: any[]) => boolean>;
    result?: Record<string, string>;
    workId?: string;
    publicStateId?: string;
    blankStaysParked?: boolean;
    interruptRequiresIntent?: boolean;
    unsatisfiableInterrupt?: boolean;
    dropFailedParkTag?: boolean;
  } = {},
) => {
  const workId = overrides.workId ?? 'work';
  const publicStateId = overrides.publicStateId ?? workId;
  const onDone = overrides.onDone ?? [
    {
      target: '#done',
      guard: ({ event }: any) => event.output.guard === 'ok',
    },
    needsBossReplyArm(workId),
  ];
  const states: Record<string, unknown> = {
    ready: { id: 'ready', on: { GO: { target: 'work' } } },
    work: {
      id: workId,
      meta: {
        playbook: { stateId: publicStateId, description: 'Working' },
      },
      invoke: {
        src: 'captain',
        input: ({ context }: any) => ({
          stateId: publicStateId,
          player: 'Writer',
          sourceItem: 'X-1',
          prompt: 'Do the work.',
          result: {
            ok: 'The work is done.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            ...overrides.result,
          },
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
        }),
        onDone,
        onError:
          'onError' in overrides ? overrides.onError : { target: '#failed' },
      },
    },
    failed: {
      id: 'failed',
      meta: {
        playbook: { stateId: 'failed', description: 'Recoverable failure' },
      },
      ...(overrides.dropFailedParkTag === true
        ? {}
        : { tags: 'playbook.parked' }),
      on: { GO: { target: 'work' } },
    },
    done: { id: 'done', type: 'final' },
  };
  if (!overrides.dropWaitState) {
    const replyArms: unknown[] = [
      {
        target: `#${workId}`,
        reenter: true,
        guard: ({ context, event }: any) =>
          context.pendingBossQuestion?.resumeStateId === workId &&
          typeof event.answer === 'string' &&
          event.answer.trim() !== '',
        actions: assign({
          bossReply: ({ event }: any) => event.answer,
        } as any),
      },
    ];
    if (!overrides.blankStaysParked) replyArms.push({ target: '#failed' });
    states.awaitBossReply = {
      id: 'awaitBossReply',
      on: {
        BOSS_REPLY: replyArms,
      },
    };
  }
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
    ...(overrides.guards === undefined
      ? {}
      : { guards: overrides.guards as any }),
  }).createMachine({
    id: 'flow',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: [
        {
          target: `#${workId}`,
          reenter: true,
          guard: ({ event }: any) =>
            event.targetId === publicStateId &&
            overrides.unsatisfiableInterrupt !== true &&
            (overrides.interruptRequiresIntent !== true ||
              (typeof event.intent === 'string' && event.intent.trim() !== '')),
        },
        {
          target: '#ready',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'ready',
        },
      ],
    },
    states: states as any,
  } as any);
};

/** A two-region structured machine with branch-local Boss-reply waits. */
const parallelMachine = (
  opts: {
    nestedPlaybook?: boolean;
    dropJoin?: boolean;
    acceptUnknownQuestionId?: boolean;
    crossResume?: boolean;
    unreachableJoin?: boolean;
    nestedPublicStateId?: string;
    dropNestedOnDone?: boolean;
    dropNestedOnError?: boolean;
    nestedInputThrows?: boolean;
    nestedInputThrowsAfterInterrupt?: boolean;
    nestedInputUsesInitializedContext?: boolean;
    contextGuardedInterrupt?: boolean;
  } = {},
) => {
  const meta = (stateId: string) => ({
    description: stateId,
    meta: { playbook: { stateId, description: stateId } },
  });
  const branch = (side: 'left' | 'right') => {
    const stateId = `${side}Work`;
    const waitId = `${side}Wait`;
    return {
      id: `${side}Branch`,
      initial: 'working',
      ...meta(`${side}Branch`),
      states: {
        working: {
          id: stateId,
          tags: 'playbook.busy',
          ...meta(stateId),
          invoke: {
            id: `${side}Captain`,
            src: 'player',
            input: () => ({
              stateId,
              player: side === 'left' ? 'Writer' : 'Reviewer',
              sourceItem: side === 'left' ? 'X-1' : 'X-2',
              prompt: `${side} prompt`,
              result: {
                ok: `${side} complete`,
                needsBossReply: NEEDS_BOSS_REPLY_TEXT,
              },
            }),
            onDone: [
              {
                target: 'complete',
                guard: ({ event }: any) => event.output.guard === 'ok',
              },
              {
                target: 'waiting',
                guard: ({ event }: any) =>
                  event.output.guard === 'needsBossReply' &&
                  typeof event.output.question === 'string',
              },
            ],
            onError: { target: '#failed' },
          },
        },
        waiting: {
          id: waitId,
          tags: 'playbook.parked',
          ...meta(waitId),
          on: {
            BOSS_REPLY: [
              {
                target: '#failed',
                guard: ({ event }: any) =>
                  event.questionId === stateId &&
                  String(event.answer).trim() === '',
              },
              {
                target: 'working',
                guard: ({ event }: any) =>
                  (event.questionId === stateId ||
                    opts.acceptUnknownQuestionId === true ||
                    (opts.crossResume === true &&
                      ['leftWork', 'rightWork'].includes(event.questionId))) &&
                  String(event.answer).trim() !== '',
              },
            ],
          },
        },
        complete: {
          id: `${side}Complete`,
          type: 'final',
          ...meta(`${side}Complete`),
        },
      },
    };
  };

  const states: Record<string, unknown> = {
    ready: {
      id: 'ready',
      tags: 'playbook.parked',
      ...meta('ready'),
      on: { GO: { target: 'parallelRound' } },
    },
    parallelRound: {
      id: 'parallelRound',
      type: 'parallel',
      ...meta('parallelRound'),
      states: { left: branch('left'), right: branch('right') },
      ...(opts.dropJoin === true
        ? {}
        : opts.unreachableJoin === true
          ? {
              onDone: [
                { target: '#failed', guard: () => false },
                { target: '#done' },
              ],
            }
          : { onDone: { target: '#done' } }),
    },
    failed: { id: 'failed', tags: 'playbook.parked', ...meta('failed') },
    done: { id: 'done', type: 'final', ...meta('done') },
  };
  if (opts.nestedPlaybook === true) {
    const publicStateId = opts.nestedPublicStateId ?? 'callChild';
    states.callChild = {
      id: 'callChild',
      tags: 'playbook.suspended',
      ...meta(publicStateId),
      invoke: {
        id: 'childPlaybook',
        src: 'playbook',
        input: ({ context }: any) => {
          if (
            opts.nestedInputThrows === true ||
            (opts.nestedInputThrowsAfterInterrupt === true &&
              context.failNestedInput === true)
          ) {
            throw new Error('coverage fixture nested input failure');
          }
          return {
            stateId: publicStateId,
            playbookId: 'child',
            text:
              opts.nestedInputUsesInitializedContext === true
                ? context.request.trim()
                : '{"request":"review"}',
          };
        },
        ...(opts.dropNestedOnDone === true
          ? {}
          : { onDone: { target: '#done' } }),
        ...(opts.dropNestedOnError === true
          ? {}
          : { onError: { target: '#failed' } }),
      },
    };
  }

  const targets = [
    { publicId: 'parallelRound', configId: 'parallelRound' },
    ...(opts.nestedPlaybook === true
      ? [
          {
            publicId: opts.nestedPublicStateId ?? 'callChild',
            configId: 'callChild',
          },
        ]
      : []),
  ];
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('player actor must be provided by the runner');
      }),
      playbook: fromPromise(async () => {
        throw new Error('playbook actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'structured',
    initial: 'ready',
    context: ({ input }: any) =>
      ({
        ...(opts.nestedInputUsesInitializedContext === true
          ? { request: input.bossIntent }
          : {}),
        ...(opts.contextGuardedInterrupt === true
          ? { phase: 'idle', topic: '', reviewScope: '' }
          : {}),
      }) as any,
    on: {
      BOSS_INTERRUPT: targets.map(({ publicId, configId }) => ({
        target: `#${configId}`,
        reenter: true,
        guard: ({ context, event }: any) =>
          event.targetId === publicId &&
          (configId !== 'parallelRound' ||
            opts.contextGuardedInterrupt !== true ||
            contextInterruptReady(context)),
        ...(configId === 'callChild' &&
        opts.nestedInputThrowsAfterInterrupt === true
          ? {
              actions: assign({
                failNestedInput: () => true,
              } as any),
            }
          : {}),
      })),
    },
    states: states as any,
  } as any);
};

/** A compact Captain planner with exact catalog guards and a dynamic child. */
const dynamicCaptainMachine = () => {
  const metadata = (stateId: string) => ({
    playbook: { stateId, description: stateId },
  });
  const needsBossReply = {
    guard: 'needsBossReply',
    target: '#awaitBossReply',
  };
  const callOutputIsValid = (context: any, output: any, guard: string) =>
    output.guard === guard &&
    Array.isArray(output.remainingPlan) &&
    typeof output.nextPlaybookId === 'string' &&
    output.nextPlaybookId.trim() !== '' &&
    output.nextPlaybookId !== context.selfPlaybookId &&
    context.enabledPlaybooks.some(
      (entry: { id: string }) => entry.id === output.nextPlaybookId,
    ) &&
    !context.attemptedCallSignatures.includes(
      JSON.stringify([output.nextPlaybookId, output.nextPlaybookInput]),
    ) &&
    typeof output.nextPlaybookInput === 'string' &&
    output.nextPlaybookInput.trim() !== '';
  const assignNextCall = assign(({ event }: any) => ({
    nextPlaybookId: event.output.nextPlaybookId,
    nextPlaybookInput: event.output.nextPlaybookInput,
    remainingPlan: event.output.remainingPlan,
  }));
  const result = (callGuard: 'delegated' | 'continuing') => ({
    [callGuard]:
      'Captain selected an enabled playbook and output includes remainingPlan, nextPlaybookId, and nextPlaybookInput.',
    ...(callGuard === 'continuing'
      ? {
          finalResponse:
            'Captain completed the intent and output includes one concise final response.',
        }
      : {}),
    needsBossReply: NEEDS_BOSS_REPLY_TEXT,
  });
  const captainState = (
    stateId: 'initialRouting' | 'reassessAfterCall',
    sourceItem: 'CAPTAIN-1' | 'CAPTAIN-3',
    callGuard: 'delegated' | 'continuing',
  ) => ({
    id: stateId,
    meta: metadata(stateId),
    invoke: {
      src: 'captain',
      input: ({ context }: any) => ({
        stateId,
        sourceItem,
        prompt: `${stateId} prompt`,
        result: result(callGuard),
        enabledPlaybooks: context.enabledPlaybooks,
      }),
      onDone: [
        ...(callGuard === 'continuing'
          ? [
              {
                target: '#done',
                guard: ({ event }: any) =>
                  event.output.guard === 'finalResponse' &&
                  typeof event.output.response === 'string' &&
                  event.output.response.trim() !== '',
                actions: assign(({ event }: any) => ({
                  finalResponse: event.output.response,
                })),
              },
            ]
          : []),
        {
          target: '#callPlaybook',
          guard: ({ context, event }: any) =>
            callOutputIsValid(context, event.output, callGuard),
          actions: assignNextCall,
        },
        {
          ...needsBossReply,
          guard: ({ event }: any) =>
            event.output.guard === 'needsBossReply' &&
            typeof event.output.question === 'string',
        },
        { target: '#failed' },
      ],
      onError: { target: '#failed' },
    },
  });

  const ids = [
    'ready',
    'initialRouting',
    'callPlaybook',
    'reassessAfterCall',
    'awaitBossReply',
    'failed',
    'done',
  ];
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
      playbook: fromPromise(async () => {
        throw new Error('playbook actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'captainPlanner',
    initial: 'ready',
    context: ({ input }: any) => ({
      stateId: input.stateId,
      selfPlaybookId: input.selfPlaybookId,
      enabledPlaybooks: input.enabledPlaybooks,
      remainingPlan: [],
      completedCallResults: [],
      attemptedCallSignatures: [],
      nextPlaybookId: '',
      nextPlaybookInput: '',
    }),
    on: {
      BOSS_INTERRUPT: ids.map((id) => ({
        target: `#${id}`,
        reenter: true,
        guard: ({ context, event }: any) =>
          event.targetId === id &&
          (id === 'callPlaybook'
            ? context.nextPlaybookInput.trim() !== '' &&
              context.enabledPlaybooks.some(
                (entry: { id: string }) => entry.id === context.nextPlaybookId,
              )
            : id === 'done'
              ? typeof context.finalResponse === 'string' &&
                context.finalResponse.trim() !== ''
              : true),
      })),
    },
    states: {
      ready: {
        id: 'ready',
        meta: metadata('ready'),
        on: { GO: { target: 'initialRouting' } },
      },
      initialRouting: captainState('initialRouting', 'CAPTAIN-1', 'delegated'),
      callPlaybook: {
        id: 'callPlaybook',
        meta: metadata('callPlaybook'),
        invoke: {
          id: 'dynamicChild',
          src: 'playbook',
          input: ({ context }: any) => ({
            stateId: 'callPlaybook',
            sourceItem: 'CAPTAIN-2',
            playbookId: context.nextPlaybookId,
            text: context.nextPlaybookInput,
            playbookIdContext: 'nextPlaybookId',
            textContext: 'nextPlaybookInput',
          }),
          onDone: { target: '#reassessAfterCall' },
          onError: { target: '#reassessAfterCall' },
        },
      },
      reassessAfterCall: captainState(
        'reassessAfterCall',
        'CAPTAIN-3',
        'continuing',
      ),
      awaitBossReply: {
        id: 'awaitBossReply',
        meta: metadata('awaitBossReply'),
        on: {
          BOSS_REPLY: [
            {
              target: '#initialRouting',
              guard: ({ event }: any) =>
                event.questionId === 'initialRouting' &&
                String(event.answer).trim() !== '',
            },
            {
              target: '#reassessAfterCall',
              guard: ({ event }: any) =>
                event.questionId === 'reassessAfterCall' &&
                String(event.answer).trim() !== '',
            },
          ],
        },
      },
      failed: {
        id: 'failed',
        tags: 'playbook.parked',
        meta: metadata('failed'),
      },
      done: { id: 'done', type: 'final', meta: metadata('done') },
    },
  } as any);
};

/** A literal child call with independently selectable success/error arms. */
const nestedMultiArmMachine = (
  opts: { deadDoneArm?: boolean; deadErrorArm?: boolean } = {},
) =>
  setup({
    actors: {
      playbook: fromPromise(async () => {
        throw new Error('playbook actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'nestedMultiArm',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: {
        target: '#callChild',
        reenter: true,
        guard: ({ event }: any) => event.targetId === 'callChild',
      },
    },
    states: {
      ready: { id: 'ready', on: { GO: { target: 'callChild' } } },
      callChild: {
        id: 'callChild',
        invoke: {
          id: 'multiArmChild',
          src: 'playbook',
          input: () => ({
            stateId: 'callChild',
            playbookId: 'child',
            text: 'Handle the nested request.',
          }),
          onDone: [
            {
              target: '#doneFirst',
              guard: ({ event }: any) => event.output.route === 'first',
            },
            {
              target: '#doneSecond',
              guard: ({ event }: any) =>
                opts.deadDoneArm !== true && event.output.route === 'second',
            },
            { target: '#doneFallback' },
          ],
          onError: [
            {
              target: '#errorFirst',
              guard: ({ event }: any) =>
                event.error.name === 'RetryableChildError',
            },
            {
              target: '#errorSecond',
              guard: ({ event }: any) =>
                opts.deadErrorArm !== true &&
                event.error.message === 'second-child-failure',
            },
            { target: '#errorFallback' },
          ],
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: { BOSS_REPLY: { target: '#ready' } },
      },
      doneFirst: { id: 'doneFirst', type: 'final' },
      doneSecond: { id: 'doneSecond', type: 'final' },
      doneFallback: { id: 'doneFallback', type: 'final' },
      errorFirst: { id: 'errorFirst', type: 'final' },
      errorSecond: { id: 'errorSecond', type: 'final' },
      errorFallback: { id: 'errorFallback', type: 'final' },
    },
  } as any);

/* eslint-enable @typescript-eslint/no-explicit-any */

type DoneGuardArgs = {
  event: {
    type: string;
    output: { guard?: string; question?: unknown };
  };
};

type ErrorGuardArgs = {
  event: { error: Error };
};

describe('guardSatisfiable (VERIFY-6)', () => {
  it('satisfies a conjunctive guard by iterative deepening over its literals', () => {
    const guard = ({
      context,
      event,
    }: {
      context: Record<string, unknown>;
      event: { output?: { guard?: string } };
    }) =>
      event.output?.guard === 'accepted' &&
      context.reviewSubject === 'commit' &&
      context.afterReview === 'continueIr';
    expect(guardSatisfiable(guard as never, { guard: 'accepted' })).toBe(true);
    expect(guardSatisfiable(guard as never, { guard: 'other' })).toBe(false);
  });

  it('reports an always-false guard unsatisfiable', () => {
    expect(guardSatisfiable(() => false, { guard: 'ok' })).toBe(false);
  });

  it('uses caller-supplied candidates for helper-bound comparisons', () => {
    const origin = 'bossSpecs';
    const guard = ({ context }: { context: Record<string, unknown> }) =>
      context.changeOrigin === origin;
    expect(guardSatisfiable(guard as never, { guard: 'ok' })).toBe(false);
    expect(
      guardSatisfiable(guard as never, { guard: 'ok' }, ['bossSpecs']),
    ).toBe(true);
  });

  it('does not invent event-level fields while probing', () => {
    const guard = ({
      event,
    }: {
      event: { type?: string; output?: { guard?: string } };
    }) => event.type === 'BOSS_REPLY' && event.output?.guard === 'accepted';
    expect(guardSatisfiable(guard as never, { guard: 'accepted' })).toBe(false);
  });
});

describe('identifierLiterals', () => {
  it('mines identifier-like literals and drops prose', () => {
    const source = `guardAndOrigin('committedSpecs', 'bossSpecs');\nconst p = 'A full prose sentence, too long to be a routing value.';`;
    expect(identifierLiterals(source)).toEqual(['committedSpecs', 'bossSpecs']);
  });
});

describe('checkFsmCoverage (VERIFY-6)', () => {
  it('finds nothing on a machine covering all its transitions', async () => {
    expect(await checkFsmCoverage({ machine: goodMachine() })).toEqual([]);
  });

  it('synthesizes typed payload fields required by an interrupt arm', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({ interruptRequiresIntent: true }),
      }),
    ).toEqual([]);
  });

  it('restores satisfying context before driving a guarded parallel parent', async () => {
    expect(
      await checkFsmCoverage(
        {
          machine: parallelMachine({ contextGuardedInterrupt: true }),
        },
        {
          sourceText:
            "const phase = 'reviewing'; const reviewScope = 'specItems';",
        },
      ),
    ).toEqual([]);
  });

  it('reports an interrupt guard that bounded probing cannot satisfy', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({ unsatisfiableInterrupt: true }),
      }),
    ).toContain(
      'BOSS_INTERRUPT target work is unsatisfiable under context/event probing',
    );
  });

  it('requires a recoverable failure state to be parked', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({ dropFailedParkTag: true }),
      }),
    ).toContain('recoverable failure state failed lacks playbook.parked tag');
  });

  it('drives explicit player leaves by entering their parallel parent', async () => {
    expect(await checkFsmCoverage({ machine: parallelMachine() })).toEqual([]);
  });

  it('drives nested playbook success and failure through its public state id', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({
          nestedPlaybook: true,
          nestedPublicStateId: 'publicChildCall',
        }),
      }),
    ).toEqual([]);
  });

  it('drives exact-catalog Captain delegation into a dynamic child', async () => {
    expect(
      await checkFsmCoverage({ machine: dynamicCaptainMachine() }),
    ).toEqual([]);
  });

  it('detects a nested playbook without an onDone transition', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({
          nestedPlaybook: true,
          dropNestedOnDone: true,
        }),
      }),
    ).toContain(
      'state callChild declares no nested playbook onDone transition',
    );
  });

  it('detects a nested playbook without an onError transition', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({
          nestedPlaybook: true,
          dropNestedOnError: true,
        }),
      }),
    ).toContain(
      'state callChild declares no nested playbook onError transition',
    );
  });

  it('reports a nested invoke.input failure without rejecting the checker', async () => {
    await expect(
      checkFsmCoverage({
        machine: parallelMachine({
          nestedPlaybook: true,
          nestedInputThrows: true,
        }),
      }),
    ).resolves.toContain(
      'state callChild: nested playbook actor failed to start during onDone coverage: coverage fixture nested input failure',
    );
  });

  it('evaluates nested input with the machine initialized context', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({
          nestedPlaybook: true,
          nestedInputUsesInitializedContext: true,
        }),
      }),
    ).toEqual([]);
  });

  it('drives every satisfiable nested success and error arm', async () => {
    expect(
      await checkFsmCoverage({ machine: nestedMultiArmMachine() }),
    ).toEqual([]);
  });

  it('reports a dead later nested onDone arm', async () => {
    expect(
      await checkFsmCoverage({
        machine: nestedMultiArmMachine({ deadDoneArm: true }),
      }),
    ).toContain(
      'state callChild: nested playbook onDone arm 1 is unsatisfiable under probing',
    );
  });

  it('reports a dead later nested onError arm', async () => {
    expect(
      await checkFsmCoverage({
        machine: nestedMultiArmMachine({ deadErrorArm: true }),
      }),
    ).toContain(
      'state callChild: nested playbook onError arm 1 is unsatisfiable under probing',
    );
  });

  it('captures an invoke.input failure caused by transition context', async () => {
    await expect(
      checkFsmCoverage({
        machine: parallelMachine({
          nestedPlaybook: true,
          nestedInputThrowsAfterInterrupt: true,
        }),
      }),
    ).resolves.toContain(
      'state callChild: nested playbook actor failed to start during onDone coverage: coverage fixture nested input failure',
    );
  });

  it('reports a parallel state whose join is missing', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ dropJoin: true }),
      }),
    ).toContain('parallel state parallelRound declares no onDone join');
  });

  it('rejects an unknown branch question id that moves a parked branch', async () => {
    expect(
      (
        await checkFsmCoverage({
          machine: parallelMachine({ acceptUnknownQuestionId: true }),
        })
      ).join('\n'),
    ).toMatch(/unknown BOSS_REPLY questionId moved the branch/);
  });

  it('detects one keyed reply resuming multiple pending branches', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ crossResume: true }),
      }),
    ).toContain(
      'parallel state parallelRound: a keyed Boss reply did not resume exactly one pending branch',
    );
  });

  it('reports a guarded parallel join arm that bounded probing cannot exercise', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ unreachableJoin: true }),
      }),
    ).toContain(
      'parallel state parallelRound: onDone join arm 0 could not be exercised under bounded branch-result probing',
    );
  });

  it('drives stable state ids that differ from their states-object keys', async () => {
    expect(
      await checkFsmCoverage({ machine: goodMachine({ workId: 'workItem' }) }),
    ).toEqual([]);
  });

  it('targets the public metadata and Captain-input id rather than the config id', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({
          workId: 'privateConfigWork',
          publicStateId: 'publicWork',
        }),
      }),
    ).toEqual([]);
  });

  it('uses public metadata ids as bounded guard-probe candidates', async () => {
    const publicStateId = 'publicWork';
    expect(
      await checkFsmCoverage({
        machine: goodMachine({
          publicStateId,
          onDone: [
            {
              target: '#done',
              guard: ({
                context,
                event,
              }: {
                context: Record<string, unknown>;
                event: { output: { guard?: string } };
              }) =>
                event.output.guard === 'ok' &&
                context.routeTarget === publicStateId,
            },
            needsBossReplyArm(),
          ],
        }),
      }),
    ).toEqual([]);
  });

  it('accepts a blank Boss reply that leaves the task parked', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({ blankStaysParked: true }),
      }),
    ).toEqual([]);
  });

  it('detects a declared result key handled only by the failure fallback', async () => {
    const machine = goodMachine({
      result: { orphan: 'No onDone guard accepts this declared result.' },
      onDone: [
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) => event.output.guard === 'ok',
        },
        needsBossReplyArm(),
        { target: '#failed' },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /result "orphan" has no reachable accepting transition/,
    );
  });

  it('keeps the actual done-event type fixed during arm probing', async () => {
    const machine = goodMachine({
      onDone: [
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) =>
            event.type === 'BOSS_REPLY' && event.output.guard === 'ok',
        },
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) => event.output.guard === 'ok',
        },
        needsBossReplyArm(),
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /onDone arm 0 .* is unsatisfiable under probing/,
    );
  });

  it('detects a missing onError transition', async () => {
    const machine = goodMachine({ onError: undefined });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /declares no onError transition/,
    );
  });

  it('detects a needsBossReply arm that does not suspend in the wait state', async () => {
    const machine = goodMachine({
      onDone: [
        {
          target: '#done',
          guard: ({ event }: { event: { output: { guard: string } } }) =>
            event.output.guard === 'ok' ||
            event.output.guard === 'needsBossReply',
        },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /did not suspend in awaitBossReply/,
    );
  });

  it('detects an unsatisfiable onDone arm', async () => {
    const machine = goodMachine({
      onDone: [
        {
          target: '#done',
          guard: ({ event }: { event: { output: { guard: string } } }) =>
            event.output.guard === 'ok' ||
            event.output.guard === 'needsBossReply',
        },
        { target: '#failed', guard: () => false },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /arm 1 .* is unsatisfiable under probing/,
    );
  });

  it('audits every guarded onError arm', async () => {
    const machine = goodMachine({
      onError: [
        {
          target: '#failed',
          guard: ({ event }: ErrorGuardArgs) =>
            event.error.message === 'coverage: forced captain failure',
        },
        { target: '#done', guard: () => false },
        { target: '#failed' },
      ],
    });
    const findings = (await checkFsmCoverage({ machine })).join('\n');
    expect(findings).toMatch(
      /onError arm 1 \(target done\) is unsatisfiable under probing/,
    );
    expect(findings).not.toMatch(/onError arm 0/);
  });

  it('detects an onError arm shadowed by an earlier unconditional guard', async () => {
    const machine = goodMachine({
      onError: [
        { target: '#failed', guard: () => true },
        { target: '#done', guard: () => true },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /onError arm 1 \(target done\) is unsatisfiable under probing/,
    );
  });

  it('probes alternate error payloads for later onError arms', async () => {
    const machine = goodMachine({
      onError: [
        {
          target: '#failed',
          guard: ({ event }: ErrorGuardArgs) =>
            event.error.message === 'coverage: forced captain failure',
        },
        {
          target: '#done',
          guard: ({ event }: ErrorGuardArgs) =>
            event.error.message === 'retryable',
        },
        { target: '#failed' },
      ],
    });
    expect(await checkFsmCoverage({ machine })).toEqual([]);
  });

  it('reports an unregistered onError guard without driving it', async () => {
    const machine = goodMachine({
      onError: [
        { target: '#done', guard: 'unregistered' },
        { target: '#failed' },
      ],
    });
    await expect(checkFsmCoverage({ machine })).resolves.toContain(
      'state work: onError arm 0 names an unresolvable guard "unregistered"',
    );
  });

  it('detects a machine without the Boss-reply wait state', async () => {
    const machine = goodMachine({
      dropWaitState: true,
      onDone: [
        {
          target: '#done',
          guard: ({ event }: { event: { output: { guard: string } } }) =>
            event.output.guard === 'ok' ||
            event.output.guard === 'needsBossReply',
        },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /declares no awaitBossReply state/,
    );
  });

  it('finds nothing on the reference machine', async () => {
    const fsm: unknown = await import(join(referenceDir, 'code.fsm.js'));
    const sourceText = readFileSync(join(referenceDir, 'code.fsm.ts'), 'utf8');
    expect(await checkFsmCoverage(fsm, { sourceText })).toEqual([]);
  });
});

describe('named guards (setup implementations)', () => {
  it('resolves parameterized named guard objects with their params', async () => {
    const machine = goodMachine({
      guards: {
        matches: ({ event }: DoneGuardArgs, params: { key: string }): boolean =>
          event.output.guard === params.key,
      },
      onDone: [
        {
          target: '#done',
          guard: { type: 'matches', params: { key: 'ok' } },
        },
        needsBossReplyArm(),
      ],
    });
    expect(await checkFsmCoverage({ machine })).toEqual([]);
  });

  it('resolves string guards through the machine implementations and flags unregistered ones', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const machine = setup({
      actors: {
        captain: fromPromise(async () => {
          throw new Error('captain actor must be provided by the runner');
        }),
      },
      guards: {
        isOk: ({ event }: any) => event.output.guard === 'ok',
      } as any,
    }).createMachine({
      id: 'named',
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
              prompt: 'p',
              result: { ok: 'done', needsBossReply: NEEDS_BOSS_REPLY_TEXT },
            }),
            onDone: [
              { target: '#done', guard: 'isOk' },
              { target: '#failed', guard: 'unregistered' },
            ],
            onError: { target: '#failed' },
          },
        },
        failed: { id: 'failed' },
        done: { id: 'done', type: 'final' },
      },
    } as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const findings = await checkFsmCoverage({ machine });
    const text = findings.join('\n');
    // The registered named guard probes fine; the unregistered one surfaces.
    expect(text).not.toMatch(/arm 0 .* unsatisfiable/);
    expect(text).toMatch(/arm 1 names an unresolvable guard "unregistered"/);
  });
});

describe('findMachine', () => {
  it('finds the providable machine export', () => {
    const machine = goodMachine();
    expect(findMachine({ other: 1, machine })).toBe(machine);
  });

  it('throws when no providable machine is exported', () => {
    expect(() => findMachine({ config: { states: {} } })).toThrow(
      /no providable XState machine/,
    );
  });
});

describe('generateFsmCoverageTest / emitFsmCoverageTest', () => {
  it('derives a timeout above the default from bounded checker work', () => {
    expect(
      fsmCoverageTestTimeout({ machine: dynamicCaptainMachine() }),
    ).toBeGreaterThan(5_000);
  });

  it('emits a test that reads the artifact source and runs the checker', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-cov-'));
    try {
      // A minimal providable machine artifact (no captain states, so the
      // checker only reports the missing gears2fsm surfaces).
      await writeFile(
        join(artifactDir, 'code.fsm.ts'),
        [
          "import { setup } from 'xstate';",
          'export const machine = setup({}).createMachine({',
          "  id: 'tiny',",
          "  initial: 'ready',",
          '  states: {',
          '    ready: {},',
          "    done: { type: 'final' },",
          '  },',
          '});',
          '',
        ].join('\n'),
      );
      const { path, diagnostics } = await emitFsmCoverageTest({
        artifactDir,
        basename: 'code',
      });
      expect(path).toBe(join(artifactDir, 'code.fsm.coverage.test.ts'));
      // The tiny machine lacks the gears2fsm Boss surfaces; the emitter
      // surfaces the checker's findings as diagnostics. (A machine that never
      // names BOSS_INTERRUPT legitimately has no interrupt surface, so the
      // finding here is the missing Boss-reply wait state.)
      expect(diagnostics.join('\n')).toMatch(/awaitBossReply/);
      const content = await readFile(path, 'utf8');
      expect(content).toContain(
        'import { checkFsmCoverage, fsmCoverageTestTimeout } from "@sublang/slc/verify"',
      );
      expect(content).toContain('import * as fsm from "./code.fsm.js"');
      expect(content).toContain('new URL("./code.fsm.ts", import.meta.url)');
      expect(content).toContain('checkFsmCoverage(fsm, { sourceText })');
      expect(content).toContain('}, fsmCoverageTestTimeout(fsm));');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('generates the module referencing the sibling artifact', () => {
    const generated = generateFsmCoverageTest({
      basename: 'flow',
      fsmModule: './flow.fsm.js',
      fsmSourceFile: './flow.fsm.ts',
      verifyModule: '@sublang/slc/verify',
    });
    expect(generated).toContain('new URL("./flow.fsm.ts", import.meta.url)');
    expect(generated).toContain('reaches every declared transition');
    expect(generated).toContain('}, fsmCoverageTestTimeout(fsm));');
  });

  it('quotes generated strings and comments for punctuation-heavy basenames', () => {
    const basename = `flow's "quoted"\nname`;
    const fsmModule = `./flow's.fsm.ts`;
    const verifyModule = `@scope/pkg's/verify`;
    const generated = generateFsmCoverageTest({
      basename,
      fsmModule,
      fsmSourceFile: fsmModule,
      verifyModule,
    });
    expect(generated).toContain(`coverage for ${JSON.stringify(basename)}.`);
    expect(generated).toContain(`from ${JSON.stringify(verifyModule)}`);
    expect(generated).toContain(`from ${JSON.stringify(fsmModule)}`);
    expect(generated).toContain(
      `describe(${JSON.stringify(`${basename}: FSM coverage`)}, () => {`,
    );
  });
});

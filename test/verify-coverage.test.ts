// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup } from 'xstate';

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
const referenceFsm: unknown = await import(join(referenceDir, 'code.fsm.js'));

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
    descriptorInterruptType?: string;
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
            (overrides.descriptorInterruptType === undefined
              ? event.targetId === publicStateId
              : Object.getOwnPropertyDescriptor(event, 'type')?.value ===
                  overrides.descriptorInterruptType &&
                Object.getOwnPropertyDescriptor(event, 'targetId')?.value ===
                  publicStateId) &&
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

/** A script preflight followed by ordinary acting work, as in the cold demo. */
const scriptWorkflow = (
  options: {
    guard?: (args: any) => boolean;
    failureArm?: boolean;
    shadowSuccess?: boolean;
    specialFailureStatus?: number;
    extraFailureStatuses?: number[];
    observed?: Array<{ guard: string; exitStatus: number }>;
  } = {},
) => {
  const ordinary = goodMachine({ workId: 'runTask' });
  const states = ordinary.config.states as any;
  const scriptOutput = (event: any) =>
    typeof event.output?.exitStatus === 'number' &&
    ['zero', 'nonzero'].includes(event.output?.guard)
      ? event.output
      : undefined;
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('coverage must supply the acting actor');
      }),
      script: fromPromise(async () => {
        throw new Error('coverage must supply the script actor');
      }),
    },
    guards: {
      scriptOk:
        options.guard ??
        (({ event }: any) => scriptOutput(event)?.guard === 'zero'),
      scriptFailureStatus: ({ event }: any, params: { exitStatus: number }) =>
        event.output.guard === 'nonzero' &&
        event.output.exitStatus === params.exitStatus,
    },
    actions: {
      rememberScriptResult: assign(({ event }: any) => {
        const output = scriptOutput(event);
        if (output !== undefined) options.observed?.push(output);
        return output === undefined ? {} : { lastResult: output };
      }),
    },
  }).createMachine({
    ...ordinary.config,
    states: {
      ...states,
      ready: { id: 'ready', on: { GO: { target: 'ensureRepository' } } },
      ensureRepository: {
        id: 'ensureRepository',
        meta: { playbook: { stateId: 'ensureRepository' } },
        invoke: {
          src: 'script',
          input: () => ({
            stateId: 'ensureRepository',
            sourceItem: 'X-0',
            command: 'test -e .git',
            result: {
              zero: 'The command exited with status zero.',
              nonzero: 'The command exited with a nonzero status.',
            },
          }),
          onDone: [
            ...(options.shadowSuccess === true ? [{ target: '#failed' }] : []),
            {
              guard: 'scriptOk',
              target: '#runTask',
              actions: 'rememberScriptResult',
            },
            ...(options.specialFailureStatus === undefined
              ? []
              : [
                  {
                    guard: ({ event }: any) =>
                      event.output.guard === 'nonzero' &&
                      event.output.exitStatus === options.specialFailureStatus,
                    target: '#failed',
                    actions: 'rememberScriptResult',
                  },
                ]),
            ...(options.extraFailureStatuses ?? []).map((exitStatus) => ({
              guard: { type: 'scriptFailureStatus', params: { exitStatus } },
              target: '#failed',
              actions: 'rememberScriptResult',
            })),
            ...(options.failureArm === false
              ? []
              : [{ target: '#failed', actions: 'rememberScriptResult' }]),
          ],
          onError: { target: '#failed' },
        },
      },
    },
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
    repeatedCanonicalRole?: boolean;
    sequentialSameRole?: boolean;
    nestedCrossRegionRepeatedRole?: boolean;
  } = {},
) => {
  const meta = (stateId: string) => ({
    description: stateId,
    meta: { playbook: { stateId, description: stateId } },
  });
  const branch = (side: 'left' | 'right') => {
    const stateId = `${side}Work`;
    const waitId = `${side}Wait`;
    const usesWriterRole =
      opts.repeatedCanonicalRole === true ||
      (opts.sequentialSameRole === true && side === 'left') ||
      (opts.nestedCrossRegionRepeatedRole === true && side === 'right');
    return {
      id: `${side}Branch`,
      initial: 'working',
      ...meta(`${side}Branch`),
      states: {
        working: {
          id: stateId,
          tags: 'playbook.busy',
          ...(usesWriterRole
            ? {
                description: stateId,
                meta: {
                  playbook: {
                    stateId,
                    description: stateId,
                    role: 'writer',
                  },
                },
              }
            : meta(stateId)),
          invoke: {
            id: `${side}Captain`,
            src: 'player',
            input: () => ({
              stateId,
              ...(usesWriterRole
                ? { role: 'writer' }
                : { player: side === 'left' ? 'Writer' : 'Reviewer' }),
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
        ...(opts.sequentialSameRole === true && side === 'left'
          ? {
              revision: {
                id: 'leftRevision',
                meta: {
                  playbook: {
                    stateId: 'leftRevision',
                    description: 'leftRevision',
                    role: 'writer',
                  },
                },
                invoke: {
                  src: 'player',
                  input: () => ({
                    stateId: 'leftRevision',
                    role: 'writer',
                    sourceItem: 'X-1-REVISION',
                    prompt: 'Revise the left result.',
                    result: { ok: 'The revision is complete.' },
                  }),
                  onDone: { target: 'complete' },
                  onError: { target: '#failed' },
                },
              },
            }
          : {}),
        ...(opts.nestedCrossRegionRepeatedRole === true && side === 'left'
          ? {
              nestedSplit: {
                id: 'leftNestedSplit',
                type: 'parallel',
                states: {
                  writerRegion: {
                    initial: 'working',
                    states: {
                      working: {
                        id: 'nestedWriterWork',
                        meta: {
                          playbook: {
                            stateId: 'nestedWriterWork',
                            description: 'nestedWriterWork',
                            role: 'writer',
                          },
                        },
                        invoke: {
                          src: 'player',
                          input: () => ({
                            stateId: 'nestedWriterWork',
                            role: 'writer',
                            sourceItem: 'X-NESTED',
                            prompt: 'Nested writer work.',
                            result: { ok: 'Nested work is complete.' },
                          }),
                          onDone: { target: 'complete' },
                          onError: { target: '#failed' },
                        },
                      },
                      complete: { type: 'final' },
                    },
                  },
                  observerRegion: { type: 'final' },
                },
                onDone: { target: 'complete' },
              },
            }
          : {}),
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
/**
 * The recovering first `onError` arm a workflow writes for a child that
 * completed at its own authored failure terminal: the bridge rejects that
 * `ok` result through the error path, so nothing else on this path matches.
 */
const authoredFailureTerminalGuard = ({ event }: any): boolean => {
  const result = event.error?.result;
  const terminal = result?.terminal;
  return (
    typeof result === 'object' &&
    result !== null &&
    result.status === 'ok' &&
    typeof result.childSessionId === 'string' &&
    result.childSessionId !== '' &&
    typeof terminal === 'object' &&
    terminal !== null &&
    terminal.kind === 'failure' &&
    typeof terminal.stateId === 'string' &&
    terminal.stateId !== ''
  );
};

const nestedMultiArmMachine = (
  opts: {
    deadDoneArm?: boolean;
    deadErrorArm?: boolean;
    authoredFailureTerminalArm?: boolean;
  } = {},
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
              guard:
                opts.authoredFailureTerminalArm === true
                  ? authoredFailureTerminalGuard
                  : ({ event }: any) =>
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

/** A static child can be entered only by its preceding player's real output. */
const accumulatedChildMachine = (
  opts: {
    deadPredecessor?: boolean;
    deadChildArm?: boolean;
    shadowedChildArm?: boolean;
    inputThrows?: boolean;
  } = {},
) => {
  const plain = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return false;
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === 'string' &&
        descriptor?.enumerable === true &&
        'value' in descriptor
      );
    });
  };
  const approved = ({ event }: any) =>
    plain(event) &&
    plain(event.output) &&
    event.output.approved === true &&
    typeof event.output.revision === 'string' &&
    event.output.revision.trim() !== '';
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('provide player');
      }),
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
    },
  }).createMachine({
    id: 'accumulatedChild',
    context: {} as any,
    initial: 'ready',
    on: {
      BOSS_INTERRUPT: {
        guard: ({ event }: any) => event.targetId === 'work',
        target: '#work',
        reenter: true,
      },
    },
    states: {
      ready: { id: 'ready', on: { BOSS_REQUEST: { target: '#work' } } },
      work: {
        id: 'work',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'work',
            role: 'writer',
            sourceItem: 'FLOW-1',
            prompt: 'Choose a route.',
            result: {
              left: 'Select the left route.',
              right: 'Select the right route.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            ...['left', 'right'].map((key) => ({
              target: '#child',
              guard: ({ event }: any) =>
                opts.deadPredecessor !== true && event.output.guard === key,
              actions: assign(({ event }: any) => ({
                branch: event.output.guard,
              })),
            })),
            needsBossReplyArm(),
            { target: '#failed' },
          ],
          onError: { target: '#failed' },
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: ({ context }: any) => {
            if (opts.inputThrows === true)
              throw new Error('real reached child input failure');
            if (context.branch !== 'left' && context.branch !== 'right')
              throw new Error('missing preceding result');
            return {
              stateId: 'child',
              playbookId: 'review',
              text: context.branch,
            };
          },
          onDone: [
            ...(opts.shadowedChildArm === true
              ? [{ target: '#doneInvalid' }]
              : []),
            {
              target: '#doneLeft',
              guard: (args: any) =>
                args.context.branch === 'left' && approved(args),
            },
            {
              target: '#doneRight',
              guard: (args: any) =>
                opts.deadChildArm !== true &&
                args.context.branch === 'right' &&
                approved(args),
            },
            { target: '#doneInvalid' },
          ],
          onError: [
            {
              target: '#authoredFailure',
              guard: ({ context, event }: any) =>
                typeof context.branch === 'string' &&
                event.error instanceof Error &&
                event.error.result?.status === 'error',
            },
            { target: '#controlFailure' },
          ],
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: {
            target: '#work',
            guard: ({ event }: any) =>
              typeof event.answer === 'string' && event.answer.trim() !== '',
          },
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked' },
      doneLeft: { id: 'doneLeft', type: 'final' },
      doneRight: { id: 'doneRight', type: 'final' },
      doneInvalid: { id: 'doneInvalid', type: 'final' },
      authoredFailure: { id: 'authoredFailure', type: 'final' },
      controlFailure: { id: 'controlFailure', type: 'final' },
    },
  } as any);
};

/** Non-preemptive planning plus a DEV-like branch/decision/code/PR chain. */
const childChainMachine = (
  opts: {
    deadDecision?: boolean;
    repeatBranch?: boolean;
    blankResumes?: boolean;
  } = {},
) => {
  const exactApproval = (value: any) =>
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).every(
      (key) => key === 'approved' || key === 'revision',
    ) &&
    value.approved === true &&
    typeof value.revision === 'string' &&
    value.revision !== '';
  const errorArms = [
    {
      target: '#childFailed',
      guard: ({ event }: any) =>
        event.error instanceof Error && event.error.result?.status === 'error',
    },
    { target: '#failed' },
  ];
  const child = (
    id: string,
    arms: unknown[],
    inputCheck?: (context: any) => void,
  ) => ({
    id,
    invoke: {
      src: 'playbook',
      input: ({ context }: any) => {
        if (context.mode === undefined)
          throw new Error('planning must execute');
        inputCheck?.(context);
        return { stateId: id, playbookId: id, text: context.mode };
      },
      onDone: arms,
      onError: errorArms,
    },
  });
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('provide planner');
      }),
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
    },
  }).createMachine({
    id: 'childChain',
    initial: 'ready',
    context: { branches: 0 } as any,
    states: {
      ready: { id: 'ready', on: { START: { target: 'plan' } } },
      plan: {
        id: 'plan',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'plan',
            sourceItem: 'CHAIN-1',
            role: 'planner',
            prompt: 'Plan the request.',
            result: {
              direct: 'Call code.',
              decide: 'Call decide then code.',
              branch: 'Call branch then code and PR.',
              both: 'Call branch, decide, code and PR.',
              discuss: 'Complete the discussion after a reply.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            ...[
              ['direct', 'code'],
              ['decide', 'decide'],
              ['branch', 'branch'],
              ['both', 'branch'],
            ].map(([key, target]) => ({
              guard: ({ event }: any) => event.output.guard === key,
              target,
              actions: assign(({ event }: any) => ({
                mode: event.output.guard,
              })),
            })),
            {
              target: 'done',
              guard: ({ context, event }: any) =>
                context.answered === true && event.output.guard === 'discuss',
            },
            {
              target: 'awaitBossReply',
              guard: ({ event }: any) =>
                event.output.guard === 'needsBossReply' &&
                typeof event.output.question === 'string',
              actions: assign(({ event }: any) => ({
                pendingBossQuestion: {
                  resumeStateId: 'plan',
                  question: event.output.question,
                },
              })),
            },
            { target: 'failed' },
          ],
          onError: { target: 'failed' },
        },
      },
      branch: child('branch', [
        {
          target: 'decide',
          guard: ({ context, event }: any) =>
            context.mode === 'both' && exactApproval(event.output),
          actions: assign(({ context }: any) => ({
            branches: context.branches + 1,
          })),
        },
        {
          target: 'code',
          guard: ({ context, event }: any) =>
            context.mode === 'branch' && exactApproval(event.output),
          actions: assign(({ context }: any) => ({
            branches: context.branches + 1,
          })),
        },
        { target: 'childFailed' },
      ]),
      decide: child('decide', [
        {
          target: 'code',
          guard: ({ event }: any) =>
            opts.deadDecision !== true && exactApproval(event.output),
          actions: assign(({ event }: any) => ({
            decisionRevision: event.output.revision,
          })),
        },
        { target: 'childFailed' },
      ]),
      code: child(
        'code',
        [
          {
            target: 'pr',
            guard: ({ context, event }: any) =>
              ['branch', 'both'].includes(context.mode) &&
              (opts.repeatBranch !== true || context.branches >= 2) &&
              exactApproval(event.output),
            actions: assign(({ event }: any) => ({
              codeRevision: event.output.revision,
            })),
          },
          ...(opts.repeatBranch === true
            ? [
                {
                  target: 'branch',
                  guard: ({ context, event }: any) =>
                    ['branch', 'both'].includes(context.mode) &&
                    context.branches < 2 &&
                    exactApproval(event.output),
                },
              ]
            : []),
          {
            target: 'done',
            guard: ({ context, event }: any) =>
              ['direct', 'decide'].includes(context.mode) &&
              exactApproval(event.output),
          },
          { target: 'childFailed' },
        ],
        (context) => {
          if (
            ['decide', 'both'].includes(context.mode) &&
            typeof context.decisionRevision !== 'string'
          )
            throw new Error('decision must execute');
        },
      ),
      pr: child('pr', [{ target: 'done' }], (context) => {
        if (context.branches < 1 || typeof context.codeRevision !== 'string')
          throw new Error('branch and code must execute');
      }),
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: {
            target: 'plan',
            guard: ({ event }: any) =>
              opts.blankResumes === true ||
              (typeof event.answer === 'string' && event.answer.trim() !== ''),
            actions: assign(() => ({ answered: true })),
          },
        },
      },
      done: { id: 'done', type: 'final' },
      childFailed: { id: 'childFailed', type: 'final' },
      failed: { id: 'failed', tags: 'playbook.parked' },
    },
  } as any);
};

const boundedPathMachine = (opts: { depth?: number; branching?: boolean }) => {
  const states: Record<string, any> = {
    ready: { id: 'ready', on: {} },
    done: { id: 'done', type: 'final' },
    failed: { id: 'failed', tags: 'playbook.parked' },
    awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
  };
  const invocation = (id: string, target: string) => ({
    id,
    invoke: {
      src: 'playbook',
      input: () => ({
        stateId: id,
        playbookId: 'child',
        text: 'Exact child request.',
      }),
      onDone: {
        target,
        guard: ({ event }: any) => Object.keys(event.output).length === 0,
      },
      onError: { target: 'failed' },
    },
  });
  if (opts.depth !== undefined) {
    states.ready.on.START = { target: 'step0' };
    for (let index = 0; index < opts.depth; index++)
      states[`step${index}`] = invocation(
        `step${index}`,
        index + 1 === opts.depth ? 'done' : `step${index + 1}`,
      );
  } else if (opts.branching) {
    states.ready.on.START = { target: 'step0' };
    for (let index = 0; index < 7; index++) {
      states[`step${index}`] = invocation(
        `step${index}`,
        index === 6 ? 'last' : `step${index + 1}`,
      );
      const target = states[`step${index}`].invoke.onDone.target;
      states[`step${index}`].invoke.onDone = ['left', 'right'].map((key) => ({
        target,
        guard:
          key === 'left'
            ? ({ event }: any) => event.output.guard === 'left'
            : ({ event }: any) => event.output.guard === 'right',
        actions: assign(({ context }: any) => ({
          path: `${context.path ?? ''}/${key}`,
        })),
      }));
    }
    states.last = invocation('last', 'done');
  }
  return setup({
    actors: { playbook: fromPromise(async () => ({})) },
  }).createMachine({
    id: 'boundedPaths',
    initial: 'ready',
    context: {},
    states,
  } as any);
};

const controllerActions = [
  'respond',
  'resume',
  'start',
  'switch',
  'dismiss',
  'deliver',
  'runtime',
] as const;

/** A schema-3 session controller entered from its hub without an interrupt. */
const controllerMachine = (
  withBossReplyWait = false,
  deadReportingResult = false,
  extraDecisionResult = false,
  opts: {
    repeatedDecisionPath?: boolean;
    wrongEarlierArm?: boolean;
    cyclicNoExit?: boolean;
    unsupportedSurfaces?: boolean;
    missingDecisionResult?: boolean;
    nestedInterrupt?: boolean;
    guardForm?: 'inline' | 'parameterized';
    staleTargetLatch?: 'prior' | 'self';
    contextualSharedArm?: boolean;
  } = {},
) => {
  const actionGuard =
    (action: (typeof controllerActions)[number]) =>
    ({ context, event }: any) => {
      const output = event.output;
      if (
        opts.contextualSharedArm === true &&
        action === 'dismiss' &&
        (output.guard === 'dismiss' || output.guard === 'deliver')
      ) {
        return context.controllerRoute === 'shared';
      }
      if (
        opts.contextualSharedArm === true &&
        action === 'deliver' &&
        output.guard === 'deliver'
      ) {
        return false;
      }
      if (
        output.guard !== action &&
        !(
          opts.wrongEarlierArm === true &&
          action === 'respond' &&
          output.guard === 'dismiss'
        )
      ) {
        return false;
      }
      if (action === 'respond') {
        return (
          output.guard === 'dismiss' ||
          (typeof output.text === 'string' && output.text !== '')
        );
      }
      if (action === 'resume' || action === 'start' || action === 'switch') {
        if (
          !context.enabledPlaybooks.some(
            (entry: { id: string }) => entry.id === output.playbookId,
          )
        ) {
          return false;
        }
        return (
          action === 'resume' ||
          (typeof output.input === 'string' && output.input !== '')
        );
      }
      return (
        action !== 'runtime' ||
        (typeof output.actionId === 'string' && output.actionId !== '')
      );
    };
  const guards = Object.fromEntries(
    controllerActions.map((action) => [action, actionGuard(action)]),
  );
  const invalidStates =
    opts.unsupportedSurfaces === true
      ? {
          delegated: {
            id: 'delegated',
            meta: {
              playbook: {
                stateId: 'delegated',
                description: 'Invalid delegated controller work.',
                role: 'writer',
              },
            },
            invoke: {
              src: 'player',
              input: () => ({
                stateId: 'delegated',
                role: 'writer',
                sourceItem: 'CONTROLLER-PLAYER',
                prompt: 'Invalid delegated work.',
                result: { done: 'The delegated work is complete.' },
              }),
              onDone: { target: '#hub' },
              onError: { target: '#failed' },
            },
          },
          child: {
            id: 'child',
            invoke: {
              src: 'playbook',
              input: () => ({
                stateId: 'child',
                playbookId: 'coverage-child-playbook',
                text: 'Invalid nested controller work.',
              }),
              onDone: { target: '#hub' },
              onError: { target: '#failed' },
            },
          },
          split: {
            id: 'split',
            type: 'parallel',
            states: {
              left: { type: 'final' },
              right: { type: 'final' },
            },
            onDone: { target: '#hub' },
          },
        }
      : {};

  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
      player: fromPromise(async () => {
        throw new Error('player actor must be provided by the runner');
      }),
      playbook: fromPromise(async () => {
        throw new Error('playbook actor must be provided by the runner');
      }),
    },
    guards: {
      ...guards,
      controllerAction: ({ context, event }: any, params: any) =>
        actionGuard(params.action)({ context, event }),
      done: ({ event }: any) =>
        deadReportingResult !== true && event.output.guard === 'done',
    } as any,
  }).createMachine({
    id: 'sessionController',
    initial: 'hub',
    context: ({ input }: any) => ({
      enabledPlaybooks: input.enabledPlaybooks,
      allowDeclaredTarget: true,
    }),
    states: {
      hub: {
        id: 'hub',
        tags: 'playbook.parked',
        on: {
          BOSS_TURN: { target: 'deciding' },
          SHUTDOWN: { target: 'shutdown' },
          ...(opts.nestedInterrupt === true
            ? { BOSS_INTERRUPT: { target: 'shutdown' } }
            : {}),
        },
      },
      deciding: {
        id: 'deciding',
        meta: {
          playbook: {
            stateId: 'deciding',
            description: 'Choose the next session action.',
          },
        },
        invoke: {
          src: 'captain',
          input: () => ({
            stateId: 'deciding',
            sourceItem: 'CONTROLLER-1',
            prompt: 'Choose the next session action.',
            result: {
              respond:
                'Reply now. Output shall include `text: <complete reply>`.',
              resume:
                'Resume work. Output shall include `playbookId: <catalog id>`.',
              start:
                'Start work. Output shall include `playbookId: <catalog id>` and `input: <request>`.',
              switch:
                'Switch work. Output shall include `playbookId: <catalog id>` and `input: <request>`.',
              dismiss: 'Dismiss the active work.',
              deliver: 'Deliver the current turn.',
              ...(opts.missingDecisionResult === true
                ? {}
                : {
                    runtime:
                      'Run a host action. Output shall include `actionId: <action id>`.',
                  }),
              ...(extraDecisionResult
                ? { other: 'An undeclared controller action.' }
                : {}),
            },
          }),
          onDone: controllerActions.map((action) => {
            const guard =
              opts.guardForm === 'inline'
                ? actionGuard(action)
                : opts.guardForm === 'parameterized'
                  ? { type: 'controllerAction', params: { action } }
                  : action;
            return {
              target:
                opts.cyclicNoExit === true ||
                (opts.repeatedDecisionPath === true && action === 'start')
                  ? '#launching'
                  : action === 'respond'
                    ? '#hub'
                    : '#reporting',
              guard,
              ...(opts.staleTargetLatch !== undefined && action === 'start'
                ? {
                    actions: assign({
                      allowDeclaredTarget: () => false,
                    }),
                  }
                : {}),
            };
          }),
          onError: { target: '#failed' },
        },
      },
      ...((opts.repeatedDecisionPath === true ||
        opts.cyclicNoExit === true) && {
        launching: {
          id: 'launching',
          meta: {
            playbook: {
              stateId: 'launching',
              description: 'Settle the selected host action.',
            },
          },
          invoke: {
            src: 'captain',
            input: () => ({
              stateId: 'launching',
              sourceItem: 'CONTROLLER-3',
              prompt: 'Settle the selected host action.',
              result: { done: 'The selected host action settled.' },
            }),
            onDone:
              opts.staleTargetLatch !== undefined
                ? [
                    {
                      target:
                        opts.staleTargetLatch === 'self'
                          ? '#launching'
                          : '#deciding',
                      guard: ({ context, event }: any) =>
                        context.allowDeclaredTarget === true &&
                        event.output.guard === 'done',
                    },
                    { target: '#hub', guard: 'done' },
                  ]
                : { target: '#deciding', guard: 'done' },
            onError: { target: '#failed' },
          },
        },
      }),
      reporting: {
        id: 'reporting',
        meta: {
          playbook: {
            stateId: 'reporting',
            description: 'Report the settled controller action.',
          },
        },
        invoke: {
          src: 'captain',
          input: () => ({
            stateId: 'reporting',
            sourceItem: 'CONTROLLER-2',
            prompt: 'Report the settled controller action.',
            result: { done: 'The action report is complete.' },
          }),
          onDone: { target: '#hub', guard: 'done' },
          onError: { target: '#failed' },
        },
      },
      ...invalidStates,
      failed: { id: 'failed', tags: 'playbook.parked' },
      ...(withBossReplyWait
        ? {
            awaitBossReply: {
              id: 'awaitBossReply',
              tags: 'playbook.parked',
              on: { BOSS_REPLY: { target: '#hub' } },
            },
          }
        : {}),
      shutdown: { id: 'shutdown', type: 'final' },
    },
  } as any);
};

/** A controller whose real hub is the leaf inside its root compound state. */
const compoundControllerWithoutHubReturn = () => {
  const flat = controllerMachine();
  const flatConfig = flat.config as any;
  const { shutdown, ...sessionStates } = flatConfig.states;
  const deciding = sessionStates.deciding;
  sessionStates.hub = {
    ...sessionStates.hub,
    on: {
      ...sessionStates.hub.on,
      SHUTDOWN: { target: '#shutdown' },
    },
  };
  sessionStates.deciding = {
    ...deciding,
    invoke: {
      ...deciding.invoke,
      onDone: deciding.invoke.onDone.map((arm: any, index: number) =>
        index === controllerActions.indexOf('start')
          ? { ...arm, target: '#stranded' }
          : arm,
      ),
    },
  };
  sessionStates.stranded = { id: 'stranded' };

  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
    guards: flat.implementations.guards as any,
  }).createMachine({
    id: 'compoundSessionController',
    initial: 'session',
    context: flatConfig.context,
    states: {
      session: {
        id: 'session',
        initial: 'hub',
        states: sessionStates,
      },
      shutdown,
    },
  } as any);
};

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

type ScriptGuardArgs = {
  event: {
    output: { guard: string; exitStatus?: number; invented?: string };
  };
};

describe('guardSatisfiable (verification-6)', () => {
  it('preserves descriptor-bearing actor outputs through probing and actual XState execution', async () => {
    const symbol = Symbol('coverage fixture');
    const getter = () => 'accepted';
    const setter = () => {};
    const cases = [
      Object.defineProperty({}, 'value', {
        get: getter,
        set: setter,
        enumerable: true,
        configurable: true,
      }),
      Object.defineProperty({}, 'value', {
        value: 'accepted',
        enumerable: false,
        writable: false,
        configurable: false,
      }),
      { [symbol]: 'accepted' },
      Object.assign(Object.create(null) as object, { value: 'accepted' }),
    ];
    for (const output of cases) {
      const descriptors = Object.getOwnPropertyDescriptors(output);
      const prototype = Object.getPrototypeOf(output) as object | null;
      const guard = ({
        context,
        event,
      }: {
        context: Record<string, unknown>;
        event: { output?: object };
      }) => {
        if (
          event.output === undefined ||
          Object.getPrototypeOf(event.output) !== prototype
        )
          return false;
        for (const key of Reflect.ownKeys(descriptors)) {
          const expected = descriptors[key as keyof typeof descriptors];
          const actual = Object.getOwnPropertyDescriptor(event.output, key);
          if (
            actual === undefined ||
            Reflect.ownKeys(expected).some(
              (member) =>
                Reflect.get(actual, member) !== Reflect.get(expected, member),
            )
          )
            return false;
        }
        return context.route === 'accepted';
      };
      expect(guardSatisfiable(guard as never, output)).toBe(true);
      const machine = setup({
        actors: { work: fromPromise(async () => output) },
      }).createMachine({
        initial: 'work',
        context: { route: 'accepted' },
        states: {
          work: { invoke: { src: 'work', onDone: { guard, target: 'done' } } },
          done: { type: 'final' },
        },
      });
      const actor = createActor(machine);
      actor.start();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(actor.getSnapshot().status).toBe('done');
      actor.stop();
      expect(Object.getOwnPropertyDescriptors(output)).toEqual(descriptors);
    }
  });

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

describe('checkFsmCoverage (verification-6)', () => {
  it.each(['BOSS_INTERRUPT', 'WRONG_EVENT'])(
    'preserves descriptor-read fixed event fields against a %s guard',
    async (eventType) => {
      const machine = goodMachine({ descriptorInterruptType: eventType });
      const actor = createActor(
        machine.provide({
          actors: { captain: fromPromise(() => new Promise(() => {})) },
        }),
      );
      actor.start();
      actor.send({ type: 'BOSS_INTERRUPT', targetId: 'work' });
      expect(actor.getSnapshot().value).toBe(
        eventType === 'BOSS_INTERRUPT' ? 'work' : 'ready',
      );
      actor.stop();
      const findings = await checkFsmCoverage({ machine });
      if (eventType === 'BOSS_INTERRUPT') expect(findings).toEqual([]);
      else
        expect(findings).toContain(
          'BOSS_INTERRUPT target work is unsatisfiable under context/event probing',
        );
    },
  );

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

  it('rejects a repeated canonical role in a parallel group', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ repeatedCanonicalRole: true }),
      }),
    ).toContain('parallel state parallelRound repeats canonical role writer');
  });

  it('allows sequential uses of one role inside a single parallel region', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ sequentialSameRole: true }),
      }),
    ).not.toContain(
      'parallel state parallelRound repeats canonical role writer',
    );
  });

  it('detects a role repeated across outer regions through a nested parallel', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ nestedCrossRegionRepeatedRole: true }),
      }),
    ).toContain('parallel state parallelRound repeats canonical role writer');
  });

  it('drives every controller action without a Boss-reply wait', async () => {
    expect(await checkFsmCoverage({ machine: controllerMachine() })).toEqual(
      [],
    );
    expect(
      await checkFsmCoverage({ machine: controllerMachine(true) }),
    ).toContain('controller machine declares a Boss-reply wait state');
  });

  it('audits intermediate controller Captain result paths', async () => {
    expect(
      await checkFsmCoverage({ machine: controllerMachine(false, true) }),
    ).toContain(
      'state reporting: result "done" has no reachable accepting transition',
    );
  });

  it('scripts repeated controller-state occurrences in path order', async () => {
    expect(
      await checkFsmCoverage({
        machine: controllerMachine(false, false, false, {
          repeatedDecisionPath: true,
        }),
      }),
    ).toEqual([]);
  });

  it.each([
    ['previously visited', 'prior', 'deciding'],
    ['self', 'self', 'launching'],
  ] as const)(
    'observes a %s controller target only through the probed transition',
    async (_label, staleTargetLatch, target) => {
      expect(
        await checkFsmCoverage({
          machine: controllerMachine(false, false, false, {
            repeatedDecisionPath: true,
            staleTargetLatch,
          }),
        }),
      ).toContain(
        `state launching: controller result "done" did not reach its declared direct action target ${target}`,
      );
    },
  );

  it('rejects a controller result selected by an earlier action arm', async () => {
    expect(
      await checkFsmCoverage({
        machine: controllerMachine(false, false, false, {
          wrongEarlierArm: true,
        }),
      }),
    ).toContain(
      'state deciding: controller result "dismiss" selects direct arm 0, already selected by result "respond"',
    );
  });

  it('detects a shared action arm that is selectable only under probed context', async () => {
    const findings = await checkFsmCoverage({
      machine: controllerMachine(false, false, false, {
        contextualSharedArm: true,
      }),
    });
    expect(findings).toContain(
      'state deciding: controller result "deliver" selects direct arm 4, already selected by result "dismiss"',
    );
  });

  it.each(['inline', 'parameterized'] as const)(
    'accepts %s controller action guards by evaluated behavior',
    async (guardForm) => {
      expect(
        await checkFsmCoverage({
          machine: controllerMachine(false, false, false, { guardForm }),
        }),
      ).toEqual([]);
    },
  );

  it('bounds a cyclic controller graph with no hub or final exit', async () => {
    expect(
      await checkFsmCoverage({
        machine: controllerMachine(false, false, false, {
          cyclicNoExit: true,
        }),
      }),
    ).toContain(
      'state deciding: controller result "respond" reached neither the session hub nor a shutdown final',
    );
  }, 2_000);

  it('requires a compound-root controller path to return to its leaf hub', async () => {
    expect(
      await checkFsmCoverage({
        machine: compoundControllerWithoutHubReturn(),
      }),
    ).toContain(
      'state deciding: controller result "start" reached neither the session hub nor a shutdown final',
    );
  });

  it('fails closed on workflow-only surfaces inside a controller', async () => {
    const findings = await checkFsmCoverage({
      machine: controllerMachine(false, false, false, {
        unsupportedSurfaces: true,
      }),
    });
    expect(findings).toEqual(
      expect.arrayContaining([
        'controller machine declares delegated-player invocation',
        'controller machine declares nested-playbook invocation',
        'controller machine declares parallel state',
      ]),
    );
  });

  it.each([
    [
      'missing action',
      controllerMachine(false, false, false, {
        missingDecisionResult: true,
        nestedInterrupt: true,
      }),
      'state deciding: controller decision contract near-miss (missing "runtime")',
    ],
    [
      'extra action',
      controllerMachine(false, false, true),
      'state deciding: controller decision contract near-miss (extra "other")',
    ],
  ] as const)(
    'diagnoses a %s without selecting the controller contract',
    async (_label, machine, nearMiss) => {
      const findings = await checkFsmCoverage({ machine });
      expect(findings).not.toContain(
        'machine declares no awaitBossReply state or branch-local Boss-reply wait state',
      );
      expect(findings).not.toContain(
        'machine declares no root BOSS_INTERRUPT event',
      );
      expect(findings).toContainEqual(expect.stringContaining(nearMiss));
    },
  );

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

  it('enters a static child through each real preceding result and probes reached context (verification-43)', async () => {
    expect(
      await checkFsmCoverage({ machine: accumulatedChildMachine() }),
    ).toEqual([]);
  });

  it('covers a non-preemptive branch/decide/code/PR chain and a real question/reply revisit', async () => {
    expect(await checkFsmCoverage({ machine: childChainMachine() })).toEqual(
      [],
    );
  });

  it('retains dead child approval and blank-reply failures without context patches', async () => {
    expect(
      await checkFsmCoverage({
        machine: childChainMachine({ deadDecision: true }),
      }),
    ).toContain(
      'state decide: nested playbook onDone arm 0 is unsatisfiable under probing',
    );
    expect(
      (
        await checkFsmCoverage({
          machine: childChainMachine({ blankResumes: true }),
        })
      ).some((finding) =>
        finding.includes('a blank BOSS_REPLY answer must not resume'),
      ),
    ).toBe(true);
  });

  it('reports a required non-question cycle as unsupported rather than skipping it', async () => {
    const findings = await checkFsmCoverage({
      machine: childChainMachine({ repeatBranch: true }),
    });
    expect(
      findings.some(
        (finding) =>
          finding.startsWith('state pr:') &&
          finding.includes('unsupported repeated-invocation'),
      ),
    ).toBe(true);
  });

  it('reports explicit depth and attempt exhaustion for otherwise runnable child paths', async () => {
    const deep = boundedPathMachine({ depth: 9 });
    const actor = createActor(deep);
    actor.start();
    actor.send({ type: 'START' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(actor.getSnapshot().status).toBe('done');
    actor.stop();
    expect(
      (await checkFsmCoverage({ machine: deep })).some((finding) =>
        finding.includes('exhausted 8-invocation path depth'),
      ),
    ).toBe(true);
    expect(
      (
        await checkFsmCoverage({
          machine: boundedPathMachine({ branching: true }),
        })
      ).some(
        (finding) =>
          finding.startsWith('state last:') &&
          finding.includes('exhausted 64-attempt path budget'),
      ),
    ).toBe(true);
  });

  it('retains initialized context when the child is initially active (verification-43)', async () => {
    const machine = setup({
      actors: {
        playbook: fromPromise(async () => {
          throw new Error('provide child');
        }),
      },
    }).createMachine({
      id: 'initialChild',
      context: { phase: 'initialized' },
      initial: 'child',
      on: {
        BOSS_INTERRUPT: {
          target: '#ready',
          guard: ({ event }) => event.targetId === 'ready',
        },
      },
      states: {
        ready: { id: 'ready' },
        child: {
          id: 'child',
          invoke: {
            src: 'playbook',
            input: ({ context }) => {
              if (context.phase !== 'initialized')
                throw new Error('lost initialized context');
              return {
                stateId: 'child',
                playbookId: 'review',
                text: context.phase,
              };
            },
            onDone: {
              target: 'done',
              guard: ({ context }) => context.phase === 'initialized',
            },
            onError: { target: 'failed' },
          },
        },
        done: { id: 'done', type: 'final' },
        failed: { id: 'failed', type: 'final' },
      },
    });
    // Machine-surface findings remain separate. The unrelated interrupt keeps
    // ordinary nested coverage enabled but cannot re-enter this initial child.
    expect(
      (await checkFsmCoverage({ machine })).filter((finding) =>
        finding.startsWith('state child:'),
      ),
    ).toEqual([]);
  });

  it('does not invent an entry or accumulated context for a dead predecessor (verification-43)', async () => {
    expect(
      await checkFsmCoverage({
        machine: accumulatedChildMachine({ deadPredecessor: true }),
      }),
    ).toContain(
      'state child: nested playbook onDone arm 0 has no reachable entry under probing',
    );
  });

  it('retains unsatisfiable and shadowed child arms after actual entry (verification-43)', async () => {
    expect(
      await checkFsmCoverage({
        machine: accumulatedChildMachine({ deadChildArm: true }),
      }),
    ).toContain(
      'state child: nested playbook onDone arm 1 is unsatisfiable under probing',
    );
    expect(
      await checkFsmCoverage({
        machine: accumulatedChildMachine({ shadowedChildArm: true }),
      }),
    ).toContain(
      'state child: nested playbook onDone arm 1 is unsatisfiable under probing',
    );
  });

  it('reports an actual child input failure after preceding execution (verification-43)', async () => {
    expect(
      await checkFsmCoverage({
        machine: accumulatedChildMachine({ inputThrows: true }),
      }),
    ).toContain(
      'state child: nested playbook actor failed to start during onDone coverage: real reached child input failure',
    );
  });

  it('satisfies a first onError arm written for an authored failure terminal (verification-6, verification-11)', async () => {
    expect(
      await checkFsmCoverage({
        machine: nestedMultiArmMachine({ authoredFailureTerminalArm: true }),
      }),
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

  it('accepts a declared result selected by an ordered failure fallback', async () => {
    const machine = goodMachine({
      result: { failed: 'Work failed and reaches the failure state.' },
      onDone: [
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) => event.output.guard === 'ok',
        },
        needsBossReplyArm(),
        { target: '#failed' },
      ],
    });
    expect(await checkFsmCoverage({ machine })).toEqual([]);
  });

  it('detects a declared result with no accepting transition', async () => {
    const machine = goodMachine({
      result: { orphan: 'No onDone arm accepts this declared result.' },
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /result "orphan" has no reachable accepting transition/,
    );
  });

  it('drives script success and fallback failure with runtime exit statuses', async () => {
    const observed: Array<{ guard: string; exitStatus: number }> = [];
    expect(
      await checkFsmCoverage({ machine: scriptWorkflow({ observed }) }),
    ).toEqual([]);
    expect(observed).toEqual(
      expect.arrayContaining([
        { guard: 'zero', exitStatus: 0 },
        { guard: 'nonzero', exitStatus: 1 },
      ]),
    );
  });

  it.each([
    [
      'impossible success status',
      ({ event }: ScriptGuardArgs) =>
        event.output.guard === 'zero' && event.output.exitStatus === 1,
    ],
    [
      'invented script payload',
      ({ event }: ScriptGuardArgs) =>
        event.output.guard === 'zero' && event.output.invented === 'yes',
    ],
    [
      'undeclared result',
      ({ event }: ScriptGuardArgs) => event.output.guard === 'notDeclared',
    ],
  ])('rejects script guards requiring %s', async (_name, guard) => {
    expect(
      (await checkFsmCoverage({ machine: scriptWorkflow({ guard }) })).join(
        '\n',
      ),
    ).toMatch(/state ensureRepository: onDone arm 0 .* unsatisfiable/);
  });

  it('rejects missing script failure routes and shadowed success arms', async () => {
    expect(
      await checkFsmCoverage({
        machine: scriptWorkflow({ failureArm: false }),
      }),
    ).toContain(
      'state ensureRepository: result "nonzero" has no reachable accepting transition',
    );
    expect(
      (
        await checkFsmCoverage({
          machine: scriptWorkflow({ shadowSuccess: true }),
        })
      ).join('\n'),
    ).toMatch(/state ensureRepository: onDone arm 1 .* unsatisfiable/);
  });

  it('probes declared nonzero exit statuses from artifact candidates', async () => {
    expect(
      await checkFsmCoverage(
        { machine: scriptWorkflow({ specialFailureStatus: 42 }) },
        { sourceText: 'const specialFailureStatus = 42;' },
      ),
    ).toEqual([]);
  });

  it('covers an outcome reached by exit status two and drives that valid candidate', async () => {
    const observed: Array<{ guard: string; exitStatus: number }> = [];
    const machine = scriptWorkflow({
      failureArm: false,
      specialFailureStatus: 2,
      observed,
    });
    const actor = createActor(
      machine.provide({
        actors: {
          script: fromPromise(async () => ({
            guard: 'nonzero',
            exitStatus: 2,
          })) as never,
        },
      }),
    );
    try {
      actor.start();
      actor.send({ type: 'GO' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(actor.getSnapshot().value).toBe('failed');
    } finally {
      actor.stop();
    }
    observed.length = 0;
    expect(
      await checkFsmCoverage(
        { machine },
        { sourceText: 'const specialFailureStatus = 2;' },
      ),
    ).toEqual([]);
    expect(observed).toContainEqual({ guard: 'nonzero', exitStatus: 2 });
  });

  it('keeps arm-local status candidates beyond the shared eight-status budget', async () => {
    const machine = scriptWorkflow({
      failureArm: false,
      extraFailureStatuses: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
    const actor = createActor(
      machine.provide({
        actors: {
          script: fromPromise(async () => ({
            guard: 'nonzero',
            exitStatus: 11,
          })) as never,
        },
      }),
    );
    try {
      actor.start();
      actor.send({ type: 'GO' });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(actor.getSnapshot().value).toBe('failed');
    } finally {
      actor.stop();
    }
    expect(await checkFsmCoverage({ machine })).toEqual([]);
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

  it(
    'finds nothing on the reference machine',
    async () => {
      const sourceText = readFileSync(
        join(referenceDir, 'code.fsm.ts'),
        'utf8',
      );
      expect(await checkFsmCoverage(referenceFsm, { sourceText })).toEqual([]);
    },
    fsmCoverageTestTimeout(referenceFsm),
  );
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
  it('caps maintained DEV scheduling at five minutes while preserving smaller derived bounds', async () => {
    const fsm: unknown = await import(
      join(referenceDir, '../dev.playbook/dev.fsm.js')
    );
    expect(fsmCoverageTestTimeout(fsm)).toBe(300_000);
    expect(fsmCoverageTestTimeout({ machine: goodMachine() })).toBeLessThan(
      300_000,
    );
  });

  it('derives a timeout above the default from bounded checker work', () => {
    expect(
      fsmCoverageTestTimeout({ machine: dynamicCaptainMachine() }),
    ).toBeGreaterThan(5_000);
  });

  it('budgets both the direct-target and hub settle for controller results', () => {
    expect(fsmCoverageTestTimeout({ machine: controllerMachine() })).toBe(
      122_200,
    );
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  normalizeErrorCompact,
  validatePlaybookCallResult,
} from '@sublang/playbook/xstate-runtime';

import { describe, expect, it } from 'vitest';
import {
  assign,
  createActor,
  createMachine,
  fromCallback,
  fromPromise,
  raise,
  setup,
} from 'xstate';

import {
  checkFsmCoverage,
  FsmCoverageDeadlineError,
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
const devFsm: unknown = await import(
  join(referenceDir, '../dev.playbook/dev.fsm.js')
);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

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

const needsBossReplyArm = (
  workId = 'work',
  role?: string,
  sourceItem = 'X-1',
) => ({
  target: '#awaitBossReply',
  guard: ({ event }: any) =>
    event.output.guard === 'needsBossReply' &&
    typeof event.output.question === 'string',
  actions: assign({
    pendingBossQuestion: ({ event }: any) => ({
      resumeStateId: workId,
      sourceItem,
      ...(role === undefined
        ? { player: 'Writer' }
        : { questionId: workId, asker: { kind: 'role', roleId: role } }),
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

/** Approval/refusal require the actual canonical question/reply history. */
const questionResumedMachine = (
  opts: {
    wrongQuestion?: boolean;
    contradictory?: boolean;
    shadowed?: boolean;
    blankResumes?: boolean;
    escapesTarget?: boolean;
    entryPhase?: boolean;
    indirectWait?: boolean;
    observed?: Array<{
      guard: string;
      questionId: string;
      sourceItem: string;
      reply: string;
    }>;
  } = {},
) => {
  const replied = (context: any) =>
    context.pendingBossQuestion?.questionId === 'work' &&
    context.pendingBossQuestion.resumeStateId === 'work' &&
    typeof context.bossReply === 'string' &&
    context.bossReply.trim() !== '';
  const accepted =
    (key: string) =>
    ({ context, event }: any) =>
      replied(context) &&
      event.output.guard === key &&
      (!opts.contradictory || event.output.guard !== key);
  const ordinary = goodMachine();
  const states = ordinary.config.states as any;
  const question = needsBossReplyArm(
    'work',
    'writer',
    opts.wrongQuestion ? 'X-other' : 'X-1',
  );
  const approval = ['approved', 'refused'].map((key) => ({
    guard: accepted(key),
    target: opts.escapesTarget ? '#after' : '#done',
    actions: ({ context, event }: any) =>
      opts.observed?.push({
        guard: event.output.guard,
        questionId: context.pendingBossQuestion.questionId,
        sourceItem: context.pendingBossQuestion.sourceItem,
        reply: context.bossReply,
      }),
  }));
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('provide actor');
      }),
    },
  }).createMachine({
    ...ordinary.config,
    context: opts.entryPhase ? { phase: 'ready' } : ordinary.config.context,
    states: {
      ...states,
      after: {
        id: 'after',
        always: opts.indirectWait ? '#awaitBossReply' : '#failed',
      },
      work: {
        ...states.work,
        ...(opts.entryPhase ? { entry: assign({ phase: 'working' }) } : {}),
        invoke: {
          ...states.work.invoke,
          src: 'player',
          input: () => ({
            stateId: 'work',
            role: 'writer',
            sourceItem: 'X-1',
            prompt: 'Ask before choosing.',
            result: {
              approved: 'The choice is approved.',
              refused: 'The choice is refused.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            ...(opts.shadowed
              ? [{ guard: accepted('approved'), target: '#failed' }]
              : []),
            ...approval,
            {
              ...question,
              target: opts.indirectWait ? '#after' : question.target,
              guard: (args: any) =>
                (!opts.entryPhase || args.context.phase === 'working') &&
                question.guard(args),
            },
            { target: '#failed' },
          ],
        },
      },
      awaitBossReply: {
        ...states.awaitBossReply,
        on: {
          BOSS_REPLY: [
            {
              ...states.awaitBossReply.on.BOSS_REPLY[0],
              guard: ({ context, event }: any) =>
                context.pendingBossQuestion?.resumeStateId === 'work' &&
                typeof event.answer === 'string' &&
                (opts.blankResumes || event.answer.trim() !== ''),
            },
            states.awaitBossReply.on.BOSS_REPLY[1],
          ],
        },
      },
    },
  } as any);
};

/** Every counted answer comes from a real canonical wait/reply transition. */
const successiveQuestionMachine = (
  opts: {
    requiredReplies?: number;
    preemptive?: boolean;
    branchingPrefix?: boolean;
    malformedLaterQuestion?: boolean;
    blankResumes?: boolean;
    observed?: Array<{ guard: string; replies: any[]; prefixRoute?: string }>;
  } = {},
) => {
  const base = questionResumedMachine({ blankResumes: opts.blankResumes });
  const states = base.config.states as any;
  const work = states.work;
  const repliesRequired = opts.requiredReplies ?? 2;
  const questionArm = work.invoke.onDone[2];
  const prefix: Record<string, any> = {};
  if (opts.branchingPrefix) {
    for (let index = 0; index < 4; index++) {
      const id = `prefix${index}`;
      prefix[id] = {
        id,
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: id,
            playbookId: 'child',
            text: 'Choose a route.',
          }),
          onDone: ['left', 'right'].map((route) => ({
            guard:
              route === 'left'
                ? ({ event }: any) =>
                    Object.keys(event.output).length === 1 &&
                    event.output.guard === 'left'
                : ({ event }: any) =>
                    Object.keys(event.output).length === 1 &&
                    event.output.guard === 'right',
            target: index === 3 ? '#work' : `#prefix${index + 1}`,
            actions: assign(({ context }: any) => ({
              route: `${context.route ?? ''}/${route}`,
            })),
          })),
          onError: '#failed',
        },
      };
    }
  }
  return setup({
    actors: {
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
      player: fromPromise(async () => {
        throw new Error('provide actor');
      }),
    },
  }).createMachine({
    ...base.config,
    on: opts.preemptive ? base.config.on : {},
    context: { replyHistory: [] } as any,
    states: {
      ...states,
      ...prefix,
      ready: opts.branchingPrefix
        ? { id: 'ready', on: { GO: '#prefix0' } }
        : states.ready,
      work: {
        ...work,
        invoke: {
          ...work.invoke,
          onDone: [
            ...['approved', 'refused'].map((guard, index) => ({
              ...work.invoke.onDone[index],
              guard: (args: any) =>
                Array.isArray(args.context.replyHistory) &&
                args.context.replyHistory.length === repliesRequired &&
                args.context.replyHistory.every(
                  (reply: any) =>
                    reply.questionId === 'work' &&
                    reply.resumeStateId === 'work' &&
                    reply.sourceItem === 'X-1' &&
                    reply.asker?.kind === 'role' &&
                    reply.asker.roleId === 'writer' &&
                    typeof reply.question === 'string' &&
                    typeof reply.answer === 'string' &&
                    reply.answer.trim() !== '',
                ) &&
                work.invoke.onDone[index].guard(args),
              actions: ({ context }: any) =>
                opts.observed?.push({
                  guard,
                  prefixRoute: context.route,
                  replies: context.replyHistory.map((reply: any) => ({
                    ...reply,
                    asker: { ...reply.asker },
                  })),
                }),
            })),
            {
              ...questionArm,
              actions: assign(({ context, event }: any) => ({
                pendingBossQuestion: {
                  questionId: 'work',
                  resumeStateId: 'work',
                  sourceItem:
                    opts.malformedLaterQuestion &&
                    context.replyHistory.length > 0
                      ? 'X-other'
                      : 'X-1',
                  asker: { kind: 'role', roleId: 'writer' },
                  question: event.output.question,
                },
                bossReply: undefined,
              })),
            },
            work.invoke.onDone[3],
          ],
        },
      },
      awaitBossReply: {
        ...states.awaitBossReply,
        on: {
          BOSS_REPLY: [
            {
              ...states.awaitBossReply.on.BOSS_REPLY[0],
              guard: (args: any) =>
                args.event.questionId === 'work' &&
                states.awaitBossReply.on.BOSS_REPLY[0].guard(args),
              actions: assign(({ context, event }: any) => ({
                bossReply: event.answer,
                replyHistory: [
                  ...context.replyHistory,
                  { ...context.pendingBossQuestion, answer: event.answer },
                ],
              })),
            },
            states.awaitBossReply.on.BOSS_REPLY[1],
          ],
        },
      },
    },
  } as any);
};

/** A discovered target competes with actual entry variants and question paths. */
const queuedTargetSuccessorMachine = (
  opts: {
    requireRight?: boolean;
    prefixLength?: number;
    shadowed?: boolean;
    escapesTarget?: boolean;
    observed?: Array<{ route: string; reply: string; guard: string }>;
  } = {},
) => {
  const base = questionResumedMachine();
  const states = base.config.states as any;
  const prefix: Record<string, any> = {};
  const prefixLength = opts.prefixLength ?? 4;
  for (let index = 0; index < prefixLength; index++) {
    const id = `prefix${index}`;
    prefix[id] = {
      id,
      invoke: {
        src: 'playbook',
        input: () => ({
          stateId: id,
          playbookId: 'child',
          text: 'Choose a route.',
        }),
        onDone: ['left', 'right'].map((route) => ({
          guard:
            route === 'left'
              ? ({ event }: any) =>
                  Object.keys(event.output).length === 1 &&
                  event.output.guard === 'left'
              : ({ event }: any) =>
                  Object.keys(event.output).length === 1 &&
                  event.output.guard === 'right',
          target: index === prefixLength - 1 ? '#work' : `#prefix${index + 1}`,
          actions: assign(({ context }: any) => ({
            route: `${context.route}/${route}`,
          })),
        })),
        onError: '#failed',
      },
    };
  }
  const question = needsBossReplyArm('audit', 'writer', 'X-audit');
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('provide actor');
      }),
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
    },
  }).createMachine({
    id: 'queued-target',
    initial: 'ready',
    context: { route: '' } as any,
    on: {
      BOSS_INTERRUPT: {
        target: '#prefix0',
        reenter: true,
        guard: ({ event }: any) => event.targetId === 'prefix0',
      },
    },
    states: {
      ...states,
      ...prefix,
      ready: {
        id: 'ready',
        on: {
          GO: {
            target: '#prefix0',
            guard: ({ event }: any) =>
              typeof event.label === 'string' && event.label.trim() !== '',
            actions: assign({ label: ({ event }: any) => event.label }),
          },
        },
      },
      work: {
        ...states.work,
        invoke: {
          ...states.work.invoke,
          onDone: [
            ...(opts.shadowed
              ? states.work.invoke.onDone
                  .slice(0, 2)
                  .map((arm: any) => ({ ...arm, target: '#failed' }))
              : []),
            ...states.work.invoke.onDone.slice(0, 2).map((arm: any) => ({
              ...arm,
              target: '#audit',
              actions: assign(({ context, event }: any) => ({
                approvalReply: context.bossReply,
                approvedGuard: event.output.guard,
              })),
            })),
            ...states.work.invoke.onDone.slice(2),
          ],
        },
      },
      audit: {
        id: 'audit',
        ...(opts.escapesTarget ? { always: '#failed' } : {}),
        invoke: {
          src: 'player',
          input: ({ context }: any) => ({
            stateId: 'audit',
            role: 'writer',
            sourceItem: 'X-audit',
            prompt: 'Audit the selected route.',
            result: {
              ok: 'The route is audited.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
          onDone: [
            {
              target: '#done',
              guard: ({ context, event }: any) =>
                event.output.guard === 'ok' &&
                (!opts.requireRight || context.route.endsWith('/right')),
              actions: ({ context }: any) =>
                opts.observed?.push({
                  route: context.route,
                  reply: context.approvalReply,
                  guard: context.approvedGuard,
                }),
            },
            question,
          ],
          onError: '#failed',
        },
      },
      awaitBossReply: {
        ...states.awaitBossReply,
        on: {
          BOSS_REPLY: [
            {
              target: '#audit',
              reenter: true,
              guard: ({ context, event }: any) =>
                context.pendingBossQuestion?.questionId === 'audit' &&
                event.questionId === 'audit' &&
                typeof event.answer === 'string' &&
                event.answer.trim() !== '',
              actions: assign({ bossReply: ({ event }: any) => event.answer }),
            },
            ...states.awaitBossReply.on.BOSS_REPLY,
          ],
        },
      },
    },
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

/** A host-owned catalog gates a declared literal child through real input. */
const catalogLiteralChildMachine = (
  inputForm: 'function' | 'object',
  requiredTarget = 'configured-child',
) => {
  const ordinary = goodMachine();
  const states = ordinary.config.states as any;
  const routedWork = {
    ...states.work,
    invoke: {
      ...states.work.invoke,
      onDone: [
        {
          target: '#callChild',
          guard: ({ context, event }: any) =>
            event.output.guard === 'ok' &&
            context.enabledPlaybooks.some(
              (entry: { id: string }) => entry.id === requiredTarget,
            ) &&
            context.initializedCatalogIds.includes(requiredTarget),
        },
        needsBossReplyArm(),
      ],
    },
  };
  const childInput = {
    stateId: 'callChild',
    playbookId: 'configured-child',
    text: 'Complete the configured child request.',
  };
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('coverage must provide captain');
      }),
      playbook: fromPromise(async () => {
        throw new Error('coverage must provide child');
      }),
    },
  }).createMachine({
    ...ordinary.config,
    context: ({ input }: any) => {
      if (!Array.isArray(input?.enabledPlaybooks)) {
        throw new Error('host catalog is required');
      }
      return {
        enabledPlaybooks: input.enabledPlaybooks,
        initializedCatalogIds: input.enabledPlaybooks.map(
          (entry: { id: string }) => entry.id,
        ),
      };
    },
    states: {
      ...ordinary.config.states,
      work: routedWork,
      callChild: {
        id: 'callChild',
        invoke: {
          src: 'playbook',
          input: inputForm === 'function' ? () => childInput : childInput,
          onDone: { target: '#done' },
          onError: { target: '#failed' },
        },
      },
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

const authoredAbortedChildGuard = (
  { event }: any,
  target = 'child',
  session?: string,
): boolean => {
  if (!(event.error instanceof Error)) return false;
  try {
    return (
      validatePlaybookCallResult(event.error.result, target, session).status ===
      'aborted'
    );
  } catch {
    return false;
  }
};

const nestedMultiArmMachine = (
  opts: {
    deadDoneArm?: boolean;
    deadErrorArm?: boolean;
    authoredFailureTerminalArm?: boolean;
    authoredAbortArm?: boolean;
    wrongAbortTarget?: boolean;
    requireAbortSession?: boolean;
    shadowedAbortArm?: boolean;
    onAbortError?: (error: unknown) => void;
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
            ...(opts.shadowedAbortArm
              ? [
                  {
                    target: '#errorFallback',
                    guard: authoredAbortedChildGuard,
                  },
                ]
              : []),
            {
              target: '#errorFirst',
              guard:
                opts.authoredAbortArm === true
                  ? (args: any) =>
                      authoredAbortedChildGuard(
                        args,
                        opts.wrongAbortTarget ? 'other-child' : 'child',
                        opts.requireAbortSession
                          ? 'required-child-session'
                          : undefined,
                      )
                  : opts.authoredFailureTerminalArm === true
                    ? authoredFailureTerminalGuard
                    : ({ event }: any) =>
                        event.error.name === 'RetryableChildError',
              ...(opts.onAbortError === undefined
                ? {}
                : {
                    actions: ({ event }: any) =>
                      opts.onAbortError?.(event.error),
                  }),
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
            needsBossReplyArm('work', 'writer', 'FLOW-1'),
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

type ChildChainPrEvidence = {
  variant: unknown;
  entryType: unknown;
  mode: unknown;
  branches: number;
  codeRevision: unknown;
  decisionRevision: unknown;
};

/** Non-preemptive planning plus a DEV-like branch/decision/code/PR chain. */
const childChainMachine = (
  opts: {
    deadDecision?: boolean;
    repeatBranch?: boolean;
    blankResumes?: boolean;
    entryVariants?: {
      preemptive?: boolean;
      modes?: readonly string[];
      rejectAlternate?: boolean;
      shadowAlternate?: boolean;
      requireProof?: boolean;
      observed?: Array<{ id: string; variant: unknown; entryType: unknown }>;
      observedPr?: ChildChainPrEvidence[];
    };
  } = {},
) => {
  const entryModes = opts.entryVariants?.modes ?? ['primary', 'alternate'];
  const alternate = entryModes.at(-1);
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
        opts.entryVariants?.observed?.push({
          id,
          variant: context.entryVariant,
          entryType: context.entryType,
        });
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
    context: {
      branches: 0,
      ...(opts.entryVariants?.preemptive
        ? { entryVariant: entryModes[0] }
        : {}),
    } as any,
    ...(opts.entryVariants?.preemptive
      ? {
          on: {
            BOSS_INTERRUPT: {
              guard: ({ event }: any) => event.targetId === 'plan',
              target: '#plan',
              actions: assign(({ event }: any) => ({ entryType: event.type })),
            },
          },
        }
      : {}),
    states: {
      ready: {
        id: 'ready',
        on: {
          START: opts.entryVariants
            ? [
                ...(opts.entryVariants.shadowAlternate
                  ? [
                      {
                        guard: ({ event }: any) => event.variant === alternate,
                        target: 'failed',
                      },
                    ]
                  : []),
                {
                  guard: ({ event }: any) =>
                    typeof event.request === 'string' &&
                    event.request.trim() !== '' &&
                    entryModes.includes(event.variant) &&
                    (!opts.entryVariants?.rejectAlternate ||
                      event.variant !== alternate),
                  target: 'plan',
                  actions: assign(({ event }: any) => ({
                    entryVariant: event.variant,
                    entryType: event.type,
                  })),
                },
              ]
            : { target: 'plan' },
        },
      },
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
              guard: ({ context, event }: any) =>
                event.output.guard === key &&
                (opts.entryVariants === undefined ||
                  (['branch', 'both'].includes(key)
                    ? context.entryVariant === alternate &&
                      (!opts.entryVariants.requireProof ||
                        context.entryProof === true)
                    : context.entryVariant !== alternate)),
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
                  questionId: 'plan',
                  resumeStateId: 'plan',
                  sourceItem: 'CHAIN-1',
                  asker: { kind: 'role', roleId: 'planner' },
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
      pr: child(
        'pr',
        [
          {
            target: 'done',
            actions: ({ context }: any) =>
              opts.entryVariants?.observedPr?.push({
                variant: context.entryVariant,
                entryType: context.entryType,
                mode: context.mode,
                branches: context.branches,
                codeRevision: context.codeRevision,
                decisionRevision: context.decisionRevision,
              }),
          },
        ],
        (context) => {
          if (context.branches < 1 || typeof context.codeRevision !== 'string')
            throw new Error('branch and code must execute');
        },
      ),
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

/** A valid interrupt and a public entry establish different real routes. */
const publicAfterInterruptMachine = (
  opts: {
    rejectAlternate?: boolean;
    shadowAlternate?: boolean;
    requireProof?: boolean;
  } = {},
  observed: Array<{ id: string; route: unknown; entryType: unknown }> = [],
) => {
  const child = (id: string) => ({
    id,
    invoke: {
      src: 'playbook',
      input: ({ context }: any) => {
        if (!['BOSS_INTERRUPT', 'START'].includes(context.entryType))
          throw new Error('entry actions must execute');
        observed.push({
          id,
          route: context.route,
          entryType: context.entryType,
        });
        return { stateId: id, playbookId: 'review', text: 'Review.' };
      },
      onDone: 'done',
      onError: 'failed',
    },
  });
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
    id: 'publicAfterInterrupt',
    initial: 'ready',
    context: { route: 'interrupt', proof: false } as any,
    on: {
      BOSS_INTERRUPT: {
        guard: ({ event }: any) => event.targetId === 'prepare',
        target: '#prepare',
        actions: assign(({ event }: any) => ({ entryType: event.type })),
      },
    },
    states: {
      ready: {
        id: 'ready',
        on: {
          START: [
            ...(opts.shadowAlternate
              ? [
                  {
                    guard: ({ event }: any) => event.mode === 'public',
                    target: 'failed',
                  },
                ]
              : []),
            {
              guard: ({ event }: any) =>
                opts.rejectAlternate !== true &&
                typeof event.request === 'string' &&
                event.request !== '' &&
                event.mode === 'public',
              target: 'prepare',
              actions: assign(({ event }: any) => ({
                route: event.mode,
                entryType: event.type,
                proof: opts.requireProof !== true,
              })),
            },
          ],
        },
      },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'prepare',
            sourceItem: 'ENTRY-1',
            role: 'writer',
            prompt: 'Prepare the route.',
            result: {
              ready: 'Advance.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            {
              guard: ({ context, event }: any) =>
                context.route === 'interrupt' && event.output.guard === 'ready',
              target: 'ordinaryChild',
            },
            {
              guard: ({ context, event }: any) =>
                context.route === 'public' &&
                context.proof === true &&
                event.output.guard === 'ready',
              target: 'alternateChild',
            },
            needsBossReplyArm('prepare', 'writer', 'ENTRY-1'),
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      ordinaryChild: child('ordinaryChild'),
      alternateChild: child('alternateChild'),
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: {
            target: 'prepare',
            guard: ({ context, event }: any) =>
              context.pendingBossQuestion?.questionId === 'prepare' &&
              event.questionId === 'prepare' &&
              typeof event.answer === 'string' &&
              event.answer.trim() !== '',
          },
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);
};

/** A valid direct-actor diagnostic must not hide an undrivable child prefix. */
const legacyPredecessorEntryMachine = (
  opts: {
    falseGuard?: boolean;
    shadowed?: boolean;
    falseContext?: boolean;
    wrongQuestion?: boolean;
  } = {},
  observed: Array<{ state: string; entryType: unknown }> = [],
) => {
  const ready = (
    id: string,
    sourceItem: string,
    result: Record<string, string>,
  ) => ({
    stateId: id,
    sourceItem,
    role: 'writer',
    prompt: 'Synthetic task.',
    result,
  });
  const accepted = ({ context, event }: any) =>
    opts.falseGuard !== true &&
    context.planned === true &&
    context.policy.allowed === true &&
    context.pendingBossQuestion?.questionId === 'approval' &&
    typeof context.bossReply === 'string' &&
    context.bossReply.trim() !== '' &&
    event.output.guard === 'approved';
  const question = needsBossReplyArm('approval', 'writer', 'FLOW-2');
  if (opts.wrongQuestion)
    question.actions = assign({
      pendingBossQuestion: () => ({
        questionId: 'other',
        resumeStateId: 'approval',
        sourceItem: 'FLOW-2',
        asker: { kind: 'role', roleId: 'writer' },
        question: 'Wrong identity?',
      }),
    } as any);
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
    id: 'legacyPredecessorEntry',
    initial: 'ready',
    context: {
      planned: false,
      entryType: '',
      policy: { allowed: opts.falseContext !== true },
    } as any,
    on: {
      BOSS_INTERRUPT: {
        target: '#approval',
        guard: ({ context, event }: any) =>
          event.targetId === 'approval' && context.planned === true,
        actions: assign(() => ({
          planned: false,
          entryType: 'BOSS_INTERRUPT',
        })),
      },
    },
    states: {
      ready: {
        id: 'ready',
        on: {
          START: {
            target: 'prepare',
            guard: ({ event }: any) => event.mode === 'fresh',
            actions: assign(({ event }: any) => ({
              planned: false,
              entryType: event.type,
            })),
          },
        },
      },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () =>
            ready('prepare', 'FLOW-1', {
              ready: 'Proceed.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            }),
          onDone: [
            {
              guard: ({ event }: any) => event.output.guard === 'ready',
              target: 'planning',
            },
            needsBossReplyArm('prepare', 'writer', 'FLOW-1'),
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      planning: {
        id: 'planning',
        invoke: {
          src: 'playbook',
          input: ({ context }: any) => {
            observed.push({ state: 'planning', entryType: context.entryType });
            return { stateId: 'planning', playbookId: 'plan', text: 'Plan.' };
          },
          onDone: {
            target: 'approval',
            guard: ({ event }: any) => event.output !== null,
            actions: assign(() => ({ planned: true })),
          },
          onError: 'failed',
        },
      },
      approval: {
        id: 'approval',
        invoke: {
          src: 'player',
          input: ({ context }: any) => {
            observed.push({ state: 'approval', entryType: context.entryType });
            return {
              ...ready('approval', 'FLOW-2', {
                approved: 'Approve.',
                refused: 'Refuse.',
                needsBossReply: NEEDS_BOSS_REPLY_TEXT,
              }),
              ...(context.pendingBossQuestion
                ? { pendingBossQuestion: context.pendingBossQuestion }
                : {}),
              ...(context.bossReply === undefined
                ? {}
                : { bossReply: context.bossReply }),
            };
          },
          onDone: [
            ...(opts.shadowed ? [{ guard: accepted, target: 'failed' }] : []),
            { guard: accepted, target: 'done' },
            {
              guard: ({ context, event }: any) =>
                context.planned === true &&
                context.policy.allowed === true &&
                typeof context.bossReply === 'string' &&
                context.bossReply.trim() !== '' &&
                event.output.guard === 'refused',
              target: 'refused',
            },
            question,
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: ['prepare', 'approval'].map((id) => ({
            target: id,
            guard: ({ context, event }: any) =>
              context.planned === (id === 'approval') &&
              context.pendingBossQuestion?.questionId === id &&
              event.questionId === id &&
              typeof event.answer === 'string' &&
              event.answer.trim() !== '',
            actions: assign(({ event }: any) => ({ bossReply: event.answer })),
          })),
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
      refused: { id: 'refused', type: 'final' },
    },
  } as any);
};

/** Public entry reads own data without changing what a descriptor returns. */
const descriptorEntryMachine = (
  opts: {
    inheritedOnly?: boolean;
    falseGuard?: boolean;
    shadowed?: boolean;
    requireProof?: boolean;
    wrongAttribute?: boolean;
    fifthField?: boolean;
  } = {},
  observed: Array<{ id: string; route: unknown; entryType: unknown }> = [],
  missingDescriptors: string[] = [],
) => {
  const base = publicAfterInterruptMachine(
    { requireProof: opts.requireProof },
    observed,
  );
  const data = (event: object, field: string): unknown => {
    const descriptor = Object.getOwnPropertyDescriptor(event, field);
    if (descriptor === undefined) missingDescriptors.push(field);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const publicGuard = ({ event }: any) => {
    const request = opts.inheritedOnly
      ? Object.hasOwn(event, 'request')
        ? undefined
        : event.request
      : data(event, 'request');
    return (
      typeof request === 'string' &&
      request.trim() !== '' &&
      data(event, 'mode') === 'public' &&
      (!opts.wrongAttribute ||
        Object.getOwnPropertyDescriptor(event, 'request')?.configurable ===
          false) &&
      (!opts.fifthField ||
        ['first', 'second', 'third'].every(
          (field) => data(event, field) === 'allow',
        )) &&
      opts.falseGuard !== true
    );
  };
  const config = base.config as any;
  const start = config.states.ready.on.START.at(-1);
  const interrupt = config.on.BOSS_INTERRUPT;
  return createMachine(
    {
      ...config,
      on: {
        ...config.on,
        BOSS_INTERRUPT: {
          ...interrupt,
          guard: (args: any) =>
            interrupt.guard(args) && data(args.event, 'permit') === 'allow',
        },
      },
      states: {
        ...config.states,
        ready: {
          ...config.states.ready,
          on: {
            START: [
              ...(opts.shadowed
                ? [
                    {
                      guard: ({ event }: any) => event.mode === 'public',
                      target: 'failed',
                    },
                  ]
                : []),
              { ...start, guard: publicGuard },
            ],
          },
        },
      },
    } as any,
    base.implementations as any,
  );
};

/** An actual predecessor supplies a value absent from the artifact literals. */
const reachedPrimitiveChildMachine = (
  opts: {
    value?: 'string' | 'boolean' | 'number';
    contradictory?: boolean;
    shadowed?: boolean;
    nested?: boolean;
    fifthRead?: boolean;
  } = {},
) => {
  const expected = (context: any) =>
    opts.nested ? context.expected.revision : context.expected;
  const accepted = ({ context, event }: any) => {
    if (
      opts.fifthRead &&
      ![context.first, context.second, context.third, context.fourth].every(
        (value) => typeof value === 'string',
      )
    )
      return false;
    return (
      event.output.approved === true &&
      event.output.revision === expected(context) &&
      (!opts.contradictory || event.output.revision !== expected(context))
    );
  };
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('provide predecessor');
      }),
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
    },
  }).createMachine({
    id: 'reachedPrimitiveChild',
    context: {},
    initial: 'ready',
    states: {
      ready: { id: 'ready', on: { START: 'prepare' } },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'prepare',
            role: 'writer',
            sourceItem: 'FLOW-1',
            prompt: 'Prepare a revision.',
            result: {
              prepared: 'Output shall include `revision`.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            {
              guard: ({ event }: any) => event.output.guard === 'prepared',
              target: 'child',
              actions: assign(({ event }: any) => {
                const primitive =
                  opts.value === 'boolean'
                    ? false
                    : opts.value === 'number'
                      ? 42
                      : event.output.revision;
                return {
                  expected: opts.nested ? { revision: primitive } : primitive,
                  first: `${event.output.revision}:first`,
                  second: `${event.output.revision}:second`,
                  third: `${event.output.revision}:third`,
                  fourth: `${event.output.revision}:fourth`,
                };
              }),
            },
            needsBossReplyArm('prepare', 'writer', 'FLOW-1'),
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'child',
            playbookId: 'review',
            text: 'Review the prepared revision.',
          }),
          onDone: [
            ...(opts.shadowed ? [{ guard: accepted, target: 'done' }] : []),
            { guard: accepted, target: 'done' },
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: {
            guard: ({ event }: any) =>
              typeof event.answer === 'string' && event.answer.trim() !== '',
            target: 'prepare',
          },
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);
};

/** A complete declared output needs only a few reached-value overrides. */
const declaredReachedValueMachine = (
  opts: {
    overrides?: number;
    contradictory?: boolean;
    shadowed?: boolean;
    falseContext?: boolean;
    nested?: boolean;
    accessor?: boolean;
  } = {},
  observed: Array<Record<string, unknown>> = [],
) => {
  const fields = ['product', 'verified', 'record', 'archive', 'report'];
  const expected = (context: any) =>
    opts.nested ? context.expected.value : context.expected;
  const accepted = ({ context, event }: any) => {
    const output = event.output;
    return (
      context.ready === true &&
      output.guard === 'delivered' &&
      Object.keys(output).length === fields.length + 1 &&
      fields.every(
        (field) =>
          Object.hasOwn(output, field) &&
          typeof output[field] === 'string' &&
          output[field].length > 0,
      ) &&
      fields
        .slice(0, opts.overrides ?? 1)
        .every((field) => output[field] === expected(context)) &&
      (!opts.contradictory || output.product !== expected(context))
    );
  };
  return setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('provide acting result');
      }),
    },
  }).createMachine({
    id: 'declaredReachedValue',
    initial: 'ready',
    context: { ready: false },
    states: {
      ready: { id: 'ready', on: { START: 'prepare' } },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'prepare',
            sourceItem: 'FLOW-1',
            role: 'writer',
            prompt: 'Prepare the revision.',
            result: {
              prepared: 'Output shall include `revision`.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            {
              guard: ({ event }: any) => event.output.guard === 'prepared',
              target: 'work',
              actions: assign(({ event }: any) => ({
                ready: !opts.falseContext,
                expected: opts.nested
                  ? { value: event.output.revision }
                  : event.output.revision,
              })),
            },
            needsBossReplyArm('prepare', 'writer', 'FLOW-1'),
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      work: {
        id: 'work',
        ...(opts.accessor
          ? {
              entry: ({ context }: any) => {
                const actual = context.expected;
                Object.defineProperty(context, 'expected', {
                  get: () => actual,
                  enumerable: true,
                  configurable: true,
                });
              },
            }
          : {}),
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'work',
            sourceItem: 'FLOW-2',
            role: 'writer',
            prompt: 'Deliver the verified revision.',
            result: {
              delivered:
                'Output shall include `product`, `verified`, `record`, `archive`, and `report`.',
              needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            },
          }),
          onDone: [
            ...(opts.shadowed ? [{ guard: accepted, target: 'done' }] : []),
            {
              guard: accepted,
              target: 'done',
              actions: ({ context, event }: any) => {
                observed.push({
                  ...event.output,
                  reachedExpected: context.expected,
                  reachedReady: context.ready,
                });
              },
            },
            needsBossReplyArm('work', 'writer', 'FLOW-2'),
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: ['prepare', 'work'].map((id) => ({
            guard: ({ context, event }: any) =>
              context.pendingBossQuestion?.questionId === id &&
              event.questionId === id &&
              typeof event.answer === 'string' &&
              event.answer.trim() !== '',
            target: id,
          })),
        },
      },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);
};

interface ChildFailureOptions {
  expected: boolean;
  optional?: boolean;
  requireError?: boolean;
  errorShape?: (value: any) => boolean;
  onErrorAccepted?: (error: unknown) => void;
}

/** Raw child success validates cardinality before reading named fields. */
const childFailureShape = (
  value: any,
  opts: ChildFailureOptions,
  wrongCount = false,
) => {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === 'string' &&
        descriptor?.enumerable &&
        'value' in descriptor
      );
    })
  )
    return false;
  const fields = [
    'lastCommit',
    'clean',
    'status',
    ...(opts.optional && Object.hasOwn(value, 'error') ? ['error'] : []),
  ];
  return (
    Object.keys(value).length === fields.length - (wrongCount ? 1 : 0) &&
    fields.every((key) => Object.hasOwn(value, key)) &&
    typeof value.lastCommit === 'string' &&
    value.clean === opts.expected &&
    value.status === 'aborted' &&
    (!opts.optional ||
      ((!opts.requireError || Object.hasOwn(value, 'error')) &&
        (!Object.hasOwn(value, 'error') ||
          (opts.errorShape !== undefined
            ? opts.errorShape(value.error)
            : value.error !== null &&
              typeof value.error === 'object' &&
              typeof value.error.name === 'string' &&
              typeof value.error.message === 'string'))))
  );
};

const enumeratedChildOutputMachine = (
  fields: 3 | 4,
  opts: {
    countLast?: boolean;
    wrongCount?: boolean;
    shadowed?: boolean;
    jsonDescriptors?: boolean;
    literalRevision?: boolean;
    needsFifth?: boolean;
    nativeSeed?: boolean;
    disjointPrior?: boolean;
    priorOwnFieldsFirst?: boolean;
    fixedContextReads?: boolean;
    blockEntry?: boolean;
    childFailure?: ChildFailureOptions;
  } = {},
) => {
  const namedFields = (value: any) =>
    typeof value.revision === 'string' &&
    value.revision.trim() !== '' &&
    (!opts.literalRevision || value.revision === 'accepted') &&
    value.approved === true &&
    typeof value.summary === 'string' &&
    value.summary.trim() !== '' &&
    (fields === 3 || value.accepted === true) &&
    (!opts.needsFifth || value.extra === true);
  const count = (value: any) =>
    Object.keys(value).length ===
      (opts.wrongCount ? fields - 1 : fields + (opts.needsFifth ? 1 : 0)) &&
    (!opts.jsonDescriptors ||
      [
        'revision',
        'approved',
        'summary',
        ...(fields === 4 ? ['accepted'] : []),
        ...(opts.needsFifth ? ['extra'] : []),
      ].every((key) => Object.hasOwn(value, key)));
  const jsonRecord = (value: any) =>
    !opts.jsonDescriptors ||
    (Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return (
          typeof key === 'string' &&
          descriptor?.enumerable &&
          'value' in descriptor &&
          (descriptor.value === null ||
            ['string', 'boolean'].includes(typeof descriptor.value))
        );
      }));
  const nativeEnvelope = (value: any) => {
    if (
      value === null ||
      typeof value !== 'object' ||
      !Reflect.ownKeys(value).every(
        (key) =>
          typeof key === 'string' &&
          Object.getOwnPropertyDescriptor(value, key)?.enumerable,
      )
    )
      return false;
    const keys = [
      'outcome',
      'state',
      'output',
      'response',
      ...(Object.hasOwn(value, 'error') ? ['error'] : []),
    ];
    return (
      Object.keys(value).length === keys.length - (opts.wrongCount ? 1 : 0) &&
      keys.every((key) => Object.hasOwn(value, key)) &&
      value.outcome === 'terminal' &&
      value.state !== null &&
      typeof value.state === 'object' &&
      typeof value.response === 'string' &&
      (!Object.hasOwn(value, 'error') ||
        (value.error !== null &&
          typeof value.error === 'object' &&
          typeof value.error.name === 'string' &&
          typeof value.error.message === 'string'))
    );
  };
  const approved = ({ context, event }: any) => {
    if (
      opts.fixedContextReads &&
      (context.entryReady !== true ||
        context.lastError !== undefined ||
        context.terminal !== undefined)
    )
      return false;
    return opts.childFailure !== undefined
      ? childFailureShape(event.output, opts.childFailure, opts.wrongCount)
      : opts.nativeSeed
        ? nativeEnvelope(event.output)
        : jsonRecord(event.output) &&
          (opts.countLast
            ? namedFields(event.output) && count(event.output)
            : count(event.output) && namedFields(event.output));
  };
  return setup({
    actors: {
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
    },
  }).createMachine({
    id: 'enumeratedChildOutput',
    initial: 'ready',
    ...(opts.fixedContextReads ? { context: { entryReady: false } } : {}),
    on: {
      BOSS_INTERRUPT: {
        target: '#ready',
        guard: ({ event }: any) => event.targetId === 'ready',
      },
    },
    states: {
      ready: {
        id: 'ready',
        on: {
          START: opts.fixedContextReads
            ? {
                target: 'child',
                actions: assign({ entryReady: !opts.blockEntry }),
              }
            : 'child',
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'child',
            playbookId: 'review',
            text: 'Review.',
          }),
          onDone: [
            ...(opts.disjointPrior
              ? [
                  {
                    guard: ({ event }: any) => {
                      const value = event.output;
                      return (
                        value !== null &&
                        typeof value === 'object' &&
                        (opts.priorOwnFieldsFirst
                          ? ['firstCommit', 'reviewRevision', 'clean'].every(
                              (key) => Object.hasOwn(value, key),
                            ) && Object.keys(value).length === 3
                          : Object.keys(value).length === 3 &&
                            ['firstCommit', 'reviewRevision', 'clean'].every(
                              (key) => Object.hasOwn(value, key),
                            )) &&
                        typeof value.firstCommit === 'string' &&
                        typeof value.reviewRevision === 'string' &&
                        value.clean === true
                      );
                    },
                    target: 'done',
                  },
                ]
              : []),
            ...(opts.shadowed ? [{ guard: approved, target: 'done' }] : []),
            {
              guard: approved,
              target: 'done',
              ...(opts.childFailure?.onErrorAccepted === undefined
                ? {}
                : {
                    actions: ({ event }: any) =>
                      opts.childFailure?.onErrorAccepted?.(event.output.error),
                  }),
            },
            { target: 'failed' },
          ],
          onError: { target: 'failed' },
        },
      },
      awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);
};

/** Descriptor values stay concrete while reached child output varies. */
const descriptorChildValueMachine = (
  opts: {
    blockEntry?: boolean;
    shadowed?: boolean;
    accessorOnly?: boolean;
    inheritedOnly?: boolean;
    mixedReads?: boolean;
  } = {},
  observed: unknown[] = [],
) => {
  const config = enumeratedChildOutputMachine(3, {
    fixedContextReads: true,
    blockEntry: opts.blockEntry,
  }).config as any;
  const read = (value: object, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  };
  const accepted = ({ context, event }: any) => {
    const value = event.output;
    return (
      context.entryReady === true &&
      value !== null &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Object.keys(value).length === 3 &&
      (!opts.accessorOnly ||
        typeof Object.getOwnPropertyDescriptor(value, 'approved')?.get ===
          'function') &&
      (!opts.inheritedOnly || !Object.hasOwn(value, 'approved')) &&
      typeof (opts.mixedReads ? value.revision : read(value, 'revision')) ===
        'string' &&
      (opts.mixedReads ? value.revision : read(value, 'revision')).trim() !==
        '' &&
      read(value, 'approved') === false &&
      typeof read(value, 'summary') === 'string' &&
      read(value, 'summary').trim() !== ''
    );
  };
  config.states.child.invoke.onDone = [
    ...(opts.shadowed ? [{ guard: accepted, target: 'done' }] : []),
    {
      guard: accepted,
      target: 'done',
      actions: ({ event }: any) => observed.push(event.output),
    },
    { target: 'failed' },
  ];
  return setup({
    actors: { playbook: fromPromise(async () => ({})) },
  }).createMachine(config);
};

/** No output is a resolved child value, not the pending-script sentinel. */
const absentChildOutputMachine = (
  opts: {
    shadowed?: boolean;
    blockEntry?: boolean;
    expected?: 'null' | 'error';
  } = {},
  observed: unknown[] = [],
) => {
  const accepted = ({ context, event }: any) =>
    context.entryReady === true &&
    (opts.expected === 'null'
      ? event.output === null
      : opts.expected === 'error'
        ? event.output instanceof Error
        : event.output === undefined);
  return setup({
    actors: { playbook: fromPromise(async () => ({})) },
  }).createMachine({
    id: 'absentChildOutput',
    initial: 'ready',
    context: { entryReady: false, absentReached: false },
    on: {
      BOSS_INTERRUPT: {
        target: '#ready',
        guard: ({ event }: any) => event.targetId === 'ready',
      },
    },
    states: {
      ready: {
        id: 'ready',
        on: {
          START: {
            target: 'child',
            actions: assign({ entryReady: !opts.blockEntry }),
          },
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'child',
            playbookId: 'review',
            text: 'Review.',
          }),
          onDone: [
            ...(opts.shadowed ? [{ guard: accepted, target: 'done' }] : []),
            {
              guard: accepted,
              target: 'following',
              actions: [
                assign({ absentReached: true }),
                ({ event }: any) => observed.push(event.output),
              ],
            },
            { target: 'failed' },
          ],
          onError: { target: 'failed' },
        },
      },
      following: {
        id: 'following',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'following',
            playbookId: 'review',
            text: 'Review again.',
          }),
          onDone: {
            guard: ({ context }: any) => context.absentReached === true,
            target: 'done',
          },
          onError: { target: 'failed' },
        },
      },
      awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);
};

/** A selected child guard must pass before excluding its earlier sibling. */
const orderedChildValueMachine = (
  opts: { blockEntry?: boolean; shadowed?: boolean } = {},
  observed: unknown[] = [],
) =>
  setup({
    actors: {
      playbook: fromPromise(async () => {
        throw new Error('provide child');
      }),
    },
  }).createMachine({
    id: 'orderedChildValue',
    initial: 'ready',
    context: { entryReady: false },
    on: {
      BOSS_INTERRUPT: {
        target: '#ready',
        guard: ({ event }: any) => event.targetId === 'ready',
      },
    },
    states: {
      ready: {
        id: 'ready',
        on: {
          START: {
            target: 'child',
            actions: assign({ entryReady: !opts.blockEntry }),
          },
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'child',
            playbookId: 'review',
            text: 'Review.',
          }),
          onDone: [
            {
              guard: ({ event }: any) =>
                opts.shadowed === true || event.output.route !== 'second',
              target: 'done',
            },
            {
              guard: ({ context, event }: any) =>
                context.entryReady === true && event.output.accepted === true,
              target: 'done',
              actions: ({ event }: any) => observed.push(event.output),
            },
            { target: 'failed' },
          ],
          onError: { target: 'failed' },
        },
      },
      awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);

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
    recovery?: boolean;
    repeatedDecisionPath?: boolean;
    wrongEarlierArm?: boolean;
    cyclicNoExit?: boolean;
    unsupportedSurfaces?: boolean;
    missingDecisionResult?: boolean;
    nestedInterrupt?: boolean;
    guardForm?: 'inline' | 'parameterized';
    staleTargetLatch?: 'prior' | 'self';
    contextualSharedArm?: boolean;
    invalidOutputFallback?: 'failed' | 'reporting' | 'hub';
    guardedHubError?: boolean;
    hubError?: boolean;
    failureError?: 'guarded' | 'nonfinal';
  } = {},
) => {
  const actions = opts.recovery
    ? ([...controllerActions, 'recover'] as const)
    : controllerActions;
  const actionGuard =
    (action: (typeof actions)[number]) =>
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
    actions.map((action) => [action, actionGuard(action)]),
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
              ...(opts.recovery ? { recover: 'Prepare and continue.' } : {}),
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
          onDone: [
            ...actions.map((action) => {
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
            ...(opts.invalidOutputFallback
              ? [{ target: `#${opts.invalidOutputFallback}` }]
              : []),
          ],
          onError:
            opts.failureError === 'guarded'
              ? { guard: () => true, target: '#failed' }
              : opts.failureError === 'nonfinal'
                ? [{ target: '#failed' }, { guard: () => true, target: '#hub' }]
                : opts.guardedHubError
                  ? [
                      { guard: () => false, target: '#hub' },
                      { target: '#failed' },
                    ]
                  : { target: opts.hubError ? '#hub' : '#failed' },
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
  it.each(['function', 'object'] as const)(
    'initializes the host catalog from a declared %s literal child binding',
    async (inputForm) => {
      expect(
        await checkFsmCoverage({
          machine: catalogLiteralChildMachine(inputForm),
        }),
      ).toEqual([]);
    },
  );

  it('does not enable an undeclared target named only in guard or source literals', async () => {
    const findings = await checkFsmCoverage(
      { machine: catalogLiteralChildMachine('function', 'undeclared-child') },
      { sourceText: "const temptingIdentifier = 'undeclared-child';" },
    );
    expect(findings).toContain(
      'state work: result "ok" has no reachable accepting transition',
    );
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  it.each(['`artifactPath` (local path)', '`artifactPath: <local path>`'])(
    'supplies every declared output field in a closed contract: %s',
    async (field) => {
      const machine = goodMachine({
        result: {
          ok: `The work is done. Output shall include ${field} and \`latestCommit: <commit identity>\`.`,
        },
        onDone: [
          {
            target: '#done',
            guard: ({ event }: any) => {
              const output = event.output;
              return (
                Reflect.ownKeys(output).length === 3 &&
                output.guard === 'ok' &&
                typeof Object.getOwnPropertyDescriptor(output, 'artifactPath')
                  ?.value === 'string' &&
                typeof Object.getOwnPropertyDescriptor(output, 'latestCommit')
                  ?.value === 'string'
              );
            },
          },
          needsBossReplyArm(),
        ],
      });
      expect(await checkFsmCoverage({ machine })).toEqual([]);
    },
  );

  it('continues target-local questions before unrelated branching alternatives exhaust the path budget', async () => {
    const observed: Array<{
      guard: string;
      replies: Array<Record<string, unknown>>;
      prefixRoute?: string;
    }> = [];
    expect(
      await checkFsmCoverage(
        {
          machine: successiveQuestionMachine({
            branchingPrefix: true,
            observed,
          }),
        },
        { artifactSchema: 3 },
      ),
    ).toEqual([]);
    expect(new Set(observed.map((value) => value.guard))).toEqual(
      new Set(['approved', 'refused']),
    );
    expect(observed.every((value) => value.replies.length === 2)).toBe(true);
    for (const value of observed)
      expect(value.prefixRoute).toMatch(/^(\/(left|right)){4}$/);
  });

  it.each(
    ['Output shall include', '输出应包含'].flatMap((clause) =>
      ['single-line', 'multiline'].map((layout) => ({ clause, layout })),
    ),
  )(
    'uses only declared fields under $clause ($layout)',
    async ({ clause, layout }) => {
      const declaration =
        layout === 'multiline'
          ? '\n`verificationReport: <verbatim\nfinal text>`.\nCompleted response.'
          : ' `verificationReport: <verbatim final text>`.';
      const result = {
        ok: `The completed response answers the question; remainingPlan, nextPlaybookId, and nextPlaybookInput are outcome prose. ${clause}${declaration}`,
      };
      const onDone = [
        {
          target: '#done',
          guard: ({ event }: any) => {
            const output = event.output;
            return (
              Reflect.ownKeys(output).length === 2 &&
              output.guard === 'ok' &&
              typeof Object.getOwnPropertyDescriptor(
                output,
                'verificationReport',
              )?.value === 'string'
            );
          },
        },
        needsBossReplyArm(),
      ];
      expect(
        await checkFsmCoverage({ machine: goodMachine({ result, onDone }) }),
      ).toEqual([]);

      const missingResult = {
        ok: `The completed response answers the question. ${clause}`,
      };
      const missing = goodMachine({ result: missingResult, onDone });
      expect(await checkFsmCoverage({ machine: missing })).toContain(
        'state work: result "ok" has no reachable accepting transition',
      );

      const missingLegacyField = goodMachine({
        result: missingResult,
        onDone: [
          {
            target: '#done',
            guard: ({ event }: any) =>
              Reflect.ownKeys(event.output).length === 2 &&
              event.output.guard === 'ok' &&
              typeof event.output.response === 'string',
          },
          needsBossReplyArm(),
        ],
      });
      expect(await checkFsmCoverage({ machine: missingLegacyField })).toContain(
        'state work: result "ok" has no reachable accepting transition',
      );
    },
  );

  it.each([
    'valid',
    'dead predecessor',
    'dead interrupt',
    'shadowed interrupt',
  ])(
    'replays nested role prerequisites while preserving a %s route',
    async (variant) => {
      const roles = ['planner', 'builder', 'verifier'];
      const canEnter = (context: any, index: number) =>
        index === 0 || context.delivery[roles[index - 1]]?.ready === true;
      const states: Record<string, any> = {
        ready: { id: 'ready', on: { GO: { target: 'planner' } } },
        done: { id: 'done', type: 'final' },
        failed: {
          id: 'failed',
          tags: 'playbook.parked',
          ...(variant === 'shadowed interrupt'
            ? { on: { BOSS_INTERRUPT: {} } }
            : {}),
        },
        awaitBossReply: {
          id: 'awaitBossReply',
          on: {
            ...(variant === 'shadowed interrupt' ? { BOSS_INTERRUPT: {} } : {}),
            BOSS_REPLY: roles.map((role) => ({
              target: `#${role}`,
              guard: ({ context, event }: any) =>
                context.pendingBossQuestion?.resumeStateId === role &&
                typeof event.answer === 'string' &&
                event.answer.trim() !== '',
            })),
          },
        },
      };
      for (const [index, role] of roles.entries()) {
        states[role] = {
          id: role,
          ...(variant === 'shadowed interrupt' && index > 0
            ? { on: { BOSS_INTERRUPT: {} } }
            : {}),
          invoke: {
            src: 'player',
            input: () => ({
              stateId: role,
              sourceItem: `CHAIN-${index + 1}`,
              role,
              prompt: 'Perform the role work.',
              result: {
                ok: 'The role completed. Output shall include `artifactPath` (local report) and `latestCommit: <commit identity>`.',
                needsBossReply: NEEDS_BOSS_REPLY_TEXT,
              },
            }),
            onDone: [
              {
                target: `#${roles[index + 1] ?? 'done'}`,
                guard: ({ context, event }: any) =>
                  !(variant === 'dead predecessor' && index === 0) &&
                  canEnter(context, index) &&
                  event.output.guard === 'ok' &&
                  Reflect.ownKeys(event.output).length === 3 &&
                  typeof event.output.artifactPath === 'string' &&
                  typeof event.output.latestCommit === 'string',
                actions: assign(({ context }: any) => ({
                  delivery: { ...context.delivery, [role]: { ready: true } },
                })),
              },
              needsBossReplyArm(role, role, `CHAIN-${index + 1}`),
            ],
            onError: { target: '#failed' },
          },
        };
      }
      const machine = setup({
        actors: {
          player: fromPromise(async () => {
            throw new Error('provide role');
          }),
        },
      }).createMachine({
        id: 'nestedRoleChain',
        initial: 'ready',
        context: { delivery: {} },
        states,
        on: {
          BOSS_INTERRUPT: roles.map((role, index) => ({
            target: `#${role}`,
            reenter: true,
            guard: ({ context, event }: any) =>
              !(variant === 'dead interrupt' && index > 0) &&
              event.targetId === role &&
              canEnter(context, index),
          })),
        },
      } as any);
      const findings = await checkFsmCoverage({ machine });
      if (variant === 'valid') expect(findings).toEqual([]);
      else {
        expect(findings).toContainEqual(
          expect.stringMatching(
            /^BOSS_INTERRUPT target builder: .*exhausted.*path/,
          ),
        );
        if (variant === 'dead predecessor')
          expect(
            findings.some((finding) =>
              finding.includes('state builder: result "ok" remains unproved'),
            ),
          ).toBe(true);
      }
    },
  );

  /* eslint-enable @typescript-eslint/no-explicit-any */

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
        expect(findings).toContainEqual(
          expect.stringMatching(
            /^BOSS_INTERRUPT target work: .*exhausted.*path/,
          ),
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
    ).toContainEqual(
      expect.stringMatching(/^BOSS_INTERRUPT target work: .*exhausted.*path/),
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

  it('covers a recovery-capable controller without a workflow wait', async () => {
    expect(
      await checkFsmCoverage({
        machine: controllerMachine(false, false, false, { recovery: true }),
      }),
    ).toEqual([]);
  });

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

  it('excludes a defensive failure fallback but still rejects a second action route', async () => {
    expect(
      await checkFsmCoverage({
        machine: controllerMachine(false, false, false, {
          recovery: true,
          invalidOutputFallback: 'failed',
        }),
      }),
    ).toEqual([]);
    const findings = await checkFsmCoverage({
      machine: controllerMachine(false, false, false, {
        recovery: true,
        invalidOutputFallback: 'reporting',
      }),
    });
    expect(findings).toContainEqual(
      expect.stringMatching(/selects 2 accepting action arms/),
    );
  });

  it.each(['guardedHubError', 'hubError'] as const)(
    'counts a fallback into an action target with %s',
    async (errorKind) => {
      const findings = await checkFsmCoverage({
        machine: controllerMachine(false, false, false, {
          recovery: true,
          invalidOutputFallback: 'hub',
          [errorKind]: true,
        }),
      });
      expect(findings).toContainEqual(
        expect.stringMatching(/selects 2 accepting action arms/),
      );
    },
  );

  it.each(['guarded', 'nonfinal'] as const)(
    'does not exempt a fallback shared only with a %s error arm',
    async (failureError) => {
      const findings = await checkFsmCoverage({
        machine: controllerMachine(false, false, false, {
          recovery: true,
          invalidOutputFallback: 'failed',
          failureError,
        }),
      });
      expect(findings).toContainEqual(
        expect.stringMatching(/selects 2 accepting action arms/),
      );
    },
  );

  it.each([
    'invoke',
    'states',
    'always',
    'after',
    'entry',
    'exit',
    'named-entry',
  ] as const)('does not exempt a fallback with %s', async (member) => {
    const base = controllerMachine(false, false, false, {
      recovery: true,
      invalidOutputFallback: 'failed',
    });
    const escape = { on: { ESCAPE: '#reporting' } };
    const extra: Record<string, unknown> =
      member === 'states'
        ? { states: {} }
        : member === 'always'
          ? { always: { target: '#hub' } }
          : member === 'invoke'
            ? { invoke: { src: 'unexpected' } }
            : member === 'after'
              ? { after: { 0: { target: '#reporting' } } }
              : member === 'named-entry'
                ? { entry: 'escape', ...escape }
                : { [member]: raise({ type: 'ESCAPE' }), ...escape };
    const failed = { ...base.config.states!.failed, ...extra };
    const machine = createMachine(
      {
        ...base.config,
        states: { ...base.config.states, failed },
      } as typeof base.config,
      {
        ...base.implementations,
        actions: {
          ...base.implementations.actions,
          escape: raise({ type: 'ESCAPE' }),
        },
      } as typeof base.implementations,
    );
    const findings = await checkFsmCoverage({ machine });
    expect(findings).toContainEqual(
      expect.stringMatching(/selects 2 accepting action arms/),
    );
  });

  it('keeps the exemption for a fallback leaf whose entry only assigns', async () => {
    const base = controllerMachine(false, false, false, {
      recovery: true,
      invalidOutputFallback: 'failed',
    });
    const failed = {
      ...base.config.states!.failed,
      entry: assign({ lastError: () => undefined }),
    };
    const machine = createMachine(
      {
        ...base.config,
        states: { ...base.config.states, failed },
      } as typeof base.config,
      base.implementations,
    );
    expect(await checkFsmCoverage({ machine })).toEqual([]);
  });

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
      expect(findings).toContainEqual(
        expect.stringMatching(
          /requires exactly respond, resume, start, switch, dismiss, deliver, runtime$/,
        ),
      );
    },
  );

  it.each([false, true])(
    'names the recovery domain for a malformed controller (extra=%s)',
    async (extra) => {
      const findings = await checkFsmCoverage({
        machine: controllerMachine(false, false, extra, {
          recovery: true,
          missingDecisionResult: !extra,
        }),
      });
      expect(findings).not.toContain(
        'machine declares no awaitBossReply state or branch-local Boss-reply wait state',
      );
      expect(findings).not.toContain(
        'machine declares no root BOSS_INTERRUPT event',
      );
      expect(findings).toContainEqual(
        expect.stringMatching(
          /controller decision contract near-miss .*requires exactly .*runtime, recover$/,
        ),
      );
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

  it('covers the bare public aborted child result through actual rejection', async () => {
    const errors: unknown[] = [];
    expect(
      await checkFsmCoverage({
        machine: nestedMultiArmMachine({
          authoredAbortArm: true,
          onAbortError: (error) => errors.push(error),
        }),
      }),
    ).toEqual([]);
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) {
      expect(error).toBeInstanceOf(Error);
      expect(
        validatePlaybookCallResult(
          (error as Error & { result: unknown }).result,
          'child',
        ),
      ).toEqual({ status: 'aborted', playbookId: 'child' });
    }
  });

  it.each([
    { wrongAbortTarget: true },
    { requireAbortSession: true },
    { shadowedAbortArm: true },
  ])('refuses an unproved public child abort for %j', async (controls) => {
    const arm = controls.shadowedAbortArm ? 1 : 0;
    expect(
      (
        await checkFsmCoverage({
          machine: nestedMultiArmMachine({
            authoredAbortArm: true,
            ...controls,
          }),
        })
      ).some((finding) =>
        finding.includes(`callChild: nested playbook onError arm ${arm}`),
      ),
    ).toBe(true);
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

  it('covers ordinary and alternate public entry values through real multi-step paths', async () => {
    const observed: Array<{
      id: string;
      variant: unknown;
      entryType: unknown;
    }> = [];
    expect(
      await checkFsmCoverage(
        { machine: childChainMachine({ entryVariants: { observed } }) },
        {
          sourceText: [
            ...Array.from({ length: 96 }, (_, index) => `'request_${index}'`),
            "'primary'",
            "'alternate'",
          ].join('\n'),
        },
      ),
    ).toEqual([]);
    for (const variant of ['primary', 'alternate'])
      expect(
        observed.some(
          (entry) =>
            entry.id === 'code' &&
            entry.variant === variant &&
            entry.entryType === 'START',
        ),
      ).toBe(true);
    expect(
      observed.some(
        (entry) => entry.id === 'pr' && entry.variant === 'alternate',
      ),
    ).toBe(true);
  });

  it.each([32, 33, 38, 64, 256])(
    'replays helper-bound public routes with %i-character identifiers',
    async (length) => {
      const alternate = 'route_' + 'a'.repeat(length - 6);
      const observed: Array<{
        id: string;
        variant: unknown;
        entryType: unknown;
      }> = [];
      const sourceText = [
        ...Array.from({ length: 96 }, (_, index) =>
          JSON.stringify('a' + index.toString(16).padStart(63, '0')),
        ),
        JSON.stringify('primary'),
        JSON.stringify(alternate),
      ].join('\n');
      expect(
        await checkFsmCoverage(
          {
            machine: childChainMachine({
              entryVariants: { modes: ['primary', alternate], observed },
            }),
          },
          { sourceText },
        ),
      ).toEqual([]);
      expect(
        observed.some(
          (entry) =>
            entry.id === 'pr' &&
            entry.variant === alternate &&
            entry.entryType === 'START',
        ),
      ).toBe(true);
    },
  );

  it.each([
    { rejectAlternate: true },
    { shadowAlternate: true },
    { requireProof: true },
  ])(
    'retains refusal for helper-bound long public routes: %j',
    async (limits) => {
      const alternate = 'independent-context-route-revalidation';
      const observed: Array<{
        id: string;
        variant: unknown;
        entryType: unknown;
      }> = [];
      const findings = await checkFsmCoverage(
        {
          machine: childChainMachine({
            entryVariants: {
              ...limits,
              modes: ['primary', alternate],
              observed,
            },
          }),
        },
        {
          sourceText: [
            JSON.stringify('primary'),
            JSON.stringify(alternate),
          ].join('\n'),
        },
      );
      expect(
        findings.some((finding) => finding.startsWith('state branch:')),
      ).toBe(true);
      expect(observed.some((entry) => entry.id === 'branch')).toBe(false);
    },
  );

  it.each([
    { rejectAlternate: true },
    { shadowAlternate: true },
    { requireProof: true },
  ])('retains public entry route refusal for %j', async (entryVariants) => {
    const observed: Array<{
      id: string;
      variant: unknown;
      entryType: unknown;
    }> = [];
    const findings = await checkFsmCoverage(
      {
        machine: childChainMachine({
          entryVariants: { ...entryVariants, observed },
        }),
      },
      { sourceText: "'primary'\n'alternate'" },
    );
    expect(
      findings.some((finding) => finding.startsWith('state branch:')),
    ).toBe(true);
    expect(observed.some((entry) => entry.id === 'branch')).toBe(false);
  });

  it('retains public routes after a valid interrupt drive', async () => {
    const observed: Array<{ id: string; route: unknown; entryType: unknown }> =
      [];
    expect(
      await checkFsmCoverage({
        machine: publicAfterInterruptMachine({}, observed),
      }),
    ).toEqual([]);
    expect(
      observed.some(
        (entry) =>
          entry.id === 'ordinaryChild' &&
          entry.route === 'interrupt' &&
          entry.entryType === 'BOSS_INTERRUPT',
      ),
    ).toBe(true);
    expect(
      observed.some(
        (entry) =>
          entry.id === 'alternateChild' &&
          entry.route === 'public' &&
          entry.entryType === 'START',
      ),
    ).toBe(true);
  });

  it('reaches PR through the alternate public route while retaining code budget exhaustion', async () => {
    const observed: Array<{
      id: string;
      variant: unknown;
      entryType: unknown;
    }> = [];
    const observedPr: ChildChainPrEvidence[] = [];
    const findings = await checkFsmCoverage(
      {
        machine: childChainMachine({
          entryVariants: { preemptive: true, observed, observedPr },
        }),
      },
      { sourceText: "'primary'\n'alternate'" },
    );
    expect(findings).toEqual([
      'state code: nested playbook onDone arm 0: exhausted 64-attempt path budget',
    ]);
    expect(observedPr.length).toBeGreaterThan(0);
    for (const result of observedPr) {
      expect(result.variant).toBe('alternate');
      expect(result.entryType).toBe('START');
      expect(['branch', 'both']).toContain(result.mode);
      expect(result.branches).toBeGreaterThanOrEqual(1);
      expect(result.codeRevision).toEqual(expect.stringMatching(/\S/));
      if (result.mode === 'both')
        expect(result.decisionRevision).toEqual(expect.stringMatching(/\S/));
    }
    expect(
      observed.some(
        (entry) =>
          entry.id === 'code' &&
          entry.variant === 'primary' &&
          entry.entryType === 'BOSS_INTERRUPT',
      ),
    ).toBe(true);
    expect(
      observed.some(
        (entry) =>
          entry.id === 'branch' &&
          entry.variant === 'alternate' &&
          entry.entryType === 'START',
      ),
    ).toBe(true);
  });

  it.each([
    { rejectAlternate: true },
    { shadowAlternate: true },
    { requireProof: true },
  ])('retains public-after-interrupt refusal for %j', async (entryVariants) => {
    const observed: Array<{ id: string; route: unknown; entryType: unknown }> =
      [];
    const findings = await checkFsmCoverage({
      machine: publicAfterInterruptMachine(entryVariants, observed),
    });
    expect(
      findings.some((finding) => finding.startsWith('state alternateChild:')),
    ).toBe(true);
    expect(observed.some((entry) => entry.id === 'alternateChild')).toBe(false);
  });

  it('uses real public paths when a legacy child predecessor has no interrupt drive', async () => {
    const observed: Array<{ state: string; entryType: unknown }> = [];
    expect(
      await checkFsmCoverage(
        { machine: legacyPredecessorEntryMachine({}, observed) },
        {
          artifactSchema: 3,
          sourceText: "'fresh'",
        },
      ),
    ).toEqual([]);
    expect(observed).toContainEqual({ state: 'planning', entryType: 'START' });
    expect(observed).toContainEqual({ state: 'approval', entryType: 'START' });
  });

  it.each([
    { falseGuard: true },
    { shadowed: true },
    { falseContext: true },
    { wrongQuestion: true },
  ])(
    'refuses an unproved legacy child predecessor fallback for %j',
    async (controls) => {
      const findings = await checkFsmCoverage(
        { machine: legacyPredecessorEntryMachine(controls) },
        {
          artifactSchema: 3,
          sourceText: "'fresh'",
        },
      );
      expect(findings.some((finding) => finding.includes('approval'))).toBe(
        true,
      );
    },
  );

  it('discovers descriptor-read public entries without fabricating descriptors', async () => {
    const observed: Array<{ id: string; route: unknown; entryType: unknown }> =
      [];
    const missing: string[] = [];
    expect(
      await checkFsmCoverage({
        machine: descriptorEntryMachine({}, observed, missing),
      }),
    ).toEqual([]);
    expect(missing).toContain('permit');
    expect(missing).toContain('request');
    expect(
      observed.some(
        (entry) =>
          entry.id === 'ordinaryChild' &&
          entry.route === 'interrupt' &&
          entry.entryType === 'BOSS_INTERRUPT',
      ),
    ).toBe(true);
    expect(
      observed.some(
        (entry) =>
          entry.id === 'alternateChild' &&
          entry.route === 'public' &&
          entry.entryType === 'START',
      ),
    ).toBe(true);
  });

  it.each([
    { inheritedOnly: true },
    { falseGuard: true },
    { shadowed: true },
    { requireProof: true },
    { wrongAttribute: true },
  ])('retains descriptor-entry refusal for %j', async (opts) => {
    const observed: Array<{ id: string; route: unknown; entryType: unknown }> =
      [];
    const findings = await checkFsmCoverage({
      machine: descriptorEntryMachine(opts, observed),
    });
    expect(
      findings.some((finding) => finding.startsWith('state alternateChild:')),
    ).toBe(true);
    expect(
      observed.some(
        (entry) => entry.id === 'alternateChild' && entry.entryType === 'START',
      ),
    ).toBe(false);
  });

  it('retains the four-field bound for descriptor-read public entries', async () => {
    const observed: Array<{ id: string; route: unknown; entryType: unknown }> =
      [];
    const findings = await checkFsmCoverage({
      machine: descriptorEntryMachine({ fifthField: true }, observed),
    });
    expect(
      findings.some((finding) => finding.startsWith('state alternateChild:')),
    ).toBe(true);
    expect(
      observed.some(
        (entry) => entry.id === 'alternateChild' && entry.entryType === 'START',
      ),
    ).toBe(false);
  });

  it.each([false, true])(
    'charges public entry alternatives to the existing replay limit (interrupt=%s)',
    async (preemptive) => {
      const modes = Array.from(
        { length: 96 },
        (_, index) => `variant_${index}`,
      );
      const findings = await checkFsmCoverage(
        {
          machine: childChainMachine({ entryVariants: { modes, preemptive } }),
        },
        { sourceText: modes.map((value) => `'${value}'`).join('\n') },
      );
      expect(
        findings.some(
          (finding) =>
            finding.startsWith('state branch:') &&
            finding.includes('exhausted 64-attempt path budget'),
        ),
      ).toBe(true);
    },
  );

  /* eslint-disable @typescript-eslint/no-explicit-any */
  it.each(
    ['string', 'object'].flatMap((initialForm) =>
      ['compound', 'parallel'].flatMap((shape) =>
        [
          'initial',
          'local-event',
          'root-event',
          'interrupt',
          'player-done',
          'player-error',
          'child-done',
          'child-error',
        ].map((entry) => ({ shape, entry, initialForm })),
      ),
    ),
  )(
    'enters $shape invocation descendants through $entry with $initialForm initial transitions',
    async ({ shape, entry, initialForm }) => {
      const initial = (target: string, marker: string) =>
        initialForm === 'string'
          ? target
          : { target, actions: assign({ [marker]: true }) };
      const child = (id: string) => ({
        id,
        invoke: {
          src: 'playbook',
          input: ({ context }: any) => {
            if (context.entered !== true)
              throw new Error('entry action must run');
            if (
              initialForm === 'object' &&
              (context.rootInitialized !== true ||
                context[`${id}Initialized`] !== true ||
                (shape === 'compound' && context.groupInitialized !== true))
            )
              throw new Error('initial-transition actions must run');
            return { stateId: id, playbookId: 'review', text: 'Review it.' };
          },
          onDone: '#done',
          onError: '#failed',
        },
      });
      const route = {
        target: '#reviewGroup',
        actions: assign({ entered: true }),
      };
      const region = (id: string) => ({
        initial: initial('review', `${id}Initialized`),
        states: { review: child(id) },
      });
      const group =
        shape === 'parallel'
          ? {
              id: 'reviewGroup',
              type: 'parallel',
              states: { east: region('review'), west: region('audit') },
              onDone: '#done',
            }
          : {
              id: 'reviewGroup',
              initial: initial('phase', 'groupInitialized'),
              states: { phase: region('review') },
            };
      const predecessor =
        entry.startsWith('player') || entry.startsWith('child');
      const fromChild = entry.startsWith('child');
      const machine = setup({
        actors: {
          player: fromPromise(async () => {
            throw new Error('provide player');
          }),
          playbook: fromPromise(async () => {
            throw new Error('provide child');
          }),
        },
      }).createMachine({
        id: 'hierarchicalEntry',
        context: { entered: entry === 'initial' },
        initial: initial(
          entry === 'initial' ? 'reviewGroup' : predecessor ? 'plan' : 'ready',
          'rootInitialized',
        ),
        on:
          entry === 'root-event'
            ? { GO: route }
            : entry === 'interrupt'
              ? {
                  BOSS_INTERRUPT: {
                    ...route,
                    reenter: true,
                    guard: ({ event }: any) => event.targetId === 'reviewGroup',
                  },
                }
              : {},
        states: {
          ready: { on: entry === 'local-event' ? { GO: route } : {} },
          ...(predecessor
            ? {
                plan: {
                  id: 'plan',
                  invoke: {
                    src: fromChild ? 'playbook' : 'player',
                    input: () =>
                      fromChild
                        ? {
                            stateId: 'plan',
                            playbookId: 'plan',
                            text: 'Plan it.',
                          }
                        : {
                            stateId: 'plan',
                            role: 'planner',
                            sourceItem: 'FLOW-1',
                            prompt: 'Plan it.',
                            result: { done: 'Planned.' },
                          },
                    onDone: entry.endsWith('done')
                      ? {
                          ...route,
                          ...(!fromChild
                            ? {
                                guard: ({ event }: any) =>
                                  event.output.guard === 'done',
                              }
                            : {}),
                        }
                      : '#done',
                    onError: entry.endsWith('error') ? route : '#failed',
                  },
                },
              }
            : {}),
          reviewGroup: group,
          awaitBossReply: { id: 'awaitBossReply' },
          done: { id: 'done', type: 'final' },
          failed: { id: 'failed', type: 'final' },
        },
      } as any);
      const findings = await checkFsmCoverage({ machine });
      // Parallel join probing still requires acting leaves; child entry itself
      // is independently covered in both regions without inventing a join.
      expect(findings).toEqual(
        shape === 'parallel' && entry === 'interrupt'
          ? [
              'parallel state reviewGroup: onDone join coverage is unsupported without one Captain leaf per branch',
            ]
          : [],
      );
    },
  );

  it.each(['string', 'object'])(
    'does not treat inactive compound descendants as entered with %s initial transitions',
    async (initialForm) => {
      const initial = (target: string) =>
        initialForm === 'string' ? target : { target };
      const machine = setup({
        actors: { playbook: fromPromise(async () => ({})) },
      }).createMachine({
        initial: initial('group'),
        states: {
          group: {
            initial: initial('idle'),
            states: {
              idle: {},
              review: {
                id: 'review',
                invoke: {
                  src: 'playbook',
                  input: {
                    stateId: 'review',
                    playbookId: 'review',
                    text: 'Review.',
                  },
                  onDone: '#done',
                  onError: '#failed',
                },
              },
            },
          },
          awaitBossReply: { id: 'awaitBossReply' },
          done: { id: 'done', type: 'final' },
          failed: { id: 'failed', type: 'final' },
        },
      });
      const findings = await checkFsmCoverage({ machine });
      expect(findings).toHaveLength(2);
      expect(
        findings.every((finding) =>
          finding.includes('dead or unsupported entry path'),
        ),
      ).toBe(true);
    },
  );

  it.each(['string', 'object'])(
    'selects the active parallel branch rather than the first declared invocation with %s initial transitions',
    async (initialForm) => {
      const config = parallelMachine({ sequentialSameRole: true })
        .config as any;
      const left = config.states.parallelRound.states.left;
      left.initial =
        initialForm === 'string' ? 'working' : { target: 'working' };
      left.states = { revision: left.states.revision, ...left.states };
      const machine = setup({
        actors: {
          player: fromPromise(async () => {
            throw new Error('provide player');
          }),
        },
      }).createMachine(config);
      const findings = await checkFsmCoverage({ machine });
      expect(
        findings.filter((finding) => finding.startsWith('parallel state')),
      ).toEqual([]);
      expect(findings.some((finding) => finding.includes('leftRevision'))).toBe(
        true,
      );
    },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */

  it.each([false, true])(
    'guides present own-data descriptor child values through real replay (mixed=%s)',
    async (mixedReads) => {
      const observed: unknown[] = [];
      expect(
        await checkFsmCoverage({
          machine: descriptorChildValueMachine({ mixedReads }, observed),
        }),
      ).toEqual([]);
      expect(observed).not.toEqual([]);
      for (const value of observed) {
        expect(Object.keys(value as object).sort()).toEqual([
          'approved',
          'revision',
          'summary',
        ]);
        expect(Object.getOwnPropertyDescriptor(value, 'approved')).toEqual({
          value: false,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    },
  );

  it.each([
    { blockEntry: true },
    { shadowed: true },
    { accessorOnly: true },
    { inheritedOnly: true },
  ])('retains descriptor-value child refusal for %j', async (opts) => {
    const findings = await checkFsmCoverage({
      machine: descriptorChildValueMachine(opts),
    });
    expect(
      findings.some((value) =>
        value.includes(
          `child: nested playbook onDone arm ${opts.shadowed ? 1 : 0}`,
        ),
      ),
    ).toBe(true);
  });

  it('replays absent successful child output into a following child', async () => {
    const result = validatePlaybookCallResult(
      {
        status: 'ok',
        playbookId: 'review',
        childSessionId: 'synthetic-review',
      },
      'review',
    );
    expect(result.status).toBe('ok');
    expect('output' in result).toBe(false);
    const observed: unknown[] = [];
    expect(
      await checkFsmCoverage({
        machine: absentChildOutputMachine({}, observed),
      }),
    ).toEqual([]);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((value) => value === undefined)).toBe(true);
  });

  it.each([
    { shadowed: true },
    { blockEntry: true },
    { expected: 'null' as const },
    { expected: 'error' as const },
  ])('keeps absent child output distinct and ordered for %j', async (opts) => {
    const observed: unknown[] = [];
    const findings = await checkFsmCoverage({
      machine: absentChildOutputMachine(opts, observed),
    });
    expect(
      findings.some((value) =>
        value.includes(
          `child: nested playbook onDone arm ${opts.shadowed ? 1 : 0}`,
        ),
      ),
    ).toBe(true);
    expect(observed).toEqual([]);
  });

  it.each([3, 4] as const)(
    'covers exact %i-field child output regardless of cardinality predicate order',
    async (fields) => {
      for (const countLast of [false, true]) {
        for (const jsonDescriptors of [false, true]) {
          expect(
            await checkFsmCoverage({
              machine: enumeratedChildOutputMachine(fields, {
                countLast,
                jsonDescriptors,
              }),
            }),
          ).toEqual([]);
        }
      }
    },
  );

  it.each([3, 4] as const)(
    'pads child fields after immutable reached-context reads (%s)',
    async (fields) => {
      expect(
        await checkFsmCoverage({
          machine: enumeratedChildOutputMachine(fields, {
            fixedContextReads: true,
          }),
        }),
      ).toEqual([]);
    },
  );

  it.each([{ blockEntry: true }, { wrongCount: true }, { shadowed: true }])(
    'preserves fixed-context child refusal for %j',
    async (controls) => {
      const arm = controls.shadowed ? 1 : 0;
      expect(
        (
          await checkFsmCoverage({
            machine: enumeratedChildOutputMachine(3, {
              fixedContextReads: true,
              ...controls,
            }),
          })
        ).some((finding) =>
          finding.includes(`child: nested playbook onDone arm ${arm}`),
        ),
      ).toBe(true);
    },
  );

  it('retains contradictory cardinality and shadowed child-output findings', async () => {
    expect(
      await checkFsmCoverage({
        machine: enumeratedChildOutputMachine(3, { wrongCount: true }),
      }),
    ).toContain(
      'state child: nested playbook onDone arm 0 is unsatisfiable under probing',
    );
    expect(
      await checkFsmCoverage({
        machine: enumeratedChildOutputMachine(4, { shadowed: true }),
      }),
    ).toContain(
      'state child: nested playbook onDone arm 1 is unsatisfiable under probing',
    );
  });

  it('guides hidden values after exact child-field presence within a broad candidate pool', async () => {
    const sourceText = [
      ...Array.from({ length: 55 }, (_, index) => `'candidate${index}'`),
      "'accepted'",
    ].join('\n');
    expect(
      await checkFsmCoverage(
        {
          machine: enumeratedChildOutputMachine(4, {
            jsonDescriptors: true,
            literalRevision: true,
          }),
        },
        { sourceText },
      ),
    ).toEqual([]);
    for (const refusal of [
      { wrongCount: true },
      { shadowed: true },
      { needsFifth: true },
    ]) {
      expect(
        await checkFsmCoverage(
          {
            machine: enumeratedChildOutputMachine(4, {
              jsonDescriptors: true,
              literalRevision: true,
              ...refusal,
            }),
          },
          { sourceText },
        ),
      ).not.toEqual([]);
    }
  });

  it('preserves an already valid native child seed with an absent optional field', async () => {
    expect(
      await checkFsmCoverage({
        machine: enumeratedChildOutputMachine(4, { nativeSeed: true }),
      }),
    ).toEqual([]);
    for (const controls of [{ wrongCount: true }, { shadowed: true }]) {
      expect(
        await checkFsmCoverage({
          machine: enumeratedChildOutputMachine(4, {
            nativeSeed: true,
            ...controls,
          }),
        }),
      ).not.toEqual([]);
    }
  });

  it.each([true, false])(
    'covers a helper-hidden %s child-output value',
    async (expected) => {
      expect(
        await checkFsmCoverage(
          {
            machine: enumeratedChildOutputMachine(3, {
              childFailure: { expected },
            }),
          },
          { sourceText: String(childFailureShape) },
        ),
      ).toEqual([]);
    },
  );

  it('guides child values while preserving an absent optional own field', async () => {
    const childFailure = { expected: false, optional: true };
    expect(
      await checkFsmCoverage(
        { machine: enumeratedChildOutputMachine(3, { childFailure }) },
        { sourceText: String(childFailureShape) },
      ),
    ).toEqual([]);
    for (const controls of [{ wrongCount: true }, { shadowed: true }]) {
      expect(
        await checkFsmCoverage(
          {
            machine: enumeratedChildOutputMachine(3, {
              childFailure,
              ...controls,
            }),
          },
          { sourceText: String(childFailureShape) },
        ),
      ).not.toEqual([]);
    }
  });

  it('covers a compact normalized child-error value', async () => {
    const acceptedErrors: unknown[] = [];
    const errorShape = (value: Record<string, unknown> | null) =>
      value !== null &&
      typeof value === 'object' &&
      Object.keys(value).length === 2 &&
      Object.hasOwn(value, 'name') &&
      Object.hasOwn(value, 'message') &&
      typeof value.name === 'string' &&
      typeof value.message === 'string';
    expect(
      await checkFsmCoverage(
        {
          machine: enumeratedChildOutputMachine(4, {
            childFailure: {
              expected: false,
              optional: true,
              requireError: true,
              errorShape,
              onErrorAccepted: (error) => acceptedErrors.push(error),
            },
          }),
        },
        { sourceText: String(childFailureShape) },
      ),
    ).toEqual([]);
    expect(acceptedErrors).toContainEqual(
      normalizeErrorCompact(new Error('coverage: child failure')),
    );
    for (const controls of [{ wrongCount: true }, { shadowed: true }]) {
      const arm = controls.shadowed ? 1 : 0;
      expect(
        (
          await checkFsmCoverage(
            {
              machine: enumeratedChildOutputMachine(4, {
                childFailure: {
                  expected: false,
                  optional: true,
                  requireError: true,
                  errorShape,
                },
                ...controls,
              }),
            },
            { sourceText: String(childFailureShape) },
          )
        ).some((value) =>
          value.includes(`child: nested playbook onDone arm ${arm}`),
        ),
      ).toBe(true);
    }
  });

  it.each(['numeric-name', 'missing-message', 'extra-member'])(
    'refuses an unsupported compact normalized child-error shape (%s)',
    async (variant) => {
      const errorShape = (value: Record<string, unknown> | null) => {
        if (value === null || typeof value !== 'object') return false;
        if (variant === 'numeric-name')
          return (
            Object.keys(value).length === 2 &&
            typeof value.name === 'number' &&
            typeof value.message === 'string'
          );
        if (variant === 'missing-message')
          return (
            Object.keys(value).length === 1 && typeof value.name === 'string'
          );
        return (
          Object.keys(value).length === 3 &&
          typeof value.name === 'string' &&
          typeof value.message === 'string' &&
          value.extra === true
        );
      };
      expect(
        (
          await checkFsmCoverage(
            {
              machine: enumeratedChildOutputMachine(4, {
                childFailure: {
                  expected: false,
                  optional: true,
                  requireError: true,
                  errorShape,
                },
              }),
            },
            { sourceText: String(childFailureShape) },
          )
        ).some((value) =>
          value.includes('child: nested playbook onDone arm 0'),
        ),
      ).toBe(true);
    },
  );

  it.each([0, 96])(
    'discovers each child arm without combining disjoint earlier shapes (extra=%s)',
    async (count) => {
      expect(
        await checkFsmCoverage(
          {
            machine: enumeratedChildOutputMachine(3, {
              disjointPrior: true,
              childFailure: { expected: false, optional: true },
            }),
          },
          {
            sourceText: [
              String(childFailureShape),
              ...Array.from(
                { length: count },
                (_, index) => `'unrelated_${index}'`,
              ),
            ].join('\n'),
          },
        ),
      ).toEqual([]);
    },
  );

  it.each([{ wrongCount: true }, { shadowed: true }])(
    'preserves ordered disjoint-child refusal for %j',
    async (controls) => {
      const arm = controls.shadowed ? 2 : 1;
      expect(
        (
          await checkFsmCoverage(
            {
              machine: enumeratedChildOutputMachine(3, {
                disjointPrior: true,
                childFailure: { expected: false, optional: true },
                ...controls,
              }),
            },
            { sourceText: String(childFailureShape) },
          )
        ).some((value) =>
          value.includes(`child: nested playbook onDone arm ${arm}`),
        ),
      ).toBe(true);
    },
  );

  it('guides a child arm before spending its budget on earlier own-field reads', async () => {
    expect(
      await checkFsmCoverage(
        {
          machine: enumeratedChildOutputMachine(3, {
            disjointPrior: true,
            priorOwnFieldsFirst: true,
            childFailure: { expected: false, optional: true },
          }),
        },
        {
          sourceText: [
            String(childFailureShape),
            ...Array.from({ length: 96 }, (_, index) => `'unrelated_${index}'`),
          ].join('\n'),
        },
      ),
    ).toEqual([]);
  });

  it('discovers ordered exclusions after the selected child guard accepts', async () => {
    const observed: unknown[] = [];
    expect(
      await checkFsmCoverage({
        machine: orderedChildValueMachine({}, observed),
      }),
    ).toEqual([]);
    expect(observed).toContainEqual({ accepted: true, route: 'second' });
  });

  it.each([{ shadowed: true }, { blockEntry: true }])(
    'retains conditional child-guidance refusal for %j',
    async (opts) => {
      const observed: unknown[] = [];
      expect(
        (
          await checkFsmCoverage({
            machine: orderedChildValueMachine(opts, observed),
          })
        ).some((finding) =>
          finding.includes('child: nested playbook onDone arm 1'),
        ),
      ).toBe(true);
      expect(observed).toEqual([]);
    },
  );

  it.each([1, 2])(
    'guides %i declared placeholder values through the real reached target',
    async (overrides) => {
      const observed: Array<Record<string, unknown>> = [];
      expect(
        await checkFsmCoverage(
          { machine: declaredReachedValueMachine({ overrides }, observed) },
          { artifactSchema: 3 },
        ),
      ).toEqual([]);
      expect(observed.length).toBeGreaterThan(0);
      for (const output of observed) {
        expect(output.guard).toBe('delivered');
        expect(output.reachedReady).toBe(true);
        expect(output.product).toBe(output.reachedExpected);
        if (overrides === 2)
          expect(output.verified).toBe(output.reachedExpected);
        else expect(output.verified).toBe('coverage:verified');
        expect(output.record).toBe('coverage:record');
        expect(output.archive).toBe('coverage:archive');
        expect(output.report).toBe('coverage:report');
      }
    },
  );

  it.each([
    { contradictory: true },
    { shadowed: true },
    { falseContext: true },
    { nested: true },
    { accessor: true },
    { overrides: 5 },
  ])('retains declared placeholder guidance refusal for %j', async (opts) => {
    const observed: Array<Record<string, unknown>> = [];
    expect(
      (
        await checkFsmCoverage(
          { machine: declaredReachedValueMachine(opts, observed) },
          { artifactSchema: 3 },
        )
      ).some((finding) => finding.includes('state work: onDone arm')),
    ).toBe(true);
    expect(observed).toEqual([]);
  });

  it.each(['string', 'boolean', 'number'] as const)(
    'reuses a predecessor-produced %s through fixed reached context',
    async (value) => {
      expect(
        await checkFsmCoverage({
          machine: reachedPrimitiveChildMachine({ value }),
        }),
      ).toEqual([]);
    },
  );

  it.each([
    { contradictory: true },
    { shadowed: true },
    { nested: true },
    { fifthRead: true },
  ])('retains bounded reached-value refusal for %j', async (opts) => {
    expect(
      await checkFsmCoverage({ machine: reachedPrimitiveChildMachine(opts) }),
    ).not.toEqual([]);
  });

  it.each([
    { prefixLength: 4, requireRight: false },
    { prefixLength: 3, requireRight: true },
  ])(
    'replays a queued target successor after $prefixLength child predecessors (require right $requireRight)',
    async ({ prefixLength, requireRight }) => {
      const observed: Array<{ route: string; reply: string; guard: string }> =
        [];
      const findings = await checkFsmCoverage(
        {
          machine: queuedTargetSuccessorMachine({
            prefixLength,
            requireRight,
            observed,
          }),
        },
        { artifactSchema: 3 },
      );
      expect(findings).toEqual([]);
      expect(observed.length).toBeGreaterThan(0);
      if (!requireRight)
        expect(observed[0]?.route).toBe('/left/left/left/left');
      for (const result of observed) {
        expect(result.route.split('/').filter(Boolean)).toHaveLength(
          prefixLength,
        );
        expect(result.reply).toMatch(/\S/);
        expect(['approved', 'refused']).toContain(result.guard);
        if (requireRight) expect(result.route.endsWith('/right')).toBe(true);
      }
    },
  );

  it('reports bounded exhaustion after rejecting queued target successors', async () => {
    const observed: Array<{ route: string; reply: string; guard: string }> = [];
    const findings = await checkFsmCoverage(
      {
        machine: queuedTargetSuccessorMachine({
          prefixLength: 4,
          requireRight: true,
          observed,
        }),
      },
      { artifactSchema: 3 },
    );
    expect(findings).toContain(
      'state audit: result "ok" remains unproved: exhausted 8-invocation path depth; exhausted 64-attempt path budget',
    );
    expect(observed).toEqual([]);
  });

  it.each([{ shadowed: true }, { escapesTarget: true }])(
    'refuses a queued target successor without actual entry %j',
    async (options) => {
      const observed: Array<{ route: string; reply: string; guard: string }> =
        [];
      const findings = await checkFsmCoverage(
        { machine: queuedTargetSuccessorMachine({ ...options, observed }) },
        { artifactSchema: 3 },
      );
      expect(findings.some((finding) => finding.includes('state audit:'))).toBe(
        true,
      );
      expect(observed).toEqual([]);
    },
  );

  it('covers canonical question-resumed approved and refused arms by actual XState actions', async () => {
    const observed: Array<{
      guard: string;
      questionId: string;
      sourceItem: string;
      reply: string;
    }> = [];
    expect(
      await checkFsmCoverage(
        { machine: questionResumedMachine({ observed }) },
        { artifactSchema: 3 },
      ),
    ).toEqual([]);
    for (const key of ['approved', 'refused'])
      expect(
        observed.some(
          (value) =>
            value.guard === key &&
            value.questionId === 'work' &&
            value.sourceItem === 'X-1' &&
            value.reply.trim() !== '',
        ),
      ).toBe(true);
  });

  it.each([false, true])(
    'replays successive canonical questions before approved and refused outcomes (preemptive %s)',
    async (preemptive) => {
      const observed: Array<{
        guard: string;
        replies: Array<Record<string, unknown>>;
      }> = [];
      expect(
        await checkFsmCoverage(
          { machine: successiveQuestionMachine({ observed, preemptive }) },
          { artifactSchema: 3 },
        ),
      ).toEqual([]);
      expect(new Set(observed.map((value) => value.guard))).toEqual(
        new Set(['approved', 'refused']),
      );
      for (const result of observed) {
        expect(result.replies).toHaveLength(2);
        for (const reply of result.replies)
          expect(reply).toMatchObject({
            questionId: 'work',
            resumeStateId: 'work',
            sourceItem: 'X-1',
            asker: { kind: 'role', roleId: 'writer' },
            question: expect.any(String),
            answer: expect.stringMatching(/\S/),
          });
      }
    },
  );

  it.each(
    [
      {
        options: { malformedLaterQuestion: true },
        finding: 'has no matching canonical scalar pending Boss question',
      },
      {
        options: { blankResumes: true },
        finding: 'a blank BOSS_REPLY answer must not resume the state',
      },
      {
        options: { requiredReplies: 8 },
        finding: 'exhausted 8-invocation path depth',
      },
    ].flatMap((value) =>
      [false, true].map((preemptive) => ({ ...value, preemptive })),
    ),
  )(
    'retains successive-question refusal for $options (preemptive $preemptive)',
    async ({ options, finding, preemptive }) => {
      const observed: Array<{
        guard: string;
        replies: Array<Record<string, unknown>>;
      }> = [];
      const findings = await checkFsmCoverage(
        {
          machine: successiveQuestionMachine({
            ...options,
            observed,
            preemptive,
          }),
        },
        { artifactSchema: 3 },
      );
      expect(findings.some((value) => value.includes(finding))).toBe(true);
      if (!options.blankResumes) expect(observed).toEqual([]);
    },
  );

  it('uses the reached question arm after entry changes its guards', async () => {
    const observed: Array<{
      guard: string;
      questionId: string;
      sourceItem: string;
      reply: string;
    }> = [];
    expect(
      await checkFsmCoverage(
        { machine: questionResumedMachine({ entryPhase: true, observed }) },
        { artifactSchema: 3 },
      ),
    ).toEqual([]);
    expect(new Set(observed.map((value) => value.guard))).toEqual(
      new Set(['approved', 'refused']),
    );
  });

  it.each([
    {
      options: { indirectWait: true },
      finding:
        'did not suspend in awaitBossReply or a branch-local Boss-reply wait state',
    },
    {
      options: { wrongQuestion: true },
      finding: 'has no matching canonical scalar pending Boss question',
    },
    {
      options: { blankResumes: true },
      finding: 'a blank BOSS_REPLY answer must not resume the state',
    },
  ])(
    'retains reached-question refusal for $options',
    async ({ options, finding }) => {
      expect(
        (
          await checkFsmCoverage(
            {
              machine: questionResumedMachine({ entryPhase: true, ...options }),
            },
            { artifactSchema: 3 },
          )
        ).some((value) => value.includes(finding)),
      ).toBe(true);
    },
  );

  it.each([
    { wrongQuestion: true },
    { contradictory: true },
    { shadowed: true },
    { blankResumes: true },
  ])('retains question-resumed arm refusal for %j', async (opts) => {
    expect(
      await checkFsmCoverage(
        { machine: questionResumedMachine(opts) },
        { artifactSchema: 3 },
      ),
    ).not.toEqual([]);
  });

  it('requires the declared resumed target after the original guard accepts', async () => {
    const findings = await checkFsmCoverage(
      { machine: questionResumedMachine({ escapesTarget: true }) },
      { artifactSchema: 3 },
    );
    expect(findings).toContain(
      'state work: onDone arm 0 did not reach after after canonical Boss reply',
    );
    expect(findings.some((finding) => finding.includes('unsatisfiable'))).toBe(
      false,
    );
  });

  it('retains dead child approval and blank-reply failures without context patches', async () => {
    expect(
      await checkFsmCoverage({
        machine: childChainMachine({ deadDecision: true }),
      }),
    ).toContainEqual(
      expect.stringMatching(
        /^state decide: nested playbook onDone arm 0: .*exhausted.*path/,
      ),
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
      'state child: nested playbook onDone arm 0 has no reachable entry under probing (dead or unsupported entry path)',
    );
  });

  it('retains unsatisfiable and shadowed child arms after actual entry (verification-43)', async () => {
    expect(
      await checkFsmCoverage({
        machine: accumulatedChildMachine({ deadChildArm: true }),
      }),
    ).toContainEqual(
      expect.stringMatching(
        /^state child: nested playbook onDone arm 1: .*exhausted.*path/,
      ),
    );
    expect(
      await checkFsmCoverage({
        machine: accumulatedChildMachine({ shadowedChildArm: true }),
      }),
    ).toContainEqual(
      expect.stringMatching(
        /^state child: nested playbook onDone arm 1: .*exhausted.*path/,
      ),
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
      /onDone arm 0 remains unproved: .*exhausted.*path/,
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
  it('budgets root and nested entry events equally for both initial-transition forms', () => {
    const config = (objectInitial: boolean) => ({
      initial: objectInitial ? { target: 'group' } : 'group',
      states: {
        group: {
          initial: objectInitial ? { target: 'ready' } : 'ready',
          // Enough distinct events to exceed the minimum timeout floor.
          states: {
            ready: {
              on: Object.fromEntries(
                Array.from({ length: 6 }, (_, index) => [
                  `GO_${index}`,
                  '#done',
                ]),
              ),
            },
          },
          on: { CANCEL: '#done' },
        },
        done: { id: 'done', type: 'final' as const },
      },
    });
    const stringForm = setup({}).createMachine(config(false));
    const objectForm = setup({}).createMachine(config(true));
    expect(fsmCoverageTestTimeout({ machine: objectForm })).toBe(
      fsmCoverageTestTimeout({ machine: stringForm }),
    );
    expect(fsmCoverageTestTimeout({ machine: objectForm })).toBeGreaterThan(
      fsmCoverageTestTimeout({
        machine: setup({}).createMachine({
          initial: 'done',
          states: { done: { type: 'final' } },
        }),
      }),
    );
  });

  it(
    'executes emitted maintained DEV coverage with its capped timeout and preserves smaller bounds',
    async () => {
      expect(fsmCoverageTestTimeout(devFsm)).toBe(300_000);
      expect(
        fsmCoverageTestTimeout({
          machine: successiveQuestionMachine({ preemptive: true }),
        }),
      ).toBe(300_000);
      expect(
        fsmCoverageTestTimeout({
          machine: setup({}).createMachine({
            initial: 'done',
            states: { done: { type: 'final' } },
          }),
        }),
      ).toBeLessThan(300_000);
      const root = await mkdtemp(join(tmpdir(), 'slc-dev-coverage-suite-'));
      try {
        await symlink(
          join(repoRoot, 'node_modules'),
          join(root, 'node_modules'),
        );
        await writeFile(join(root, 'package.json'), '{"type":"module"}');
        for (const ext of ['ts', 'js'])
          await copyFile(
            join(referenceDir, `../dev.playbook/dev.fsm.${ext}`),
            join(root, `dev.fsm.${ext}`),
          );
        await writeFile(
          join(root, 'dev.fsm.coverage.test.ts'),
          generateFsmCoverageTest({
            basename: 'dev',
            fsmModule: './dev.fsm.js',
            fsmSourceFile: './dev.fsm.ts',
            verifyModule: join(repoRoot, 'src/verify-coverage.ts'),
          }),
        );
        const config = join(root, 'vitest.config.mjs');
        await writeFile(
          config,
          `export default ${JSON.stringify({ cacheDir: join(root, '.vite'), test: { cache: false, maxWorkers: 1, include: ['dev.fsm.coverage.test.ts'] } })};\n`,
        );
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            join(repoRoot, 'node_modules/vitest/vitest.mjs'),
            'run',
            '--root',
            root,
            '--config',
            config,
          ],
          { cwd: root, timeout: 310_000 },
        );
        expect(stdout).toContain('1 passed');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    fsmCoverageTestTimeout(devFsm) + 10_000,
  );

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

describe('cooperative coverage lifetime', () => {
  const tracked = (onStart: () => void = () => {}) => {
    const lifetime = { started: 0, stopped: 0 };
    const base = goodMachine();
    const machine = setup({
      actors: {
        captain: fromPromise(async () => {
          throw new Error('coverage supplies captain');
        }),
        lifetime: fromCallback(() => {
          lifetime.started++;
          onStart();
          return () => {
            lifetime.stopped++;
          };
        }),
      },
    }).createMachine({ ...base.config, invoke: { src: 'lifetime' } } as never);
    return { machine, lifetime };
  };

  it('does no actor work for an already canceled check', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel coverage before start');
    controller.abort(reason);
    const fixture = tracked();
    await expect(
      checkFsmCoverage(fixture, { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(fixture.lifetime).toEqual({ started: 0, stopped: 0 });
  });

  it('cancels pending driving and stops every actual actor', async () => {
    const controller = new AbortController();
    const reason = new Error('cancel active coverage');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fixture = tracked(() => {
      timer ??= setTimeout(() => controller.abort(reason), 1);
    });
    try {
      await expect(
        checkFsmCoverage(fixture, { signal: controller.signal }),
      ).rejects.toBe(reason);
      expect(fixture.lifetime.started).toBeGreaterThan(0);
      expect(fixture.lifetime.stopped).toBe(fixture.lifetime.started);
    } finally {
      clearTimeout(timer);
    }
  });

  it('reports a deadline after finite synchronous actor work and cleans up', async () => {
    const fixture = tracked(() => {
      const until = performance.now() + 150;
      while (performance.now() < until) {
        /* Deliberately finite, not preemptible. */
      }
    });
    await expect(
      checkFsmCoverage(fixture, { timeoutMs: 100 }),
    ).rejects.toBeInstanceOf(FsmCoverageDeadlineError);
    expect(fixture.lifetime.started).toBeGreaterThan(0);
    expect(fixture.lifetime.stopped).toBe(fixture.lifetime.started);
  });

  it('does not convert cancellation inside a throwing guard into a coverage finding', async () => {
    const controller = new AbortController();
    const reason = new Error('guard canceled coverage');
    const machine = goodMachine({
      guards: {
        cancel: () => {
          controller.abort(reason);
          throw new Error('guard also threw');
        },
      },
      onDone: [{ guard: 'cancel', target: '#done' }, needsBossReplyArm()],
    });
    await expect(
      checkFsmCoverage({ machine }, { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it('isolates concurrent cancellation and leaves subsequent checks clean', async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canceled = tracked(() => {
      timer ??= setTimeout(
        () => controller.abort(new Error('only this run')),
        1,
      );
    });
    const healthy = tracked();
    try {
      const results = await Promise.allSettled([
        checkFsmCoverage(canceled, { signal: controller.signal }),
        checkFsmCoverage(healthy),
      ]);
      expect(results[0].status).toBe('rejected');
      expect(results[1]).toEqual({ status: 'fulfilled', value: [] });
      expect(canceled.lifetime.stopped).toBe(canceled.lifetime.started);
      expect(healthy.lifetime.stopped).toBe(healthy.lifetime.started);
      expect(await checkFsmCoverage({ machine: goodMachine() })).toEqual([]);
    } finally {
      clearTimeout(timer);
    }
  });
});

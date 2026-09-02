// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/**
 * Stable working-leaf ids that may suspend on a Boss question and be resumed
 * by `BOSS_REPLY`. The machine has at most one active Captain task, so the
 * scalar Boss-reply form applies.
 */
const RESUMABLE_STATE_IDS = ['transform'] as const;
type ResumableStateId = (typeof RESUMABLE_STATE_IDS)[number];

/** Stable ids Boss may pre-empt with `BOSS_INTERRUPT`. */
const INTERRUPT_TARGET_IDS = ['transform'] as const;
type InterruptTargetId = (typeof INTERRUPT_TARGET_IDS)[number];

/** JSON-safe normalization of a rejected invocation, retained for inspection. */
export interface NormalizedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Question record raised by a suspended working leaf. */
export interface PendingBossQuestion {
  readonly questionId: string;
  readonly resumeStateId: string;
  readonly sourceItem: string;
  readonly asker: { readonly kind: 'captain' };
  readonly question: string;
}

/** Typed input for the direct `captain` actor. */
export interface CaptainInput {
  readonly stateId: string;
  readonly sourceItem: string;
  readonly prompt: string;
  /** Host-supplied definition bytes backing the prompt's `<definition>` placeholder. */
  readonly definition: string;
  readonly result: Readonly<Record<string, string>>;
  readonly pendingBossQuestion?: PendingBossQuestion;
  readonly bossReply?: string;
}

/** Discriminated result contract of the direct `captain` actor. */
export type CaptainOutput =
  | { readonly guard: 'compiled' }
  | { readonly guard: 'rejected' }
  | { readonly guard: 'needsBossReply'; readonly question: string };

/** Immutable, host-owned machine input for the session. */
export interface MachineInput {
  readonly definition: string;
}

/** Typed Boss surfaces: entry event, pre-emptive interrupt, and Boss reply. */
export type PlaybookEvent =
  | { type: 'TRANSFORMATION_REQUEST'; request?: string }
  | { type: 'BOSS_INTERRUPT'; targetId: InterruptTargetId }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

interface PlaybookContext {
  /** Host-owned configuration; never replaced by a Boss event or actor output. */
  definition: string;
  request?: string;
  lastError?: NormalizedError;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

/** No parallel group in this package. */
export const concurrentRoleSets: readonly (readonly string[])[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isResumableStateId(value: string): value is ResumableStateId {
  return (RESUMABLE_STATE_IDS as readonly string[]).includes(value);
}

/**
 * Narrows an unknown event's `output` structurally to the declared `captain`
 * contract. Returns `undefined` for output that does not satisfy it, including
 * `needsBossReply` without a `question`.
 */
function captainOutputOf(event: unknown): CaptainOutput | undefined {
  if (!isRecord(event) || !isRecord(event.output)) {
    return undefined;
  }
  const output = event.output;
  if (output.guard === 'compiled') {
    return { guard: 'compiled' };
  }
  if (output.guard === 'rejected') {
    return { guard: 'rejected' };
  }
  if (output.guard === 'needsBossReply' && isNonEmptyString(output.question)) {
    return { guard: 'needsBossReply', question: output.question };
  }
  return undefined;
}

/** Narrows an unknown event's `error` structurally to a JSON-safe record. */
function normalizedErrorOf(event: unknown): NormalizedError {
  const error = isRecord(event) ? event.error : undefined;
  const name =
    error instanceof Error
      ? error.name
      : isRecord(error) && typeof error.name === 'string'
        ? error.name
        : 'Error';
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error) && typeof error.message === 'string'
        ? error.message
        : typeof error === 'string'
          ? error
          : 'captain actor rejected without a normalized error';
  const stack =
    error instanceof Error
      ? error.stack
      : isRecord(error)
        ? error.stack
        : undefined;
  return typeof stack === 'string'
    ? { name, message, stack }
    : { name, message };
}

interface BossInterruptTransition {
  guard: { type: 'canInterruptInto'; params: { targetId: InterruptTargetId } };
  target: string;
  reenter: true;
  actions: 'clearBossReplyContext';
}

/** Builds one guarded `BOSS_INTERRUPT` arm per jumpable state id. */
function bossInterrupts(
  ids: readonly InterruptTargetId[],
): BossInterruptTransition[] {
  return ids.map((id) => ({
    guard: { type: 'canInterruptInto', params: { targetId: id } },
    target: `#${id}`,
    reenter: true,
    actions: 'clearBossReplyContext',
  }));
}

interface ResumeTransition {
  guard: { type: 'canResume'; params: { stateId: ResumableStateId } };
  target: string;
  reenter: true;
  actions: 'acceptBossReply';
}

/** Builds one guarded `BOSS_REPLY` resume arm per registered working-leaf id. */
function resumableStates(ids: readonly ResumableStateId[]): ResumeTransition[] {
  return ids.map((id) => ({
    guard: { type: 'canResume', params: { stateId: id } },
    target: `#${id}`,
    reenter: true,
    actions: 'acceptBossReply',
  }));
}

export const machine = setup({
  types: {
    context: {} as PlaybookContext,
    events: {} as PlaybookEvent,
    input: {} as MachineInput,
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    hasTransformationRequest: ({ context, event }) => {
      const supplied =
        event.type === 'TRANSFORMATION_REQUEST' ? event.request : undefined;
      return isNonEmptyString(supplied) || isNonEmptyString(context.request);
    },
    canInterruptInto: (
      { context, event },
      params: { targetId: InterruptTargetId },
    ) =>
      event.type === 'BOSS_INTERRUPT' &&
      event.targetId === params.targetId &&
      isNonEmptyString(context.request),
    canResume: ({ context, event }, params: { stateId: ResumableStateId }) => {
      if (event.type !== 'BOSS_REPLY' || !isNonEmptyString(event.answer)) {
        return false;
      }
      const pending = context.pendingBossQuestion;
      if (pending === undefined || pending.resumeStateId !== params.stateId) {
        return false;
      }
      return (
        event.questionId === undefined ||
        event.questionId === pending.questionId
      );
    },
    captainCompiled: ({ event }) =>
      captainOutputOf(event)?.guard === 'compiled',
    captainRejected: ({ event }) =>
      captainOutputOf(event)?.guard === 'rejected',
    captainAsksBoss: ({ event }, params: { stateId: string }) =>
      captainOutputOf(event)?.guard === 'needsBossReply' &&
      isResumableStateId(params.stateId),
  },
  actions: {
    copyTransformationRequest: assign(({ event }): Partial<PlaybookContext> => {
      if (
        event.type !== 'TRANSFORMATION_REQUEST' ||
        !isNonEmptyString(event.request)
      ) {
        return {};
      }
      return { request: event.request };
    }),
    clearBossReplyContext: assign(
      ({ context }): Partial<PlaybookContext> =>
        context.pendingBossQuestion === undefined &&
        context.bossReply === undefined
          ? {}
          : { pendingBossQuestion: undefined, bossReply: undefined },
    ),
    setPendingBossQuestion: assign(
      (
        { context, event },
        params: { stateId: ResumableStateId; sourceItem: string },
      ): Partial<PlaybookContext> => {
        const output = captainOutputOf(event);
        if (output === undefined || output.guard !== 'needsBossReply') {
          return {};
        }
        return {
          pendingBossQuestion: {
            questionId: params.stateId,
            resumeStateId: params.stateId,
            sourceItem: params.sourceItem,
            asker: { kind: 'captain' },
            question: output.question,
          },
          ...(context.bossReply === undefined ? {} : { bossReply: undefined }),
        };
      },
    ),
    acceptBossReply: assign(
      ({ event }): Partial<PlaybookContext> =>
        event.type === 'BOSS_REPLY' ? { bossReply: event.answer } : {},
    ),
    rememberCaptainError: assign(
      ({ event }): Partial<PlaybookContext> => ({
        lastError: normalizedErrorOf(event),
      }),
    ),
    rememberMalformedCaptainOutput: assign(
      (): Partial<PlaybookContext> => ({
        lastError: {
          name: 'MalformedCaptainOutput',
          message:
            'Captain output did not satisfy the declared result contract of GEARS2FSM-1.',
        },
      }),
    ),
    rememberMalformedBossReply: assign(
      (): Partial<PlaybookContext> => ({
        lastError: {
          name: 'MalformedBossReply',
          message:
            'BOSS_REPLY carried an empty answer or named no pending question.',
        },
      }),
    ),
  },
}).createMachine({
  id: 'gears2fsm',
  context: ({ input }): PlaybookContext => ({ definition: input.definition }),
  initial: 'ready',
  on: {
    BOSS_INTERRUPT: bossInterrupts(INTERRUPT_TARGET_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Idle hub awaiting a transformation request naming a gears Source and an fsm Target.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Idle hub awaiting a transformation request naming a gears Source and an fsm Target.',
        },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'hasTransformationRequest',
          target: 'transform',
          actions: ['copyTransformationRequest', 'clearBossReplyContext'],
        },
      },
    },
    transform: {
      id: 'transform',
      description:
        'Captain carries out the GEARS-to-FSM transformation as the relayed definition specifies.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'transform',
          description:
            'Captain carries out the GEARS-to-FSM transformation as the relayed definition specifies.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'transform',
          sourceItem: 'GEARS2FSM-1',
          prompt: [
            'Follow the definition relayed between the `--- DEFINITION ---` and `--- END DEFINITION ---` lines exactly, adding no rules of your own: read the named Source and write the named Target as the definition specifies.',
            'If the Source cannot be transformed under the definition, do not guess: leave the Target unwritten and report the concrete reason.',
            '--- DEFINITION ---',
            '<definition>',
            '--- END DEFINITION ---',
          ].join('\n'),
          definition: context.definition,
          result: {
            compiled:
              'Captain wrote the named Target as the relayed definition specifies.',
            rejected:
              'Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.',
            needsBossReply:
              "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.",
          },
          ...(context.pendingBossQuestion === undefined
            ? {}
            : { pendingBossQuestion: context.pendingBossQuestion }),
          ...(context.bossReply === undefined
            ? {}
            : { bossReply: context.bossReply }),
        }),
        onDone: [
          {
            guard: 'captainCompiled',
            target: 'compiled',
            actions: 'clearBossReplyContext',
          },
          {
            guard: 'captainRejected',
            target: 'rejected',
            actions: 'clearBossReplyContext',
          },
          {
            guard: {
              type: 'captainAsksBoss',
              params: { stateId: 'transform' },
            },
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: { stateId: 'transform', sourceItem: 'GEARS2FSM-1' },
            },
          },
          {
            target: 'failed',
            actions: 'rememberMalformedCaptainOutput',
          },
        ],
        onError: {
          target: 'failed',
          actions: 'rememberCaptainError',
        },
      },
    },
    awaitBossReply: {
      id: 'awaitBossReply',
      description: "Waiting for Boss to answer the acting agent's question.",
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'awaitBossReply',
          description:
            "Waiting for Boss to answer the acting agent's question.",
        },
      },
      on: {
        BOSS_REPLY: [
          ...resumableStates(RESUMABLE_STATE_IDS),
          {
            target: 'failed',
            actions: 'rememberMalformedBossReply',
          },
        ],
      },
    },
    failed: {
      id: 'failed',
      description:
        'The transformation run failed; parked with typed context for Boss recovery.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'The transformation run failed; parked with typed context for Boss recovery.',
        },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'hasTransformationRequest',
          target: 'transform',
          actions: ['copyTransformationRequest', 'clearBossReplyContext'],
        },
      },
    },
    compiled: {
      id: 'compiled',
      type: 'final',
      description:
        'Captain wrote the named Target as the relayed definition specifies.',
      meta: {
        playbook: {
          stateId: 'compiled',
          description:
            'Captain wrote the named Target as the relayed definition specifies.',
        },
      },
    },
    rejected: {
      id: 'rejected',
      type: 'final',
      description:
        'Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.',
      meta: {
        playbook: {
          stateId: 'rejected',
          description:
            'Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.',
        },
      },
    },
  },
});

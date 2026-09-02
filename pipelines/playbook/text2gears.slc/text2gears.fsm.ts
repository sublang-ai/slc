// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/** Stable id of the working leaf a Boss reply resumes. */
export type ResumableStateId = 'transform';

/** Stable id of the state a Boss interrupt may pre-empt. */
export type InterruptTargetId = 'transform';

/** JSON-safe normalized error retained for Boss recovery. */
export interface NormalizedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Boss question raised by the acting agent and awaiting a Boss reply. */
export interface PendingBossQuestion {
  readonly questionId: ResumableStateId;
  readonly resumeStateId: ResumableStateId;
  readonly sourceItem: string;
  readonly asker: { readonly kind: 'captain' };
  readonly question: string;
}

/**
 * Host-owned machine input. `definition` is the exact bytes of the definition
 * file the request names; it stays immutable for the session.
 */
export interface Text2GearsInput {
  readonly definition: string;
}

/** Typed machine context. */
export interface Text2GearsContext {
  readonly definition: string;
  readonly bossIntent?: string;
  readonly pendingBossQuestion?: PendingBossQuestion;
  readonly bossReply?: string;
  readonly lastError?: NormalizedError;
}

/** Every Boss-originated event this machine accepts. */
export type Text2GearsEvent =
  | { readonly type: 'BOSS_INTENT'; readonly bossIntent: string }
  | {
      readonly type: 'BOSS_INTERRUPT';
      readonly targetId: InterruptTargetId;
      readonly bossIntent: string;
    }
  | {
      readonly type: 'BOSS_REPLY';
      readonly answer: string;
      readonly questionId?: string;
    };

/** Input of the direct Captain actor. */
export interface CaptainInput {
  readonly stateId: ResumableStateId;
  readonly sourceItem: string;
  readonly prompt: string;
  readonly definition: string;
  readonly bossIntent?: string;
  readonly pendingBossQuestion?: PendingBossQuestion;
  readonly bossReply?: string;
  readonly result: Readonly<Record<string, string>>;
}

/** Adjudicated output of the direct Captain actor for TEXT2GEARS-1. */
export type CaptainOutput =
  | { readonly guard: 'compiled' }
  | { readonly guard: 'rejected' }
  | { readonly guard: 'needsBossReply'; readonly question: string };

/** No parallel group in this package. */
export const concurrentRoleSets: readonly (readonly string[])[] = [];

const TRANSFORM_PROMPT = [
  'Follow the definition relayed between the `--- DEFINITION ---` and `--- END DEFINITION ---` lines exactly, adding no rules of your own: read the named Source and write the named Target as the definition specifies.',
  'If the Source cannot be transformed under the definition, do not guess: leave the Target unwritten and report the concrete reason.',
  '--- DEFINITION ---',
  '<definition>',
  '--- END DEFINITION ---',
].join('\n');

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

const TRANSFORM_RESULT = {
  compiled:
    'Captain wrote the named Target as the relayed definition specifies.',
  rejected:
    'Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.',
  needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
} as const;

/**
 * Structurally narrow an invoked actor's `output` to this state's Captain
 * contract. XState exposes it as `unknown`, so nothing is read unchecked.
 */
const readCaptainOutput = (event: unknown): CaptainOutput | undefined => {
  if (typeof event !== 'object' || event === null) return undefined;
  const output: unknown = (event as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) return undefined;
  const guard: unknown = (output as { guard?: unknown }).guard;
  if (guard === 'compiled' || guard === 'rejected') return { guard };
  if (guard === 'needsBossReply') {
    const question: unknown = (output as { question?: unknown }).question;
    if (typeof question === 'string' && question.trim() !== '') {
      return { guard, question };
    }
  }
  return undefined;
};

/** Narrow an invoke error event to a JSON-safe `{ name, message, stack? }`. */
const normalizeError = (event: unknown): NormalizedError => {
  const error: unknown =
    typeof event === 'object' && event !== null
      ? (event as { error?: unknown }).error
      : undefined;
  if (error instanceof Error) {
    return typeof error.stack === 'string'
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: error.name, message: error.message };
  }
  return {
    name: 'Error',
    message:
      typeof error === 'string' && error.trim() !== ''
        ? error
        : 'The captain actor rejected without an Error value.',
  };
};

/** Read a non-empty Boss intent from a fresh-directive event. */
const readBossIntent = (event: unknown): string | undefined => {
  if (typeof event !== 'object' || event === null) return undefined;
  const type: unknown = (event as { type?: unknown }).type;
  if (type !== 'BOSS_INTENT' && type !== 'BOSS_INTERRUPT') return undefined;
  const intent: unknown = (event as { bossIntent?: unknown }).bossIntent;
  return typeof intent === 'string' && intent.trim() !== ''
    ? intent
    : undefined;
};

const INTERRUPT_TARGET_IDS = [
  'transform',
] as const satisfies readonly InterruptTargetId[];
const RESUMABLE_STATE_IDS = [
  'transform',
] as const satisfies readonly ResumableStateId[];

/** One guarded, reentering `BOSS_INTERRUPT` arm per jumpable state id. */
const bossInterrupts = (ids: readonly InterruptTargetId[]) =>
  ids.map(
    (id) =>
      ({
        guard: { type: 'isInterruptTarget', params: { id } },
        target: `#${id}` as const,
        reenter: true,
        actions: { type: 'startFreshRequest' },
      }) as const,
  );

/** One guarded `BOSS_REPLY` arm per registered resume destination. */
const resumableStates = (ids: readonly ResumableStateId[]) =>
  ids.map(
    (id) =>
      ({
        guard: { type: 'canResume', params: { id } },
        target: `#${id}` as const,
        actions: { type: 'answerBossQuestion' },
      }) as const,
  );

export const text2gearsMachine = setup({
  types: {
    context: {} as Text2GearsContext,
    events: {} as Text2GearsEvent,
    input: {} as Text2GearsInput,
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(() => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    hasFreshIntent: ({ event }) => readBossIntent(event) !== undefined,
    isInterruptTarget: (
      { event },
      params: { readonly id: InterruptTargetId },
    ) => {
      if (event.type !== 'BOSS_INTERRUPT') return false;
      if (event.targetId !== params.id) return false;
      return readBossIntent(event) !== undefined;
    },
    isCompiled: ({ event }) => readCaptainOutput(event)?.guard === 'compiled',
    isRejected: ({ event }) => readCaptainOutput(event)?.guard === 'rejected',
    isBossQuestion: ({ event }) =>
      readCaptainOutput(event)?.guard === 'needsBossReply',
    canResume: (
      { context, event },
      params: { readonly id: ResumableStateId },
    ) => {
      if (event.type !== 'BOSS_REPLY') return false;
      const answer: unknown = event.answer;
      if (typeof answer !== 'string' || answer.trim() === '') return false;
      const pending = context.pendingBossQuestion;
      if (pending === undefined) return false;
      if (pending.resumeStateId !== params.id) return false;
      const questionId: unknown = event.questionId;
      if (questionId === undefined) return true;
      return questionId === pending.questionId;
    },
  },
  actions: {
    startFreshRequest: assign(({ event }) => {
      const bossIntent = readBossIntent(event);
      if (bossIntent === undefined) return {};
      return {
        bossIntent,
        pendingBossQuestion: undefined,
        bossReply: undefined,
        lastError: undefined,
      };
    }),
    setPendingBossQuestion: assign(
      (
        { event },
        params: {
          readonly stateId: ResumableStateId;
          readonly sourceItem: string;
        },
      ) => {
        const output = readCaptainOutput(event);
        if (output === undefined || output.guard !== 'needsBossReply')
          return {};
        return {
          pendingBossQuestion: {
            questionId: params.stateId,
            resumeStateId: params.stateId,
            sourceItem: params.sourceItem,
            asker: { kind: 'captain' },
            question: output.question,
          } satisfies PendingBossQuestion,
          bossReply: undefined,
        };
      },
    ),
    answerBossQuestion: assign(({ event }) => {
      if (event.type !== 'BOSS_REPLY') return {};
      return { bossReply: event.answer };
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
    rememberCaptainError: assign({
      lastError: ({ event }) => normalizeError(event),
    }),
    rememberMalformedResult: assign({
      lastError: () =>
        ({
          name: 'MalformedCaptainResult',
          message:
            'The captain actor returned no result matching the TEXT2GEARS-1 result contract.',
        }) satisfies NormalizedError,
    }),
    rememberMalformedBossReply: assign({
      lastError: () =>
        ({
          name: 'MalformedBossReply',
          message:
            'BOSS_REPLY carried an empty answer or named no pending Boss question.',
        }) satisfies NormalizedError,
    }),
  },
}).createMachine({
  id: 'text2gears',
  initial: 'ready',
  context: ({ input }) => ({ definition: input.definition }),
  on: {
    BOSS_INTERRUPT: bossInterrupts(INTERRUPT_TARGET_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description: 'Idle hub awaiting a transformation request from Boss.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description: 'Idle hub awaiting a transformation request from Boss.',
        },
      },
      on: {
        BOSS_INTENT: {
          guard: 'hasFreshIntent',
          target: 'transform',
          actions: 'startFreshRequest',
        },
      },
    },
    transform: {
      id: 'transform',
      description:
        'Captain carries out the text-to-GEARS transformation as the relayed definition specifies.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'transform',
          description:
            'Captain carries out the text-to-GEARS transformation as the relayed definition specifies.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'transform',
          sourceItem: 'TEXT2GEARS-1',
          prompt: TRANSFORM_PROMPT,
          definition: context.definition,
          ...(context.bossIntent !== undefined
            ? { bossIntent: context.bossIntent }
            : {}),
          ...(context.pendingBossQuestion !== undefined
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
          result: TRANSFORM_RESULT,
        }),
        onDone: [
          {
            guard: 'isCompiled',
            target: 'compiled',
            actions: 'clearBossReplyContext',
          },
          {
            guard: 'isRejected',
            target: 'rejected',
            actions: 'clearBossReplyContext',
          },
          {
            guard: 'isBossQuestion',
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: { stateId: 'transform', sourceItem: 'TEXT2GEARS-1' },
            },
          },
          {
            target: 'failed',
            actions: ['rememberMalformedResult', 'clearBossReplyContext'],
          },
        ],
        onError: {
          target: 'failed',
          actions: ['rememberCaptainError', 'clearBossReplyContext'],
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
            actions: ['rememberMalformedBossReply', 'clearBossReplyContext'],
          },
        ],
      },
    },
    failed: {
      id: 'failed',
      description:
        'Recoverable failure parked for Boss: the transformation did not settle on an authored outcome.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'Recoverable failure parked for Boss: the transformation did not settle on an authored outcome.',
        },
      },
      on: {
        BOSS_INTENT: {
          guard: 'hasFreshIntent',
          target: 'transform',
          actions: 'startFreshRequest',
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

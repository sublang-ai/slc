// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/* -------------------------------------------------------------------------
 * Source-derived constants (GEARS package: FSM-to-Runtime Linking)
 * ---------------------------------------------------------------------- */

/** LINK-1 blockquote, verbatim after removing the outer GEARS marker. */
const LINK_1_PROMPT = [
  'Follow the definition relayed between the `--- DEFINITION ---` and `--- END DEFINITION ---` lines exactly, adding no rules of your own: read the named Source and write the named Target as the definition specifies.',
  'If the Source cannot be transformed under the definition, do not guess: leave the Target unwritten and report the concrete reason.',
  '--- DEFINITION ---',
  '<definition>',
  '--- END DEFINITION ---',
].join('\n');

/** Universal Boss-reply result description added by this compiler. */
const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

/** LINK-1 `Results:` bullets, verbatim and in declared order. */
const LINK_1_RESULT = {
  compiled:
    'Captain wrote the named Target as the relayed definition specifies.',
  rejected:
    'Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.',
  needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
} as const satisfies Readonly<Record<string, string>>;

const READY_DESCRIPTION =
  'Idle hub awaiting a transformation request from Boss.';
const LINKING_DESCRIPTION =
  'Captain carries out the FSM-to-runtime linking as specified.';
const AWAIT_BOSS_REPLY_DESCRIPTION =
  "Waiting for Boss to answer the acting agent's question.";
const FAILED_DESCRIPTION =
  'The linking task failed; the normalized error is retained for Boss recovery.';
const COMPILED_DESCRIPTION = LINK_1_RESULT.compiled;
const REJECTED_DESCRIPTION = LINK_1_RESULT.rejected;

/* -------------------------------------------------------------------------
 * Typed contracts exported for the linker
 * ---------------------------------------------------------------------- */

export type ResumableStateId = 'linking';
export type InterruptTargetId = 'linking';

/** Working leaves that register a Boss-reply resume route. */
export const resumableStateIds = [
  'linking',
] as const satisfies readonly ResumableStateId[];

/** Jumpable `BOSS_INTERRUPT` targets. Final and wait states are excluded. */
export const interruptTargetIds = [
  'linking',
] as const satisfies readonly InterruptTargetId[];

/** No parallel group in this package. */
export const concurrentRoleSets: readonly (readonly string[])[] = [];

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: ResumableStateId;
  sourceItem: string;
  asker: { kind: 'captain' } | { kind: 'role'; roleId: string };
  question: string;
}

export interface CaptainInput {
  stateId: string;
  sourceItem: string;
  prompt: string;
  /** Host-supplied bytes backing the `<definition>` prompt placeholder. */
  definition: string;
  result: Readonly<Record<string, string>>;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

export type CaptainOutput =
  | { guard: 'compiled' }
  | { guard: 'rejected' }
  | { guard: 'needsBossReply'; question: string };

export interface LinkMachineInput {
  /** Host-owned, immutable for the session. */
  definition: string;
}

export interface LinkContext {
  definition: string;
  lastResult?: CaptainOutput;
  lastError?: NormalizedError;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

export type LinkEvent =
  | { type: 'TRANSFORMATION_REQUEST' }
  | { type: 'BOSS_INTERRUPT'; targetId: InterruptTargetId }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

/* -------------------------------------------------------------------------
 * Structural narrowing helpers (heterogeneous actor output arrives unknown)
 * ---------------------------------------------------------------------- */

const readProperty = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const captainOutputOf = (event: unknown): CaptainOutput | undefined => {
  const guard = readProperty(readProperty(event, 'output'), 'guard');
  if (guard === 'compiled' || guard === 'rejected') return { guard };
  if (guard === 'needsBossReply') {
    const question = nonEmptyString(
      readProperty(readProperty(event, 'output'), 'question'),
    );
    return question === undefined
      ? undefined
      : { guard: 'needsBossReply', question };
  }
  return undefined;
};

const normalizeError = (value: unknown): NormalizedError => {
  if (value instanceof Error) {
    const base: NormalizedError = {
      name: nonEmptyString(value.name) ?? 'Error',
      message: typeof value.message === 'string' ? value.message : '',
    };
    const stack = typeof value.stack === 'string' ? value.stack : undefined;
    return stack === undefined ? base : { ...base, stack };
  }
  return {
    name: 'Error',
    message:
      typeof value === 'string'
        ? value
        : 'The captain actor failed without an Error value.',
  };
};

/* -------------------------------------------------------------------------
 * Generated transition helpers
 * ---------------------------------------------------------------------- */

const bossInterrupts = (ids: readonly InterruptTargetId[]) =>
  ids.map(
    (id) =>
      ({
        guard: { type: 'canEnterInterruptTarget', params: { targetId: id } },
        target: `#${id}`,
        reenter: true,
        actions: [{ type: 'clearBossReplyContext' }],
      }) as const,
  );

const resumableStates = (ids: readonly ResumableStateId[]) =>
  ids.map(
    (id) =>
      ({
        guard: { type: 'canResumeState', params: { stateId: id } },
        target: `#${id}`,
        reenter: true,
        actions: [{ type: 'acceptBossReply' }],
      }) as const,
  );

/* -------------------------------------------------------------------------
 * Machine
 * ---------------------------------------------------------------------- */

const linkSetup = setup({
  types: {
    context: {} as LinkContext,
    events: {} as LinkEvent,
    input: {} as LinkMachineInput,
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    captainResultIs: ({ event }, params: { guard: CaptainOutput['guard'] }) =>
      captainOutputOf(event)?.guard === params.guard,
    canSuspendForBossReply: (
      { event },
      params: { stateId: ResumableStateId },
    ) =>
      captainOutputOf(event)?.guard === 'needsBossReply' &&
      resumableStateIds.includes(params.stateId),
    canEnterInterruptTarget: (
      { context, event },
      params: { targetId: InterruptTargetId },
    ) =>
      readProperty(event, 'targetId') === params.targetId &&
      nonEmptyString(context.definition) !== undefined,
    canResumeState: (
      { context, event },
      params: { stateId: ResumableStateId },
    ) => {
      const pending = context.pendingBossQuestion;
      if (pending === undefined || pending.resumeStateId !== params.stateId)
        return false;
      if (nonEmptyString(readProperty(event, 'answer')) === undefined)
        return false;
      const questionId = readProperty(event, 'questionId');
      return questionId === undefined || questionId === pending.questionId;
    },
    hasDefinition: ({ context }) =>
      nonEmptyString(context.definition) !== undefined,
  },
  actions: {
    rememberCaptainResult: assign(({ event }) => {
      const output = captainOutputOf(event);
      return output === undefined ? {} : { lastResult: output };
    }),
    rememberCaptainError: assign(({ event }) => ({
      lastError: normalizeError(readProperty(event, 'error')),
    })),
    rememberMalformedResult: assign(() => ({
      lastError: {
        name: 'MalformedCaptainOutput',
        message:
          "The captain actor returned no result matching this state's declared guard contract.",
      } satisfies NormalizedError,
    })),
    rememberMalformedBossReply: assign(() => ({
      lastError: {
        name: 'MalformedBossReply',
        message:
          'BOSS_REPLY carried no non-empty answer for the pending question.',
      } satisfies NormalizedError,
    })),
    setPendingBossQuestion: assign(
      (
        { event },
        params: { stateId: ResumableStateId; sourceItem: string },
      ) => {
        const output = captainOutputOf(event);
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
        };
      },
    ),
    acceptBossReply: assign(({ event }) => {
      const answer = nonEmptyString(readProperty(event, 'answer'));
      return answer === undefined ? {} : { bossReply: answer };
    }),
    clearBossReplyContext: assign(({ context }) =>
      context.pendingBossQuestion === undefined &&
      context.bossReply === undefined
        ? {}
        : { pendingBossQuestion: undefined, bossReply: undefined },
    ),
  },
});

export const linkMachine = linkSetup.createMachine({
  id: 'link',
  context: ({ input }): LinkContext => ({ definition: input.definition }),
  initial: 'ready',
  on: {
    BOSS_INTERRUPT: bossInterrupts(interruptTargetIds),
  },
  states: {
    ready: {
      id: 'ready',
      description: READY_DESCRIPTION,
      tags: ['playbook.parked'],
      meta: { playbook: { stateId: 'ready', description: READY_DESCRIPTION } },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'hasDefinition',
          target: '#linking',
          actions: ['clearBossReplyContext'],
        },
      },
    },
    linking: {
      id: 'linking',
      description: LINKING_DESCRIPTION,
      tags: ['playbook.busy'],
      meta: {
        playbook: { stateId: 'linking', description: LINKING_DESCRIPTION },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'linking',
          sourceItem: 'LINK-1',
          prompt: LINK_1_PROMPT,
          definition: context.definition,
          result: LINK_1_RESULT,
          ...(context.pendingBossQuestion === undefined
            ? {}
            : { pendingBossQuestion: context.pendingBossQuestion }),
          ...(context.bossReply === undefined
            ? {}
            : { bossReply: context.bossReply }),
        }),
        onDone: [
          {
            guard: { type: 'captainResultIs', params: { guard: 'compiled' } },
            target: '#compiled',
            actions: ['rememberCaptainResult'],
          },
          {
            guard: { type: 'captainResultIs', params: { guard: 'rejected' } },
            target: '#rejected',
            actions: ['rememberCaptainResult'],
          },
          {
            guard: {
              type: 'canSuspendForBossReply',
              params: { stateId: 'linking' },
            },
            target: '#awaitBossReply',
            actions: [
              'rememberCaptainResult',
              {
                type: 'setPendingBossQuestion',
                params: { stateId: 'linking', sourceItem: 'LINK-1' },
              },
            ],
          },
          { target: '#failed', actions: ['rememberMalformedResult'] },
        ],
        onError: { target: '#failed', actions: ['rememberCaptainError'] },
      },
    },
    awaitBossReply: {
      id: 'awaitBossReply',
      description: AWAIT_BOSS_REPLY_DESCRIPTION,
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'awaitBossReply',
          description: AWAIT_BOSS_REPLY_DESCRIPTION,
        },
      },
      on: {
        BOSS_REPLY: [
          ...resumableStates(resumableStateIds),
          { target: '#failed', actions: ['rememberMalformedBossReply'] },
        ],
      },
    },
    failed: {
      id: 'failed',
      description: FAILED_DESCRIPTION,
      tags: ['playbook.parked'],
      meta: {
        playbook: { stateId: 'failed', description: FAILED_DESCRIPTION },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'hasDefinition',
          target: '#linking',
          actions: ['clearBossReplyContext'],
        },
      },
    },
    compiled: {
      id: 'compiled',
      type: 'final',
      description: COMPILED_DESCRIPTION,
      meta: {
        playbook: { stateId: 'compiled', description: COMPILED_DESCRIPTION },
      },
    },
    rejected: {
      id: 'rejected',
      type: 'final',
      description: REJECTED_DESCRIPTION,
      meta: {
        playbook: { stateId: 'rejected', description: REJECTED_DESCRIPTION },
      },
    },
  },
});

export default linkMachine;

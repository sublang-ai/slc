// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { setup, fromPromise, assign } from 'xstate';

// ---------------------------------------------------------------------------
// Players declared by the GEARS source.
// ---------------------------------------------------------------------------

export type PlayerName = '编码者' | '审查者';

// ---------------------------------------------------------------------------
// Boss-reply suspension contract.
// ---------------------------------------------------------------------------

export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: PlayerName;
  question: string;
}

// ---------------------------------------------------------------------------
// Script actor contract (optimizer-introduced CODE-1).
// ---------------------------------------------------------------------------

export interface ScriptInput {
  stateId: string;
  sourceItem: string;
  command: string;
  result: { ok: string; failed: string };
}

export type ScriptOutput =
  | { guard: 'ok'; exitStatus: number }
  | { guard: 'failed'; exitStatus: number };

// ---------------------------------------------------------------------------
// Player actor contract. One typed input/output shared by the delegated
// states; each state's invoke.input.result is the authoritative local
// contract for the guards that state may return.
// ---------------------------------------------------------------------------

export interface PlayerInput {
  stateId: string;
  player: PlayerName;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  // Runtime-value placeholders established by Source, backed by typed context.
  task?: string;
  reviewFindings?: string;
  reviewerRebuttal?: string;
  coderRuling?: string;
  conclusion?: string;
  // Boss-reply continuation (singular contract for prompt composition).
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

export type PlayerOutput =
  | { guard: 'done' }
  | { guard: 'issues'; reviewFindings: string }
  | { guard: 'clean' }
  | { guard: 'agreed'; conclusion: string }
  | { guard: 'dispute'; coderRuling: string }
  | { guard: 'responded'; reviewerRebuttal: string }
  | { guard: 'needsBossReply'; question: string };

// ---------------------------------------------------------------------------
// Machine input, context, events.
// ---------------------------------------------------------------------------

export interface WorkflowInput {
  task?: string;
}

interface WorkflowContext {
  task?: string;
  reviewFindings?: string;
  reviewerRebuttal?: string;
  coderRuling?: string;
  conclusion?: string;
  reviewCount: number;
  judgmentCount: number;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: { name: string; message: string; stack?: string };
}

export type WorkflowEvent =
  | { type: 'START'; task: string }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

// ---------------------------------------------------------------------------
// Fixed compiler-owned descriptions.
// ---------------------------------------------------------------------------

const DONE_DESCRIPTION = 'The acting agent completed the behavior.';

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// ---------------------------------------------------------------------------
// Resume routing (scalar Boss-reply form).
// ---------------------------------------------------------------------------

const RESUMABLE_STATE_IDS = [
  'implement',
  'review',
  'adjudicate',
  'rebut',
  'applyConclusion',
] as const;

type ResumableStateId = (typeof RESUMABLE_STATE_IDS)[number];

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function compact<T extends object>(object: T): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(object)) {
    const value = (object as Record<string, unknown>)[key];
    if (value !== undefined) result[key] = value;
  }
  return result as T;
}

function normalizeError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    const normalized: { name: string; message: string; stack?: string } = {
      name: error.name,
      message: error.message,
    };
    if (typeof error.stack === 'string') normalized.stack = error.stack;
    return normalized;
  }
  return { name: 'Error', message: String(error) };
}

function playerQuestion(event: unknown): string {
  if (typeof event !== 'object' || event === null) return '';
  const output = (event as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) return '';
  const question = (output as { question?: unknown }).question;
  return typeof question === 'string' ? question : '';
}

function resumableStates(ids: readonly ResumableStateId[]) {
  const arms = ids.map((id) => ({
    guard: { type: 'canResume' as const, params: { stateId: id } },
    target: `#${id}` as const,
    reenter: true,
    actions: [{ type: 'storeBossReply' as const }],
  }));
  return [
    ...arms,
    {
      target: '#failed' as const,
      actions: [{ type: 'rememberBadBossReply' as const }],
    },
  ];
}

// ---------------------------------------------------------------------------
// Machine.
// ---------------------------------------------------------------------------

export const workflowMachine = setup({
  types: {
    context: {} as WorkflowContext,
    events: {} as WorkflowEvent,
    input: {} as WorkflowInput,
  },
  actors: {
    script: fromPromise<ScriptOutput, ScriptInput>(async () => {
      throw new Error('script actor must be provided by the runner');
    }),
    player: fromPromise<PlayerOutput, PlayerInput>(async () => {
      throw new Error('player actor must be provided by the runner');
    }),
  },
  guards: {
    canResume: ({ context, event }, params: { stateId: ResumableStateId }) => {
      if (event.type !== 'BOSS_REPLY') return false;
      const answer = event.answer;
      if (typeof answer !== 'string' || answer.trim().length === 0)
        return false;
      const pending = context.pendingBossQuestion;
      if (pending === undefined) return false;
      if (pending.resumeStateId !== params.stateId) return false;
      if (
        event.questionId !== undefined &&
        event.questionId !== pending.questionId
      ) {
        return false;
      }
      return true;
    },
  },
  actions: {
    seedTask: assign(({ context, event }) => ({
      task: event.type === 'START' ? event.task : context.task,
    })),
    restart: assign(({ context, event }) => ({
      task: event.type === 'START' ? event.task : context.task,
      reviewFindings: undefined,
      reviewerRebuttal: undefined,
      coderRuling: undefined,
      conclusion: undefined,
      reviewCount: 0,
      judgmentCount: 0,
      pendingBossQuestion: undefined,
      bossReply: undefined,
      lastError: undefined,
    })),
    storeBossReply: assign(({ context, event }) => ({
      bossReply: event.type === 'BOSS_REPLY' ? event.answer : context.bossReply,
    })),
    clearBossReplyContext: assign(() => ({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    })),
    setPendingBossQuestion: assign(
      (
        { event },
        params: {
          stateId: ResumableStateId;
          sourceItem: string;
          player: PlayerName;
        },
      ) => ({
        pendingBossQuestion: {
          questionId: params.stateId,
          resumeStateId: params.stateId,
          sourceItem: params.sourceItem,
          player: params.player,
          question: playerQuestion(event),
        } satisfies PendingBossQuestion,
      }),
    ),
    rememberInvokeError: assign(({ event }) => ({
      lastError: normalizeError((event as { error?: unknown }).error),
    })),
    rememberScriptFailure: assign(() => ({
      lastError: {
        name: 'ScriptFailed',
        message: 'CODE-1 script exited with a nonzero status.',
      },
    })),
    rememberMalformedOutput: assign(() => ({
      lastError: {
        name: 'MalformedOutput',
        message: 'Actor output did not satisfy the state result contract.',
      },
    })),
    rememberStalemate: assign(() => ({
      lastError: {
        name: 'ArgumentExhausted',
        message:
          '编码者 disputed after the 3rd judgment without deciding a conclusion.',
      },
    })),
    rememberBadBossReply: assign(() => ({
      lastError: {
        name: 'BossReplyError',
        message: 'BOSS_REPLY had an empty answer or an unknown question id.',
      },
    })),
  },
}).createMachine({
  id: 'workflow',
  initial: 'ready',
  context: ({ input }) => ({
    task: input.task,
    reviewCount: 0,
    judgmentCount: 0,
  }),
  states: {
    ready: {
      id: 'ready',
      description: 'Idle hub awaiting the Boss task that starts the workflow.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Idle hub awaiting the Boss task that starts the workflow.',
        },
      },
      on: {
        START: { target: 'setup', actions: ['seedTask'] },
      },
    },

    setup: {
      id: 'setup',
      description: 'Ensure the working directory is a Git repository (CODE-1).',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'setup',
          description:
            'Ensure the working directory is a Git repository (CODE-1).',
        },
      },
      invoke: {
        src: 'script',
        input: (): ScriptInput => ({
          stateId: 'setup',
          sourceItem: 'CODE-1',
          command:
            'git rev-parse --is-inside-work-tree 2>/dev/null || git init',
          result: {
            ok: '命令以状态码 0 退出。',
            failed: '命令以非 0 状态码退出。',
          },
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.guard === 'ok',
            target: 'implement',
          },
          { target: 'failed', actions: ['rememberScriptFailure'] },
        ],
        onError: { target: 'failed', actions: ['rememberInvokeError'] },
      },
    },

    implement: {
      id: 'implement',
      description: 'Coder implements the Boss task and commits (CODE-2).',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'implement',
          description: 'Coder implements the Boss task and commits (CODE-2).',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput =>
          compact({
            stateId: 'implement',
            player: '编码者',
            sourceItem: 'CODE-2',
            prompt: [
              '你要完成的任务是：<task>。',
              '按任务要求，对当前目录的代码进行修改。',
              '将修改提交到 Git。',
            ].join('\n'),
            result: {
              done: DONE_DESCRIPTION,
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
            task: context.task,
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              playerQuestion(event).trim().length > 0,
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'implement',
                  sourceItem: 'CODE-2',
                  player: '编码者',
                },
              },
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'done',
            target: 'review',
            actions: [
              assign(({ context }) => ({
                reviewCount: context.reviewCount + 1,
              })),
              'clearBossReplyContext',
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberInvokeError'] },
      },
    },

    review: {
      id: 'review',
      description: 'Reviewer reviews the latest commit (CODE-3).',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'review',
          description: 'Reviewer reviews the latest commit (CODE-3).',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput =>
          compact({
            stateId: 'review',
            player: '审查者',
            sourceItem: 'CODE-3',
            prompt: [
              '对最新提交的 commit 进行 review。',
              '提出合理的问题；若没有任何问题，请明确说明通过。',
            ].join('\n'),
            result: {
              issues:
                '审查者提出了需要处理的问题；输出应包含 `reviewFindings: <审查者提出的问题>`。',
              clean: '审查者认为没有任何问题，流程结束。',
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              playerQuestion(event).trim().length > 0,
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'review',
                  sourceItem: 'CODE-3',
                  player: '审查者',
                },
              },
            ],
          },
          {
            guard: ({ event }) =>
              event.output.guard === 'issues' &&
              typeof (event.output as { reviewFindings?: unknown })
                .reviewFindings === 'string',
            target: 'adjudicate',
            actions: [
              assign(({ context, event }) => ({
                reviewFindings:
                  event.output.guard === 'issues'
                    ? event.output.reviewFindings
                    : context.reviewFindings,
                judgmentCount: context.judgmentCount + 1,
              })),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'clean',
            target: 'done',
            actions: ['clearBossReplyContext'],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberInvokeError'] },
      },
    },

    adjudicate: {
      id: 'adjudicate',
      description: 'Coder adjudicates the review findings (CODE-4).',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'adjudicate',
          description: 'Coder adjudicates the review findings (CODE-4).',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput =>
          compact({
            stateId: 'adjudicate',
            player: '编码者',
            sourceItem: 'CODE-4',
            prompt: [
              '审查者提出的问题：<reviewFindings>。',
              '审查者对你上一次判断的回应（如有）：<reviewerRebuttal>。',
              '针对每个问题，决定接受还是拒绝，并讲清楚原因。',
              '与审查者讨论，争取达成一致；若无法达成一致，则由你自行定夺，给出最终结论。',
            ].join('\n'),
            result: {
              agreed:
                '编码者与审查者达成一致，或已到第 3 次判断由编码者自行定夺；输出应包含 `conclusion: <最终结论>`。',
              dispute:
                '尚未达成一致，仍需继续争论；输出应包含 `coderRuling: <编码者对各问题的接受或拒绝判断及原因>`。',
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
            reviewFindings: context.reviewFindings,
            reviewerRebuttal: context.reviewerRebuttal,
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              playerQuestion(event).trim().length > 0,
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'adjudicate',
                  sourceItem: 'CODE-4',
                  player: '编码者',
                },
              },
            ],
          },
          {
            guard: ({ event }) =>
              event.output.guard === 'agreed' &&
              typeof (event.output as { conclusion?: unknown }).conclusion ===
                'string',
            target: 'applyConclusion',
            actions: [
              assign(({ context, event }) => ({
                conclusion:
                  event.output.guard === 'agreed'
                    ? event.output.conclusion
                    : context.conclusion,
              })),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ context, event }) =>
              event.output.guard === 'dispute' &&
              typeof (event.output as { coderRuling?: unknown }).coderRuling ===
                'string' &&
              context.judgmentCount < 3,
            target: 'rebut',
            actions: [
              assign(({ context, event }) => ({
                coderRuling:
                  event.output.guard === 'dispute'
                    ? event.output.coderRuling
                    : context.coderRuling,
              })),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'dispute',
            target: 'failed',
            actions: ['rememberStalemate'],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberInvokeError'] },
      },
    },

    rebut: {
      id: 'rebut',
      description: 'Reviewer responds to the Coder ruling (CODE-5).',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'rebut',
          description: 'Reviewer responds to the Coder ruling (CODE-5).',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput =>
          compact({
            stateId: 'rebut',
            player: '审查者',
            sourceItem: 'CODE-5',
            prompt: [
              '编码者对你所提问题的判断与原因：<coderRuling>。',
              '针对编码者的判断进行回应，说明你是否接受其理由。',
              '若仍有异议，请进一步说明，争取与编码者达成一致。',
            ].join('\n'),
            result: {
              responded:
                '审查者对编码者的判断作出了回应；输出应包含 `reviewerRebuttal: <审查者的回应>`。',
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
            coderRuling: context.coderRuling,
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              playerQuestion(event).trim().length > 0,
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'rebut',
                  sourceItem: 'CODE-5',
                  player: '审查者',
                },
              },
            ],
          },
          {
            guard: ({ event }) =>
              event.output.guard === 'responded' &&
              typeof (event.output as { reviewerRebuttal?: unknown })
                .reviewerRebuttal === 'string',
            target: 'adjudicate',
            actions: [
              assign(({ context, event }) => ({
                reviewerRebuttal:
                  event.output.guard === 'responded'
                    ? event.output.reviewerRebuttal
                    : context.reviewerRebuttal,
                judgmentCount: context.judgmentCount + 1,
              })),
              'clearBossReplyContext',
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberInvokeError'] },
      },
    },

    applyConclusion: {
      id: 'applyConclusion',
      description:
        'Coder applies the agreed conclusion and recommits (CODE-6).',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'applyConclusion',
          description:
            'Coder applies the agreed conclusion and recommits (CODE-6).',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput =>
          compact({
            stateId: 'applyConclusion',
            player: '编码者',
            sourceItem: 'CODE-6',
            prompt: [
              '按以下结论修改代码：<conclusion>。',
              '将修改再次提交到 Git。',
            ].join('\n'),
            result: {
              done: DONE_DESCRIPTION,
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
            conclusion: context.conclusion,
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              playerQuestion(event).trim().length > 0,
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'applyConclusion',
                  sourceItem: 'CODE-6',
                  player: '编码者',
                },
              },
            ],
          },
          {
            guard: ({ context, event }) =>
              event.output.guard === 'done' && context.reviewCount < 2,
            target: 'review',
            actions: [
              assign(({ context }) => ({
                reviewCount: context.reviewCount + 1,
              })),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'done',
            target: 'done',
            actions: ['clearBossReplyContext'],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberInvokeError'] },
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
        BOSS_REPLY: resumableStates(RESUMABLE_STATE_IDS),
      },
    },

    failed: {
      id: 'failed',
      description: 'A step failed; awaiting Boss recovery.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description: 'A step failed; awaiting Boss recovery.',
        },
      },
      on: {
        START: { target: 'setup', actions: ['restart'] },
      },
    },

    done: {
      type: 'final',
      description:
        'Workflow complete: review found no issues, or the review-fix cycle bound was reached.',
      meta: {
        playbook: {
          stateId: 'done',
          description:
            'Workflow complete: review found no issues, or the review-fix cycle bound was reached.',
        },
      },
    },
  },
});

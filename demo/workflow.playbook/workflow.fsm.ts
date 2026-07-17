// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { setup, fromPromise, assign } from 'xstate';

// ---------------------------------------------------------------------------
// Fixed framework descriptions mandated verbatim by the GEARS-to-FSM definition.
// ---------------------------------------------------------------------------

// Default single-outcome contract description for acting items that declare no
// `Results:` label (CODE-2, CODE-6).
const DONE_DESCRIPTION = 'The acting agent completed the behavior.';

// Universal Boss-reply result description added to every agent-invoking state.
const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// ---------------------------------------------------------------------------
// Actor input/output contracts (exported for the linker to implement).
// This GEARS artifact uses only the `player` and `script` actor kinds, so no
// `captain` or `playbook` contract is declared, registered, or exported.
// ---------------------------------------------------------------------------

// A clarifying question a player surfaced for Boss, parked until BOSS_REPLY.
export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

// Delegated-player actor input. Placeholder-backed fields (reviewComments,
// coderResponse, agreedConclusion) carry the runtime values the linker
// substitutes for the corresponding `<...>` prompt placeholders. The singular
// pendingBossQuestion/bossReply fields give prompt composition one stable
// continuation contract regardless of the scalar context representation.
export interface PlayerInput {
  stateId: string;
  player: string;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  reviewComments?: string;
  coderResponse?: string;
  agreedConclusion?: string;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

// Delegated-player actor output: a discriminated union with one literal `guard`
// member per authored result key across the player states, each carrying every
// payload field its accepting guard requires, plus the universal needsBossReply.
export type PlayerOutput =
  | { guard: 'done' }
  | { guard: 'issues'; reviewComments: string }
  | { guard: 'clean' }
  | { guard: 'responded'; coderResponse: string }
  | { guard: 'agreed'; agreedConclusion: string }
  | { guard: 'disputed'; reviewComments: string }
  | { guard: 'needsBossReply'; question: string };

// Optimizer-introduced script actor input (CODE-1). No prompt, no player.
// The result keys preserve the item's two guards in declared order: first the
// zero-exit guard, then the nonzero-exit guard.
export interface ScriptInput {
  stateId: string;
  sourceItem: string;
  command: string;
  result: { ok: string; failed: string };
}

// Script actor output: one literal `guard` member per declared result key plus
// the required exitStatus. The script contract carries no prose output.
export type ScriptOutput =
  | { guard: 'ok'; exitStatus: number }
  | { guard: 'failed'; exitStatus: number };

// This playbook takes no per-run parameters from Source, and it has no dynamic
// nested call, so it declares neither runtime knobs nor a selfPlaybookId. The
// GEARS-declared player identities are carried on each invocation directly.
export type WorkflowInput = Record<string, never>;

// Boss-originated events: the entry event that starts/recovers the workflow and
// the scalar Boss-reply event. This fixed pipeline consumes no Boss routing
// directive, so no BOSS_INTERRUPT surface is generated.
export type WorkflowEvent =
  | { type: 'START' }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

interface WorkflowContext {
  // Placeholder-backed routing values; each is populated by its producing
  // transition before the consuming state can run.
  reviewComments: string;
  coderResponse: string;
  agreedConclusion: string;
  // Scalar Boss-reply suspension state (at most one active player task).
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  // Inspection-only capture of the most recent failure.
  lastError?: SerializedError;
}

interface PendingLeafMeta {
  stateId: string;
  sourceItem: string;
  player: string;
}

// Player-invoking working leaves eligible for Boss-reply resume. The script
// leaf (ensureRepo) is not agent-invoking and is intentionally excluded.
const RESUMABLE_IDS = [
  'implement',
  'review',
  'judge',
  'debate',
  'revise',
] as const;

// ---------------------------------------------------------------------------
// Structural narrowing helpers: XState may surface heterogeneous actor output
// as `unknown` in shared guards/actions, so narrow before reading fields rather
// than relying on unchecked event.output inference.
// ---------------------------------------------------------------------------

function readPlayerOutput(event: unknown): PlayerOutput | undefined {
  if (typeof event === 'object' && event !== null && 'output' in event) {
    const output = (event as { output: unknown }).output;
    if (typeof output === 'object' && output !== null && 'guard' in output) {
      return output as PlayerOutput;
    }
  }
  return undefined;
}

function readScriptOutput(event: unknown): ScriptOutput | undefined {
  if (typeof event === 'object' && event !== null && 'output' in event) {
    const output = (event as { output: unknown }).output;
    if (typeof output === 'object' && output !== null && 'guard' in output) {
      return output as ScriptOutput;
    }
  }
  return undefined;
}

function isBossReplyEvent(
  event: unknown,
): event is { type: 'BOSS_REPLY'; answer: string; questionId?: string } {
  return (
    typeof event === 'object' &&
    event !== null &&
    (event as { type?: unknown }).type === 'BOSS_REPLY'
  );
}

function normalizeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const normalized: SerializedError = {
      name: error.name,
      message: error.message,
    };
    if (typeof error.stack === 'string') {
      normalized.stack = error.stack;
    }
    return normalized;
  }
  return { name: 'Error', message: String(error) };
}

// BOSS_REPLY transition arms for the scalar awaitBossReply state: one guarded
// reentry per resumable working leaf targeting its stable id, plus a fallback to
// `failed` for a reply that matches no pending question or has an empty answer.
// Registered guard/action names stay literal so they type-check.
function resumableStates(ids: readonly string[]) {
  return [
    ...ids.map((id) => ({
      guard: { type: 'canResume' as const, params: { stateId: id } },
      target: `#${id}`,
      reenter: true as const,
      actions: 'setBossReply' as const,
    })),
    {
      target: '#failed' as const,
      actions: 'rememberBossReplyRejection' as const,
    },
  ];
}

// ---------------------------------------------------------------------------
// Machine: an XState v5 object artifact. Actor placeholders fail explicitly; the
// runner binds concrete implementations. No runner is imported here.
// ---------------------------------------------------------------------------

export const workflowMachine = setup({
  types: {} as {
    context: WorkflowContext;
    events: WorkflowEvent;
    input: WorkflowInput;
  },
  actors: {
    player: fromPromise<PlayerOutput, PlayerInput>(async () => {
      throw new Error('player actor must be provided by the runner');
    }),
    script: fromPromise<ScriptOutput, ScriptInput>(async () => {
      throw new Error('script actor must be provided by the runner');
    }),
  },
  guards: {
    isOk: ({ event }) => readScriptOutput(event)?.guard === 'ok',
    isFailed: ({ event }) => readScriptOutput(event)?.guard === 'failed',
    isDone: ({ event }) => readPlayerOutput(event)?.guard === 'done',
    isIssues: ({ event }) => readPlayerOutput(event)?.guard === 'issues',
    isClean: ({ event }) => readPlayerOutput(event)?.guard === 'clean',
    isResponded: ({ event }) => readPlayerOutput(event)?.guard === 'responded',
    isAgreed: ({ event }) => readPlayerOutput(event)?.guard === 'agreed',
    isDisputed: ({ event }) => readPlayerOutput(event)?.guard === 'disputed',
    isNeedsBossReply: ({ event }) => {
      const out = readPlayerOutput(event);
      return (
        out?.guard === 'needsBossReply' &&
        typeof out.question === 'string' &&
        out.question.trim().length > 0
      );
    },
    isNeedsBossReplyMalformed: ({ event }) => {
      const out = readPlayerOutput(event);
      return (
        out?.guard === 'needsBossReply' &&
        !(typeof out.question === 'string' && out.question.trim().length > 0)
      );
    },
    canResume: ({ context, event }, params: { stateId: string }) => {
      if (!isBossReplyEvent(event)) return false;
      if (event.answer.trim().length === 0) return false;
      const pending = context.pendingBossQuestion;
      if (!pending || pending.resumeStateId !== params.stateId) return false;
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
    setReviewComments: assign({
      reviewComments: ({ event }) => {
        const out = readPlayerOutput(event);
        return out && 'reviewComments' in out ? out.reviewComments : '';
      },
    }),
    setCoderResponse: assign({
      coderResponse: ({ event }) => {
        const out = readPlayerOutput(event);
        return out && 'coderResponse' in out ? out.coderResponse : '';
      },
    }),
    setAgreedConclusion: assign({
      agreedConclusion: ({ event }) => {
        const out = readPlayerOutput(event);
        return out && 'agreedConclusion' in out ? out.agreedConclusion : '';
      },
    }),
    setPendingBossQuestion: assign(({ event }, params: PendingLeafMeta) => {
      const out = readPlayerOutput(event);
      const question =
        out && out.guard === 'needsBossReply' ? out.question : '';
      return {
        pendingBossQuestion: {
          questionId: params.stateId,
          resumeStateId: params.stateId,
          sourceItem: params.sourceItem,
          player: params.player,
          question,
        },
      };
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: () => undefined,
      bossReply: () => undefined,
    }),
    setBossReply: assign({
      bossReply: ({ event }) => (isBossReplyEvent(event) ? event.answer : ''),
    }),
    rememberError: assign({
      lastError: ({ event }) =>
        normalizeError((event as { error?: unknown }).error),
    }),
    rememberBossReplyRejection: assign({
      lastError: () => ({
        name: 'BossReplyError',
        message:
          'BOSS_REPLY did not match a pending question or had an empty answer.',
      }),
    }),
    rememberMalformedQuestion: assign({
      lastError: () => ({
        name: 'BossQuestionError',
        message:
          'Acting agent returned needsBossReply without a question field.',
      }),
    }),
  },
}).createMachine({
  id: 'workflow',
  initial: 'ready',
  context: () => ({
    reviewComments: '',
    coderResponse: '',
    agreedConclusion: '',
  }),
  states: {
    // Quiescent idle hub: no invoke, accepts the Boss entry event.
    ready: {
      id: 'ready',
      description: '空闲集散状态：等待 Boss 启动工作流。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description: '空闲集散状态：等待 Boss 启动工作流。',
        },
      },
      on: {
        START: { target: 'ensureRepo' },
      },
    },

    // CODE-1: optimizer-introduced script actor. Success advances to the next
    // workflow step; nonzero exit routes to `failed`.
    ensureRepo: {
      id: 'ensureRepo',
      description: '确保当前目录是一个 Git 仓库。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'ensureRepo',
          description: '确保当前目录是一个 Git 仓库。',
        },
      },
      invoke: {
        src: 'script',
        input: (): ScriptInput => ({
          stateId: 'ensureRepo',
          sourceItem: 'CODE-1',
          command:
            'git rev-parse --is-inside-work-tree 2>/dev/null || git init',
          result: {
            ok: '命令以零状态码退出。',
            failed: '命令以非零状态码退出。',
          },
        }),
        onDone: [
          { guard: 'isOk', target: 'implement' },
          { guard: 'isFailed', target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    // CODE-2: delegated player, default single-outcome contract.
    implement: {
      id: 'implement',
      description: '编码者按任务要求修改代码并提交。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'implement',
          description: '编码者按任务要求修改代码并提交。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'implement',
          player: '编码者',
          sourceItem: 'CODE-2',
          prompt: '按任务要求对当前目录的代码进行修改。\n提交Git。',
          result: {
            done: DONE_DESCRIPTION,
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: {
                stateId: 'implement',
                sourceItem: 'CODE-2',
                player: '编码者',
              },
            },
          },
          {
            guard: 'isNeedsBossReplyMalformed',
            target: 'failed',
            actions: 'rememberMalformedQuestion',
          },
          {
            guard: 'isDone',
            target: 'review',
            actions: 'clearBossReplyContext',
          },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    // CODE-3: delegated player. `issues` feeds the judge; `clean` completes.
    review: {
      id: 'review',
      description: '审查者对提交的 commit 进行 review 并提出问题。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'review',
          description: '审查者对提交的 commit 进行 review 并提出问题。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'review',
          player: '审查者',
          sourceItem: 'CODE-3',
          prompt: '对提交的commit进行review。\n提出合理问题。',
          result: {
            issues:
              '审查者提出了合理问题，交回给编码者判断。输出应包含 `reviewComments`：审查者提出的问题。',
            clean: '审查者对提交的commit未发现任何问题。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: {
                stateId: 'review',
                sourceItem: 'CODE-3',
                player: '审查者',
              },
            },
          },
          {
            guard: 'isNeedsBossReplyMalformed',
            target: 'failed',
            actions: 'rememberMalformedQuestion',
          },
          {
            guard: 'isIssues',
            target: 'judge',
            actions: ['setReviewComments', 'clearBossReplyContext'],
          },
          {
            guard: 'isClean',
            target: 'done',
            actions: 'clearBossReplyContext',
          },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    // CODE-4: delegated player. Produces coderResponse for the debate.
    judge: {
      id: 'judge',
      description: '编码者对审查者的问题做出判断。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'judge',
          description: '编码者对审查者的问题做出判断。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'judge',
          player: '编码者',
          sourceItem: 'CODE-4',
          prompt:
            '对审查者提出的问题做出判断：<reviewComments>\n可以接受或拒绝，但要讲清楚原因。',
          result: {
            responded:
              '编码者对每个问题做出接受或拒绝的判断并讲清原因。输出应包含 `coderResponse`：编码者的判断与理由。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          reviewComments: context.reviewComments,
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: {
                stateId: 'judge',
                sourceItem: 'CODE-4',
                player: '编码者',
              },
            },
          },
          {
            guard: 'isNeedsBossReplyMalformed',
            target: 'failed',
            actions: 'rememberMalformedQuestion',
          },
          {
            guard: 'isResponded',
            target: 'debate',
            actions: ['setCoderResponse', 'clearBossReplyContext'],
          },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    // CODE-5: delegated player. `agreed` advances; `disputed` reuses the one
    // feedback cycle by routing back to the judge with fresh reviewComments.
    debate: {
      id: 'debate',
      description: '审查者与编码者争论直至达成一致。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'debate',
          description: '审查者与编码者争论直至达成一致。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'debate',
          player: '审查者',
          sourceItem: 'CODE-5',
          prompt:
            '阅读编码者的判断与理由：<coderResponse>\n与编码者争论，直至达成一致。',
          result: {
            agreed:
              '审查者与编码者达成一致。输出应包含 `agreedConclusion`：双方一致的修改结论。',
            disputed:
              '尚未达成一致，审查者继续争论。输出应包含 `reviewComments`：审查者进一步的问题或理由。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          coderResponse: context.coderResponse,
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: {
                stateId: 'debate',
                sourceItem: 'CODE-5',
                player: '审查者',
              },
            },
          },
          {
            guard: 'isNeedsBossReplyMalformed',
            target: 'failed',
            actions: 'rememberMalformedQuestion',
          },
          {
            guard: 'isAgreed',
            target: 'revise',
            actions: ['setAgreedConclusion', 'clearBossReplyContext'],
          },
          {
            guard: 'isDisputed',
            target: 'judge',
            actions: ['setReviewComments', 'clearBossReplyContext'],
          },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    // CODE-6: delegated player, default single-outcome. Re-submitting satisfies
    // review's trigger ("编码者提交了改动"), so `done` loops back to review; the
    // loop terminates via review's `clean` outcome.
    revise: {
      id: 'revise',
      description: '编码者按结论修改代码并再次提交。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'revise',
          description: '编码者按结论修改代码并再次提交。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'revise',
          player: '编码者',
          sourceItem: 'CODE-6',
          prompt: '按结论修改代码：<agreedConclusion>\n再次提交。',
          result: {
            done: DONE_DESCRIPTION,
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          agreedConclusion: context.agreedConclusion,
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply !== undefined
            ? { bossReply: context.bossReply }
            : {}),
        }),
        onDone: [
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: {
                stateId: 'revise',
                sourceItem: 'CODE-6',
                player: '编码者',
              },
            },
          },
          {
            guard: 'isNeedsBossReplyMalformed',
            target: 'failed',
            actions: 'rememberMalformedQuestion',
          },
          {
            guard: 'isDone',
            target: 'review',
            actions: 'clearBossReplyContext',
          },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    // Scalar Boss-reply wait. Quiescent and parked; not an interrupt target.
    // Each resumable working leaf is the sole BOSS_REPLY resume destination.
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
        BOSS_REPLY: resumableStates(RESUMABLE_IDS),
      },
    },

    // Recoverable failure sink: parked, retains typed context, accepts the
    // recovery entry event. Not final.
    failed: {
      id: 'failed',
      description: '工作流失败：保留上下文，等待 Boss 恢复。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description: '工作流失败：保留上下文，等待 Boss 恢复。',
        },
      },
      on: {
        START: { target: 'ensureRepo' },
      },
    },

    // Terminal completion. Source declares no JSON-safe terminal result, so the
    // machine derives no `output`.
    done: {
      id: 'done',
      type: 'final',
      description: '工作流完成。',
      meta: {
        playbook: {
          stateId: 'done',
          description: '工作流完成。',
        },
      },
    },
  },
});

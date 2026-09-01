import { assign, fromPromise, setup } from 'xstate';

/** 源: `Roles:` — 规范小写本地 id。 */
export type RoleId = '编码者' | '评审者';

const CODER_ROLE = '编码者';
const REVIEWER_ROLE = '评审者';

/** 源 WORKFLOW-3: 循环次数不超过 2 次。 */
const REVIEW_CYCLE_LIMIT = 2;
/** 源 WORKFLOW-5: 至多到总计第 3 次判断后不再争论。 */
const JUDGMENT_LIMIT = 3;

/** 可被 BOSS_REPLY 恢复的工作叶（仅代理调用状态；脚本状态不注册）。 */
export type ResumableStateId =
  | 'implementChange'
  | 'reviewCommit'
  | 'judgeFindings'
  | 'debateJudgment'
  | 'rejudgeRebuttal'
  | 'reviseByConclusion';

/** Boss 可抢占的活动状态；脚本叶、等待叶与 final 状态不可跳入。 */
export type InterruptTargetId = ResumableStateId;

const RESUMABLE_STATE_IDS: readonly ResumableStateId[] = [
  'implementChange',
  'reviewCommit',
  'judgeFindings',
  'debateJudgment',
  'rejudgeRebuttal',
  'reviseByConclusion',
];

const INTERRUPT_TARGET_IDS: readonly InterruptTargetId[] = RESUMABLE_STATE_IDS;

/** 无并行组。 */
export const concurrentRoleSets: readonly (readonly RoleId[])[] = [];

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

const DEFAULT_SINGLE_OUTCOME_DESCRIPTION =
  'The acting agent completed the behavior.';

const AWAIT_BOSS_REPLY_DESCRIPTION =
  "Waiting for Boss to answer the acting agent's question.";

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type BossQuestionAsker =
  | { kind: 'captain' }
  | { kind: 'role'; roleId: RoleId };

export interface PendingBossQuestion {
  questionId: ResumableStateId;
  resumeStateId: ResumableStateId;
  sourceItem: string;
  asker: BossQuestionAsker;
  question: string;
}

export interface PlayerInput {
  stateId: ResumableStateId;
  role: RoleId;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  bossIntent?: string;
  reviewFindings?: string;
  coderJudgment?: string;
  reviewerRebuttal?: string;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

export type PlayerOutput =
  | { guard: 'done' }
  | { guard: 'issues'; reviewFindings: string }
  | { guard: 'clean' }
  | { guard: 'accept' }
  | { guard: 'reject'; coderJudgment: string }
  | { guard: 'dispute'; reviewerRebuttal: string }
  | { guard: 'agreed' }
  | { guard: 'needsBossReply'; question: string };

export interface ScriptInput {
  stateId: 'ensureRepository';
  sourceItem: string;
  command: string;
  result: Record<string, string>;
}

export type ScriptOutput =
  | { guard: 'ok'; exitStatus: number }
  | { guard: 'failed'; exitStatus: number };

export interface WorkflowInput {
  bossIntent?: string;
}

export interface WorkflowContext {
  bossIntent: string;
  loopCount: number;
  judgmentCount: number;
  reviewFindings: string;
  coderJudgment: string;
  reviewerRebuttal: string;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: SerializedError;
}

export type WorkflowEvent =
  | { type: 'BOSS_TASK'; bossIntent?: string }
  | { type: 'BOSS_INTERRUPT'; targetId: InterruptTargetId }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: ResumableStateId };

interface LeafIdentity {
  stateId: ResumableStateId;
  sourceItem: string;
  roleId: RoleId;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

const readOutput = (event: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(event)) return undefined;
  return isRecord(event.output) ? event.output : undefined;
};

const readPlayerOutput = (event: unknown): PlayerOutput | undefined => {
  const output = readOutput(event);
  if (output === undefined) return undefined;
  const guard = output.guard;
  if (typeof guard !== 'string') return undefined;
  switch (guard) {
    case 'done':
      return { guard: 'done' };
    case 'clean':
      return { guard: 'clean' };
    case 'accept':
      return { guard: 'accept' };
    case 'agreed':
      return { guard: 'agreed' };
    case 'issues':
      return nonEmptyString(output.reviewFindings)
        ? { guard: 'issues', reviewFindings: output.reviewFindings }
        : undefined;
    case 'reject':
      return nonEmptyString(output.coderJudgment)
        ? { guard: 'reject', coderJudgment: output.coderJudgment }
        : undefined;
    case 'dispute':
      return nonEmptyString(output.reviewerRebuttal)
        ? { guard: 'dispute', reviewerRebuttal: output.reviewerRebuttal }
        : undefined;
    case 'needsBossReply':
      return nonEmptyString(output.question)
        ? { guard: 'needsBossReply', question: output.question }
        : undefined;
    default:
      return undefined;
  }
};

const playerGuardIs = (event: unknown, guard: PlayerOutput['guard']): boolean =>
  readPlayerOutput(event)?.guard === guard;

const readScriptOutput = (event: unknown): ScriptOutput | undefined => {
  const output = readOutput(event);
  if (output === undefined) return undefined;
  const guard = output.guard;
  const exitStatus = output.exitStatus;
  if (typeof exitStatus !== 'number' || !Number.isFinite(exitStatus))
    return undefined;
  if (guard === 'ok') return { guard: 'ok', exitStatus };
  if (guard === 'failed') return { guard: 'failed', exitStatus };
  return undefined;
};

const readBossTaskIntent = (event: unknown): string | undefined => {
  if (!isRecord(event) || event.type !== 'BOSS_TASK') return undefined;
  return nonEmptyString(event.bossIntent) ? event.bossIntent : undefined;
};

const readBossReply = (
  event: unknown,
): { answer: string; questionId?: string } | undefined => {
  if (!isRecord(event) || event.type !== 'BOSS_REPLY') return undefined;
  const answer = event.answer;
  if (!nonEmptyString(answer)) return undefined;
  const questionId = event.questionId;
  if (questionId === undefined) return { answer };
  return typeof questionId === 'string' ? { answer, questionId } : undefined;
};

const readInterruptTargetId = (event: unknown): string | undefined => {
  if (!isRecord(event) || event.type !== 'BOSS_INTERRUPT') return undefined;
  return typeof event.targetId === 'string' ? event.targetId : undefined;
};

const readActorError = (event: unknown): unknown =>
  isRecord(event) ? event.error : undefined;

const normalizeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return typeof error.stack === 'string'
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: error.name, message: error.message };
  }
  if (isRecord(error) && typeof error.message === 'string') {
    return {
      name: typeof error.name === 'string' ? error.name : 'Error',
      message: error.message,
    };
  }
  return {
    name: 'Error',
    message: typeof error === 'string' ? error : 'Unknown error',
  };
};

/** 进入 targetId 所需的类型化上下文前置条件（源条件）。 */
const canEnterTarget = (
  context: WorkflowContext,
  stateId: InterruptTargetId,
): boolean => {
  switch (stateId) {
    case 'implementChange':
      return nonEmptyString(context.bossIntent);
    case 'reviewCommit':
      return context.loopCount < REVIEW_CYCLE_LIMIT;
    case 'judgeFindings':
      return nonEmptyString(context.reviewFindings);
    case 'debateJudgment':
      return (
        nonEmptyString(context.coderJudgment) &&
        context.judgmentCount < JUDGMENT_LIMIT
      );
    case 'rejudgeRebuttal':
      return nonEmptyString(context.reviewerRebuttal);
    case 'reviseByConclusion':
      return context.judgmentCount >= 1;
  }
};

/** 只把归属于该工作叶的挂起提问与回复交给它的 invoke.input。 */
const bossReplyFields = (
  context: WorkflowContext,
  stateId: ResumableStateId,
): Pick<PlayerInput, 'pendingBossQuestion' | 'bossReply'> => {
  const pending = context.pendingBossQuestion;
  if (pending === undefined || pending.resumeStateId !== stateId) return {};
  return nonEmptyString(context.bossReply)
    ? { pendingBossQuestion: pending, bossReply: context.bossReply }
    : { pendingBossQuestion: pending };
};

const resumableStates = (ids: readonly ResumableStateId[]) =>
  ids.map(
    (stateId) =>
      ({
        guard: { type: 'isResumeTarget', params: { stateId } },
        target: `#${stateId}`,
        actions: ['storeBossReply'],
      }) as const,
  );

const bossInterrupts = (ids: readonly InterruptTargetId[]) =>
  ids.map(
    (stateId) =>
      ({
        guard: { type: 'canInterruptTo', params: { stateId } },
        target: `#${stateId}`,
        reenter: true,
        actions: ['clearBossReplyContext'],
      }) as const,
  );

const bossTaskEntry = {
  guard: 'hasBossIntent',
  target: '#ensureRepository',
  actions: ['applyBossTask', 'clearBossReplyContext'],
} as const;

export const workflowMachine = setup({
  types: {
    context: {} as WorkflowContext,
    events: {} as WorkflowEvent,
    input: {} as WorkflowInput,
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
    hasBossIntent: ({ context, event }) =>
      nonEmptyString(readBossTaskIntent(event) ?? context.bossIntent),
    isScriptOk: ({ event }) => readScriptOutput(event)?.guard === 'ok',
    isScriptFailed: ({ event }) => readScriptOutput(event)?.guard === 'failed',
    isDone: ({ event }) => playerGuardIs(event, 'done'),
    isIssues: ({ event }) => playerGuardIs(event, 'issues'),
    isClean: ({ event }) => playerGuardIs(event, 'clean'),
    isAccept: ({ event }) => playerGuardIs(event, 'accept'),
    isAgreed: ({ event }) => playerGuardIs(event, 'agreed'),
    isDispute: ({ event }) => playerGuardIs(event, 'dispute'),
    isNeedsBossReply: ({ event }) => playerGuardIs(event, 'needsBossReply'),
    isRejectAndDebatable: ({ context, event }) =>
      playerGuardIs(event, 'reject') && context.judgmentCount < JUDGMENT_LIMIT,
    isRejectAndDebateExhausted: ({ context, event }) =>
      playerGuardIs(event, 'reject') && context.judgmentCount >= JUDGMENT_LIMIT,
    isDoneAndCycleAvailable: ({ context, event }) =>
      playerGuardIs(event, 'done') && context.loopCount < REVIEW_CYCLE_LIMIT,
    isDoneAndCycleLimitReached: ({ context, event }) =>
      playerGuardIs(event, 'done') && context.loopCount >= REVIEW_CYCLE_LIMIT,
    isResumeTarget: (
      { context, event },
      params: { stateId: ResumableStateId },
    ) => {
      const pending = context.pendingBossQuestion;
      if (pending === undefined || pending.resumeStateId !== params.stateId)
        return false;
      const reply = readBossReply(event);
      if (reply === undefined) return false;
      return (
        reply.questionId === undefined ||
        reply.questionId === pending.questionId
      );
    },
    canInterruptTo: (
      { context, event },
      params: { stateId: InterruptTargetId },
    ) =>
      readInterruptTargetId(event) === params.stateId &&
      canEnterTarget(context, params.stateId),
  },
  actions: {
    applyBossTask: assign(({ context, event }) => ({
      bossIntent: readBossTaskIntent(event) ?? context.bossIntent,
      loopCount: 0,
      judgmentCount: 0,
      reviewFindings: '',
      coderJudgment: '',
      reviewerRebuttal: '',
    })),
    beginReviewCycle: assign({
      loopCount: ({ context }) => context.loopCount + 1,
      judgmentCount: 0,
    }),
    countJudgment: assign({
      judgmentCount: ({ context }) => context.judgmentCount + 1,
    }),
    rememberReviewFindings: assign(({ event }) => {
      const output = readPlayerOutput(event);
      return output !== undefined && output.guard === 'issues'
        ? { reviewFindings: output.reviewFindings }
        : {};
    }),
    rememberCoderJudgment: assign(({ event }) => {
      const output = readPlayerOutput(event);
      return output !== undefined && output.guard === 'reject'
        ? { coderJudgment: output.coderJudgment }
        : {};
    }),
    rememberReviewerRebuttal: assign(({ event }) => {
      const output = readPlayerOutput(event);
      return output !== undefined && output.guard === 'dispute'
        ? { reviewerRebuttal: output.reviewerRebuttal }
        : {};
    }),
    setPendingBossQuestion: assign(({ event }, params: LeafIdentity) => {
      const output = readPlayerOutput(event);
      if (output === undefined || output.guard !== 'needsBossReply') return {};
      const pendingBossQuestion: PendingBossQuestion = {
        questionId: params.stateId,
        resumeStateId: params.stateId,
        sourceItem: params.sourceItem,
        asker: { kind: 'role', roleId: params.roleId },
        question: output.question,
      };
      return { pendingBossQuestion };
    }),
    storeBossReply: assign(({ event }) => {
      const reply = readBossReply(event);
      return reply === undefined ? {} : { bossReply: reply.answer };
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
    rememberActorError: assign(({ event }) => ({
      lastError: normalizeError(readActorError(event)),
    })),
    rememberScriptFailure: assign(({ event }) => {
      const output = readScriptOutput(event);
      const exitStatus =
        output === undefined ? 'unknown' : String(output.exitStatus);
      return {
        lastError: {
          name: 'ScriptNonZeroExit',
          message: `WORKFLOW-1 的命令以非 0 状态退出（exitStatus: ${exitStatus}）。`,
        },
      };
    }),
    rememberMalformedOutput: assign({
      lastError: {
        name: 'MalformedActorOutput',
        message: '被调用者的输出不符合该状态声明的结果契约。',
      },
    }),
    rememberMalformedBossReply: assign({
      lastError: {
        name: 'MalformedBossReply',
        message:
          'BOSS_REPLY 的回答为空，或其 questionId 不对应任何挂起的提问。',
      },
    }),
  },
}).createMachine({
  id: 'workflowZh',
  context: ({ input }): WorkflowContext => ({
    bossIntent: input.bossIntent ?? '',
    loopCount: 0,
    judgmentCount: 0,
    reviewFindings: '',
    coderJudgment: '',
    reviewerRebuttal: '',
  }),
  initial: 'ready',
  on: {
    BOSS_INTERRUPT: bossInterrupts(INTERRUPT_TARGET_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description: '空闲枢纽：等待 Boss 给出输入的任务。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description: '空闲枢纽：等待 Boss 给出输入的任务。',
        },
      },
      on: {
        BOSS_TASK: bossTaskEntry,
      },
    },
    ensureRepository: {
      id: 'ensureRepository',
      description:
        '当 Boss 给出输入的任务时，确保当前目录是 Git 仓库的根目录。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'ensureRepository',
          description:
            '当 Boss 给出输入的任务时，确保当前目录是 Git 仓库的根目录。',
        },
      },
      invoke: {
        src: 'script',
        input: (): ScriptInput => ({
          stateId: 'ensureRepository',
          sourceItem: 'WORKFLOW-1',
          command: '[ -e .git ] || git init',
          result: {
            ok: '命令以状态 0 退出。',
            failed: '命令以非 0 状态退出。',
          },
        }),
        onDone: [
          { guard: 'isScriptOk', target: 'implementChange' },
          {
            guard: 'isScriptFailed',
            target: 'failed',
            actions: ['rememberScriptFailure'],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
      },
    },
    implementChange: {
      id: 'implementChange',
      description:
        '当 Git 仓库准备就绪时，由 `编码者` 按任务要求修改代码并提交 Git。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'implementChange',
          description:
            '当 Git 仓库准备就绪时，由 `编码者` 按任务要求修改代码并提交 Git。',
          role: CODER_ROLE,
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'implementChange',
          role: CODER_ROLE,
          sourceItem: 'WORKFLOW-2',
          prompt: [
            '按 Boss 输入的任务要求对当前目录的代码进行修改。',
            '将修改提交Git。',
          ].join('\n'),
          result: {
            done: DEFAULT_SINGLE_OUTCOME_DESCRIPTION,
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          bossIntent: context.bossIntent,
          ...bossReplyFields(context, 'implementChange'),
        }),
        onDone: [
          {
            guard: 'isDone',
            target: 'reviewCommit',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'implementChange',
                  sourceItem: 'WORKFLOW-2',
                  roleId: CODER_ROLE,
                },
              },
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
      },
    },
    reviewCommit: {
      id: 'reviewCommit',
      description:
        '当 `编码者` 完成一次提交时，由 `评审者` review 该 commit 并提出合理问题。',
      tags: ['playbook.busy'],
      entry: ['beginReviewCycle'],
      meta: {
        playbook: {
          stateId: 'reviewCommit',
          description:
            '当 `编码者` 完成一次提交时，由 `评审者` review 该 commit 并提出合理问题。',
          role: REVIEWER_ROLE,
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'reviewCommit',
          role: REVIEWER_ROLE,
          sourceItem: 'WORKFLOW-3',
          prompt: [
            '对 `编码者` 提交的 commit 进行 review。',
            '提出合理问题。',
          ].join('\n'),
          result: {
            issues:
              '`评审者` 提出了问题，交回 `编码者` 做判断。输出应包含 `reviewFindings: <评审者提出的全部问题>`。',
            clean: 'review 没有任何问题，流程结束。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          ...bossReplyFields(context, 'reviewCommit'),
        }),
        onDone: [
          {
            guard: 'isIssues',
            target: 'judgeFindings',
            actions: ['rememberReviewFindings', 'clearBossReplyContext'],
          },
          {
            guard: 'isClean',
            target: 'reviewClean',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'reviewCommit',
                  sourceItem: 'WORKFLOW-3',
                  roleId: REVIEWER_ROLE,
                },
              },
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
      },
    },
    judgeFindings: {
      id: 'judgeFindings',
      description:
        '当 `评审者` 提出的问题交回 `编码者` 做判断时，由 `编码者` 接受或拒绝并讲清楚原因。',
      tags: ['playbook.busy'],
      entry: ['countJudgment'],
      meta: {
        playbook: {
          stateId: 'judgeFindings',
          description:
            '当 `评审者` 提出的问题交回 `编码者` 做判断时，由 `编码者` 接受或拒绝并讲清楚原因。',
          role: CODER_ROLE,
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'judgeFindings',
          role: CODER_ROLE,
          sourceItem: 'WORKFLOW-4',
          prompt: [
            '以下是 `评审者` 提出的问题：',
            '<reviewFindings>',
            '对这些问题做判断：可以接受或拒绝，但要讲清楚原因。',
          ].join('\n'),
          result: {
            accept: '`编码者` 接受了 `评审者` 的问题，双方达成一致。',
            reject:
              '`编码者` 拒绝了 `评审者` 的问题，并讲清楚了原因。输出应包含 `coderJudgment: <编码者的判断及其原因>`。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          reviewFindings: context.reviewFindings,
          ...bossReplyFields(context, 'judgeFindings'),
        }),
        onDone: [
          {
            guard: 'isAccept',
            target: 'reviseByConclusion',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isRejectAndDebatable',
            target: 'debateJudgment',
            actions: ['rememberCoderJudgment', 'clearBossReplyContext'],
          },
          {
            guard: 'isRejectAndDebateExhausted',
            target: 'reviseByConclusion',
            actions: ['rememberCoderJudgment', 'clearBossReplyContext'],
          },
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'judgeFindings',
                  sourceItem: 'WORKFLOW-4',
                  roleId: CODER_ROLE,
                },
              },
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
      },
    },
    debateJudgment: {
      id: 'debateJudgment',
      description:
        '如果判断次数少于 3 次，当 `编码者` 拒绝问题时，由 `评审者` 与其争论直至达成一致。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'debateJudgment',
          description:
            '如果判断次数少于 3 次，当 `编码者` 拒绝问题时，由 `评审者` 与其争论直至达成一致。',
          role: REVIEWER_ROLE,
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'debateJudgment',
          role: REVIEWER_ROLE,
          sourceItem: 'WORKFLOW-5',
          prompt: [
            '以下是 `编码者` 的判断及其原因：',
            '<coderJudgment>',
            '与 `编码者` 争论，直至达成一致。',
          ].join('\n'),
          result: {
            dispute:
              '尚未达成一致，`评审者` 继续争论。输出应包含 `reviewerRebuttal: <评审者继续争论的理由>`。',
            agreed: '双方达成一致。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          coderJudgment: context.coderJudgment,
          ...bossReplyFields(context, 'debateJudgment'),
        }),
        onDone: [
          {
            guard: 'isDispute',
            target: 'rejudgeRebuttal',
            actions: ['rememberReviewerRebuttal', 'clearBossReplyContext'],
          },
          {
            guard: 'isAgreed',
            target: 'reviseByConclusion',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'debateJudgment',
                  sourceItem: 'WORKFLOW-5',
                  roleId: REVIEWER_ROLE,
                },
              },
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
      },
    },
    rejudgeRebuttal: {
      id: 'rejudgeRebuttal',
      description:
        '当 `评审者` 继续争论时，由 `编码者` 再次接受或拒绝并讲清楚原因。',
      tags: ['playbook.busy'],
      entry: ['countJudgment'],
      meta: {
        playbook: {
          stateId: 'rejudgeRebuttal',
          description:
            '当 `评审者` 继续争论时，由 `编码者` 再次接受或拒绝并讲清楚原因。',
          role: CODER_ROLE,
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'rejudgeRebuttal',
          role: CODER_ROLE,
          sourceItem: 'WORKFLOW-6',
          prompt: [
            '以下是 `评审者` 继续争论的理由：',
            '<reviewerRebuttal>',
            '再次做判断：可以接受或拒绝，但要讲清楚原因。',
          ].join('\n'),
          result: {
            accept: '`编码者` 接受了 `评审者` 的理由，双方达成一致。',
            reject:
              '`编码者` 仍然拒绝，并讲清楚了原因。输出应包含 `coderJudgment: <编码者的判断及其原因>`。',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          reviewerRebuttal: context.reviewerRebuttal,
          ...bossReplyFields(context, 'rejudgeRebuttal'),
        }),
        onDone: [
          {
            guard: 'isAccept',
            target: 'reviseByConclusion',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isRejectAndDebatable',
            target: 'debateJudgment',
            actions: ['rememberCoderJudgment', 'clearBossReplyContext'],
          },
          {
            guard: 'isRejectAndDebateExhausted',
            target: 'reviseByConclusion',
            actions: ['rememberCoderJudgment', 'clearBossReplyContext'],
          },
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'rejudgeRebuttal',
                  sourceItem: 'WORKFLOW-6',
                  roleId: CODER_ROLE,
                },
              },
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
      },
    },
    reviseByConclusion: {
      id: 'reviseByConclusion',
      description:
        '当双方达成一致，或 `编码者` 已做出总计第 3 次判断而不再争论时，由 `编码者` 按结论修改代码并再次提交。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'reviseByConclusion',
          description:
            '当双方达成一致，或 `编码者` 已做出总计第 3 次判断而不再争论时，由 `编码者` 按结论修改代码并再次提交。',
          role: CODER_ROLE,
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'reviseByConclusion',
          role: CODER_ROLE,
          sourceItem: 'WORKFLOW-7',
          prompt: ['按结论修改代码。', '再次提交。'].join('\n'),
          result: {
            done: DEFAULT_SINGLE_OUTCOME_DESCRIPTION,
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          ...bossReplyFields(context, 'reviseByConclusion'),
        }),
        onDone: [
          {
            guard: 'isDoneAndCycleAvailable',
            target: 'reviewCommit',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isDoneAndCycleLimitReached',
            target: 'cycleLimitReached',
            actions: ['clearBossReplyContext'],
          },
          {
            guard: 'isNeedsBossReply',
            target: 'awaitBossReply',
            actions: [
              {
                type: 'setPendingBossQuestion',
                params: {
                  stateId: 'reviseByConclusion',
                  sourceItem: 'WORKFLOW-7',
                  roleId: CODER_ROLE,
                },
              },
            ],
          },
          { target: 'failed', actions: ['rememberMalformedOutput'] },
        ],
        onError: { target: 'failed', actions: ['rememberActorError'] },
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
          ...resumableStates(RESUMABLE_STATE_IDS),
          { target: 'failed', actions: ['rememberMalformedBossReply'] },
        ],
      },
    },
    failed: {
      id: 'failed',
      description: '流程失败，等待 Boss 以新的任务恢复。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description: '流程失败，等待 Boss 以新的任务恢复。',
        },
      },
      on: {
        BOSS_TASK: bossTaskEntry,
      },
    },
    reviewClean: {
      id: 'reviewClean',
      type: 'final',
      description: 'review 没有任何问题，流程结束。',
      meta: {
        playbook: {
          stateId: 'reviewClean',
          description: 'review 没有任何问题，流程结束。',
        },
      },
    },
    cycleLimitReached: {
      id: 'cycleLimitReached',
      type: 'final',
      description: '循环次数已达 2 次上限，review 未确认无问题，流程结束。',
      meta: {
        playbook: {
          stateId: 'cycleLimitReached',
          description: '循环次数已达 2 次上限，review 未确认无问题，流程结束。',
        },
      },
    },
  },
});

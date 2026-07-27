import { setup, assign, fromPromise } from 'xstate';

// Actor input/output contracts the linker must provide.

export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

export interface PlayerInput {
  stateId: string;
  player: string;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  task?: string;
  findings?: string;
  judgment?: string;
  conclusion?: string;
}

export type PlayerOutput =
  | { guard: 'done' }
  | { guard: 'findings'; findings: string }
  | { guard: 'clean' }
  | { guard: 'agreed'; conclusion: string }
  | { guard: 'disagreed'; judgment: string; conclusion: string }
  | { guard: 'needsBossReply'; question: string };

export interface ScriptInput {
  stateId: string;
  sourceItem: string;
  command: string;
  result: Record<string, string>;
}

export type ScriptOutput =
  | { guard: 'ok'; exitStatus: number }
  | { guard: 'failed'; exitStatus: number };

export interface WorkflowInput {
  task?: string;
}

interface WorkflowContext {
  task: string;
  findings: string;
  judgment: string;
  conclusion: string;
  judgeCount: number;
  loopCount: number;
  lastError?: NormalizedError;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

type WorkflowEvent =
  | { type: 'START'; task: string }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

// Fixed descriptions.

const DONE_DESCRIPTION = 'The acting agent completed the behavior.';

const STD_NEEDS_BOSS_REPLY =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// Structural narrowing helpers: invoked-actor output may reach shared guards
// and actions as unknown, so narrow to the declared contract before reading.

function playerOutputOf(event: unknown): PlayerOutput | undefined {
  const output = (event as { output?: unknown }).output;
  if (
    typeof output === 'object' &&
    output !== null &&
    'guard' in output &&
    typeof (output as { guard: unknown }).guard === 'string'
  ) {
    return output as PlayerOutput;
  }
  return undefined;
}

function guardOf(event: unknown): string {
  return playerOutputOf(event)?.guard ?? '';
}

function findingsOf(event: unknown): string {
  const output = playerOutputOf(event);
  return output?.guard === 'findings' ? output.findings : '';
}

function judgmentOf(event: unknown): string {
  const output = playerOutputOf(event);
  return output?.guard === 'disagreed' ? output.judgment : '';
}

function conclusionOf(event: unknown): string {
  const output = playerOutputOf(event);
  return output?.guard === 'agreed' || output?.guard === 'disagreed'
    ? output.conclusion
    : '';
}

function questionOf(event: unknown): string {
  const output = playerOutputOf(event);
  return output?.guard === 'needsBossReply' ? output.question : '';
}

function scriptGuardOf(event: unknown): string {
  const output = (event as { output?: unknown }).output;
  if (
    typeof output === 'object' &&
    output !== null &&
    'guard' in output &&
    typeof (output as { guard: unknown }).guard === 'string'
  ) {
    return (output as ScriptOutput).guard;
  }
  return '';
}

function normalizeError(event: unknown): NormalizedError {
  const error = (event as { error?: unknown }).error;
  if (error instanceof Error) {
    const normalized: NormalizedError = {
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

function buildPending(
  resumeStateId: string,
  sourceItem: string,
  player: string,
  event: unknown,
): PendingBossQuestion {
  return {
    questionId: resumeStateId,
    resumeStateId,
    sourceItem,
    player,
    question: questionOf(event),
  };
}

// Carry the pending question and reply for the working leaf, omitting absent
// optional members so actor input stays JSON-safe.
function bossReplyFields(context: WorkflowContext): {
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
} {
  const fields: {
    pendingBossQuestion?: PendingBossQuestion;
    bossReply?: string;
  } = {};
  if (context.pendingBossQuestion !== undefined) {
    fields.pendingBossQuestion = context.pendingBossQuestion;
  }
  if (context.bossReply !== undefined) {
    fields.bossReply = context.bossReply;
  }
  return fields;
}

// One guarded BOSS_REPLY arm per resumable working leaf.
function resumableStates(ids: readonly string[]) {
  return ids.map((id) => ({
    guard: { type: 'isResumeTarget' as const, params: { id } },
    target: `#${id}`,
    actions: 'applyBossReply' as const,
    reenter: true as const,
  }));
}

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
    scriptOk: ({ event }) => scriptGuardOf(event) === 'ok',
    scriptFailed: ({ event }) => scriptGuardOf(event) === 'failed',
    isDone: ({ event }) => guardOf(event) === 'done',
    isFindings: ({ event }) => guardOf(event) === 'findings',
    isClean: ({ event }) => guardOf(event) === 'clean',
    needsBossReply: ({ event }) =>
      guardOf(event) === 'needsBossReply' && questionOf(event).length > 0,
    needsBossReplyNoQuestion: ({ event }) =>
      guardOf(event) === 'needsBossReply' && questionOf(event).length === 0,
    agreedCanLoop: ({ context, event }) =>
      guardOf(event) === 'agreed' && context.loopCount < 2,
    agreedNoLoop: ({ context, event }) =>
      guardOf(event) === 'agreed' && context.loopCount >= 2,
    disagreedCanArgue: ({ context, event }) =>
      guardOf(event) === 'disagreed' && context.judgeCount < 2,
    disagreedStopCanLoop: ({ context, event }) =>
      guardOf(event) === 'disagreed' &&
      context.judgeCount >= 2 &&
      context.loopCount < 2,
    disagreedStopNoLoop: ({ context, event }) =>
      guardOf(event) === 'disagreed' &&
      context.judgeCount >= 2 &&
      context.loopCount >= 2,
    bossReplyEmpty: ({ event }) => {
      const reply = event as { answer?: unknown };
      return (
        typeof reply.answer !== 'string' || reply.answer.trim().length === 0
      );
    },
    isResumeTarget: ({ context }, params: { id: string }) =>
      context.pendingBossQuestion?.resumeStateId === params.id,
  },
  actions: {
    assignTask: assign(({ event }) => {
      if (event.type !== 'START') {
        return {};
      }
      return {
        task: event.task,
        findings: '',
        judgment: '',
        conclusion: '',
        judgeCount: 0,
        loopCount: 0,
        lastError: undefined,
        pendingBossQuestion: undefined,
        bossReply: undefined,
      };
    }),
    applyBossReply: assign(({ event }) => {
      if (event.type !== 'BOSS_REPLY') {
        return {};
      }
      return { bossReply: event.answer };
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: () => undefined,
      bossReply: () => undefined,
    }),
    assignFindings: assign({ findings: ({ event }) => findingsOf(event) }),
    assignConclusion: assign({
      conclusion: ({ event }) => conclusionOf(event),
    }),
    assignJudgmentAndConclusion: assign({
      judgment: ({ event }) => judgmentOf(event),
      conclusion: ({ event }) => conclusionOf(event),
    }),
    incJudge: assign({ judgeCount: ({ context }) => context.judgeCount + 1 }),
    incLoop: assign({ loopCount: ({ context }) => context.loopCount + 1 }),
    rememberError: assign({ lastError: ({ event }) => normalizeError(event) }),
  },
}).createMachine({
  id: 'twoAgentWorkflow',
  context: ({ input }) => ({
    task: input.task ?? '',
    findings: '',
    judgment: '',
    conclusion: '',
    judgeCount: 0,
    loopCount: 0,
  }),
  initial: 'ready',
  states: {
    ready: {
      id: 'ready',
      description: '空闲枢纽，等待 Boss 提供输入任务。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description: '空闲枢纽，等待 Boss 提供输入任务。',
        },
      },
      on: {
        START: { target: 'repoSetup', actions: 'assignTask' },
      },
    },

    repoSetup: {
      id: 'repoSetup',
      description: '在提交前确保工作目录是 Git 仓库根目录。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'repoSetup',
          description: '在提交前确保工作目录是 Git 仓库根目录。',
        },
      },
      invoke: {
        src: 'script',
        input: (): ScriptInput => ({
          stateId: 'repoSetup',
          sourceItem: 'REPO-1',
          command: '[ -e .git ] || git init',
          result: {
            ok: '命令以状态码零退出。',
            failed: '命令以非零状态码退出。',
          },
        }),
        onDone: [
          { guard: 'scriptOk', target: 'implement' },
          { guard: 'scriptFailed', target: 'failed' },
          { target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    implement: {
      id: 'implement',
      description: '编码者实现输入任务并提交。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'implement',
          description: '编码者实现输入任务并提交。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'implement',
          player: '编码者',
          sourceItem: 'IMPL-1',
          prompt: [
            '按输入任务的要求修改当前目录的代码：<task>。',
            '将改动提交到 Git。',
          ].join('\n'),
          result: {
            done: DONE_DESCRIPTION,
            needsBossReply: STD_NEEDS_BOSS_REPLY,
          },
          task: context.task,
          ...bossReplyFields(context),
        }),
        onDone: [
          {
            guard: 'needsBossReply',
            target: 'awaitBossReply',
            actions: assign({
              pendingBossQuestion: ({ event }) =>
                buildPending('implement', 'IMPL-1', '编码者', event),
              bossReply: () => undefined,
            }),
          },
          { guard: 'needsBossReplyNoQuestion', target: 'failed' },
          {
            guard: 'isDone',
            target: 'review',
            actions: 'clearBossReplyContext',
          },
          { target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    review: {
      id: 'review',
      description: '审查者审查最新 commit，并可能提出问题。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'review',
          description: '审查者审查最新 commit，并可能提出问题。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'review',
          player: '审查者',
          sourceItem: 'REVIEW-1',
          prompt: [
            '审查当前目录中的最新 commit。',
            '就其提出合理的问题。',
          ].join('\n'),
          result: {
            findings:
              '`审查者` 提出了合理的问题并交回给 `编码者`。输出应包含 `findings: <逐字的问题内容>`。',
            clean: '`审查者` 没有提出任何问题，工作流结束。',
            needsBossReply: STD_NEEDS_BOSS_REPLY,
          },
          ...bossReplyFields(context),
        }),
        onDone: [
          {
            guard: 'needsBossReply',
            target: 'awaitBossReply',
            actions: assign({
              pendingBossQuestion: ({ event }) =>
                buildPending('review', 'REVIEW-1', '审查者', event),
              bossReply: () => undefined,
            }),
          },
          { guard: 'needsBossReplyNoQuestion', target: 'failed' },
          {
            guard: 'isFindings',
            target: 'judge',
            actions: ['assignFindings', 'clearBossReplyContext'],
          },
          {
            guard: 'isClean',
            target: 'done',
            actions: 'clearBossReplyContext',
          },
          { target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    judge: {
      id: 'judge',
      description: '编码者对问题做判断，逐一接受或拒绝。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'judge',
          description: '编码者对问题做判断，逐一接受或拒绝。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'judge',
          player: '编码者',
          sourceItem: 'JUDGE-1',
          prompt: [
            '对 `审查者` 提出的问题做判断：<findings>。',
            '对每个问题给出接受或拒绝，并逐一说明原因。',
          ].join('\n'),
          result: {
            agreed:
              '`编码者` 与 `审查者` 就问题达成一致。输出应包含 `conclusion: <达成一致后要做的改动>`。',
            disagreed:
              '`编码者` 判断后仍存在分歧。输出应包含 `judgment: <编码者接受或拒绝的决定及原因>` 与 `conclusion: <编码者当前打算做的改动>`。',
            needsBossReply: STD_NEEDS_BOSS_REPLY,
          },
          findings: context.findings,
          ...bossReplyFields(context),
        }),
        onDone: [
          {
            guard: 'needsBossReply',
            target: 'awaitBossReply',
            actions: assign({
              pendingBossQuestion: ({ event }) =>
                buildPending('judge', 'JUDGE-1', '编码者', event),
              bossReply: () => undefined,
            }),
          },
          { guard: 'needsBossReplyNoQuestion', target: 'failed' },
          {
            guard: 'agreedCanLoop',
            target: 'reimplement',
            actions: ['assignConclusion', 'incJudge', 'clearBossReplyContext'],
          },
          {
            guard: 'agreedNoLoop',
            target: 'done',
            actions: ['assignConclusion', 'incJudge', 'clearBossReplyContext'],
          },
          {
            guard: 'disagreedCanArgue',
            target: 'argue',
            actions: [
              'assignJudgmentAndConclusion',
              'incJudge',
              'clearBossReplyContext',
            ],
          },
          {
            guard: 'disagreedStopCanLoop',
            target: 'reimplement',
            actions: [
              'assignJudgmentAndConclusion',
              'incJudge',
              'clearBossReplyContext',
            ],
          },
          {
            guard: 'disagreedStopNoLoop',
            target: 'done',
            actions: [
              'assignJudgmentAndConclusion',
              'incJudge',
              'clearBossReplyContext',
            ],
          },
          { target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    argue: {
      id: 'argue',
      description: '审查者就其判断据理力争。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'argue',
          description: '审查者就其判断据理力争。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'argue',
          player: '审查者',
          sourceItem: 'ARGUE-1',
          prompt: [
            '考虑 `编码者` 对你所提问题的判断：<judgment>。',
            '对你仍不认同的问题据理力争。',
          ].join('\n'),
          result: {
            findings:
              '`审查者` 保留尚未解决的问题，交由 `编码者` 再次判断。输出应包含 `findings: <尚未解决的问题>`。',
            agreed: '`审查者` 接受 `编码者` 的判断，不再有争议问题。',
            needsBossReply: STD_NEEDS_BOSS_REPLY,
          },
          judgment: context.judgment,
          ...bossReplyFields(context),
        }),
        onDone: [
          {
            guard: 'needsBossReply',
            target: 'awaitBossReply',
            actions: assign({
              pendingBossQuestion: ({ event }) =>
                buildPending('argue', 'ARGUE-1', '审查者', event),
              bossReply: () => undefined,
            }),
          },
          { guard: 'needsBossReplyNoQuestion', target: 'failed' },
          {
            guard: 'isFindings',
            target: 'judge',
            actions: ['assignFindings', 'clearBossReplyContext'],
          },
          {
            guard: 'agreedCanLoop',
            target: 'reimplement',
            actions: 'clearBossReplyContext',
          },
          {
            guard: 'agreedNoLoop',
            target: 'done',
            actions: 'clearBossReplyContext',
          },
          { target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    reimplement: {
      id: 'reimplement',
      description: '编码者按结论修改代码并再次提交。',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'reimplement',
          description: '编码者按结论修改代码并再次提交。',
        },
      },
      invoke: {
        src: 'player',
        input: ({ context }): PlayerInput => ({
          stateId: 'reimplement',
          player: '编码者',
          sourceItem: 'IMPL-2',
          prompt: [
            '按结论修改当前目录的代码：<conclusion>。',
            '将改动提交到 Git。',
          ].join('\n'),
          result: {
            done: DONE_DESCRIPTION,
            needsBossReply: STD_NEEDS_BOSS_REPLY,
          },
          conclusion: context.conclusion,
          ...bossReplyFields(context),
        }),
        onDone: [
          {
            guard: 'needsBossReply',
            target: 'awaitBossReply',
            actions: assign({
              pendingBossQuestion: ({ event }) =>
                buildPending('reimplement', 'IMPL-2', '编码者', event),
              bossReply: () => undefined,
            }),
          },
          { guard: 'needsBossReplyNoQuestion', target: 'failed' },
          {
            guard: 'isDone',
            target: 'review',
            actions: ['incLoop', 'clearBossReplyContext'],
          },
          { target: 'failed' },
        ],
        onError: { target: 'failed', actions: 'rememberError' },
      },
    },

    awaitBossReply: {
      id: 'awaitBossReply',
      description: '等待 Boss 回答执行者提出的问题。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'awaitBossReply',
          description: '等待 Boss 回答执行者提出的问题。',
        },
      },
      on: {
        BOSS_REPLY: [
          { guard: 'bossReplyEmpty', target: 'failed' },
          ...resumableStates([
            'implement',
            'review',
            'judge',
            'argue',
            'reimplement',
          ]),
          { target: 'failed' },
        ],
      },
    },

    failed: {
      id: 'failed',
      description: '可恢复的失败；保留类型化上下文并接受新任务。',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description: '可恢复的失败；保留类型化上下文并接受新任务。',
        },
      },
      on: {
        START: { target: 'repoSetup', actions: 'assignTask' },
      },
    },

    done: {
      id: 'done',
      type: 'final',
      description: '工作流结束：审查未提出问题或已达到循环上限。',
      meta: {
        playbook: {
          stateId: 'done',
          description: '工作流结束：审查未提出问题或已达到循环上限。',
        },
      },
    },
  },
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

const gearsOutput = `# Pipeline Fixture

Roles:

- Player

### PIPELINE-FIXTURE

Captain shall prompt Player:

> Write the requested pipeline output.
`;

/** Generic pipeline fixtures author a small reachable FSM so early gates can run. */
export function pipelineOutput(target: string, label = 'output'): string {
  if (target.endsWith('.gears.md') || target.endsWith('.gears.raw.md'))
    return gearsOutput;
  return target.endsWith('.ts')
    ? `// ${label}
import { assign, fromPromise, setup } from 'xstate';

export const concurrentRoleSets = [] as const;
export const machine = setup({
  types: {
    context: {} as {
      pendingBossQuestion?: { question: string };
      bossReply?: string;
      failure?: string;
    },
    events: {} as
      | { type: 'BOSS_REPLY'; answer: string }
      | { type: 'NO_ACTION' },
  },
  actors: {
    player: fromPromise(async () => {
      throw new Error('test fixture supplies the player actor');
    }),
  },
  actions: {
    rememberQuestion: assign({
      pendingBossQuestion: ({ event }) => ({
        question: String(
          (event as { output?: { question?: unknown } }).output?.question ??
            'Which output is required?',
        ),
      }),
    }),
    rememberBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
    }),
    rememberFailure: assign({
      failure: ({ event }) =>
        String((event as { error?: unknown }).error ?? 'player failed'),
    }),
  },
  guards: {
    playerDone: ({ event }) =>
      (event as { output?: { guard?: string } }).output?.guard === 'done',
    playerAskedBoss: ({ event }) =>
      (event as { output?: { guard?: string; question?: unknown } }).output
        ?.guard === 'needsBossReply' &&
      typeof (event as { output?: { question?: unknown } }).output?.question ===
        'string' &&
      (event as { output?: { question?: string } }).output!.question!.trim() !==
        '',
    bossReplyIsNonblank: ({ event }) =>
      event.type === 'BOSS_REPLY' && event.answer.trim() !== '',
  },
}).createMachine({
  initial: 'work',
  states: {
    work: {
      id: 'work',
      tags: ['playbook.busy'],
      meta: { playbook: { stateId: 'work', role: 'player' } },
      invoke: {
        src: 'player',
        input: ({ context }) => ({
          stateId: 'work',
          sourceItem: 'PIPELINE-FIXTURE',
          role: 'player',
          prompt: 'Write the requested pipeline output.',
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
          result: {
            done: 'The output was written.',
            needsBossReply:
              'Output shall include \`question:\` Ask Boss for the missing pipeline detail.',
          },
        }),
        onDone: [
          { guard: 'playerDone', target: 'done' },
          {
            guard: 'playerAskedBoss',
            target: 'awaitBossReply',
            actions: 'rememberQuestion',
          },
        ],
        onError: { target: 'failed', actions: 'rememberFailure' },
      },
    },
    awaitBossReply: {
      id: 'awaitBossReply',
      tags: ['playbook.suspended'],
      meta: { playbook: { stateId: 'awaitBossReply' } },
      on: {
        BOSS_REPLY: {
          guard: 'bossReplyIsNonblank',
          target: 'work',
          actions: 'rememberBossReply',
        },
      },
    },
    failed: {
      id: 'failed',
      tags: ['playbook.parked'],
      type: 'final',
      meta: { playbook: { stateId: 'failed', terminal: 'failure' } },
    },
    done: {
      id: 'done',
      type: 'final',
      meta: { playbook: { stateId: 'done', terminal: 'success' } },
    },
  },
});
`
    : `${label}
`;
}

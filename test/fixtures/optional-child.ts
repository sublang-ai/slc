// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

export const prompt =
  'Review exactly.\n> <caller>\n> <local-report>\n> <remote-report>\nFinish exactly.\n';
export const gears = `### RELAY-1\n\nCaptain shall call playbook \`review\`:\n${prompt
  .split('\n')
  .map((line) => `> ${line}`)
  .join('\n')}\n`;
type Context = {
  mode?: string;
  caller?: string;
  left?: string;
  right?: string;
};
export function fixture(
  fault = '',
  predecessor = false,
  textTemplate = prompt,
) {
  const machine = setup({
    types: {
      context: {} as Context,
      events: {} as { type: 'LOCAL' | 'STALE' | 'REMOTE' },
    },
    actors: { playbook: fromPromise(async () => undefined) },
  }).createMachine({
    context: {},
    initial: 'idle',
    states: {
      idle: {
        on: {
          LOCAL: {
            target: predecessor ? 'prepare' : 'call',
            actions: assign(() => ({
              mode: 'local',
              caller: 'Request',
              left: 'Local',
              right: fault === 'stale' ? 'Hidden' : undefined,
            })),
          },
          ...(fault === 'stale-entry'
            ? {
                STALE: {
                  target: 'call',
                  actions: assign(() => ({
                    mode: 'local',
                    caller: 'Request',
                    left: 'Local',
                    right: 'Hidden',
                  })),
                },
              }
            : {}),
          REMOTE: {
            target: predecessor ? 'prepare' : 'call',
            actions: assign(() => ({
              mode: 'remote',
              caller: 'Request',
              right: 'Remote',
            })),
          },
        },
      },
      ...(predecessor
        ? {
            prepare: {
              id: 'prepare',
              tags: 'playbook.suspended',
              meta: { playbook: { stateId: 'prepare' } },
              invoke: {
                src: 'playbook',
                input: {
                  stateId: 'prepare',
                  sourceItem: 'PREPARE-1',
                  playbookId: 'prepare',
                  text: 'Prepare the report.',
                },
                onDone: {
                  target: 'call',
                  actions: assign(({ context }) => ({
                    left: context.mode === 'local' ? 'Local result' : undefined,
                    right:
                      context.mode === 'remote' ? 'Remote result' : undefined,
                  })),
                },
                onError: 'failed',
              },
            },
          }
        : {}),
      call: {
        id: 'call',
        tags: 'playbook.suspended',
        meta: { playbook: { stateId: 'call' } },
        invoke: {
          src: 'playbook',
          input: ({ context }) => {
            if (
              fault === 'strict-selector' &&
              context.mode !== undefined &&
              context.mode !== 'local' &&
              context.mode !== 'remote'
            )
              throw new Error('unsupported mode');
            // Eager reads alone must not establish payload influence.
            const eager =
              fault === 'eager'
                ? { left: context.left, right: context.right }
                : undefined;
            const values: Record<string, string | undefined> = {
              '<caller>': context.caller,
              '<local-report>':
                context.mode === 'local'
                  ? fault === 'eager'
                    ? eager.left
                    : context.left
                  : undefined,
              '<remote-report>':
                context.mode === 'remote'
                  ? fault === 'eager'
                    ? eager.right
                    : context.right
                  : undefined,
            };
            if (fault === 'deleted') values['<caller>'] = undefined;
            if (fault === 'nonempty' && context.mode === 'local')
              values['<local-report>'] = undefined;
            const text = textTemplate
              .split(/(?<=\n)/)
              .filter((line) => {
                const token = /^> (<[^>]+>)(?:\r?\n)?$/.exec(line)?.[1];
                return (
                  token === undefined ||
                  (values[token] !== undefined && values[token] !== '')
                );
              })
              .join('')
              .replace(/<[^>]+>/g, (token) =>
                (fault === 'crlf'
                  ? (values[token] ?? token).replace(/\r\n/g, '\n')
                  : (values[token] ?? token)
                ).replace(/\r?\n/g, (separator) =>
                  fault === 'blank' ? separator : `${separator}> `,
                ),
              );
            return {
              stateId: 'call',
              sourceItem: 'RELAY-1',
              playbookId:
                fault === 'identity' && context.caller?.includes('«')
                  ? 'other'
                  : 'review',
              text:
                fault === 'invent'
                  ? text + 'Invented'
                  : (fault === 'separator' || fault === 'terminal-separator') &&
                      Object.values(values).every(
                        (value) => value === undefined || value === '',
                      )
                    ? text.slice(0, -1)
                    : text,
            };
          },
          onDone: 'done',
          onError: 'failed',
        },
      },
      done: { type: 'final' },
      failed: { tags: 'playbook.parked' },
      awaitBossReply: { tags: 'playbook.parked', on: { BOSS_REPLY: 'idle' } },
    },
  });
  return machine;
}

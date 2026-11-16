// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/** How the call renders a labelled relay line whose value is empty. */
export type Style = 'keep' | 'omit';
/**
 * Which public entries exist. Real predecessors leave the note empty and the
 * IR number absent after `direct`, the IR number absent after `noted`, and
 * neither after `planned`.
 */
export type Reached = 'direct' | 'noted' | 'planned';

export const commits = ['a1b2c3d', 'c0ffee2'] as const;
/** Three labelled relays, the last one trailing after a blank line. */
export const template = [
  'Review the accepted work.',
  '> Request: <caller>',
  '',
  '> Note: <note>',
  '',
  'Scope: every commit, namely <commits>, and the resulting state.',
  'Evidence follows.',
  '> Report: <report>',
  '',
  '> IR number: <ir-number>',
].join('\n');
const quoted = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
/** Only a phase some public entry reaches is declared. */
export const gears = (reached: readonly Reached[]): string =>
  (reached.some((entry) => entry !== 'direct')
    ? '### PHASE-1\n\nCaptain shall call playbook `code`:\n> Plan the work.\n\n'
    : '') +
  '### PHASE-2\n\nCaptain shall call playbook `code`:\n> Implement the work.\n\n' +
  `### REVIEW-1\n\nCaptain shall call playbook \`review\`:\n${quoted(template)}\n`;

type Context = {
  kind?: Reached;
  caller?: string;
  note?: string;
  report?: string;
  irNumber?: string;
  commits: string[];
};
const enter = (kind: Reached) => assign({ kind, caller: 'Request' });

/**
 * A `review` call whose labelled relays the predecessors leave empty or
 * absent in some reached cases. With `gated`, the IR number is read only
 * where the entry planned one.
 */
export function fixture(
  style: Style,
  reached: readonly Reached[],
  fault = '',
  gated = false,
) {
  const text = template;
  return setup({
    types: { context: {} as Context },
    actors: { playbook: fromPromise(async () => undefined) },
  }).createMachine({
    context: () => ({ commits: [] }),
    initial: 'ready',
    states: {
      ready: {
        on: {
          ...(reached.includes('direct')
            ? { DIRECT: { target: 'work', actions: enter('direct') } }
            : {}),
          ...(reached.includes('noted')
            ? { NOTED: { target: 'plan', actions: enter('noted') } }
            : {}),
          ...(reached.includes('planned')
            ? { PLANNED: { target: 'plan', actions: enter('planned') } }
            : {}),
        },
      },
      ...(reached.some((entry) => entry !== 'direct')
        ? {
            plan: {
              id: 'plan',
              tags: 'playbook.suspended',
              invoke: {
                src: 'playbook' as const,
                input: {
                  stateId: 'plan',
                  sourceItem: 'PHASE-1',
                  playbookId: 'code',
                  text: 'Plan the work.',
                },
                onDone: {
                  target: 'work',
                  // Only a planned entry records an IR number.
                  actions: assign(({ context }: { context: Context }) => ({
                    note: context.kind === 'planned' ? 'Planned' : 'Noted',
                    ...(context.kind === 'planned' ? { irNumber: '7' } : {}),
                    commits: [...context.commits, commits[0]],
                  })),
                },
                onError: 'failed',
              },
            },
          }
        : {}),
      work: {
        id: 'work',
        tags: 'playbook.suspended',
        invoke: {
          src: 'playbook',
          input: {
            stateId: 'work',
            sourceItem: 'PHASE-2',
            playbookId: 'code',
            text: 'Implement the work.',
          },
          onDone: {
            target: 'call',
            actions: assign(({ context }) => ({
              report: 'Done',
              note: context.note ?? '',
              commits: [...context.commits, commits[1]],
            })),
          },
          onError: 'failed',
        },
      },
      call: {
        id: 'call',
        tags: 'playbook.suspended',
        invoke: {
          src: 'playbook',
          input: ({ context }) => {
            const values: Record<string, string> = {
              '<caller>': context.caller ?? '',
              '<note>': context.note ?? '',
              '<commits>': context.commits.join(', '),
              '<report>': context.report ?? '',
              '<ir-number>':
                gated && context.kind !== 'planned'
                  ? ''
                  : (context.irNumber ?? ''),
            };
            const omitting =
              fault === 'mix-cases'
                ? context.kind !== 'direct'
                : fault === 'mix-probes'
                  ? values['<caller>'] === ''
                  : style === 'omit';
            const lines: string[] = [];
            let omitted = false;
            for (const line of text.split('\n')) {
              const token = /^> [^<>]+: (<[^>]+>)$/.exec(line)?.[1];
              const empty = token !== undefined && values[token] === '';
              if (
                fault === 'never'
                  ? token === '<ir-number>'
                  : (empty &&
                      omitting &&
                      !(fault === 'mix-lines' && token === '<ir-number>')) ||
                    // The IR number goes with an empty note, present or not.
                    (fault === 'omit-present' &&
                      token === '<ir-number>' &&
                      values['<note>'] === '')
              ) {
                omitted = true;
                if (fault === 'remove-blank' && lines.at(-1) === '')
                  lines.pop();
                continue;
              }
              if (
                fault === 'drop-static' &&
                line === 'Evidence follows.' &&
                values['<report>'] === ''
              )
                continue;
              lines.push(
                line.replace(/<[^>]+>/g, (token) => {
                  const value = values[token] ?? token;
                  return line.startsWith('> ')
                    ? value.replace(/\r?\n/g, (separator) => separator + '> ')
                    : value;
                }),
              );
            }
            // The blank lines an omission leaves at the end go with it.
            if (omitted && fault !== 'leave-blank')
              while (lines.at(-1) === '') lines.pop();
            return {
              stateId: 'call',
              sourceItem: 'REVIEW-1',
              playbookId: 'review',
              text: lines.join('\n'),
            };
          },
          onDone: 'done',
          onError: 'failed',
        },
      },
      done: { type: 'final' },
      failed: { tags: 'playbook.parked' },
      awaitBossReply: { on: { BOSS_REPLY: 'ready' } },
    },
  });
}

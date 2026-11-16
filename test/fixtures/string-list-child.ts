// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/** Where `<commits>` stands in the child-input template. */
export type Slot = 'inline' | 'labelled' | 'both' | 'standalone';
/** Which public entries exist: each reaches the call with another list. */
export type Reached = 'one' | 'several' | 'empty';

export const commits = ['a1b2c3d', 'c0ffee2'] as const;
const slots: Record<Slot, string[]> = {
  inline: ['Scope: every commit, namely <commits>, and the resulting state.'],
  labelled: ['> Commits: <commits>'],
  both: [
    'Scope: every commit, namely <commits>, and the resulting state.',
    '> Commits: <commits>',
  ],
  standalone: ['> <commits>'],
};
export const template = (slot: Slot): string =>
  [
    'Review the accepted work.',
    '> Request: <caller>',
    ...slots[slot],
    'Evidence follows.',
    '> <evidence>',
    'Finish exactly.',
  ].join('\n');
const quoted = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
const everyEntry: readonly Reached[] = ['one', 'several'];
/** Only a phase some public entry reaches is declared. */
export const gears = (
  slot: Slot,
  reached: readonly Reached[] = everyEntry,
): string =>
  (reached.includes('several')
    ? '### PHASE-1\n\nCaptain shall call playbook `code`:\n> Implement the first phase.\n\n'
    : '') +
  (reached.some((entry) => entry !== 'empty')
    ? '### PHASE-2\n\nCaptain shall call playbook `code`:\n> Implement the last phase.\n\n'
    : '') +
  `### REVIEW-1\n\nCaptain shall call playbook \`review\`:\n${quoted(template(slot))}\n`;

type Context = {
  caller?: string;
  commits: unknown;
  evidence?: { kind: string; text: string }[];
};
const entry = assign({
  caller: 'Request',
  evidence: () => [{ kind: 'caller', text: 'Request' }],
});
const phase = (
  stateId: string,
  sourceItem: string,
  text: string,
  commit: unknown,
  target: string,
  decorate: (value: unknown) => unknown,
) => ({
  id: stateId,
  tags: 'playbook.suspended',
  invoke: {
    src: 'playbook' as const,
    input: { stateId, sourceItem, playbookId: 'code', text },
    onDone: {
      target,
      // The phase's commit joins the list, oldest first.
      actions: assign(({ context }: { context: Context }) => ({
        commits:
          target === 'call'
            ? decorate([...(context.commits as unknown[]), commit])
            : [...(context.commits as unknown[]), commit],
      })),
    },
    onError: 'failed',
  },
});

export function fixture(
  slot: Slot = 'both',
  reached: readonly Reached[] = everyEntry,
  fault = '',
  decorate: (value: unknown) => unknown = (value) => value,
) {
  const text = template(slot);
  return setup({
    types: { context: {} as Context },
    actors: { playbook: fromPromise(async () => undefined) },
  }).createMachine({
    context: () => ({ commits: [] }),
    initial: 'ready',
    states: {
      ready: {
        on: {
          ...(reached.includes('empty')
            ? { EMPTY: { target: 'call', actions: entry } }
            : {}),
          ...(reached.includes('one')
            ? { DIRECT: { target: 'last', actions: entry } }
            : {}),
          ...(reached.includes('several')
            ? { SERIES: { target: 'first', actions: entry } }
            : {}),
        },
      },
      ...(reached.includes('several')
        ? {
            first: phase(
              'first',
              'PHASE-1',
              'Implement the first phase.',
              commits[0],
              'last',
              decorate,
            ),
          }
        : {}),
      ...(reached.some((entry) => entry !== 'empty')
        ? {
            last: phase(
              'last',
              'PHASE-2',
              'Implement the last phase.',
              fault === 'non-string' ? 7 : commits[1],
              'call',
              decorate,
            ),
          }
        : {}),
      call: {
        id: 'call',
        tags: 'playbook.suspended',
        invoke: {
          src: 'playbook',
          input: ({ context }) => {
            const list =
              fault === 'unsafe'
                ? (void context.commits, [...commits])
                : (context.commits as string[]);
            const joined =
              fault === 'separator'
                ? list.join('; ')
                : fault === 'compact'
                  ? list.join(',')
                  : fault === 'drop'
                    ? list.slice(1).join(', ')
                    : fault === 'reorder'
                      ? [...list].reverse().join(', ')
                      : fault === 'alter'
                        ? list.map((commit) => commit.slice(0, 7)).join(', ')
                        : fault === 'hardcode'
                          ? [...list.slice(0, -1), commits[1]].join(', ')
                          : fault === 'partly-json'
                            ? [
                                ...list.slice(0, 1),
                                ...list
                                  .slice(1)
                                  .map((commit) => JSON.stringify(commit)),
                              ].join(', ')
                            : fault === 'first'
                              ? (list[0] ?? '')
                              : fault === 'last'
                                ? (list[list.length - 1] ?? '')
                                : fault === 'lowercase'
                                  ? list
                                      .map((commit) => commit.toLowerCase())
                                      .join(', ')
                                  : list.join(', ');
            const values: Record<string, string | undefined> = {
              '<caller>': context.caller,
              '<commits>': joined,
              '<evidence>': JSON.stringify(context.evidence),
            };
            let occurrence = 0;
            return {
              stateId: 'call',
              sourceItem: 'REVIEW-1',
              playbookId: 'review',
              text: text
                .split(/(?<=\n)/)
                .filter((line) => {
                  const token = /^> (<[^>]+>)(?:\n)?$/.exec(line)?.[1];
                  return token === undefined || values[token] !== '';
                })
                .map((line) =>
                  line.replace(/<[^>]+>/g, (token) => {
                    // One list, joined in its first slot and JSON in the next.
                    const value =
                      fault === 'json-and-list' &&
                      token === '<commits>' &&
                      occurrence++ > 0
                        ? JSON.stringify(list)
                        : (values[token] ?? token);
                    return line.startsWith('> ')
                      ? value.replace(/\r?\n/g, (separator) => separator + '> ')
                      : value;
                  }),
                )
                .join(''),
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

const ownerTemplate = [
  'Review the accepted work.',
  '> Request: <caller>',
  'Owner: <owner> here.',
  'Finish exactly.',
].join('\n');
export const ownerGears = (
  reached: readonly ('absent' | 'present')[],
): string =>
  (reached.includes('present')
    ? '### PHASE-2\n\nCaptain shall call playbook `code`:\n> Implement the last phase.\n\n'
    : '') +
  `### REVIEW-1\n\nCaptain shall call playbook \`review\`:\n${quoted(ownerTemplate)}\n`;

/**
 * An inline scalar relay whose record is absent until a real predecessor
 * assigns it, beside a list of tags that starts empty and that the input
 * relays nowhere: it reads the list for control, or not at all.
 */
export function ownerFixture(
  readsTags: boolean,
  reached: readonly ('absent' | 'present')[],
  tag: unknown = commits[1],
) {
  const text = ownerTemplate;
  const enter = assign({ caller: 'Request' });
  return setup({
    types: {
      context: {} as {
        caller?: string;
        owner?: { name: string };
        tags: unknown[];
      },
    },
    actors: { playbook: fromPromise(async () => undefined) },
  }).createMachine({
    context: () => ({ tags: [] }),
    initial: 'ready',
    states: {
      ready: {
        on: {
          ...(reached.includes('absent')
            ? { ABSENT: { target: 'call', actions: enter } }
            : {}),
          ...(reached.includes('present')
            ? { PRESENT: { target: 'last', actions: enter } }
            : {}),
        },
      },
      ...(reached.includes('present')
        ? {
            last: {
              id: 'last',
              tags: 'playbook.suspended',
              invoke: {
                src: 'playbook' as const,
                input: {
                  stateId: 'last',
                  sourceItem: 'PHASE-2',
                  playbookId: 'code',
                  text: 'Implement the last phase.',
                },
                onDone: {
                  target: 'call',
                  actions: assign(({ context }) => ({
                    owner: { name: 'Ada' },
                    tags: [...context.tags, tag],
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
        invoke: {
          src: 'playbook',
          input: ({ context }) => {
            if (readsTags) void context.tags.length;
            const values: Record<string, string> = {
              '<caller>': context.caller ?? '<caller>',
              '<owner>': context.owner?.name ?? '',
            };
            return {
              stateId: 'call',
              sourceItem: 'REVIEW-1',
              playbookId: 'review',
              text: text
                .split(/(?<=\n)/)
                .map((line) =>
                  line.replace(/<[^>]+>/g, (token) => {
                    const value = values[token] ?? token;
                    return line.startsWith('> ')
                      ? value.replace(/\r?\n/g, (separator) => separator + '> ')
                      : value;
                  }),
                )
                .join(''),
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

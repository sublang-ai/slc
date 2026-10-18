// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup } from 'xstate';
import { checkGearsFsmArtifact } from '../src/verify-coverage.js';

const template =
  'Complete the authorized task.\n> <caller>\n\n> <report>\n\n> <evidence>';
const gears =
  '### COORDINATOR-1\n\nCaptain shall call playbook `coordinate`:\n> Read the current evidence.\n\n' +
  `### CHILD-1\n\nCaptain shall call playbook \`design\`:\n${template
    .split('\n')
    .map((line) => '> ' + line)
    .join('\n')}\n`;
type Context = {
  caller?: string;
  report?: string;
  evidence: unknown;
  evidenceAlias?: unknown;
};
function ordered(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(ordered)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              ordered((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;
}
function fixture(
  fault = '',
  record = false,
  decorate: (value: unknown) => unknown = (value) => value,
) {
  const machine = setup({
    types: { context: {} as Context },
    actors: { playbook: fromPromise(async () => undefined) },
  }).createMachine({
    context: () => {
      const evidence: unknown[] = [];
      return { evidence, evidenceAlias: evidence };
    },
    initial: 'ready',
    states: {
      ready: {
        on: {
          ...(['empty-cases', 'empty-drop'].includes(fault)
            ? {
                EMPTY: {
                  target: 'call',
                  actions: assign({
                    caller: 'Request',
                    report: 'Current report',
                    evidence: () => [],
                  }),
                },
                NUMERIC: {
                  target: 'call',
                  actions: assign({
                    caller: 'Request',
                    report: 'Current report',
                    evidence: () => [2, false, null],
                  }),
                },
              }
            : {}),
          START: {
            target: 'coordinate',
            actions: assign({
              caller: 'Request',
              evidence: () => [
                { kind: 'caller', text: 'Request' },
                { kind: 'prior', text: 'Prior receipt' },
              ],
            }),
          },
        },
      },
      coordinate: {
        id: 'coordinate',
        tags: 'playbook.suspended',
        invoke: {
          src: 'playbook',
          input: {
            stateId: 'coordinate',
            sourceItem: 'COORDINATOR-1',
            playbookId: 'coordinate',
            text: 'Read the current evidence.',
          },
          onDone: {
            target: 'call',
            actions: assign(({ context }) => {
              const evidence = decorate(
                record
                  ? {
                      '10': 'Ten',
                      '2': 'Two',
                      z: { flag: false, count: 2, empty: null, text: 'Last' },
                      a: context.evidence,
                    }
                  : [
                      ...(context.evidence as object[]),
                      { kind: 'report', text: 'Current report' },
                    ],
              );
              return {
                report: 'Current report',
                evidence,
                evidenceAlias: evidence,
              };
            }),
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
            if (fault === 'alias' && context.evidence !== context.evidenceAlias)
              throw Error('alias changed');
            if (
              fault === 'key-order' &&
              context.report !== undefined &&
              Object.keys(context.evidence as object).join('|') !== '2|10|z|a'
            )
              throw Error('record control key order changed');
            let evidence =
              fault === 'unsafe'
                ? (void context.evidence, [{ text: 'Unproved' }])
                : ordered(context.evidence);
            if (
              fault === 'mutating-descriptor' &&
              Array.isArray(context.evidence) &&
              context.evidence[0]
            ) {
              const row = context.evidence[0];
              const descriptor = Object.getOwnPropertyDescriptor(row, 'text')!;
              Object.defineProperty(row, 'text', {
                ...descriptor,
                writable: !descriptor.writable,
              });
            }
            if (fault === 'drop') evidence = (evidence as unknown[]).slice(1);
            if (fault === 'reorder')
              evidence = [...(evidence as unknown[])].reverse();
            if (fault === 'hardcode')
              evidence = (evidence as Record<string, unknown>[]).map(
                (row, index) =>
                  index === 1 ? { ...row, text: 'Prior receipt' } : row,
              );
            let encoded = JSON.stringify(
              evidence,
              null,
              fault === 'noncanonical' ? 2 : undefined,
            );
            if (fault === 'corrupt')
              encoded = encoded.replace('Current report', 'Changed report');
            if (fault === 'empty-drop' && encoded === '[]') encoded = '';
            const values: Record<string, string | undefined> = {
              '<caller>': context.caller,
              '<report>': context.report,
              '<evidence>': encoded,
            };
            return {
              stateId: 'call',
              sourceItem: 'CHILD-1',
              playbookId: 'design',
              text: template
                .split(/(?<=\n)/)
                .filter((line) => {
                  const token = /^> (<[^>]+>)(?:\n)?$/.exec(line)?.[1];
                  return token === undefined || values[token] !== '';
                })
                .join('')
                .replace(/<[^>]+>/g, (token) =>
                  (values[token] ?? token).replace(
                    /\r?\n/g,
                    (separator) => separator + '> ',
                  ),
                ),
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
  return machine;
}

describe('reached canonical structured child relays', () => {
  it('preserves a real START and Coordinator-assigned three-row evidence array', async () => {
    const machine = fixture();
    let actual = '';
    const actor = createActor(
      machine.provide({
        actors: {
          playbook: fromPromise(async ({ input }) => {
            const value = input as { playbookId: string; text: string };
            if (value.playbookId === 'design') actual = value.text;
          }),
        },
      }),
    );
    actor.start();
    actor.send({ type: 'START' });
    for (let n = 0; n < 10 && !actual; n++) await Promise.resolve();
    actor.stop();
    const evidence = [
      { kind: 'caller', text: 'Request' },
      { kind: 'prior', text: 'Prior receipt' },
      { kind: 'report', text: 'Current report' },
    ];
    expect(actual).toBe(
      template
        .replace('<caller>', 'Request')
        .replace('<report>', 'Current report')
        .replace('<evidence>', JSON.stringify(ordered(evidence))),
    );
    expect(await checkGearsFsmArtifact(gears, { machine })).toEqual([]);
  });
  it('preserves nested records, numbers, booleans, null and JSON integer-key ordering', async () => {
    expect(
      await checkGearsFsmArtifact(gears, { machine: fixture('', true) }),
    ).toEqual([]);
  });
  it('preserves original own-key control order while only canonical encoding sorts keys', async () => {
    expect(
      await checkGearsFsmArtifact(gears, {
        machine: fixture('key-order', true),
      }),
    ).toEqual([]);
  });
  it('validates empty and numeric-only reached arrays under another case mapping', async () => {
    expect(
      await checkGearsFsmArtifact(gears, { machine: fixture('empty-cases') }),
    ).toEqual([]);
    expect(
      await checkGearsFsmArtifact(gears, { machine: fixture('empty-drop') }),
    ).not.toEqual([]);
  });
  it.each([[], [2, false, null]])(
    'does not invent a structured mapping from a no-string container %j',
    async (evidence) => {
      expect(
        await checkGearsFsmArtifact(gears, {
          machine: fixture('', false, () => evidence),
        }),
      ).not.toEqual([]);
    },
  );
  it('preserves shared root-array identity and frozen data descriptors during probes', async () => {
    expect(
      await checkGearsFsmArtifact(gears, {
        machine: fixture('alias', false, (value) => {
          for (const row of value as object[]) Object.freeze(row);
          return Object.freeze(value);
        }),
      }),
    ).toEqual([]);
  });
  it('refuses descendant descriptor mutation during observation even when text is unchanged', async () => {
    expect(
      (
        await checkGearsFsmArtifact(gears, {
          machine: fixture('mutating-descriptor'),
        })
      ).join('\n'),
    ).toContain('changed during input');
  });
  it.each([
    'getter',
    'proxy',
    'toJSON',
    'prototype',
    'cycle',
    'hole',
    'extra',
    'depth',
    'nodes',
    'alias-width',
    'alias-bytes',
    'bytes',
  ])(
    'refuses unsafe or excessive %s structured roots without inspector hooks',
    async (fault) => {
      let hooks = 0;
      const machine = fixture('unsafe', false, (value) => {
        const data = value as Record<string, unknown>[];
        if (fault === 'proxy')
          return new Proxy(data, {
            getPrototypeOf(target) {
              hooks++;
              return Reflect.getPrototypeOf(target);
            },
            ownKeys(target) {
              hooks++;
              return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, key) {
              hooks++;
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
            isExtensible(target) {
              hooks++;
              return Reflect.isExtensible(target);
            },
          });
        if (fault === 'getter')
          Object.defineProperty(data[0], 'text', {
            enumerable: true,
            get() {
              hooks++;
              return 'Request';
            },
          });
        if (fault === 'toJSON')
          Object.defineProperty(data, 'toJSON', {
            enumerable: true,
            value() {
              hooks++;
              return [];
            },
          });
        if (fault === 'prototype')
          Object.setPrototypeOf(data, {
            toJSON() {
              hooks++;
              return [];
            },
          });
        if (fault === 'cycle') data[0].self = data;
        if (fault === 'hole') delete data[1];
        if (fault === 'extra')
          Object.defineProperty(data, 'extra', {
            value: 'Extra',
            enumerable: true,
          });
        if (fault === 'depth') {
          let next = data[0];
          for (let n = 0; n < 33; n++)
            next = next.next = {} as Record<string, unknown>;
        }
        if (fault === 'nodes')
          data.push(...Array.from({ length: 130 }, () => ({ text: 'Entry' })));
        if (fault === 'alias-width')
          return Object.fromEntries(
            Array.from({ length: 130 }, (_, index) => [String(index), data[0]]),
          );
        if (fault === 'alias-bytes') {
          const shared = { text: 'x'.repeat(40000) };
          return [shared, shared];
        }
        if (fault === 'bytes') data[0].text = 'x'.repeat(65537);
        return data;
      });
      expect(await checkGearsFsmArtifact(gears, { machine })).not.toEqual([]);
      expect(hooks).toBe(0);
    },
  );
  it.each(['drop', 'reorder', 'hardcode', 'noncanonical', 'corrupt'])(
    'refuses %s structured substitutions',
    async (fault) => {
      expect(
        await checkGearsFsmArtifact(gears, { machine: fixture(fault) }),
      ).not.toEqual([]);
    },
  );
});

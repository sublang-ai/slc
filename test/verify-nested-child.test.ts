// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup } from 'xstate';
import { checkGearsFsmConformance } from '../src/verify.js';

const template = [
  'Preserve the complete request.',
  '> <caller-input>',
  '> Next: <next-request>',
  '> Again: <next-request>',
  '> <optional>',
  '> Report: <coordinator-report>',
  'Finish exactly.',
].join('\n');
const gears = `### NESTED-1\n\nCaptain shall call playbook \`review\`:\n${template
  .split('\n')
  .map((line) => `> ${line}`)
  .join('\n')}\n`;
type Context = {
  callerInput?: string;
  facts: Record<string, unknown>;
  typed: { nested: number[]; enabled: boolean };
};
type Input = {
  stateId: string;
  playbookId: string;
  sourceItem: string;
  text: string;
};
type Event = {
  type: 'COORDINATOR_DONE';
  callerInput: string;
  output: Record<string, string>;
};

function fixture(fault = '', nullPrototype = false) {
  const facts: Record<string, unknown> = nullPrototype
    ? Object.create(null)
    : {};
  if (fault === 'cycle') facts.self = facts;
  if (fault === 'depth') {
    let node = facts;
    for (let n = 0; n < 34; n++) node = node.next = {};
  }
  const render = (context: Context): string => {
    if (
      !Array.isArray(context.typed.nested) ||
      context.typed.nested[0] !== 7 ||
      context.typed.enabled !== false
    )
      throw Error('typed context changed');
    if (
      Object.getPrototypeOf(context.facts) !==
      (nullPrototype ? null : Object.prototype)
    )
      throw Error('record prototype changed');
    if (fault === 'cycle') void context.facts.self;
    if (fault === 'depth') {
      let node = context.facts;
      for (let n = 0; n < 34; n++) node = node.next as Record<string, unknown>;
    }
    if (fault === 'static') return template;
    const values: Record<string, unknown> = {
      '<caller-input>': context.callerInput,
      '<next-request>': context.facts.unrelatedFirst,
      '<optional>': context.facts.unrelatedOptional,
      '<coordinator-report>': context.facts.unrelatedLast,
    };
    const body = template
      .split(/(?<=\n)/)
      .filter((line) => {
        const token = /^> (<[^>]+>)(?:\n)?$/.exec(line)?.[1];
        return token === undefined || values[token] !== '';
      })
      .join('');
    let result = body.replace(/<[^>]+>/g, (token, offset: number) => {
      let value = values[token];
      if (fault === 'repeated' && body.slice(0, offset).endsWith('Again: '))
        value = values['<coordinator-report>'];
      if (typeof value !== 'string') return token;
      if (fault === 'json') value = JSON.stringify(value);
      return fault === 'blank-line'
        ? (value as string).replace(/\n(?=[^\n])/g, '\n> ')
        : (value as string).replace(/\n/g, '\n> ');
    });
    if (fault === 'recursive')
      result = result.replaceAll(
        '<coordinator-report>',
        String(values['<coordinator-report>']),
      );
    if (fault === 'invent') result += '\nInvented instruction.';
    return result;
  };
  const machine = setup({
    types: { context: {} as Context, events: {} as Event },
    actors: { playbook: fromPromise<void, Input>(async () => {}) },
    actions: {
      rememberCoordinator: assign(({ event }) => ({
        callerInput: event.callerInput,
        facts: Object.assign(
          Object.create(nullPrototype ? null : Object.prototype),
          event.output,
        ),
      })),
    },
  }).createMachine({
    context: () => ({ facts, typed: { nested: [7], enabled: false } }),
    initial: 'waiting',
    states: {
      waiting: {
        id: 'waiting',
        meta: { playbook: { stateId: 'waiting' } },
        on: {
          COORDINATOR_DONE: { target: 'call', actions: 'rememberCoordinator' },
        },
      },
      call: {
        id: 'call',
        tags: 'playbook.suspended',
        meta: { playbook: { stateId: 'call' } },
        invoke: {
          src: 'playbook',
          input: ({ context }) => ({
            stateId: 'call',
            playbookId: 'review',
            sourceItem: 'NESTED-1',
            text: render(context),
          }),
        },
      },
    },
  });
  return { machine, facts, render };
}

describe('nested literal child scalar dataflow', () => {
  it.each([false, true])(
    'accepts initialized records and actual predecessor assignments (null prototype %s)',
    async (nullPrototype) => {
      const { machine, facts, render } = fixture('', nullPrototype);
      expect(checkGearsFsmConformance(gears, machine.config)).toEqual([]);
      expect(Object.keys(facts)).toEqual([]);
      let received!: Input;
      const actor = createActor(
        machine.provide({
          actors: {
            playbook: fromPromise(async ({ input }) => {
              received = input;
            }),
          },
        }),
      );
      actor.start();
      const output = {
        unrelatedFirst: 'First <coordinator-report> $& $$\n\nlast',
        unrelatedOptional: '',
        unrelatedLast: "Report $` $'\nsecond",
      };
      actor.send({
        type: 'COORDINATOR_DONE',
        callerInput: 'Fixture caller',
        output,
      });
      await Promise.resolve();
      expect(actor.getSnapshot().value).toBe('call');
      expect(actor.getSnapshot().context.facts).toEqual(output);
      expect(received.text).toBe(render(actor.getSnapshot().context));
      expect(received.text).toContain(
        'First <coordinator-report> $& $$\n> \n> last',
      );
      actor.stop();
      expect(Object.keys(facts)).toEqual([]);
    },
  );

  it.each(['blank-line', 'static', 'repeated', 'recursive', 'json', 'invent'])(
    'still refuses %s drift with nested scalars',
    (fault) => {
      const { machine } = fixture(fault);
      const findings = checkGearsFsmConformance(gears, machine.config);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatch(/^NESTED-1: FSM playbook text /);
      if (fault === 'blank-line')
        expect(findings[0]).toContain('quoted continuation lines');
    },
  );

  it.each(['cycle', 'depth'])(
    'refuses observed %s record access without changing the initialized containers',
    (fault) => {
      const { machine, facts } = fixture(fault);
      const findings = checkGearsFsmConformance(gears, machine.config);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('unsupported composition');
      if (fault === 'cycle') expect(facts.self).toBe(facts);
    },
  );
});

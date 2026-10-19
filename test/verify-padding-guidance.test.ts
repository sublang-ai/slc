// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { types } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate';
import { checkFsmCoverage } from '../src/verify-coverage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Observed = {
  maxRepeatedTrace: number;
  traceCalls: number;
  concreteCalls: number;
  outputs: unknown[];
};
const observation = (): Observed => ({
  maxRepeatedTrace: 0,
  traceCalls: 0,
  concreteCalls: 0,
  outputs: [],
});
const revision = () => ['actual', 'prepared', 'revision'].join(':');
const validOutput = () => ({
  revision: revision(),
  allowed: true,
});

function fixture(
  observed: Observed,
  options: { shadowed?: boolean; falseContext?: boolean } = {},
) {
  let previous = '';
  let repeated = 0;
  const accepted = ({ context, event }: any) => {
    const value = event.output;
    const traced = types.isProxy(value);
    if (traced) observed.traceCalls++;
    else {
      observed.concreteCalls++;
      previous = '';
      repeated = 0;
    }
    if (
      context.ready !== true ||
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== 2
    )
      return false;
    const keys = ['revision', 'allowed'];
    const values: unknown[] = [];
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !('value' in descriptor)
      )
        return false;
      values.push(descriptor.value);
    }
    // Observation alone distinguishes guidance proxies from concrete predicate
    // calls; the guard's result never depends on that distinction or counters.
    if (
      traced &&
      values.every(
        (v) => v === null || ['string', 'boolean', 'number'].includes(typeof v),
      )
    ) {
      const signature = JSON.stringify([Reflect.ownKeys(value), values]);
      repeated = signature === previous ? repeated + 1 : 1;
      previous = signature;
      observed.maxRepeatedTrace = Math.max(observed.maxRepeatedTrace, repeated);
    }
    const [outputRevision, allowed] = values;
    return allowed === true && outputRevision === context.revision;
  };
  return setup({
    actors: {
      player: fromPromise(async () => ({ guard: 'prepared' })),
      playbook: fromPromise(async () => validOutput()),
    },
  }).createMachine({
    id: 'paddingGuidance',
    initial: 'ready',
    context: { ready: false, revision: null },
    states: {
      ready: { id: 'ready', on: { START: 'prepare' } },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'prepare',
            role: 'coordinator',
            prompt: 'Prepare.',
            result: { prepared: 'Preparation completed.' },
          }),
          onDone: [
            {
              guard: ({ event }: any) => event.output.guard === 'prepared',
              target: 'child',
              actions: assign({
                revision: () => revision(),
                ready: () => !options.falseContext,
              }),
            },
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'child',
            playbookId: 'review',
            text: 'Review the prepared revision.',
          }),
          onDone: [
            ...(options.shadowed
              ? [{ guard: accepted, target: 'failed' }]
              : []),
            {
              guard: accepted,
              target: 'done',
              actions: ({ event }: any) => observed.outputs.push(event.output),
            },
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
      failed: { id: 'failed', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
    },
  } as any);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('distinct padding guidance through real public replay', () => {
  it('avoids repeated unchanged padding shapes while retaining actual acceptance', async () => {
    const observed = observation();
    const findings = await checkFsmCoverage({ machine: fixture(observed) });
    expect(findings).toEqual([]);
    expect(observed.outputs.length).toBeGreaterThan(0);
    for (const output of observed.outputs)
      expect(output).toMatchObject({
        revision: revision(),
        allowed: true,
      });
    expect(observed.traceCalls).toBeGreaterThan(0);
    expect(observed.concreteCalls).toBeGreaterThan(0);
    // One ordinary trace and one selected-shape trace remain distinct. The
    // latter must not be repeated just because several widths give that same shape.
    expect(observed.maxRepeatedTrace).toBeLessThanOrEqual(2);
  });

  it.each([{ shadowed: true }, { falseContext: true }])(
    'retains coverage refusal for %j',
    async (options) => {
      const observed = observation();
      const findings = await checkFsmCoverage({
        machine: fixture(observed, options),
      });
      expect(
        findings.some((finding) =>
          finding.includes(
            `child: nested playbook onDone arm ${options.shadowed ? 1 : 0}`,
          ),
        ),
      ).toBe(true);
      expect(observed.outputs).toEqual([]);
    },
  );

  it.each([
    {
      name: 'wrong revision',
      output: () => ({ ...validOutput(), revision: 'old' }),
    },
    {
      name: 'false success',
      output: () => ({ ...validOutput(), allowed: false }),
    },
    { name: 'missing field', output: () => ({ allowed: true }) },
    {
      name: 'extra symbol',
      output: () => ({ ...validOutput(), [Symbol('extra')]: 1 }),
    },
    {
      name: 'custom prototype',
      output: () => Object.assign(Object.create({}), validOutput()),
    },
    {
      name: 'nonenumerable',
      output: () =>
        Object.defineProperty(validOutput(), 'revision', { enumerable: false }),
    },
    {
      name: 'accessor',
      output: () =>
        Object.defineProperty(validOutput(), 'revision', {
          get: () => {
            throw new Error('getter must not run');
          },
        }),
    },
  ])('refuses real child $name output', async ({ output }) => {
    const observed = observation();
    const machine = fixture(observed).provide({
      actors: { playbook: fromPromise(async () => output()) },
    });
    const actor = createActor(machine);
    try {
      actor.start();
      actor.send({ type: 'START' });
      await waitFor(actor, (snapshot) => snapshot.matches('failed'), {
        timeout: 1000,
      });
      expect(observed.outputs).toEqual([]);
      expect(actor.getSnapshot().context.revision).toBe(revision());
    } finally {
      actor.stop();
    }
  });
});

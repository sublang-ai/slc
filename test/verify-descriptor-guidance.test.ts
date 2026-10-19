// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate';
import { checkFsmCoverage } from '../src/verify-coverage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Options = {
  reverse?: boolean;
  shadowed?: boolean;
  contradiction?: boolean;
  falseContext?: boolean;
  accessorOnly?: boolean;
  inheritedOnly?: boolean;
};
type Observation = { payload: unknown; reached: string };
const reachedValue = () => ['actual', 'predecessor', 'value'].join(':');
const ownValue = (value: object, key: string): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
};

// Save the first descriptor value, read the second one, then compare the saved
// primitive with action-produced context. No synthetic context is supplied.
const fixture = (opts: Options = {}, observed: Observation[] = []) => {
  const accepted = ({ context, event }: any) => {
    const output = event.output;
    if (context.ready !== true || output === null || typeof output !== 'object')
      return false;
    const firstKey = opts.reverse ? 'allowed' : 'token';
    const secondKey = opts.reverse ? 'token' : 'allowed';
    const first = ownValue(output, firstKey);
    if (
      Object.keys(output).length !== 2 ||
      !Reflect.ownKeys(output).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(output, key);
        return (
          typeof key === 'string' &&
          descriptor?.enumerable &&
          'value' in descriptor
        );
      })
    )
      return false;
    const second = ownValue(output, secondKey);
    const token = opts.reverse ? second : first;
    const allowed = opts.reverse ? first : second;
    return (
      (!opts.accessorOnly ||
        typeof Object.getOwnPropertyDescriptor(output, 'allowed')?.get ===
          'function') &&
      (!opts.inheritedOnly || !Object.hasOwn(output, 'token')) &&
      allowed === true &&
      token === context.current &&
      (!opts.contradiction || token !== context.current)
    );
  };
  return setup({
    actors: {
      player: fromPromise(async () => ({ guard: 'prepared' })),
      playbook: fromPromise(async () => ({
        token: reachedValue(),
        allowed: true,
      })),
    },
  }).createMachine({
    id: 'descriptorGuidance',
    initial: 'ready',
    context: { ready: false, current: null },
    states: {
      ready: { id: 'ready', on: { START: 'prepare' } },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'prepare',
            role: 'coordinator',
            sourceItem: 'FLOW-1',
            prompt: 'Prepare.',
            result: { prepared: 'Preparation completed.' },
          }),
          onDone: [
            {
              guard: ({ event }: any) => event.output.guard === 'prepared',
              target: 'child',
              actions: assign({
                current: () => reachedValue(),
                ready: () => !opts.falseContext,
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
            text: 'Review current state.',
          }),
          onDone: [
            ...(opts.shadowed ? [{ guard: accepted, target: 'failed' }] : []),
            {
              guard: accepted,
              target: 'follow',
              actions: ({ context, event }: any) =>
                observed.push({
                  payload: event.output,
                  reached: context.current,
                }),
            },
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      follow: {
        id: 'follow',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'follow',
            playbookId: 'review',
            text: 'Finish.',
          }),
          onDone: 'done',
          onError: 'failed',
        },
      },
      awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
      done: { id: 'done', type: 'final' },
      failed: { id: 'failed', tags: 'playbook.parked' },
    },
  } as any);
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('unresolved descriptor guidance through actual public entry', () => {
  it.each([false, true])(
    'executes the legal route directly (reverse=%s)',
    async (reverse) => {
      const observed: Observation[] = [];
      const actor = createActor(fixture({ reverse }, observed));
      try {
        actor.start();
        actor.send({ type: 'START' });
        await waitFor(actor, (snapshot) => snapshot.status === 'done', {
          timeout: 1000,
        });
        expect(observed).toEqual([
          {
            payload: { token: reachedValue(), allowed: true },
            reached: reachedValue(),
          },
        ]);
      } finally {
        actor.stop();
      }
    },
  );

  it.each([
    { token: 'wrong-value', allowed: true },
    { token: reachedValue(), allowed: false },
  ])(
    'rejects actual child output %j without reaching the successor',
    async (output) => {
      const observed: Observation[] = [];
      const machine = fixture({}, observed).provide({
        actors: { playbook: fromPromise(async () => output) },
      });
      const actor = createActor(machine);
      try {
        actor.start();
        actor.send({ type: 'START' });
        await waitFor(actor, (snapshot) => snapshot.matches('failed'), {
          timeout: 1000,
        });
        expect(observed).toEqual([]);
        expect(actor.getSnapshot().context.current).toBe(reachedValue());
      } finally {
        actor.stop();
      }
    },
  );

  it.each([false, true])(
    'covers the same route with saved descriptor values (reverse=%s)',
    async (reverse) => {
      const observed: Observation[] = [];
      const findings = await checkFsmCoverage({
        machine: fixture({ reverse }, observed),
      });
      expect(findings).toEqual([]);
      expect(observed.length).toBeGreaterThan(0);
      for (const { payload, reached } of observed) {
        expect(reached).toBe(reachedValue());
        expect(payload).toEqual({ token: reached, allowed: true });
        expect(Object.getOwnPropertyDescriptor(payload, 'token')).toEqual({
          value: reached,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
    },
  );

  it.each<Options>([
    { contradiction: true },
    { shadowed: true },
    { falseContext: true },
    { accessorOnly: true },
    { inheritedOnly: true },
  ])('retains actual refusal for %j', async (opts) => {
    const observed: Observation[] = [];
    const findings = await checkFsmCoverage({
      machine: fixture(opts, observed),
    });
    expect(
      findings.some((finding) =>
        finding.includes(
          `child: nested playbook onDone arm ${opts.shadowed ? 1 : 0}`,
        ),
      ),
    ).toBe(true);
    expect(observed).toEqual([]);
    expect(findings.some((finding) => finding.includes('state follow:'))).toBe(
      true,
    );
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate';
import { checkFsmCoverage, guardSatisfiable } from '../src/verify-coverage.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const revision = () => ['actual', 'predecessor', 'revision'].join(':');
type Options = { shadowed?: boolean; falseContext?: boolean };
const fixture = (opts: Options = {}, observed: unknown[] = []) => {
  const accepted = ({ context, event }: any) => {
    const output = event.output;
    if (
      context.ready !== true ||
      output === null ||
      typeof output !== 'object' ||
      Object.keys(output).length !== 2
    )
      return false;
    const fields = ['revision', 'accepted'];
    if (
      !fields.every((key) => Object.hasOwn(output, key)) ||
      !Reflect.ownKeys(output).every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(output, key);
        return (
          typeof key === 'string' &&
          fields.includes(key) &&
          descriptor?.enumerable &&
          'value' in descriptor
        );
      })
    )
      return false;
    return (
      Object.getOwnPropertyDescriptor(output, 'revision')?.value ===
        context.revision &&
      Object.getOwnPropertyDescriptor(output, 'accepted')?.value === true
    );
  };
  return setup({
    actors: {
      playbook: fromPromise(async () => ({
        revision: revision(),
        accepted: true,
      })),
    },
  }).createMachine({
    id: 'candidateCloning',
    initial: 'ready',
    context: { ready: false, revision: null },
    states: {
      ready: { on: { START: 'prepare' } },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'playbook',
          input: () => ({
            stateId: 'prepare',
            playbookId: 'review',
            text: 'Prepare the current revision.',
          }),
          onDone: {
            target: 'child',
            actions: assign({
              ready: () => !opts.falseContext,
              revision: () => revision(),
            }),
          },
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
            text: 'Review the prepared revision and evidence.',
          }),
          onDone: [
            ...(opts.shadowed ? [{ guard: accepted, target: 'failed' }] : []),
            {
              guard: accepted,
              target: 'done',
              actions: ({ event }: any) => observed.push(event.output),
            },
            { target: 'failed' },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: { tags: 'playbook.parked' },
      done: { type: 'final' },
      failed: { tags: 'playbook.parked' },
    },
  } as any);
};

const runActor = async (machine: any, final: string) => {
  const actor = createActor(machine);
  try {
    actor.start();
    actor.send({ type: 'START' });
    await waitFor(actor, (snapshot) => snapshot.matches(final), {
      timeout: 1000,
    });
  } finally {
    actor.stop();
  }
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('guard candidate copying through real XState execution', () => {
  it('replays a descriptor guard against actual predecessor data', async () => {
    const observed: unknown[] = [];
    await runActor(fixture({}, observed), 'done');
    expect(await checkFsmCoverage({ machine: fixture({}, observed) })).toEqual(
      [],
    );
    expect(observed.length).toBeGreaterThan(1);
    for (const output of observed)
      expect(output).toEqual({
        revision: revision(),
        accepted: true,
      });
  });

  it.each([
    {
      revision: 'wrong',
      accepted: true,
    },
    { accepted: true },
    {
      revision: revision(),
      accepted: true,
      extra: true,
    },
    {
      revision: revision(),
      accepted: false,
    },
  ])(
    'retains actual rejection of malformed child output %j',
    async (output) => {
      const observed: unknown[] = [];
      await runActor(
        fixture({}, observed).provide({
          actors: { playbook: fromPromise(async () => output) },
        }),
        'failed',
      );
      expect(observed).toEqual([]);
    },
  );

  it.each<Options>([{ shadowed: true }, { falseContext: true }])(
    'retains ordered or reached-context refusal %j',
    async (opts) => {
      const observed: unknown[] = [];
      const findings = await checkFsmCoverage({
        machine: fixture(opts, observed),
      });
      expect(findings.some((finding) => finding.includes('state child:'))).toBe(
        true,
      );
      expect(observed).toEqual([]);
    },
  );

  it('preserves seed descriptors, keys and shallow aliases without getter reads', async () => {
    const symbol = Symbol('ordinary payload');
    const shared = { marker: 'shared identity' };
    let getterCalls = 0;
    const getter = () => {
      getterCalls++;
      return 'not read while copying';
    };
    const ordinary = {
      '2': 'two',
      '1': 'one',
      left: shared,
      right: shared,
      [symbol]: shared,
    };
    Object.defineProperty(ordinary, '__proto__', {
      value: shared,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const cases: object[] = [
      ordinary,
      Object.create(null, Object.getOwnPropertyDescriptors(ordinary)),
      Object.create(
        { inherited: shared },
        Object.getOwnPropertyDescriptors(ordinary),
      ),
      Object.defineProperty({}, 'value', { get: getter, enumerable: true }),
      Object.defineProperty({ value: shared }, symbol, { value: shared }),
      Object.freeze({ value: shared }),
      new Error('descriptor fallback'),
      [shared, shared],
    ];
    for (const output of cases) {
      const descriptors = Object.getOwnPropertyDescriptors(output);
      const keys = Reflect.ownKeys(output);
      const prototype = Object.getPrototypeOf(output) as object | null;
      const guard = ({
        context,
        event,
      }: {
        context: Record<string, unknown>;
        event: { output: object };
      }) =>
        Object.getPrototypeOf(event.output) === prototype &&
        Reflect.ownKeys(event.output).length === keys.length &&
        Reflect.ownKeys(event.output).every(
          (key, index) => key === keys[index],
        ) &&
        keys.every((key) => {
          const before = Reflect.get(descriptors, key) as PropertyDescriptor;
          const after = Object.getOwnPropertyDescriptor(event.output, key);
          return (
            after !== undefined &&
            Reflect.ownKeys(before).every((field) =>
              Object.is(Reflect.get(before, field), Reflect.get(after, field)),
            )
          );
        }) &&
        context.route === 'accepted';
      expect(
        guardSatisfiable(guard as never, output as Record<string, unknown>),
      ).toBe(true);
      const machine = setup({
        actors: { work: fromPromise(async () => output) },
      }).createMachine({
        context: { route: 'accepted' },
        initial: 'ready',
        states: {
          ready: { on: { START: 'work' } },
          work: { invoke: { src: 'work', onDone: { target: 'done', guard } } },
          done: { type: 'final' },
        },
      });
      await runActor(machine, 'done');
      expect(Object.getOwnPropertyDescriptors(output)).toEqual(descriptors);
    }
    expect(getterCalls).toBe(0);
  });

  it('does not reuse a candidate mutated by an earlier guard evaluation', () => {
    const output = { value: 'original' };
    const guard = ({
      context,
      event,
    }: {
      context: Record<string, unknown>;
      event: { output: Record<string, unknown> };
    }) => {
      const clean = !Object.hasOwn(event.output, 'scratch');
      Object.defineProperty(event.output, 'scratch', {
        value: true,
        configurable: true,
      });
      return clean && context.route === 'accepted';
    };
    expect(guardSatisfiable(guard as never, output)).toBe(true);
    expect(output).toEqual({ value: 'original' });
  });

  it('retains inherited setter semantics for assigned candidate fields', () => {
    let writes = 0;
    const output = Object.create({
      set token(value: unknown) {
        writes++;
        Object.defineProperty(this, 'stored', { value, configurable: true });
      },
      get token(): unknown {
        return Object.getOwnPropertyDescriptor(this, 'stored')?.value;
      },
    }) as Record<string, unknown>;
    const guard = ({
      event,
    }: {
      event: { output: Record<string, unknown> };
    }) => {
      Object.getOwnPropertyDescriptor(event.output, 'token');
      return event.output.token === 'accepted';
    };
    expect(guardSatisfiable(guard as never, output)).toBe(true);
    expect(writes).toBeGreaterThan(0);
    expect(Reflect.ownKeys(output)).toEqual([]);
  });
});

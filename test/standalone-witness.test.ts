// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup } from 'xstate';
import { isAbsolute } from 'node:path';
import { checkFsmCoverage } from '../src/verify-coverage.js';
const coverage = { maxAttempts: 8, maxInvocations: 4, maxDurationMs: 10000 };
function machine(allowEntry = true, trace: string[] = [], guarded = true) {
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw Error('unbound');
      }),
    },
  }).createMachine({
    initial: 'ready',
    context: { path: '', prepared: false },
    on: {
      BOSS_INTERRUPT: {
        target: '#work',
        reenter: true,
        guard: ({ context, event }) =>
          event.targetId === 'work' &&
          context.prepared &&
          (guarded
            ? isAbsolute(context.path)
            : typeof context.path === 'string' && context.path.trim() !== ''),
      },
    },
    states: {
      ready: {
        entry: () => {
          trace.push('ready');
        },
        on: {
          START: {
            target: guarded ? 'prepare' : 'work',
            ...(guarded
              ? {
                  guard: ({ event }: { event: Record<string, unknown> }) =>
                    allowEntry &&
                    typeof event.path === 'string' &&
                    isAbsolute(event.path),
                }
              : {}),
            actions: assign({
              path: ({ event }) => event.path,
              ...(!guarded ? { prepared: true } : {}),
            }),
          },
        },
      },
      prepare: {
        entry: () => {
          trace.push('prepare');
        },
        always: { target: 'work', actions: assign({ prepared: true }) },
      },
      work: {
        entry: ({ context, event }) => {
          trace.push('work:' + event.type + ':' + String(context.prepared));
        },
        id: 'work',
        meta: { playbook: { stateId: 'work' } },
        invoke: {
          src: 'captain',
          input: () => ({
            stateId: 'work',
            sourceItem: 'TASK-1',
            prompt: 'Read the task path.',
            result: { ok: 'Done.' },
          }),
          onDone: {
            target: 'done',
            guard: ({ event }) =>
              (event.output as { guard: string }).guard === 'ok',
          },
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: ['playbook.suspended'],
        on: { BOSS_REPLY: 'work' },
      },
      done: { type: 'final' },
      failed: { type: 'final' },
    },
  });
}
function loop(
  progress = true,
  allowStart = true,
  reenter = true,
  completed: number[] = [],
) {
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw Error('provide');
      }),
    },
  }).createMachine({
    initial: 'ready',
    context: { prepared: false, count: 0 },
    on: {
      BOSS_INTERRUPT: {
        target: '#work',
        reenter: true,
        guard: ({ context, event }) =>
          context.prepared && event.targetId === 'work',
      },
    },
    states: {
      ready: {
        on: {
          START: {
            target: 'work',
            guard: () => allowStart,
            actions: assign({ prepared: true }),
          },
        },
      },
      work: {
        id: 'work',
        meta: { playbook: { stateId: 'work' } },
        invoke: {
          src: 'captain',
          input: () => ({
            stateId: 'work',
            sourceItem: 'LOOP-1',
            prompt: 'Perform one bounded iteration.',
            result: {
              again: 'Repeat one iteration.',
              finished: 'Finish after two iterations.',
            },
          }),
          onDone: [
            {
              target: '#work',
              reenter,
              guard: ({ context, event }) =>
                context.count < 2 &&
                (event.output as { guard: string }).guard === 'again',
              actions: assign({
                count: ({ context }) => context.count + (progress ? 1 : 0),
              }),
            },
            {
              target: 'done',
              guard: ({ context, event }) =>
                context.count === 2 &&
                (event.output as { guard: string }).guard === 'finished',
            },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: ['playbook.suspended'],
        on: { BOSS_REPLY: 'work' },
      },
      done: {
        type: 'final',
        entry: ({ context }) => {
          completed.push(context.count);
        },
      },
      failed: { type: 'final' },
    },
  });
}

function interruptedLoop(allowInterrupt = true, completed: number[] = []) {
  const binding = (stateId: string, result: Record<string, string>) => ({
    stateId,
    sourceItem: 'LOOP-1',
    prompt: 'Perform the bounded loop.',
    result,
  });
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw Error('provide');
      }),
    },
  }).createMachine({
    initial: 'ready',
    context: { prepared: false, count: 0 },
    on: {
      BOSS_INTERRUPT: {
        target: '#work',
        reenter: true,
        guard: ({ context, event }) =>
          allowInterrupt && context.prepared && event.targetId === 'work',
      },
    },
    states: {
      ready: {
        on: { START: { target: 'work', actions: assign({ prepared: true }) } },
      },
      work: {
        id: 'work',
        invoke: {
          src: 'captain',
          input: () => binding('work', { again: 'Continue.', ok: 'Finish.' }),
          onDone: [
            {
              guard: ({ context, event }) =>
                context.count >= 2 && event.output.guard === 'ok',
              target: 'done',
              actions: ({ context }) => {
                completed.push(context.count);
              },
            },
            {
              guard: ({ context, event }) =>
                context.count < 2 && event.output.guard === 'again',
              target: 'counter',
            },
          ],
          onError: 'failed',
        },
      },
      counter: {
        id: 'counter',
        entry: assign({ count: ({ context }) => context.count + 1 }),
        invoke: {
          src: 'captain',
          input: () => binding('counter', { stopped: 'Stop.' }),
          onDone: 'failed',
          onError: 'failed',
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: ['playbook.suspended'],
        on: { BOSS_REPLY: 'work' },
      },
      done: { type: 'final' },
      failed: { type: 'final' },
    },
  });
}
describe('public coverage witness authority', () => {
  it('discovers guard-free public entry payload reads through actual actions', async () => {
    const trace: string[] = [];
    expect(
      await checkFsmCoverage(
        { machine: machine(true, trace, false) },
        {
          coverage: {
            maxInvocations: 8,
            maxAttempts: 64,
            maxDurationMs: 10000,
          },
        },
      ),
    ).toEqual([]);
    expect(trace).toContain('work:START:true');
  });
  it('replays public interrupts from actual predecessor context inside a bounded loop', async () => {
    const completed: number[] = [];
    const findings = await checkFsmCoverage(
      { machine: interruptedLoop(true, completed) },
      {
        coverage: { maxInvocations: 8, maxAttempts: 64, maxDurationMs: 10000 },
      },
    );
    expect(findings).toEqual([]);
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.every((value) => value === 2)).toBe(true);
    const refused: number[] = [];
    expect(
      (
        await checkFsmCoverage(
          { machine: interruptedLoop(false, refused) },
          {
            coverage: {
              maxInvocations: 8,
              maxAttempts: 64,
              maxDurationMs: 10000,
            },
          },
        )
      ).join('\n'),
    ).toMatch(/unproved|unverified/);
    expect(refused).toEqual([]);
  });
  it('observes two actual self-reentries before accepting a counter-guarded result', async () => {
    const completed: number[] = [];
    expect(
      await checkFsmCoverage(
        { machine: loop(true, true, true, completed) },
        {
          coverage: {
            maxInvocations: 6,
            maxAttempts: 64,
            maxDurationMs: 10000,
          },
        },
      ),
    ).toEqual([]);
    expect(completed).toContain(2);
    expect(completed.every((x) => x === 2)).toBe(true);
  });
  it.each([
    [false, true, true],
    [true, false, true],
    [true, true, false],
  ])(
    'keeps a loop without actual progress/start/reentry unverified (%j)',
    async (progress, start, reenter) => {
      const completed: number[] = [];
      const findings = await checkFsmCoverage(
        { machine: loop(progress, start, reenter, completed) },
        {
          coverage: {
            maxInvocations: 4,
            maxAttempts: 16,
            maxDurationMs: 10000,
          },
        },
      );
      expect(findings.join('\n')).toMatch(/unproved|unverified|exhausted/);
      expect(completed).toEqual([]);
    },
  );
  it('replays an absolute path from the real public initial state', async () => {
    const path =
      process.platform === 'win32'
        ? 'C:\\slc-witness\\task.md'
        : '/tmp/slc-witness/task.md';
    const trace: string[] = [];
    const findings = await checkFsmCoverage(
      {
        machine: machine(true, trace),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [{ events: [{ type: 'START', path }] }],
        },
      },
      { coverage },
    );
    expect(findings).toEqual([]);
    expect(trace).toContain('prepare');
    expect(trace).toContain('work:START:true');
    expect(
      trace
        .filter((x) => x.startsWith('work:'))
        .every((x) => x.endsWith(':true')),
    ).toBe(true);
  });
  it.each([undefined, 'relative/task.md'])(
    'does not let path=%s invent predecessor context',
    async (path) => {
      const direct = createActor(machine());
      direct.start();
      direct.send({ type: 'START', ...(path === undefined ? {} : { path }) });
      expect(direct.getSnapshot().value).toBe('ready');
      expect(direct.getSnapshot().context).toEqual({
        path: '',
        prepared: false,
      });
      direct.stop();
      const trace: string[] = [];
      const findings = await checkFsmCoverage(
        {
          machine: machine(true, trace),
          coverageWitnesses: {
            schema: 'sublang.slc.coverage-witnesses.v1',
            entries: [
              {
                events: [
                  { type: 'START', ...(path === undefined ? {} : { path }) },
                ],
              },
            ],
          },
        },
        { coverage },
      );
      // Witnesses are additive: any proof must still observe a genuine route.
      if (findings.length === 0) expect(trace).toContain('work:START:true');
      else
        expect(findings.join('\n')).toMatch(
          /unverified|unproved|unsatisfiable/,
        );
      expect(
        trace
          .filter((x) => x.startsWith('work:'))
          .every((x) => x.endsWith(':true')),
      ).toBe(true);
    },
  );
  it('keeps a dead public predecessor unverified even with a valid absolute witness', async () => {
    const path =
      process.platform === 'win32'
        ? 'C:\\slc-witness\\task.md'
        : '/tmp/slc-witness/task.md';
    const trace: string[] = [];
    const findings = await checkFsmCoverage(
      {
        machine: machine(false, trace),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [{ events: [{ type: 'START', path }] }],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(/unverified|unproved/);
    expect(trace.filter((x) => x.startsWith('work:'))).toEqual([]);
  });
  it('requires an observed interrupt transition even when its terminal target is already active', async () => {
    const trace: string[] = [];
    const terminal = setup({}).createMachine({
      initial: 'done',
      on: {
        BOSS_INTERRUPT: {
          target: '#done',
          reenter: true,
          guard: ({ event }) => event.targetId === 'done',
          actions: () => {
            trace.push('ROOT');
          },
        },
      },
      states: { done: { id: 'done', type: 'final' } },
    });
    const findings = await checkFsmCoverage(
      { machine: terminal },
      { coverage },
    );
    expect(findings).toContain(
      'BOSS_INTERRUPT target done remains unverified after actual public interrupt replay',
    );
    expect(trace).toEqual([]);
  });
  it.each([
    'enabledPlaybooks',
    'context',
    'snapshot',
    'hostCapabilities',
    'roleBindings',
  ])('refuses witness startup override of %s', async (key) => {
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [
            {
              input: {
                [key]: key === 'enabledPlaybooks' ? [{ id: 'fabricated' }] : {},
              },
              events: [],
            },
          ],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(
      /invalid public coverageWitnesses:.*host authority or private runtime state/,
    );
  });
  it('refuses private internal events rather than jumping into a state', async () => {
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [
            {
              events: [
                { type: 'xstate.done.actor.work', output: { guard: 'ok' } },
              ],
            },
          ],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(
      /only public input records and public event sequences/,
    );
  });
  it('keeps unvalidated renamed/nested startup options unverified', async () => {
    const findings = await checkFsmCoverage(
      {
        machine: machine(),
        coverageWitnesses: {
          schema: 'sublang.slc.coverage-witnesses.v1',
          entries: [
            {
              input: {
                startupSettings: {
                  allowedChildren: ['configured-child', 'undeclared-child'],
                },
              },
              events: [],
            },
          ],
        },
      },
      { coverage },
    );
    expect(findings.join('\n')).toMatch(
      /unverified: public coverageWitnesses: nonempty witness startup options require an independent Source-derived validation contract/,
    );
  });
});

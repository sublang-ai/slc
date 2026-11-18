// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { fromPromise, setup } from 'xstate';
import * as link from '../pipelines/playbook/link.slc/link.fsm.js';
import {
  checkFsmCoverage,
  checkGearsFsmArtifact,
} from '../src/verify-coverage.js';
const coverage = { maxInvocations: 8, maxAttempts: 64, maxDurationMs: 10000 };
describe('independently supplied verification startup input', () => {
  it('gives each real actor fresh caller and framework input rather than accumulated mutations', async () => {
    const seen: number[] = [];
    const machine = setup({
      actors: {
        captain: fromPromise(async () => {
          throw Error('provide');
        }),
      },
    }).createMachine({
      initial: 'ready',
      context: ({ input }: { input: { counter: number } }) => {
        input.counter++;
        seen.push(input.counter);
        return { counter: input.counter };
      },
      on: {
        BOSS_INTERRUPT: {
          target: '#work',
          guard: ({ context, event }) =>
            context.counter >= 2 && event.targetId === 'work',
        },
      },
      states: {
        ready: {
          on: {
            START: {
              target: 'work',
              guard: ({ context }) => context.counter >= 2,
            },
          },
        },
        work: {
          id: 'work',
          invoke: {
            src: 'captain',
            input: () => ({
              stateId: 'work',
              sourceItem: 'TASK-1',
              prompt: 'Work.',
              result: { ok: 'Done.' },
            }),
            onDone: 'done',
            onError: 'failed',
          },
        },
        awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.suspended' },
        done: { type: 'final' },
        failed: { type: 'final' },
      },
    });
    const input = { counter: 0 };
    expect(
      (
        await checkFsmCoverage({ machine }, { coverage, machineInput: input })
      ).join('\n'),
    ).toMatch(/unproved|unverified/);
    // Metadata inspection also calls the initializer without configured input;
    // its NaN is not a reached actor context or a successful proof.
    expect(seen).toContain(1);
    expect(
      seen.some((counter) => Number.isFinite(counter) && counter >= 2),
    ).toBe(false);
    expect(input.counter).toBe(0);
    expect(
      await checkFsmCoverage(
        { machine },
        { coverage, machineInput: { counter: 1 } },
      ),
    ).toEqual([]);
  });
  it('rejects named array properties used to conceal a hole before actor access', async () => {
    const values = [1] as number[] & { extra?: number };
    values.length = 2;
    values.extra = 2;
    await expect(
      checkFsmCoverage({}, { coverage, machineInput: { values } }),
    ).rejects.toThrow(/machineInput/);
  });
  it('uses actual caller-supplied definition bytes for the required meta-phase input', async () => {
    const definition = await readFile(
      new URL('../pipelines/playbook/link.md', import.meta.url),
      'utf8',
    );
    expect((await checkFsmCoverage(link, { coverage })).join('\n')).toMatch(
      /unproved|unverified/,
    );
    const opts = { coverage, machineInput: { definition } };
    expect(await checkFsmCoverage(link, opts)).toEqual([]);
    const gears = await readFile(
      new URL('../pipelines/playbook/link.slc/link.gears.md', import.meta.url),
      'utf8',
    );
    expect(
      await checkGearsFsmArtifact(gears, link, { ...opts, artifactSchema: 3 }),
    ).toEqual([]);
    const [supplied, absent] = await Promise.all([
      checkFsmCoverage(link, opts),
      checkFsmCoverage(link, { coverage }),
    ]);
    expect(supplied).toEqual([]);
    expect(absent.join('\n')).toMatch(/unproved|unverified/);
    expect(
      (
        await checkFsmCoverage(
          {
            ...link,
            coverageWitnesses: {
              schema: 'sublang.slc.coverage-witnesses.v1',
              entries: [
                {
                  input: { renamedAuthority: { enabled: 'invented' } },
                  events: [],
                },
              ],
            },
          },
          opts,
        )
      ).join('\n'),
    ).toContain('nonempty witness startup options');
  });
  it.each([
    'enabledPlaybooks',
    'stateId',
    'selfPlaybookId',
    'bossIntent',
    'hostCapabilities',
    'context',
    'snapshot',
    'roleBindings',
    'ports',
    'repository',
    'effectLedger',
    'authority',
  ])('rejects caller override of %s before artifact access', async (key) => {
    let reads = 0;
    const module = {
      get machine() {
        reads++;
        return link.linkMachine;
      },
    };
    const opts = { coverage, machineInput: { [key]: 'forged' } };
    await expect(checkFsmCoverage(module, opts)).rejects.toThrow(
      /machineInput/,
    );
    expect(reads).toBe(0);
  });
  it('rejects getters and proxies without invoking their hooks', async () => {
    let reads = 0;
    for (const machineInput of [
      Object.defineProperty({}, 'definition', {
        enumerable: true,
        get() {
          reads++;
          return 'forged';
        },
      }),
      new Proxy(
        {},
        {
          ownKeys() {
            reads++;
            return [];
          },
        },
      ),
    ]) {
      const opts = { coverage, machineInput };
      await expect(checkFsmCoverage(link, opts)).rejects.toThrow(
        /machineInput/,
      );
    }
    expect(reads).toBe(0);
  });
  it('refuses non-JSON or oversized caller data before artifact access', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = 'leaf';
    for (let i = 0; i < 34; i++) deep = { nested: deep };
    for (const machineInput of [
      { definition: undefined },
      { definition: 'x'.repeat(1048577) },
      cyclic,
      { deep },
      { values: new Array(2) },
      { count: Infinity },
      { values: Array.from({ length: 4096 }, () => 1) },
    ]) {
      const opts = { coverage, machineInput };
      await expect(checkFsmCoverage({}, opts)).rejects.toThrow(/machineInput/);
    }
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { readFileSync } from 'node:fs';
import { createActor, fromPromise } from 'xstate';
import { describe, expect, it } from 'vitest';
import { checkFsmCoverage } from '../src/verify-coverage.js';
import {
  fairEntryMachine,
  lazyEntryBudgetMachine,
} from './fixtures/fair-entry.js';
const sourceText = readFileSync(
  new URL('./fixtures/fair-entry.ts', import.meta.url),
  'utf8',
);
const modes = ['alpha', 'beta', 'gamma', 'delta'];
describe('fair declared-root coverage replay', () => {
  it('reaches each real public route and proves the shared final arms without starving later roots', async () => {
    const machine = fairEntryMachine();
    for (const mode of modes) {
      const seen: string[] = [];
      const actor = createActor(
        machine.provide({
          actors: {
            captain: fromPromise(
              async ({ input }: { input: { stateId: string } }) => {
                seen.push(input.stateId);
                return input.stateId === 'verify'
                  ? { guard: 'verified', revision: 'original-revision' }
                  : input.stateId === 'finish'
                    ? {
                        guard: 'ready',
                        report: 'actual report',
                        commit: 'new-report-commit',
                      }
                    : { guard: 'admitted', report: 'actual admission' };
              },
            ),
            playbook: fromPromise(async () => ({
              accepted: true,
              revision: 'original-revision',
            })),
          },
        }),
      );
      try {
        actor.start();
        actor.send({ type: 'START', mode, request: 'Actual generic request' });
        await new Promise((resolve) => setTimeout(resolve, 15));
        expect(actor.getSnapshot().status).toBe('done');
        expect(actor.getSnapshot().value).toBe(
          mode === 'gamma'
            ? 'doneGamma'
            : mode === 'delta'
              ? 'doneDelta'
              : 'doneOrdinary',
        );
        expect(seen).toEqual([
          mode === 'gamma' ? 'entryB' : mode === 'delta' ? 'entryC' : 'entryA',
          'verify',
          'finish',
        ]);
      } finally {
        actor.stop();
      }
    }
    expect(await checkFsmCoverage({ machine }, { sourceText })).toEqual([]);
  });
  it.each([
    {
      name: 'rejected public entry',
      options: { rejectedMode: 'delta' },
      finding: /entryC|finish/,
    },
    {
      name: 'ordered shadowing',
      options: { shadowFinish: true },
      finding: /finish.*onDone arm/,
    },
    {
      name: 'contradictory fixed child revision',
      options: { contradictoryReview: true },
      finding: /inspect.*onDone arm|finish/,
    },
  ])('retains refusal for $name', async ({ options, finding }) => {
    expect(
      (
        await checkFsmCoverage(
          { machine: fairEntryMachine(options) },
          { sourceText },
        )
      ).join('\n'),
    ).toMatch(finding);
  });
});

describe('one root family keeps lazy variants and shared replay charges', () => {
  it.each([32, 33])(
    'charges failed target replays within64 for %i public variants',
    async (count) => {
      const variants = Array.from({ length: count }, (_, i) => `variant_${i}`);
      const observed: string[] = [];
      const machine = lazyEntryBudgetMachine(variants, observed);
      const actor = createActor(machine);
      try {
        actor.start();
        actor.send({ type: 'START', mode: variants.at(-1) });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(actor.getSnapshot().value).toBe('done');
      } finally {
        actor.stop();
      }
      observed.length = 0;
      const findings = await checkFsmCoverage(
        { machine },
        {
          sourceText: variants.map((value) => JSON.stringify(value)).join('\n'),
        },
      );
      if (count === 32) {
        expect(findings).toEqual([]);
        expect(observed).toContain(variants.at(-1));
      } else {
        // Existing child diagnostics may call finite exhaustion unsatisfiable
        // under probing; actual short-path witnesses still disprove impossibility.
        expect(findings.join('\n')).toMatch(
          /state child: nested playbook onDone arm 0/,
        );
        expect(observed).not.toContain(variants.at(-1));
        expect(new Set(observed).size).toBe(32);
      }
    },
  );
});

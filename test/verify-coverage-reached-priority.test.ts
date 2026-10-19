// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup, waitFor } from 'xstate';

import { checkFsmCoverage } from '../src/verify-coverage.js';

const coverage = {
  maxInvocations: 16,
  maxAttempts: 1024,
  maxDurationMs: 900000,
};
const sourceText = Array.from(
  { length: 144 },
  (_, index) => `'unrelated${index}'`,
).join('\n');
const runtimeRevision = () => ['observed', 'revision', 17].join(':');
const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

function cleanOutput(value: unknown) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const keys = ['noUnsettledFindings', 'evaluatedRevision'];
  const own = Reflect.ownKeys(value);
  if (own.length !== 2 || !keys.every((key) => Object.hasOwn(value, key)))
    return undefined;
  if (
    !own.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === 'string' &&
        descriptor?.enumerable === true &&
        'value' in descriptor &&
        (descriptor.value === null ||
          ['string', 'boolean'].includes(typeof descriptor.value))
      );
    })
  )
    return undefined;
  const output = value as Record<string, unknown>;
  // Save the revision before the Boolean check, as an ordinary decoder may do.
  const evaluatedRevision = output.evaluatedRevision;
  return output.noUnsettledFindings === true && nonblank(evaluatedRevision)
    ? { noUnsettledFindings: true, evaluatedRevision }
    : undefined;
}

interface Observation {
  roleStarts: number;
  childStarts: number;
  predecessorRevisions: string[];
  accepted: { expected: string | undefined; output: unknown }[];
}
const observation = (): Observation => ({
  roleStarts: 0,
  childStarts: 0,
  predecessorRevisions: [],
  accepted: [],
});
function fixture(observed: Observation, contradictory = false) {
  return setup({
    actors: {
      player: fromPromise(async () => {
        observed.roleStarts++;
        return {
          guard: 'prepared',
          verifiedRevision: runtimeRevision(),
          preparationReport: 'Prepared independently.',
        };
      }),
      playbook: fromPromise(async () => {
        observed.childStarts++;
        return {
          noUnsettledFindings: true,
          evaluatedRevision: runtimeRevision(),
        };
      }),
    },
  }).createMachine({
    id: 'genericReachedValue',
    context: { verifiedRevision: undefined as string | undefined },
    initial: 'ready',
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
            prompt: 'Prepare an actual revision.',
            result: {
              prepared:
                'Prepared. Output shall include `verifiedRevision` and `preparationReport`.',
            },
          }),
          onDone: [
            {
              guard: ({ event }) =>
                event.output.guard === 'prepared' &&
                nonblank(event.output.verifiedRevision),
              target: 'child',
              actions: assign(({ event }) => {
                observed.predecessorRevisions.push(
                  event.output.verifiedRevision,
                );
                return { verifiedRevision: event.output.verifiedRevision };
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
          input: ({ context }) => ({
            stateId: 'child',
            sourceItem: 'FLOW-2',
            playbookId: 'inspect',
            text: 'Review ' + context.verifiedRevision,
          }),
          onDone: [
            {
              guard: ({ context, event }) => {
                const review = cleanOutput(event.output);
                if (review === undefined || !nonblank(context.verifiedRevision))
                  return false;
                const expected = context.verifiedRevision;
                return (
                  review.evaluatedRevision === expected &&
                  (!contradictory || review.evaluatedRevision !== expected)
                );
              },
              target: 'accepted',
              actions: ({ context, event }) =>
                observed.accepted.push({
                  expected: context.verifiedRevision,
                  output: event.output,
                }),
            },
            { target: 'rejected' },
          ],
          onError: 'failed',
        },
      },
      awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
      failed: { id: 'failed', tags: 'playbook.parked' },
      accepted: { id: 'accepted', type: 'final' },
      rejected: { id: 'rejected', type: 'final' },
    },
  });
}

function expectMatchingReplay(observed: Observation) {
  expect(observed.accepted.length).toBeGreaterThan(0);
  for (const row of observed.accepted) {
    expect(observed.predecessorRevisions).toContain(row.expected);
    expect(row.output).toEqual({
      noUnsettledFindings: true,
      evaluatedRevision: row.expected,
    });
  }
}

describe('newly reached values through public XState entry', () => {
  it('independently executes the legal two-invocation concrete path', async () => {
    const observed = observation();
    const actor = createActor(fixture(observed));
    try {
      actor.start();
      actor.send({ type: 'START' });
      await waitFor(actor, (snapshot) => snapshot.status === 'done', {
        timeout: 1000,
      });
      expect(actor.getSnapshot().value).toBe('accepted');
      expect(observed.roleStarts).toBe(1);
      expect(observed.childStarts).toBe(1);
      expectMatchingReplay(observed);
      expect(observed.accepted[0].expected).toBe(runtimeRevision());
    } finally {
      actor.stop();
    }
  });

  it('replays an exact two-field result matching fixed predecessor context', async () => {
    const observed = observation();
    expect(
      await checkFsmCoverage(
        { machine: fixture(observed) },
        { coverage, sourceText, artifactSchema: 3, timeoutMs: 10000 },
      ),
    ).toEqual([]);
    expectMatchingReplay(observed);
    expect(sourceText).not.toContain(observed.accepted[0].expected);
  });

  it('retains a finding for contradictory equality in the same fixed context', async () => {
    const observed = observation();
    expect(
      await checkFsmCoverage(
        { machine: fixture(observed, true) },
        { coverage, sourceText, artifactSchema: 3, timeoutMs: 10000 },
      ),
    ).toContain(
      'state child: nested playbook onDone arm 0 is unsatisfiable under probing',
    );
    expect(observed.predecessorRevisions.length).toBeGreaterThan(0);
    expect(observed.accepted).toEqual([]);
  });
});

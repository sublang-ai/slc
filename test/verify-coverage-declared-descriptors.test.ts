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
const runtimeRevision = () => ['observed', 'revision', 19].join(':');
const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';
function ownDataField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor
    ? descriptor.value
    : undefined;
}
function decode(value: unknown) {
  const guard = ownDataField(value, 'guard');
  const report = ownDataField(value, 'report');
  if (guard !== 'delivered') return undefined;
  const productRevision = ownDataField(value, 'productRevision');
  const verifiedRevision = ownDataField(value, 'verifiedRevision');
  const latestCommit = ownDataField(value, 'latestCommit');
  return nonblank(report) &&
    nonblank(productRevision) &&
    nonblank(verifiedRevision) &&
    nonblank(latestCommit)
    ? { guard, report, productRevision, verifiedRevision, latestCommit }
    : undefined;
}
interface Observation {
  roleStarts: number;
  predecessorRevisions: string[];
  accepted: { expected: string | undefined; output: unknown }[];
}
const observation = (): Observation => ({
  roleStarts: 0,
  predecessorRevisions: [],
  accepted: [],
});
function fixture(observed: Observation, contradictory = false) {
  return setup({
    actors: {
      player: fromPromise(async ({ input }: { input: { stateId: string } }) => {
        observed.roleStarts++;
        return input.stateId === 'prepare'
          ? { guard: 'prepared', verifiedRevision: runtimeRevision() }
          : {
              guard: 'delivered',
              report: 'Delivery report.',
              productRevision: runtimeRevision(),
              verifiedRevision: runtimeRevision(),
              latestCommit: runtimeRevision() + ':report',
            };
      }),
    },
  }).createMachine({
    id: 'genericDeclaredDescriptorCopy',
    initial: 'ready',
    context: { verifiedRevision: undefined as string | undefined },
    states: {
      ready: { id: 'ready', on: { START: 'prepare' } },
      prepare: {
        id: 'prepare',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'prepare',
            role: 'writer',
            sourceItem: 'FLOW-1',
            prompt: 'Prepare a revision.',
            result: { prepared: 'Output shall include `verifiedRevision`.' },
          }),
          onDone: [
            {
              guard: ({ event }) =>
                event.output.guard === 'prepared' &&
                nonblank(event.output.verifiedRevision),
              target: 'work',
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
      work: {
        id: 'work',
        invoke: {
          src: 'player',
          input: () => ({
            stateId: 'work',
            role: 'writer',
            sourceItem: 'FLOW-2',
            prompt: 'Deliver a verified revision.',
            result: {
              delivered:
                'Output shall include `report`, `productRevision`, `verifiedRevision`, and `latestCommit`.',
            },
          }),
          onDone: [
            {
              guard: ({ context, event }) => {
                const output = decode(event.output);
                if (output === undefined || !nonblank(context.verifiedRevision))
                  return false;
                const expected = context.verifiedRevision;
                return (
                  output.productRevision === expected &&
                  output.verifiedRevision === expected &&
                  output.latestCommit !== expected &&
                  (!contradictory || output.productRevision !== expected)
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
    const output = decode(row.output);
    expect(output).toBeDefined();
    expect(output?.productRevision).toBe(row.expected);
    expect(output?.verifiedRevision).toBe(row.expected);
    expect(output?.latestCommit).not.toBe(row.expected);
    expect(Object.keys(row.output as object).sort()).toEqual(
      [
        'guard',
        'report',
        'productRevision',
        'verifiedRevision',
        'latestCommit',
      ].sort(),
    );
    expect(output?.report).toBeTruthy();
  }
}

describe('declared own-data descriptor guidance through public entry', () => {
  it('independently executes the legal concrete two-invocation path', async () => {
    const observed = observation();
    const actor = createActor(fixture(observed));
    try {
      actor.start();
      actor.send({ type: 'START' });
      await waitFor(actor, (snapshot) => snapshot.status === 'done', {
        timeout: 1000,
      });
      expect(actor.getSnapshot().value).toBe('accepted');
      expect(observed.roleStarts).toBe(2);
      expectMatchingReplay(observed);
      expect(observed.accepted[0].expected).toBe(runtimeRevision());
    } finally {
      actor.stop();
    }
  });

  it('replays copied declared fields against actual predecessor context', async () => {
    const observed = observation();
    expect(
      await checkFsmCoverage(
        { machine: fixture(observed) },
        { coverage, artifactSchema: 3, sourceText, timeoutMs: 10000 },
      ),
    ).toEqual([]);
    expectMatchingReplay(observed);
    for (const row of observed.accepted) {
      expect(row.output).toMatchObject({
        guard: 'delivered',
        report: 'coverage:report',
        latestCommit: 'coverage:latestCommit',
      });
      expect(sourceText).not.toContain(row.expected);
    }
  });

  it('retains contradictory equality refusal without accepted replay', async () => {
    const observed = observation();
    expect(
      await checkFsmCoverage(
        { machine: fixture(observed, true) },
        { coverage, artifactSchema: 3, sourceText, timeoutMs: 10000 },
      ),
    ).toContain(
      'state work: onDone arm 0 remains unproved: no candidate completed at the declared target under reached-context probing',
    );
    expect(observed.predecessorRevisions.length).toBeGreaterThan(0);
    expect(observed.accepted).toEqual([]);
  });
});

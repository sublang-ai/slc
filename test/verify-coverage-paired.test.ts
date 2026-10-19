// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import { fromPromise, setup } from 'xstate';

import { checkFsmCoverage } from '../src/verify-coverage.js';

const coverage = {
  maxInvocations: 16,
  maxAttempts: 1024,
  maxDurationMs: 900000,
};
const sourceText = [
  ...Array.from({ length: 144 }, (_, index) => `'sample${index}'`),
  "'accepted'",
  "'enter'",
].join('\n');

function jsonSafe(value: unknown, active = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (
      !Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      return false;
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== 'string' ||
        !descriptor ||
        descriptor.enumerable !== true ||
        !('value' in descriptor) ||
        !jsonSafe(descriptor.value, active)
      )
        return false;
    }
    return true;
  } finally {
    active.delete(value);
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  jsonSafe(value) &&
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value);
const nonblank = (value: unknown) =>
  typeof value === 'string' && value.trim() !== '';

function eagerOutput(value: unknown, requiresNull: boolean): boolean {
  if (!record(value)) return false;
  const keys = ['selector', 'earlier', 'later', 'ready'];
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
    return false;
  const earlier = value.earlier;
  const later = value.later;
  return (
    value.selector === 'accepted' &&
    (requiresNull ? earlier === null : nonblank(earlier)) &&
    nonblank(later) &&
    value.ready === true
  );
}
function laterNullOutput(value: unknown): boolean {
  if (!record(value)) return false;
  const keys = ['selector', 'earlier', 'later', 'ready'];
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
    return false;
  const earlier = value.earlier;
  const later = value.later;
  return (
    value.selector === 'accepted' &&
    nonblank(earlier) &&
    later === null &&
    value.ready === true
  );
}
function exclusiveOutput(value: unknown): boolean {
  if (!record(value)) return false;
  const left = Object.prototype.hasOwnProperty.call(value, 'left');
  const right = Object.prototype.hasOwnProperty.call(value, 'right');
  return left !== right && left && nonblank(value.left);
}
interface Observation {
  selected: string;
  output: unknown;
  retained: unknown;
}
function fixture(
  accepts: (value: unknown) => boolean,
  observed: Observation[],
  actualNull = false,
  shadowed = false,
) {
  return setup({
    actors: {
      playbook: fromPromise(async () => {
        throw Error('Checker must provide diagnostic actor');
      }),
    },
  }).createMachine({
    id: 'genericNullPriority',
    context: actualNull ? { retained: null } : {},
    initial: 'ready',
    states: {
      ready: {
        on: {
          START: {
            target: 'child',
            ...(actualNull
              ? {
                  guard: ({ context, event }) =>
                    context.retained === null && event.key === 'enter',
                }
              : {}),
          },
        },
      },
      child: {
        id: 'child',
        invoke: {
          src: 'playbook',
          input: {
            stateId: 'child',
            sourceItem: 'FLOW-1',
            playbookId: 'inspect',
            text: 'Inspect generic payload.',
          },
          onDone: [
            ...(shadowed
              ? [
                  {
                    guard: () => true,
                    target: 'rejected',
                    actions: ({ event, context }) =>
                      observed.push({
                        selected: 'shadow',
                        output: event.output,
                        retained: context.retained,
                      }),
                  },
                ]
              : []),
            {
              guard: ({ event }) => accepts(event.output),
              target: 'accepted',
              actions: ({ event, context }) =>
                observed.push({
                  selected: 'accepted',
                  output: event.output,
                  retained: context.retained,
                }),
            },
            {
              target: 'rejected',
              actions: ({ event, context }) =>
                observed.push({
                  selected: 'fallback',
                  output: event.output,
                  retained: context.retained,
                }),
            },
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

const cases = [
  ['nonblank broad pool', (value: unknown) => eagerOutput(value, false), false],
  [
    'required-null broad pool',
    (value: unknown) => eagerOutput(value, true),
    false,
  ],
  ['genuine null context', (value: unknown) => eagerOutput(value, false), true],
  ['partial shape fallback', exclusiveOutput, false],
] as const;

describe('paired synthetic-field coverage through public XState entry', () => {
  it.each(cases)('replays %s', async (_name, accepts, actualNull) => {
    const observed: Observation[] = [];
    expect(
      await checkFsmCoverage(
        { machine: fixture(accepts, observed, actualNull) },
        { coverage, sourceText, artifactSchema: 3, timeoutMs: 10000 },
      ),
    ).toEqual([]);
    const accepted = observed.filter((row) => row.selected === 'accepted');
    expect(accepted.length).toBeGreaterThan(0);
    for (const row of accepted) expect(accepts(row.output)).toBe(true);
    expect(observed.some((row) => row.selected === 'fallback')).toBe(true);
    if (actualNull) {
      expect(observed.every((row) => row.retained === null)).toBe(true);
    }
  });

  it.each([
    ['mixed later-null finite-search limit', laterNullOutput, false, 0],
    [
      'impossible predicate',
      (value: unknown) => eagerOutput(value, false) && false,
      false,
      0,
    ],
    ['shadowed arm', (value: unknown) => eagerOutput(value, false), true, 1],
  ] as const)(
    'retains refusal for %s',
    async (_name, accepts, shadowed, arm) => {
      const observed: Observation[] = [];
      const findings = await checkFsmCoverage(
        { machine: fixture(accepts, observed, false, shadowed) },
        { coverage, sourceText, artifactSchema: 3, timeoutMs: 10000 },
      );
      expect(findings).toContain(
        `state child: nested playbook onDone arm ${arm} is unsatisfiable under probing`,
      );
      expect(observed.some((row) => row.selected === 'accepted')).toBe(false);
    },
  );

  it('cancels resumed search with the caller reason before any target replay', async () => {
    const controller = new AbortController();
    const reason = Error('cancel_during_generic_guard');
    const observed: Observation[] = [];
    let evaluations = 0;
    const accepts = (value: unknown): boolean => {
      evaluations++;
      if (evaluations === 256) controller.abort(reason);
      return eagerOutput(value, false) && false;
    };
    await expect(
      checkFsmCoverage(
        { machine: fixture(accepts, observed) },
        {
          coverage,
          sourceText,
          artifactSchema: 3,
          timeoutMs: 10000,
          signal: controller.signal,
        },
      ),
    ).rejects.toBe(reason);
    expect(evaluations).toBeGreaterThanOrEqual(256);
    expect(observed).toEqual([]);
  });

  it('preserves an already aborted caller reason', async () => {
    const controller = new AbortController();
    const reason = Error('diagnostic_preaborted_caller');
    controller.abort(reason);
    const observed: Observation[] = [];
    await expect(
      checkFsmCoverage(
        { machine: fixture((value) => eagerOutput(value, false), observed) },
        {
          coverage,
          sourceText,
          artifactSchema: 3,
          timeoutMs: 10000,
          signal: controller.signal,
        },
      ),
    ).rejects.toBe(reason);
    expect(observed).toEqual([]);
  });
});

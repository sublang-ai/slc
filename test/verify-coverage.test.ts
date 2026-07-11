// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { assign, fromPromise, setup } from 'xstate';

import {
  checkFsmCoverage,
  emitFsmCoverageTest,
  findMachine,
  generateFsmCoverageTest,
  guardSatisfiable,
  identifierLiterals,
} from '../src/verify-coverage.js';

const referenceDir = fileURLToPath(
  new URL(
    '../node_modules/@sublang/playbook/reference/sdlc/code.playbook/',
    import.meta.url,
  ),
);

const NEEDS_BOSS_REPLY_TEXT =
  "The player's prose surfaces a clarifying question for Boss. Output shall include `question: <verbatim question text>`.";

/* eslint-disable @typescript-eslint/no-explicit-any */

const needsBossReplyArm = (workId = 'work') => ({
  target: '#awaitBossReply',
  guard: ({ event }: any) =>
    event.output.guard === 'needsBossReply' &&
    typeof event.output.question === 'string',
  actions: assign({
    pendingBossQuestion: ({ event }: any) => ({
      resumeStateId: workId,
      sourceItem: 'X-1',
      player: 'Writer',
      question: event.output.question,
    }),
  } as any),
});

/**
 * A minimal machine in the gears2fsm shape: one captain state with a plain
 * result key and the Boss-reply suspension surfaces (interrupts, wait state,
 * resume and blank-answer arms).
 */
const goodMachine = (
  overrides: {
    onDone?: unknown[];
    onError?: unknown;
    dropWaitState?: boolean;
    guards?: Record<string, (...args: any[]) => boolean>;
    result?: Record<string, string>;
    workId?: string;
    publicStateId?: string;
    blankStaysParked?: boolean;
  } = {},
) => {
  const workId = overrides.workId ?? 'work';
  const publicStateId = overrides.publicStateId ?? workId;
  const onDone = overrides.onDone ?? [
    {
      target: '#done',
      guard: ({ event }: any) => event.output.guard === 'ok',
    },
    needsBossReplyArm(workId),
  ];
  const states: Record<string, unknown> = {
    ready: { id: 'ready', on: { GO: { target: 'work' } } },
    work: {
      id: workId,
      meta: {
        playbook: { stateId: publicStateId, description: 'Working' },
      },
      invoke: {
        src: 'captain',
        input: ({ context }: any) => ({
          stateId: publicStateId,
          player: 'Writer',
          sourceItem: 'X-1',
          prompt: 'Do the work.',
          result: {
            ok: 'The work is done.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
            ...overrides.result,
          },
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
        }),
        onDone,
        onError:
          'onError' in overrides ? overrides.onError : { target: '#failed' },
      },
    },
    failed: { id: 'failed', on: { GO: { target: 'work' } } },
    done: { id: 'done', type: 'final' },
  };
  if (!overrides.dropWaitState) {
    const replyArms: unknown[] = [
      {
        target: `#${workId}`,
        reenter: true,
        guard: ({ context, event }: any) =>
          context.pendingBossQuestion?.resumeStateId === workId &&
          typeof event.answer === 'string' &&
          event.answer.trim() !== '',
        actions: assign({
          bossReply: ({ event }: any) => event.answer,
        } as any),
      },
    ];
    if (!overrides.blankStaysParked) replyArms.push({ target: '#failed' });
    states.awaitBossReply = {
      id: 'awaitBossReply',
      on: {
        BOSS_REPLY: replyArms,
      },
    };
  }
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
    ...(overrides.guards === undefined
      ? {}
      : { guards: overrides.guards as any }),
  }).createMachine({
    id: 'flow',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: [
        {
          target: `#${workId}`,
          reenter: true,
          guard: ({ event }: any) => event.targetId === publicStateId,
        },
        {
          target: '#ready',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'ready',
        },
      ],
    },
    states: states as any,
  } as any);
};

/** A two-region structured machine with branch-local Boss-reply waits. */
const parallelMachine = (
  opts: {
    nestedPlaybook?: boolean;
    dropJoin?: boolean;
    acceptUnknownQuestionId?: boolean;
    crossResume?: boolean;
    unreachableJoin?: boolean;
  } = {},
) => {
  const meta = (stateId: string) => ({
    description: stateId,
    meta: { playbook: { stateId, description: stateId } },
  });
  const branch = (side: 'left' | 'right') => {
    const stateId = `${side}Work`;
    const waitId = `${side}Wait`;
    return {
      id: `${side}Branch`,
      initial: 'working',
      ...meta(`${side}Branch`),
      states: {
        working: {
          id: stateId,
          tags: 'playbook.busy',
          ...meta(stateId),
          invoke: {
            id: `${side}Captain`,
            src: 'captain',
            input: () => ({
              stateId,
              player: side === 'left' ? 'Writer' : 'Reviewer',
              sourceItem: side === 'left' ? 'X-1' : 'X-2',
              prompt: `${side} prompt`,
              result: {
                ok: `${side} complete`,
                needsBossReply: NEEDS_BOSS_REPLY_TEXT,
              },
            }),
            onDone: [
              {
                target: 'complete',
                guard: ({ event }: any) => event.output.guard === 'ok',
              },
              {
                target: 'waiting',
                guard: ({ event }: any) =>
                  event.output.guard === 'needsBossReply' &&
                  typeof event.output.question === 'string',
              },
            ],
            onError: { target: '#failed' },
          },
        },
        waiting: {
          id: waitId,
          tags: 'playbook.parked',
          ...meta(waitId),
          on: {
            BOSS_REPLY: [
              {
                target: '#failed',
                guard: ({ event }: any) =>
                  event.questionId === stateId &&
                  String(event.answer).trim() === '',
              },
              {
                target: 'working',
                guard: ({ event }: any) =>
                  (event.questionId === stateId ||
                    opts.acceptUnknownQuestionId === true ||
                    (opts.crossResume === true &&
                      ['leftWork', 'rightWork'].includes(event.questionId))) &&
                  String(event.answer).trim() !== '',
              },
            ],
          },
        },
        complete: {
          id: `${side}Complete`,
          type: 'final',
          ...meta(`${side}Complete`),
        },
      },
    };
  };

  const states: Record<string, unknown> = {
    ready: {
      id: 'ready',
      tags: 'playbook.parked',
      ...meta('ready'),
      on: { GO: { target: 'parallelRound' } },
    },
    parallelRound: {
      id: 'parallelRound',
      type: 'parallel',
      ...meta('parallelRound'),
      states: { left: branch('left'), right: branch('right') },
      ...(opts.dropJoin === true
        ? {}
        : opts.unreachableJoin === true
          ? {
              onDone: [
                { target: '#failed', guard: () => false },
                { target: '#done' },
              ],
            }
          : { onDone: { target: '#done' } }),
    },
    failed: { id: 'failed', ...meta('failed') },
    done: { id: 'done', type: 'final', ...meta('done') },
  };
  if (opts.nestedPlaybook === true) {
    states.callChild = {
      id: 'callChild',
      tags: 'playbook.suspended',
      ...meta('callChild'),
      invoke: {
        id: 'childPlaybook',
        src: 'playbook',
        input: () => ({
          stateId: 'callChild',
          playbookId: 'child',
          text: '{"request":"review"}',
        }),
        onDone: { target: '#done' },
        onError: { target: '#failed' },
      },
    };
  }

  const targets = [
    'leftWork',
    'rightWork',
    ...(opts.nestedPlaybook === true ? ['callChild'] : []),
  ];
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
      playbook: fromPromise(async () => {
        throw new Error('playbook actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'structured',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: targets.map((targetId) => ({
        target: `#${targetId}`,
        reenter: true,
        guard: ({ event }: any) => event.targetId === targetId,
      })),
    },
    states: states as any,
  } as any);
};

/* eslint-enable @typescript-eslint/no-explicit-any */

type DoneGuardArgs = {
  event: {
    type: string;
    output: { guard?: string; question?: unknown };
  };
};

type ErrorGuardArgs = {
  event: { error: Error };
};

describe('guardSatisfiable (VERIFY-6)', () => {
  it('satisfies a conjunctive guard by iterative deepening over its literals', () => {
    const guard = ({
      context,
      event,
    }: {
      context: Record<string, unknown>;
      event: { output?: { guard?: string } };
    }) =>
      event.output?.guard === 'accepted' &&
      context.reviewSubject === 'commit' &&
      context.afterReview === 'continueIr';
    expect(guardSatisfiable(guard as never, { guard: 'accepted' })).toBe(true);
    expect(guardSatisfiable(guard as never, { guard: 'other' })).toBe(false);
  });

  it('reports an always-false guard unsatisfiable', () => {
    expect(guardSatisfiable(() => false, { guard: 'ok' })).toBe(false);
  });

  it('uses caller-supplied candidates for helper-bound comparisons', () => {
    const origin = 'bossSpecs';
    const guard = ({ context }: { context: Record<string, unknown> }) =>
      context.changeOrigin === origin;
    expect(guardSatisfiable(guard as never, { guard: 'ok' })).toBe(false);
    expect(
      guardSatisfiable(guard as never, { guard: 'ok' }, ['bossSpecs']),
    ).toBe(true);
  });

  it('does not invent event-level fields while probing', () => {
    const guard = ({
      event,
    }: {
      event: { type?: string; output?: { guard?: string } };
    }) => event.type === 'BOSS_REPLY' && event.output?.guard === 'accepted';
    expect(guardSatisfiable(guard as never, { guard: 'accepted' })).toBe(false);
  });
});

describe('identifierLiterals', () => {
  it('mines identifier-like literals and drops prose', () => {
    const source = `guardAndOrigin('committedSpecs', 'bossSpecs');\nconst p = 'A full prose sentence, too long to be a routing value.';`;
    expect(identifierLiterals(source)).toEqual(['committedSpecs', 'bossSpecs']);
  });
});

describe('checkFsmCoverage (VERIFY-6)', () => {
  it('finds nothing on a machine covering all its transitions', async () => {
    expect(await checkFsmCoverage({ machine: goodMachine() })).toEqual([]);
  });

  it('drives nested parallel leaves through stable public state metadata', async () => {
    expect(await checkFsmCoverage({ machine: parallelMachine() })).toEqual([]);
  });

  it('reports nested playbook invocation coverage as explicitly unsupported', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ nestedPlaybook: true }),
      }),
    ).toContain(
      'state callChild: nested playbook invocation coverage is unsupported',
    );
  });

  it('reports a parallel state whose join is missing', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ dropJoin: true }),
      }),
    ).toContain('parallel state parallelRound declares no onDone join');
  });

  it('rejects an unknown branch question id that moves a parked branch', async () => {
    expect(
      (
        await checkFsmCoverage({
          machine: parallelMachine({ acceptUnknownQuestionId: true }),
        })
      ).join('\n'),
    ).toMatch(/unknown BOSS_REPLY questionId moved the branch/);
  });

  it('detects one keyed reply resuming multiple pending branches', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ crossResume: true }),
      }),
    ).toContain(
      'parallel state parallelRound: a keyed Boss reply did not resume exactly one pending branch',
    );
  });

  it('reports a guarded parallel join arm that bounded probing cannot exercise', async () => {
    expect(
      await checkFsmCoverage({
        machine: parallelMachine({ unreachableJoin: true }),
      }),
    ).toContain(
      'parallel state parallelRound: onDone join arm 0 could not be exercised under bounded branch-result probing',
    );
  });

  it('drives stable state ids that differ from their states-object keys', async () => {
    expect(
      await checkFsmCoverage({ machine: goodMachine({ workId: 'workItem' }) }),
    ).toEqual([]);
  });

  it('targets the public metadata and Captain-input id rather than the config id', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({
          workId: 'privateConfigWork',
          publicStateId: 'publicWork',
        }),
      }),
    ).toEqual([]);
  });

  it('uses public metadata ids as bounded guard-probe candidates', async () => {
    const publicStateId = 'publicWork';
    expect(
      await checkFsmCoverage({
        machine: goodMachine({
          publicStateId,
          onDone: [
            {
              target: '#done',
              guard: ({
                context,
                event,
              }: {
                context: Record<string, unknown>;
                event: { output: { guard?: string } };
              }) =>
                event.output.guard === 'ok' &&
                context.routeTarget === publicStateId,
            },
            needsBossReplyArm(),
          ],
        }),
      }),
    ).toEqual([]);
  });

  it('accepts a blank Boss reply that leaves the task parked', async () => {
    expect(
      await checkFsmCoverage({
        machine: goodMachine({ blankStaysParked: true }),
      }),
    ).toEqual([]);
  });

  it('detects a declared result key handled only by the failure fallback', async () => {
    const machine = goodMachine({
      result: { orphan: 'No onDone guard accepts this declared result.' },
      onDone: [
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) => event.output.guard === 'ok',
        },
        needsBossReplyArm(),
        { target: '#failed' },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /result "orphan" has no reachable accepting transition/,
    );
  });

  it('keeps the actual done-event type fixed during arm probing', async () => {
    const machine = goodMachine({
      onDone: [
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) =>
            event.type === 'BOSS_REPLY' && event.output.guard === 'ok',
        },
        {
          target: '#done',
          guard: ({ event }: DoneGuardArgs) => event.output.guard === 'ok',
        },
        needsBossReplyArm(),
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /onDone arm 0 .* is unsatisfiable under probing/,
    );
  });

  it('detects a missing onError transition', async () => {
    const machine = goodMachine({ onError: undefined });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /declares no onError transition/,
    );
  });

  it('detects a needsBossReply arm that does not suspend in the wait state', async () => {
    const machine = goodMachine({
      onDone: [
        {
          target: '#done',
          guard: ({ event }: { event: { output: { guard: string } } }) =>
            event.output.guard === 'ok' ||
            event.output.guard === 'needsBossReply',
        },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /did not suspend in awaitBossReply/,
    );
  });

  it('detects an unsatisfiable onDone arm', async () => {
    const machine = goodMachine({
      onDone: [
        {
          target: '#done',
          guard: ({ event }: { event: { output: { guard: string } } }) =>
            event.output.guard === 'ok' ||
            event.output.guard === 'needsBossReply',
        },
        { target: '#failed', guard: () => false },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /arm 1 .* is unsatisfiable under probing/,
    );
  });

  it('audits every guarded onError arm', async () => {
    const machine = goodMachine({
      onError: [
        {
          target: '#failed',
          guard: ({ event }: ErrorGuardArgs) =>
            event.error.message === 'coverage: forced captain failure',
        },
        { target: '#done', guard: () => false },
        { target: '#failed' },
      ],
    });
    const findings = (await checkFsmCoverage({ machine })).join('\n');
    expect(findings).toMatch(
      /onError arm 1 \(target done\) is unsatisfiable under probing/,
    );
    expect(findings).not.toMatch(/onError arm 0/);
  });

  it('detects an onError arm shadowed by an earlier unconditional guard', async () => {
    const machine = goodMachine({
      onError: [
        { target: '#failed', guard: () => true },
        { target: '#done', guard: () => true },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /onError arm 1 \(target done\) is unsatisfiable under probing/,
    );
  });

  it('probes alternate error payloads for later onError arms', async () => {
    const machine = goodMachine({
      onError: [
        {
          target: '#failed',
          guard: ({ event }: ErrorGuardArgs) =>
            event.error.message === 'coverage: forced captain failure',
        },
        {
          target: '#done',
          guard: ({ event }: ErrorGuardArgs) =>
            event.error.message === 'retryable',
        },
        { target: '#failed' },
      ],
    });
    expect(await checkFsmCoverage({ machine })).toEqual([]);
  });

  it('reports an unregistered onError guard without driving it', async () => {
    const machine = goodMachine({
      onError: [
        { target: '#done', guard: 'unregistered' },
        { target: '#failed' },
      ],
    });
    await expect(checkFsmCoverage({ machine })).resolves.toContain(
      'state work: onError arm 0 names an unresolvable guard "unregistered"',
    );
  });

  it('detects a machine without the Boss-reply wait state', async () => {
    const machine = goodMachine({
      dropWaitState: true,
      onDone: [
        {
          target: '#done',
          guard: ({ event }: { event: { output: { guard: string } } }) =>
            event.output.guard === 'ok' ||
            event.output.guard === 'needsBossReply',
        },
      ],
    });
    expect((await checkFsmCoverage({ machine })).join('\n')).toMatch(
      /declares no awaitBossReply state/,
    );
  });

  it('finds nothing on the reference machine', async () => {
    const fsm: unknown = await import(join(referenceDir, 'code.fsm.js'));
    const sourceText = readFileSync(join(referenceDir, 'code.fsm.ts'), 'utf8');
    expect(await checkFsmCoverage(fsm, { sourceText })).toEqual([]);
  });
});

describe('named guards (setup implementations)', () => {
  it('resolves parameterized named guard objects with their params', async () => {
    const machine = goodMachine({
      guards: {
        matches: ({ event }: DoneGuardArgs, params: { key: string }): boolean =>
          event.output.guard === params.key,
      },
      onDone: [
        {
          target: '#done',
          guard: { type: 'matches', params: { key: 'ok' } },
        },
        needsBossReplyArm(),
      ],
    });
    expect(await checkFsmCoverage({ machine })).toEqual([]);
  });

  it('resolves string guards through the machine implementations and flags unregistered ones', async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const machine = setup({
      actors: {
        captain: fromPromise(async () => {
          throw new Error('captain actor must be provided by the runner');
        }),
      },
      guards: {
        isOk: ({ event }: any) => event.output.guard === 'ok',
      } as any,
    }).createMachine({
      id: 'named',
      initial: 'ready',
      context: {} as any,
      on: {
        BOSS_INTERRUPT: [
          {
            target: '#work',
            reenter: true,
            guard: ({ event }: any) => event.targetId === 'work',
          },
        ],
      },
      states: {
        ready: { id: 'ready', on: { GO: { target: 'work' } } },
        work: {
          id: 'work',
          invoke: {
            src: 'captain',
            input: () => ({
              player: 'Writer',
              sourceItem: 'X-1',
              prompt: 'p',
              result: { ok: 'done', needsBossReply: NEEDS_BOSS_REPLY_TEXT },
            }),
            onDone: [
              { target: '#done', guard: 'isOk' },
              { target: '#failed', guard: 'unregistered' },
            ],
            onError: { target: '#failed' },
          },
        },
        failed: { id: 'failed' },
        done: { id: 'done', type: 'final' },
      },
    } as any);
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const findings = await checkFsmCoverage({ machine });
    const text = findings.join('\n');
    // The registered named guard probes fine; the unregistered one surfaces.
    expect(text).not.toMatch(/arm 0 .* unsatisfiable/);
    expect(text).toMatch(/arm 1 names an unresolvable guard "unregistered"/);
  });
});

describe('findMachine', () => {
  it('finds the providable machine export', () => {
    const machine = goodMachine();
    expect(findMachine({ other: 1, machine })).toBe(machine);
  });

  it('throws when no providable machine is exported', () => {
    expect(() => findMachine({ config: { states: {} } })).toThrow(
      /no providable XState machine/,
    );
  });
});

describe('generateFsmCoverageTest / emitFsmCoverageTest', () => {
  it('emits a test that reads the artifact source and runs the checker', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-cov-'));
    try {
      // A minimal providable machine artifact (no captain states, so the
      // checker only reports the missing gears2fsm surfaces).
      await writeFile(
        join(artifactDir, 'code.fsm.ts'),
        [
          "import { setup } from 'xstate';",
          'export const machine = setup({}).createMachine({',
          "  id: 'tiny',",
          "  initial: 'ready',",
          '  states: {',
          '    ready: {},',
          "    done: { type: 'final' },",
          '  },',
          '});',
          '',
        ].join('\n'),
      );
      const { path, diagnostics } = await emitFsmCoverageTest({
        artifactDir,
        basename: 'code',
      });
      expect(path).toBe(join(artifactDir, 'code.fsm.coverage.test.ts'));
      // The tiny machine lacks the gears2fsm Boss surfaces; the emitter
      // surfaces the checker's findings as diagnostics.
      expect(diagnostics.join('\n')).toMatch(/BOSS_INTERRUPT/);
      const content = await readFile(path, 'utf8');
      expect(content).toContain(
        'import { checkFsmCoverage } from "@sublang/slc/verify"',
      );
      expect(content).toContain('import * as fsm from "./code.fsm.ts"');
      expect(content).toContain('checkFsmCoverage(fsm, { sourceText })');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('generates the module referencing the sibling artifact', () => {
    const generated = generateFsmCoverageTest({
      basename: 'flow',
      fsmModule: './flow.fsm.ts',
      verifyModule: '@sublang/slc/verify',
    });
    expect(generated).toContain('new URL("./flow.fsm.ts", import.meta.url)');
    expect(generated).toContain('reaches every declared transition');
  });

  it('quotes generated strings and comments for punctuation-heavy basenames', () => {
    const basename = `flow's "quoted"\nname`;
    const fsmModule = `./flow's.fsm.ts`;
    const verifyModule = `@scope/pkg's/verify`;
    const generated = generateFsmCoverageTest({
      basename,
      fsmModule,
      verifyModule,
    });
    expect(generated).toContain(`coverage for ${JSON.stringify(basename)}.`);
    expect(generated).toContain(`from ${JSON.stringify(verifyModule)}`);
    expect(generated).toContain(`from ${JSON.stringify(fsmModule)}`);
    expect(generated).toContain(
      `describe(${JSON.stringify(`${basename}: FSM coverage`)}, () => {`,
    );
  });
});

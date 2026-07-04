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
  } = {},
) => {
  const onDone = overrides.onDone ?? [
    {
      target: '#done',
      guard: ({ event }: any) => event.output.guard === 'ok',
    },
    {
      target: '#awaitBossReply',
      guard: ({ event }: any) =>
        event.output.guard === 'needsBossReply' &&
        typeof event.output.question === 'string',
      actions: assign({
        pendingBossQuestion: ({ event }: any) => ({
          resumeStateId: 'work',
          sourceItem: 'X-1',
          player: 'Writer',
          question: event.output.question,
        }),
      } as any),
    },
  ];
  const states: Record<string, unknown> = {
    ready: { id: 'ready', on: { GO: { target: 'work' } } },
    work: {
      id: 'work',
      invoke: {
        src: 'captain',
        input: ({ context }: any) => ({
          player: 'Writer',
          sourceItem: 'X-1',
          prompt: 'Do the work.',
          result: {
            ok: 'The work is done.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
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
    states.awaitBossReply = {
      id: 'awaitBossReply',
      on: {
        BOSS_REPLY: [
          {
            target: '#work',
            reenter: true,
            guard: ({ context, event }: any) =>
              context.pendingBossQuestion?.resumeStateId === 'work' &&
              typeof event.answer === 'string' &&
              event.answer.trim() !== '',
            actions: assign({
              bossReply: ({ event }: any) => event.answer,
            } as any),
          },
          { target: '#failed' },
        ],
      },
    };
  }
  return setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('captain actor must be provided by the runner');
      }),
    },
  }).createMachine({
    id: 'flow',
    initial: 'ready',
    context: {} as any,
    on: {
      BOSS_INTERRUPT: [
        {
          target: '#work',
          reenter: true,
          guard: ({ event }: any) => event.targetId === 'work',
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

/* eslint-enable @typescript-eslint/no-explicit-any */

describe('guardSatisfiable (VERIFY-6)', () => {
  it('satisfies a conjunctive guard by iterative deepening over its literals', () => {
    const guard = ({ context, event }: { context: any; event: any }) =>
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
    const guard = ({ context }: { context: any }) =>
      context.changeOrigin === origin;
    expect(guardSatisfiable(guard as never, { guard: 'ok' })).toBe(false);
    expect(
      guardSatisfiable(guard as never, { guard: 'ok' }, ['bossSpecs']),
    ).toBe(true);
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
        "import { checkFsmCoverage } from '@sublang/slc/verify'",
      );
      expect(content).toContain("import * as fsm from './code.fsm.ts'");
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
    expect(generated).toContain("new URL('./flow.fsm.ts', import.meta.url)");
    expect(generated).toContain('reaches every declared transition');
  });
});

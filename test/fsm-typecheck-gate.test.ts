// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createConfiguredExecutor,
  type AdapterFactory,
} from '../src/config.js';
import { runSlc } from '../src/runner.js';
import { checkFsmTypeScript } from '../src/verify-typescript.js';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const GEARS =
  'Roles:\n\n- Agent\n\n### TASK-1\n\nCaptain shall prompt Agent:\n\n> Carry out <boss-intent>.\n';
const definition = (source: string, target: string) =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${source} | ${source === 'gears' ? '.md' : '.ts'} |\n| target | ${target} | .ts |\n`;
const fsm = (invalid = false) => `
import { assign, fromPromise, setup } from 'xstate';
export const concurrentRoleSets = [] as const;
export const machine = setup({
  types: {
    context: {} as { bossIntent: string; pendingBossQuestion?: { question: string }; bossReply?: string; failure?: string },
    input: {} as { bossIntent?: string },
    events: {} as { type: 'BOSS_REPLY'; answer: string } | { type: 'NO_ACTION' },
    ${invalid ? 'output: {} as void,' : ''}
  },
  actors: { player: fromPromise(async () => { throw new Error('runner provides player'); }) },
  actions: {
    rememberQuestion: assign({ pendingBossQuestion: ({ event }) => ({ question: String((event as { output?: { question?: unknown } }).output?.question ?? 'Which output is required?') }) }),
    rememberBossReply: assign({ bossReply: ({ event }) => (event.type === 'BOSS_REPLY' ? event.answer : undefined) }),
    rememberFailure: assign({ failure: ({ event }) => String((event as { error?: unknown }).error ?? 'player failed') }),
  },
  guards: {
    playerDone: ({ event }) => (event as { output?: { guard?: string } }).output?.guard === 'done',
    playerAskedBoss: ({ event }) => (event as { output?: { guard?: string; question?: string } }).output?.guard === 'needsBossReply' && typeof (event as { output?: { question?: unknown } }).output?.question === 'string' && (event as { output?: { question?: string } }).output!.question!.trim() !== '',
    bossReplyIsNonblank: ({ event }) => event.type === 'BOSS_REPLY' && event.answer.trim() !== '',
  },
}).createMachine({
  context: ({ input }) => ({ bossIntent: input.bossIntent ?? '' }),
  initial: 'work',
  states: {
    work: {
      id: 'work',
      tags: ['playbook.busy'],
      meta: { playbook: { stateId: 'work', role: 'agent' } },
      invoke: {
        src: 'player',
        input: ({ context }) => ({
          stateId: 'work', sourceItem: 'TASK-1', role: 'agent',
          prompt: 'Carry out <boss-intent>.', bossIntent: context.bossIntent,
          pendingBossQuestion: context.pendingBossQuestion, bossReply: context.bossReply,
          result: { done: 'Done.', needsBossReply: 'Output shall include \`question:\`' },
        }),
        onDone: [
          { guard: 'playerDone', target: 'done' },
          { guard: 'playerAskedBoss', target: 'awaitBossReply', actions: 'rememberQuestion' },
        ],
        onError: { target: 'failed', actions: 'rememberFailure' },
      },
    },
    awaitBossReply: {
      id: 'awaitBossReply',
      tags: ['playbook.suspended'],
      meta: { playbook: { stateId: 'awaitBossReply' } },
      on: { BOSS_REPLY: { guard: 'bossReplyIsNonblank', target: 'work', actions: 'rememberBossReply' } },
    },
    failed: {
      id: 'failed',
      tags: ['playbook.parked'],
      type: 'final',
      meta: { playbook: { stateId: 'failed', terminal: 'failure' } },
    },
    done: {
      id: 'done',
      type: 'final',
      meta: { playbook: { stateId: 'done', terminal: 'success' } },
    },
  },
});
`;
const correction = JSON.stringify({
  dispositions: [
    {
      finding: 1,
      decision: 'accept',
      reason: 'Removed the invalid void assertion.',
    },
  ],
  result: 'Wrote the corrected FSM.',
});

describe('strict FSM producer and consumer boundaries', () => {
  let root: string;
  let pipeline: string;
  let source: string;
  let target: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-fsm-types-'));
    pipeline = join(root, 'pipeline');
    await mkdir(pipeline);
    await symlink(
      join(repository, 'node_modules'),
      join(root, 'node_modules'),
      'dir',
    );
    await writeFile(join(pipeline, 'gears2fsm.md'), definition('gears', 'fsm'));
    await writeFile(join(pipeline, 'link.md'), definition('fsm', 'playbook'));
    source = join(root, 'task.gears.md');
    target = join(root, 'task.flow', 'task.fsm.ts');
    await writeFile(source, GEARS);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([false, true])(
    'uses same-Coder repair only for type errors (invalid=%s)',
    async (invalid) => {
      const prompts: string[] = [];
      const factory: AdapterFactory = (agent) => ({
        agent,
        async isAvailable() {
          return true;
        },
        async *run(prompt) {
          prompts.push(prompt);
          await writeFile(target, fsm(invalid && prompts.length === 1));
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: 'coder',
            payload: {
              status: 'success',
              result: prompts.length === 1 ? 'Wrote FSM.' : correction,
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      const result = await runSlc(['flow.gears2fsm', source], {
        cwd: root,
        resolver: () => [pipeline],
        executor: createConfiguredExecutor(
          { agent: 'codex' },
          { cwd: root, adapterFactory: factory },
        ),
      });
      expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
        ok: true,
      });
      expect(prompts).toHaveLength(invalid ? 2 : 1);
      if (invalid) expect(prompts[1]).toContain('TS2352');
      expect(await readFile(source, 'utf8')).toBe(GEARS);
    },
  );

  it('rejects a type-invalid produced FSM before linking with unchanged source', async () => {
    const calls: string[] = [];
    const result = await runSlc(
      ['flow', source, '--link', join(root, 'target.ts')],
      {
        cwd: root,
        resolver: () => [pipeline],
        executor: {
          async run(request) {
            calls.push(request.kind);
            if (request.kind !== 'compile')
              throw new Error('link must never run');
            await writeFile(request.target, fsm(true));
            return { status: 'ok' };
          },
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('TS2352');
    expect(calls).toEqual(['compile']);
    expect(await readFile(source, 'utf8')).toBe(GEARS);
    expect(await readFile(target, 'utf8')).toBe(fsm(true));
  });

  it('rejects an invalid supplied FSM before constructing a link executor', async () => {
    const input = join(root, 'task.fsm.ts');
    await writeFile(input, fsm(true));
    let constructions = 0;
    const result = await runSlc(['flow.link', input, join(root, 'target.ts')], {
      cwd: root,
      resolver: () => [pipeline],
      get executor() {
        constructions++;
        return {
          async run() {
            throw new Error('consumer must never run');
          },
        };
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('TS2352');
    expect(constructions).toBe(0);
    expect(await readFile(input, 'utf8')).toBe(fsm(true));
  });

  it('checks an unchanged real relative dependency under its own module format', async () => {
    const input = join(root, 'task.fsm.ts');
    const support = join(root, 'support.ts');
    await writeFile(
      input,
      "import { value } from './support.js';\nexport const answer: number = value;\n",
    );
    await writeFile(support, 'export const value = 42;\n');
    const before = await Promise.all(
      [input, support].map(async (path) =>
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      ),
    );
    // Root ESM does not relabel its actual imported CommonJS sibling.
    expect((await checkFsmTypeScript(input)).join('\n')).toContain('TS1287');
    await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
    expect(await checkFsmTypeScript(input)).toEqual([]);
    await writeFile(support, 'export const value = "wrong";\n');
    expect((await checkFsmTypeScript(input)).join('\n')).toContain('TS2322');
    await writeFile(support, 'export const value = 42;\n');
    expect(
      await Promise.all(
        [input, support].map(async (path) =>
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        ),
      ),
    ).toEqual(before);
  });

  it.each([undefined, 'module', 'commonjs'])(
    'treats only the standalone root as ESM (package=%s)',
    async (type) => {
      const input = join(root, 'task.fsm.ts');
      if (type)
        await writeFile(join(root, 'package.json'), JSON.stringify({ type }));
      await writeFile(input, fsm(false));
      expect(await checkFsmTypeScript(input)).toEqual([]);
    },
  );

  it('honors cancellation before a source consumer can construct an executor', async () => {
    const input = join(root, 'task.fsm.ts');
    await writeFile(input, fsm(false));
    const controller = new AbortController();
    controller.abort(new Error('cancelled fixture'));
    let constructions = 0;
    const result = await runSlc(['flow.link', input, join(root, 'target.ts')], {
      cwd: root,
      resolver: () => [pipeline],
      signal: controller.signal,
      get executor() {
        constructions++;
        throw new Error('must not construct');
      },
    });
    expect(result.ok).toBe(false);
    expect(constructions).toBe(0);
    expect(await readFile(input, 'utf8')).toBe(fsm(false));
  });

  it.each(['persistent', 'source-change', 'cancel'])(
    'preserves repair limits and protection (%s)',
    async (mode) => {
      const controller = new AbortController();
      let calls = 0;
      const factory: AdapterFactory = (agent) => ({
        agent,
        async isAvailable() {
          return true;
        },
        async *run() {
          calls++;
          await writeFile(target, fsm(calls === 1 || mode === 'persistent'));
          if (calls === 2 && mode === 'source-change')
            await writeFile(source, GEARS + '\nChanged protected source.\n');
          if (mode === 'cancel')
            controller.abort(new Error('stop before checking'));
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: 'coder',
            payload: {
              status: 'success',
              result: calls === 1 ? 'Wrote FSM.' : correction,
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      const result = await runSlc(['flow.gears2fsm', source], {
        cwd: root,
        resolver: () => [pipeline],
        signal: controller.signal,
        executor: createConfiguredExecutor(
          { agent: 'codex' },
          { cwd: root, adapterFactory: factory },
        ),
      });
      expect(result.ok).toBe(false);
      expect(calls).toBe(
        mode === 'persistent' ? 3 : mode === 'source-change' ? 2 : 1,
      );
      if (mode === 'persistent')
        expect(result.diagnostics.join('\n')).toContain('third and final');
      if (mode === 'source-change')
        expect(result.diagnostics.join('\n')).toContain(source);
    },
  );

  it('uses SLC compiler and Node declarations despite conflicting project installations and config', async () => {
    await rm(join(root, 'node_modules'));
    await mkdir(join(root, 'node_modules', 'typescript'), { recursive: true });
    await mkdir(join(root, 'node_modules', '@types', 'node'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'node_modules', 'typescript', 'package.json'),
      '{"name":"typescript","main":"index.cjs"}\n',
    );
    await writeFile(
      join(root, 'node_modules', 'typescript', 'index.cjs'),
      'throw new Error("project compiler must not execute");\n',
    );
    await writeFile(
      join(root, 'node_modules', '@types', 'node', 'package.json'),
      '{"name":"@types/node","types":"index.d.ts"}\n',
    );
    await writeFile(
      join(root, 'node_modules', '@types', 'node', 'index.d.ts'),
      'declare const process: {argv: number};\n',
    );
    await writeFile(
      join(root, 'tsconfig.json'),
      '{"compilerOptions":{"strict":false,"noUnusedLocals":false}}\n',
    );
    const input = join(root, 'task.fsm.ts');
    await writeFile(input, 'export const args: string[] = process.argv;\n');
    expect(await checkFsmTypeScript(input)).toEqual([]);
    await writeFile(input, 'export function echo(value) {return value;}\n');
    expect((await checkFsmTypeScript(input)).join('\n')).toContain('TS7006');
  });

  it('reports checker I/O failure separately from invalid source', async () => {
    const input = join(root, 'task.fsm.ts');
    await mkdir(input);
    let selected = false;
    const result = await runSlc(['flow.link', input, join(root, 'target.ts')], {
      cwd: root,
      resolver: () => [pipeline],
      get executor() {
        selected = true;
        throw new Error('must not select');
      },
    });
    expect(result.ok).toBe(false);
    expect(selected).toBe(false);
    expect(result.diagnostics.join('\n')).toContain(
      'FSM TypeScript check could not run:',
    );
    expect(result.diagnostics.join('\n')).not.toContain('invalid FSM source');
  });

  it('observes a timer cancellation pending during checking before selecting a consumer', async () => {
    const input = join(root, 'task.fsm.ts');
    await writeFile(input, fsm(false));
    const signal = AbortSignal.timeout(10);
    let selected = false;
    const result = await runSlc(['flow.link', input, join(root, 'target.ts')], {
      cwd: root,
      resolver: () => [pipeline],
      signal,
      get executor() {
        selected = true;
        throw new Error('must not select');
      },
    });
    expect(result.ok).toBe(false);
    expect(signal.aborted).toBe(true);
    expect(selected).toBe(false);
  });
});

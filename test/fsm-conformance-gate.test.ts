// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createConfiguredExecutor,
  type AdapterFactory,
} from '../src/config.js';
import type { PhaseExecutor } from '../src/execution.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const GEARS =
  '# Task\n\nRoles:\n\n- Agent\n\n### TASK-1\n\nCaptain shall prompt Agent:\n\n> Carry out <boss-intent>.\n';
// The measured failure interpolated context.bossIntent into the source prompt
// prematurely. This executable fixture preserves that same boundary defect.
const fsm = (interpolate: boolean, nested = false) => `
export const concurrentRoleSets = [];
export const machine = { config: {
  context: { bossIntent: '', continuation: {} },
  states: { work: {
    meta: { playbook: { stateId: 'work', role: 'agent' } },
    invoke: { src: 'player', input: ({context}: {context: {bossIntent: string; pendingBossQuestion?: unknown; bossReply?: string; continuation?: {pendingBossQuestion?: unknown; bossReply?: string}}}) => ({
      stateId: 'work', sourceItem: 'TASK-1', role: 'agent',
      prompt: ${interpolate ? "'Carry out ' + context.bossIntent + '.'" : "'Carry out <boss-intent>.'"},
      bossIntent: context.bossIntent,
      ${nested ? '...context.continuation,' : 'pendingBossQuestion: context.pendingBossQuestion, bossReply: context.bossReply,'}
      result: { done: 'Done.', needsBossReply: 'Output shall include \`question:\`' }
    }) }
  } }
} };
`;

const definition = (source: string, target: string, ext = '.ts') =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${source} | ${source === 'gears' ? '.md' : '.ts'} |\n| target | ${target} | ${ext} |\n`;
const envelope = (result: string) =>
  JSON.stringify({
    dispositions: [
      {
        finding: 1,
        decision: 'accept',
        reason: 'Preserved the literal prompt.',
      },
    ],
    result,
  });

describe('early GEARS-to-FSM gate and configured repair (DR-033)', () => {
  let root: string;
  let pipeline: string;
  let source: string;
  let target: string;
  const calls: string[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-fsm-gate-'));
    pipeline = join(root, 'pipeline');
    await mkdir(pipeline);
    await writeFile(join(pipeline, 'gears2fsm.md'), definition('gears', 'fsm'));
    await writeFile(
      join(pipeline, 'fsm2output.md'),
      definition('fsm', 'output'),
    );
    source = join(root, 'task.gears.md');
    target = join(root, 'task.flow', 'task.fsm.ts');
    await writeFile(source, GEARS);
    calls.length = 0;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor): SlcDeps => ({
    cwd: root,
    resolver: () => [pipeline],
    executor,
  });
  const writing = (content: string): PhaseExecutor => ({
    async run(request) {
      if (request.kind !== 'compile') throw new Error('unexpected link');
      calls.push(request.definitionPath);
      await writeFile(request.target, content);
      return { status: 'ok' };
    },
  });

  it.each([fsm(true), 'this is not an importable FSM'])(
    'rejects invalid FSM before downstream work',
    async (content) => {
      const result = await runSlc(['flow', source], deps(writing(content)));
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(1);
      expect(result.diagnostics.join('\n')).toContain(
        content === fsm(true)
          ? 'TASK-1: FSM prompt is not the GEARS prompt verbatim'
          : 'TS',
      );
      expect(await readFile(source, 'utf8')).toBe(GEARS);
    },
  );

  it.each([false, true])(
    'configured one-Coder repairs only when required (defect=%s)',
    async (defect) => {
      const factory: AdapterFactory = (agent) => ({
        agent,
        async isAvailable() {
          return true;
        },
        async *run(prompt) {
          calls.push(prompt);
          const first = calls.length === 1;
          await writeFile(target, fsm(first && defect));
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: 'coder-session',
            payload: {
              status: 'success',
              result: first ? 'Wrote FSM.' : envelope('Repaired FSM.'),
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      const result = await runSlc(
        ['flow.gears2fsm', source],
        deps(
          createConfiguredExecutor(
            { agent: 'codex' },
            { cwd: root, adapterFactory: factory },
          ),
        ),
      );
      expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
        ok: true,
      });
      expect(calls).toHaveLength(defect ? 2 : 1);
      if (defect)
        expect(calls[1]).toContain(
          'TASK-1: FSM prompt is not the GEARS prompt verbatim',
        );
      expect(await readFile(source, 'utf8')).toBe(GEARS);
    },
  );
  it('leaves a roleless direct-Captain FSM unclassified before a link target exists', async () => {
    const directSource = GEARS.replace('Roles:\n\n- Agent\n\n', '').replace(
      'Captain shall prompt Agent:',
      'Captain shall work directly:',
    );
    const directFsm = fsm(false)
      .replace("src: 'player'", "src: 'captain'")
      .replaceAll(", role: 'agent'", '');
    await writeFile(source, directSource);
    const result = await runSlc(
      ['flow.gears2fsm', source],
      deps(writing(directFsm)),
    );
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
      ok: true,
    });
  });

  it('repairs privately nested continuation wiring with the same Coder', async () => {
    const factory: AdapterFactory = (agent) => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(prompt) {
        calls.push(prompt);
        await writeFile(target, fsm(false, calls.length === 1));
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: 'coder',
          payload: {
            status: 'success',
            result:
              calls.length === 1
                ? 'Wrote FSM.'
                : envelope('Repaired continuation input.'),
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as never;
      },
    });
    const result = await runSlc(
      ['flow.gears2fsm', source],
      deps(
        createConfiguredExecutor(
          { agent: 'codex' },
          { cwd: root, adapterFactory: factory },
        ),
      ),
    );
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
      ok: true,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain(
      'invoke.input does not carry pendingBossQuestion/bossReply',
    );
    expect(await readFile(source, 'utf8')).toBe(GEARS);
  });

  it('rejects a produced continuation defect before downstream work', async () => {
    const result = await runSlc(
      ['flow', source],
      deps(writing(fsm(false, true))),
    );
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(result.diagnostics.join('\n')).toContain(
      'invoke.input does not carry pendingBossQuestion/bossReply',
    );
    expect(await readFile(target, 'utf8')).toBe(fsm(false, true));
    expect(await readFile(source, 'utf8')).toBe(GEARS);
  });

  it.each(['compile', 'link'])(
    'rejects supplied continuation defects before %s consumer construction',
    async (kind) => {
      const input = join(root, 'task.fsm.ts');
      await writeFile(input, fsm(false, true));
      await writeFile(join(pipeline, 'link.md'), definition('fsm', 'playbook'));
      let constructions = 0;
      const result = await runSlc(
        kind === 'compile'
          ? ['flow.fsm2output', input]
          : ['flow.link', input, join(root, 'runtime.ts')],
        {
          cwd: root,
          resolver: () => [pipeline],
          get executor() {
            constructions++;
            throw Error('consumer must not be constructed');
          },
        },
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics.join('\n')).toContain(
        'invoke.input does not carry pendingBossQuestion/bossReply',
      );
      expect(constructions).toBe(0);
      expect(await readFile(input, 'utf8')).toBe(fsm(false, true));
    },
  );

  it('keeps an unclassified supplied direct-Captain FSM eligible for its consumer', async () => {
    const input = join(root, 'task.fsm.ts');
    const direct = fsm(false, true)
      .replace("src: 'player'", "src: 'captain'")
      .replaceAll(", role: 'agent'", '');
    await writeFile(input, direct);
    const result = await runSlc(
      ['flow.fsm2output', input],
      deps(writing('export const output = true;')),
    );
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
      ok: true,
    });
    expect(calls).toHaveLength(1);
    expect(await readFile(input, 'utf8')).toBe(direct);
  });

  it.each(['cancel', 'clarification'])(
    'halts continuation repair on %s',
    async (mode) => {
      const controller = new AbortController();
      const factory: AdapterFactory = (agent) => ({
        agent,
        async isAvailable() {
          return true;
        },
        async *run(prompt) {
          calls.push(prompt);
          await writeFile(target, fsm(false, true));
          if (mode === 'cancel')
            controller.abort(new Error('stop continuation repair'));
          const clarification = `CLARIFICATION: ${JSON.stringify({ questions: [{ id: 'outcome', question: 'Which output is required?', reason: 'The outcome choice is unresolved.', evidence: 'The source asks to carry out a task without specifying its outcome.' }] })}`;
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: 'coder',
            payload: {
              status: 'success',
              result:
                calls.length === 1 ? 'Wrote FSM.' : envelope(clarification),
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      const result = await runSlc(['flow.gears2fsm', source], {
        ...deps(
          createConfiguredExecutor(
            { agent: 'codex' },
            { cwd: root, adapterFactory: factory },
          ),
        ),
        signal: controller.signal,
      });
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(mode === 'cancel' ? 1 : 2);
      if (mode === 'clarification')
        expect(result.clarification?.questions[0]?.id).toBe('outcome');
      expect(await readFile(source, 'utf8')).toBe(GEARS);
    },
  );

  it.each([
    ['source', 'clean'],
    ['source', 'finding'],
    ['source', 'throw'],
    ['definition', 'clean'],
    ['semantic input', 'finding'],
    ['object', 'clean'],
    ['link target', 'throw'],
  ] as const)(
    'rejects import-time changes to the %s before a %s preflight can select its consumer',
    async (protectedKind, outcome) => {
      const input = join(root, 'task.fsm.ts');
      const runtime = join(root, 'runtime.ts');
      const semantic = join(pipeline, 'inputs', 'semantic.md');
      await mkdir(join(pipeline, 'inputs'));
      const linking =
        protectedKind === 'object' || protectedKind === 'link target';
      const consumerDefinition = join(
        pipeline,
        linking ? 'link.md' : 'fsm2output.md',
      );
      await writeFile(join(pipeline, 'link.md'), definition('fsm', 'playbook'));
      await writeFile(runtime, 'export {};\n');
      await writeFile(semantic, 'Declared semantic input.\n');
      await writeFile(
        join(pipeline, 'slc.pin-inputs.json'),
        JSON.stringify({
          schema: 'sublang.slc.pin-inputs.v1',
          closures: { fsm2output: ['inputs/semantic.md'] },
        }),
      );
      const changed =
        protectedKind === 'definition'
          ? consumerDefinition
          : protectedKind === 'semantic input'
            ? semantic
            : protectedKind === 'link target'
              ? runtime
              : input;
      const content = `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(changed)}, '\\n// changed during preflight import\\n');\n${outcome === 'throw' ? "throw new Error('import failed after mutation');\n" : ''}${outcome === 'finding' ? fsm(false, true) : 'export const machine = {config:{states:{}}};\n'}`;
      await writeFile(input, content);
      const original = await readFile(changed, 'utf8');
      let selections = 0;
      const result = await runSlc(
        linking ? ['flow.link', input, runtime] : ['flow.fsm2output', input],
        {
          cwd: root,
          resolver: () => [pipeline],
          get executor() {
            selections++;
            throw Error('must not select consumer after preflight mutation');
          },
        },
      );
      expect(result.ok).toBe(false);
      expect(selections).toBe(0);
      const diagnostic = result.diagnostics.join('\n');
      expect(diagnostic).toContain(
        `protected path "${changed}" changed during the run`,
      );
      expect(diagnostic).not.toContain('invalid FSM source');
      expect(diagnostic).not.toContain('import failed after mutation');
      expect(await readFile(changed, 'utf8')).toBe(
        original + '\n// changed during preflight import\n',
      );
    },
  );

  it.each(['source', 'definition'])(
    'fails generic protection after a correction mutates the %s',
    async (protectedKind) => {
      const protectedPath =
        protectedKind === 'source' ? source : join(pipeline, 'gears2fsm.md');
      const factory: AdapterFactory = (agent) => ({
        agent,
        async isAvailable() {
          return true;
        },
        async *run(prompt) {
          calls.push(prompt);
          const first = calls.length === 1;
          await writeFile(target, fsm(first));
          if (!first)
            await writeFile(
              protectedPath,
              (await readFile(protectedPath, 'utf8')) +
                '\nChanged protected input.\n',
            );
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: 'coder-session',
            payload: {
              status: 'success',
              result: first ? 'Wrote FSM.' : envelope('Repaired FSM.'),
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      const result = await runSlc(
        ['flow.gears2fsm', source],
        deps(
          createConfiguredExecutor(
            { agent: 'codex' },
            { cwd: root, adapterFactory: factory },
          ),
        ),
      );
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(2);
      expect(result.diagnostics.join('\n')).toContain(protectedPath);
    },
  );
});

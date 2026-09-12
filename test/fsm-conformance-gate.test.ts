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
const fsm = (interpolate: boolean) => `
export const concurrentRoleSets = [];
export const machine = { config: {
  context: { bossIntent: '' },
  states: { work: {
    meta: { playbook: { stateId: 'work', role: 'agent' } },
    invoke: { src: 'player', input: ({context}) => ({
      stateId: 'work', sourceItem: 'TASK-1', role: 'agent',
      prompt: ${interpolate ? "'Carry out ' + context.bossIntent + '.'" : "'Carry out <boss-intent>.'"},
      bossIntent: context.bossIntent,
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
          : 'FSM conformance could not be checked',
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

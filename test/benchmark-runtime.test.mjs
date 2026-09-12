// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifacts } from '../scripts/benchmark-compile.mjs';
import { checkMinimalRuntime } from '../scripts/benchmark-runtime.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

// A real schema-3 entry, shared XState runtime, script actor and governed commit
// boundary. Only the performing model is synthetic, as in the live benchmark.
async function entryFixture({
  command = '[ -e .git ] || git init',
  omitTask = false,
  repeat = false,
  terminal = 'success',
  setupCaptain = false,
  normalGuard = 'done',
  classifyWithJudge = false,
  taskPresentation = 'literal',
  taskDrift = 'none',
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'slc-runtime-entry-'));
  directories.push(directory);
  await symlink(
    fileURLToPath(new URL('../node_modules', import.meta.url)),
    join(directory, 'node_modules'),
    'dir',
  );
  const entry = join(directory, 'minimal.ts');
  await writeFile(
    entry,
    `
import { setup, assign, fromPromise } from 'xstate';
import { RUNTIME_ABI, createXStatePlaybookRuntime } from '@sublang/playbook/xstate-runtime';
type WorkInput = { stateId: string; sourceItem: string; prompt?: string; command?: string; role?: string; result: Record<string, string> };
type Outcome = { guard: string };
function resultGuard(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null || !('output' in event)) return undefined;
  const output = event.output;
  return typeof output === 'object' && output !== null && 'guard' in output && typeof output.guard === 'string' ? output.guard : undefined;
}
function presentTask(task: string, presentation: string = ${JSON.stringify(taskPresentation)}): string {
  let lines = task.split('\\n');
  const drift: string = ${JSON.stringify(taskDrift)};
  if (drift === 'changed') lines[1] = lines[1].replace('unchanged', 'changed');
  if (drift === 'missing') lines = lines.slice(0, -1);
  if (drift === 'reordered') lines.reverse();
  if (presentation === 'quoted') {
    lines = lines.map((line, index) => drift === 'mixed' && index === 1 ? line : '> ' + line);
  }
  return lines.join('\\n');
}
const machine = setup({
  types: { context: {} as { task: string }, events: {} as { type: 'START'; task: string } },
  actors: { script: fromPromise<Outcome, WorkInput>(async () => { throw new Error('unbound script'); }), player: fromPromise<Outcome, WorkInput>(async () => { throw new Error('unbound player'); }), captain: fromPromise<Outcome, WorkInput>(async () => { throw new Error('unbound captain'); }) },
  actions: { start: assign({ task: ({ event }) => event.task }) },
  guards: { ok: ({ event }) => resultGuard(event) === 'ok', done: ({ event }) => resultGuard(event) === ${JSON.stringify(normalGuard)} },
}).createMachine({
  id: 'minimal', initial: 'ready', context: { task: '' },
  states: {
    ready: { meta: { playbook: { stateId: 'ready', description: 'Waiting for task.' } }, tags: ['playbook.parked'], on: { START: { target: 'setup', actions: 'start' } } },
    setup: {
      meta: { playbook: { stateId: 'setup', description: 'Initialize repository.' } }, tags: ['playbook.busy'],
      ${setupCaptain ? `invoke: { src: 'captain', input: { stateId: 'setup', sourceItem: 'MINIMAL-1', prompt: 'Ensure the current directory is its own Git repository; if .git is absent, initialize it here.', result: { ready: 'Repository is initialized.' } }, onDone: 'implement', onError: 'failed' },` : `invoke: { src: 'script', input: { stateId: 'setup', sourceItem: 'MINIMAL-1', command: ${JSON.stringify(command)}, result: { ok: 'Command succeeded.', failed: 'Command failed.' } }, onDone: [{ guard: 'ok', target: 'implement' }, { target: 'failed' }], onError: 'failed' },`}
    },
    implement: {
      tags: ['playbook.busy'], meta: { playbook: { stateId: 'implement', role: 'agent', description: 'Carry out and commit the task.' } },
      invoke: { src: 'player', input: ({ context }) => ({ stateId: 'implement', role: 'agent', sourceItem: 'MINIMAL-2', prompt: 'Carry out and commit the task.\\n' + ${omitTask ? "'omitted'" : 'presentTask(context.task)'}, result: { ${JSON.stringify(normalGuard)}: 'The acting agent completed the behavior.' } }), onDone: [{ guard: 'done', target: ${JSON.stringify(repeat ? 'implement' : 'finished')}, reenter: true }, { target: 'failed' }], onError: 'failed' },
    },
    finished: { type: 'final', meta: { playbook: { stateId: 'finished', terminal: ${JSON.stringify(terminal)}, description: 'Finished.' } } },
    failed: { type: 'final', meta: { playbook: { stateId: 'failed', terminal: 'failure', description: 'Failed.' } } },
  },
});
const factory = createXStatePlaybookRuntime(machine, {
  label: 'minimal', compat: { artifactSchema: 3, runtimeAbi: RUNTIME_ABI },
  snapshotOptions: (value: unknown) => {
    if (value === undefined) return {};
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid options');
    const options: Record<string, string> = {};
    for (const [key, field] of Object.entries(value)) {
      if (typeof field !== 'string') throw new Error('Invalid option value');
      options[key] = field;
    }
    return options;
  }, machineInput: () => ({}),
  ${classifyWithJudge ? '' : "entryEvent: { type: 'START', textField: 'task', contextField: 'task' },"} transitionEventFields: ['task'],
  ${classifyWithJudge ? `classifyBossText: async (text, ports, signal) => { const event = JSON.parse(await ports.callJudge('Classify the following Boss message into exactly one event.\\nAllowed JSON objects:\\n- { "type": "NO_ACTION" }\\n- { "type": "START" }\\nBoss message:\\n' + text, signal)); return { ...event, task: text }; },` : ''}
  roleStates: { implement: { role: 'agent', label: 'Carry out and commit the task.' } },
  outcomeAuthority: { governedPlayerStates: { implement: { ${JSON.stringify(normalGuard)}: { fields: {}, repositoryDisposition: 'one-descendant-commit' } } } },
});
export default {
  id: 'minimal', requiredRoleIds: ['agent'], concurrentRoleSets: [],
  createRuntime(options: { captainOptions?: Readonly<Record<string, string>> }, hostCapabilities: NonNullable<Parameters<typeof factory>[0]>['hostCapabilities']) { return factory({ configuredOptions: options.captainOptions ?? {}, hostCapabilities }); },
};
`,
  );
  return entry;
}

describe('minimal benchmark source acceptance', () => {
  it('drives an emitted entry with real host capabilities and a committed exact Boss task', async () => {
    const result = await checkMinimalRuntime({ entry: await entryFixture() });
    expect(result).toMatchObject({
      ok: true,
      ownRepository: true,
      exactBossTask: true,
      taskPresentation: 'literal',
      performingCalls: 1,
      commits: 1,
      terminalKind: 'success',
    });
  });

  it('accepts the exact quoted task through real Git execution', async () => {
    const result = await checkMinimalRuntime({
      entry: await entryFixture({ taskPresentation: 'quoted' }),
    });
    expect(result).toMatchObject({
      ok: true,
      exactBossTask: true,
      taskPresentation: 'quoted',
      ownRepository: true,
      performingCalls: 1,
      commits: 1,
      terminalKind: 'success',
    });
  });

  it.each(['changed', 'missing', 'reordered', 'mixed'])(
    'rejects %s quoted task lines through real runtime execution',
    async (taskDrift) => {
      await expect(
        checkMinimalRuntime({
          entry: await entryFixture({ taskPresentation: 'quoted', taskDrift }),
        }),
      ).rejects.toThrow(/exact Boss task/);
    },
  );

  it('supports faithful setup Captain work and an authored normal guard', async () => {
    const result = await checkMinimalRuntime({
      entry: await entryFixture({
        setupCaptain: true,
        normalGuard: 'completed',
        classifyWithJudge: true,
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      performingCalls: 1,
      setupCaptainCalls: 1,
      judgeCalls: 3,
      commits: 1,
    });
  });

  it('requires the runtime check after emitted suites pass and retains separate evidence', async () => {
    const entry = await entryFixture();
    const work = directories.at(-1);
    const bundle = join(work, 'minimal.playbook');
    await mkdir(bundle);
    for (const suffix of [
      'gears-fsm',
      'fsm.introspect',
      'prompt-contract',
      'fsm.coverage',
    ]) {
      await writeFile(
        join(bundle, `minimal.${suffix}.test.ts`),
        "import { it, expect } from 'vitest'; it('valid artifact', () => expect(true).toBe(true));\n",
      );
    }
    const diagnostics = [];
    const result = await validateArtifacts({
      result: { outputs: [entry] },
      work,
      root: fileURLToPath(new URL('..', import.meta.url)),
      signal: AbortSignal.timeout(15_000),
      log: (text) => diagnostics.push(text),
      runtimeCheck: 'minimal',
    });
    expect(result, diagnostics.join('')).toMatchObject({
      ok: true,
      suite: { ok: true },
      runtime: {
        ok: true,
        performingCalls: 1,
        commits: 1,
        terminalKind: 'success',
        elapsedMs: expect.any(Number),
      },
    });
  });

  it.each([
    [
      {
        command: 'git rev-parse --is-inside-work-tree 2>/dev/null || git init',
      },
      /own .git/,
    ],
    [{ omitTask: true }, /exact Boss task/],
    [{ repeat: true }, /perform exactly once/],
    [{ terminal: 'failure' }, /successful terminal/],
  ])(
    'rejects semantic drift in an otherwise runnable entry: %j',
    async (options, expected) => {
      await expect(
        checkMinimalRuntime({ entry: await entryFixture(options) }),
      ).rejects.toThrow(expected);
    },
  );
});

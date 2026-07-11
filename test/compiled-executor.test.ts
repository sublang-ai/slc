// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlaybookPorts } from '@sublang/playbook/runtime';

import { createCompiledExecutor } from '../src/compiled-executor.js';
import type { ExecuteRequest } from '../src/execution.js';
import type { AgentClient } from '../src/interpreter.js';

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'phase-fixture.mjs',
);

// An agent transport that is never invoked by the fixture (it only does file IO),
// present to satisfy the ports adapter.
const idleAgent: AgentClient = {
  async run() {
    return { status: 'success', text: '' };
  },
};

const structuredState = {
  value: 'ready',
  activeStateIds: ['ready'],
  tags: ['playbook.parked'],
  status: 'active' as const,
  quiescent: true,
  stateId: 'ready',
};
const sparseJson: unknown[] = [];
sparseJson.length = 1;
const accessorJson = Object.defineProperty({}, 'secret', {
  enumerable: true,
  get: () => 'hidden',
});
const symbolJson = { [Symbol('secret')]: 'hidden' };

// Integration: a compiled `playbook` artifact driven non-interactively through
// the executor over a fixture run root (PHEXEC-26).
describe('createCompiledExecutor (PHEXEC-26)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-compiled-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const runFixture = async (sourceContent: string) => {
    await writeFile(join(root, 'src.md'), sourceContent);
    const executor = createCompiledExecutor({
      artifactPath: fixture,
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
    });
    const request: ExecuteRequest = {
      kind: 'compile',
      definitionPath: join(root, 'phase.md'),
      source: 'src.md',
      target: 'out.ts',
    };
    return executor.run(request, new AbortController().signal);
  };

  it('drives the runtime, writes the target, and yields ok with drained diagnostics', async () => {
    const result = await runFixture('hello');
    expect(result.status).toBe('ok');
    // The runtime returns void; the only diagnostics are its drained status.
    expect(result.diagnostics).toEqual(['fixture wrote target']);
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe('compiled:hello');
  });

  it('derives blocked when a clean turn produces no output', async () => {
    const result = await runFixture('BLOCK');
    expect(result.status).toBe('blocked');
    expect(result.diagnostics).toContain('fixture parked');
  });

  it('derives blocked when a stale target pre-exists and the turn writes nothing', async () => {
    await writeFile(join(root, 'out.ts'), 'stale prior artifact\n');
    const result = await runFixture('BLOCK');
    // A pre-existing target must not be mistaken for produced output.
    expect(result.status).toBe('blocked');
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe(
      'stale prior artifact\n',
    );
  });

  it('recognizes an atomic replacement whose mtime is preserved as produced output', async () => {
    const target = join(root, 'out.ts');
    const replacement = join(root, 'replacement.ts');
    await writeFile(target, 'stale prior artifact');
    await writeFile(replacement, 'fresh compiled artifact');
    const fixedTime = new Date('2001-01-01T00:00:00.000Z');
    await utimes(target, fixedTime, fixedTime);
    await utimes(replacement, fixedTime, fixedTime);
    const priorMtime = (await stat(target)).mtimeMs;

    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init() {},
        async handleBossInput() {
          await rename(replacement, target);
        },
        async dispose() {},
      }),
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect((await stat(target)).mtimeMs).toBe(priorMtime);
    expect(await readFile(target, 'utf8')).toBe('fresh compiled artifact');
  });

  it('derives error when standard telemetry reports the failed quiescent state', async () => {
    let ports: PlaybookPorts | undefined;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value) {
          ports = value;
        },
        async handleBossInput() {
          await ports?.emitTelemetry({
            topic: 'playbook.fsm.state',
            payload: { from: 'transform', to: 'failed' },
          });
        },
        async dispose() {},
      }),
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target: join(root, 'out.ts'),
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('error');
    expect(result.diagnostics).toContain(
      'compiled runtime reached the failed quiescent state',
    );
    expect(result.diagnostics).toContain(
      '[playbook.fsm.state] {"from":"transform","to":"failed"}',
    );
    expect(result.diagnostics.join('\n')).not.toContain(
      'parked for Boss input',
    );
  });

  it('derives error when the turn throws', async () => {
    const result = await runFixture('ERR');
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]).toMatch(/fixture error/);
  });

  it('initializes a legacy runtime with exactly four recorded ports', async () => {
    let keys: string[] = [];
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          keys = Object.keys(value as object);
        },
        async handleBossInput() {},
        async dispose() {},
      }),
    });
    await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );

    expect(keys.sort()).toEqual([
      'callJudge',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
  });

  it('initializes a traced session-v1 runtime with its exact boundary', async () => {
    const target = join(root, 'out.ts');
    let initValue: unknown;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'session-v1',
      playbookId: 'phase',
      createSessionId: () => 'session-v1',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          initValue = value;
        },
        async handleBossInput() {
          await writeFile(target, 'fresh');
        },
        async dispose() {},
      }),
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(Object.keys(initValue as object).sort()).toEqual([
      'playbookId',
      'ports',
      'sessionId',
    ]);
    const session = initValue as { ports: Record<string, unknown> };
    expect(Object.keys(session.ports).sort()).toEqual([
      'callJudge',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
  });

  it('initializes a causal root session with exactly five runtime ports', async () => {
    let initValue: unknown;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      playbookId: 'text2gears',
      createSessionId: () => 'session-1',
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          initValue = value;
        },
        async handleBossInput() {
          return { outcome: 'no-action', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });
    await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );

    expect(initValue).toMatchObject({
      sessionId: 'session-1',
      playbookId: 'text2gears',
      rootSessionId: 'session-1',
      depth: 0,
    });
    const session = initValue as { ports: Record<string, unknown> };
    expect(Object.keys(session.ports).sort()).toEqual([
      'callJudge',
      'callPlaybook',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
    expect(Object.keys(session.ports)).not.toContain('drainDiagnostics');
  });

  it('maps structured outcomes directly instead of failed telemetry', async () => {
    const target = join(root, 'out.ts');
    let ports: { emitTelemetry(event: unknown): Promise<void> } | undefined;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          ports = (value as typeof value & { ports: typeof ports }).ports;
        },
        async handleBossInput() {
          await writeFile(target, 'fresh');
          await ports?.emitTelemetry({
            topic: 'playbook.fsm.state',
            payload: { to: 'failed' },
          });
          await ports?.emitTelemetry({
            topic: 'playbook.trace',
            payload: {
              prompt: 'private prompt',
              reply: 'private reply',
              resumeToken: 'private token',
            },
          });
          return { outcome: 'quiescent', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(result.diagnostics.join('\n')).not.toMatch(
      /private prompt|private reply|private token/,
    );
  });

  it.each([
    ['no-action', { outcome: 'no-action', state: structuredState }, 'blocked'],
    ['failed', { outcome: 'failed', state: structuredState }, 'error'],
    ['aborted', { outcome: 'aborted', state: structuredState }, 'error'],
    ['missing', undefined, 'error'],
    [
      'non-json output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: 1n,
      },
      'error',
    ],
    [
      'sparse output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: sparseJson,
      },
      'error',
    ],
    [
      'accessor output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: accessorJson,
      },
      'error',
    ],
    [
      'symbol output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: symbolJson,
      },
      'error',
    ],
    [
      'malformed state',
      {
        outcome: 'quiescent',
        state: { ...structuredState, stateId: 7 },
      },
      'error',
    ],
    [
      'accessor state value',
      {
        outcome: 'quiescent',
        state: { ...structuredState, value: accessorJson },
      },
      'error',
    ],
    [
      'symbol state value',
      {
        outcome: 'quiescent',
        state: { ...structuredState, value: symbolJson },
      },
      'error',
    ],
    [
      'suspended',
      {
        outcome: 'suspended',
        state: structuredState,
        pendingCall: {
          callId: 'child-1',
          playbookId: 'child',
          childSessionId: 'session-child',
        },
      },
      'error',
    ],
    ['invalid', { outcome: 'quiescent', state: {} }, 'error'],
  ] as const)(
    'maps a structured %s result to %s',
    async (_name, outcome, status) => {
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract: 'composed-v2',
        player: idleAgent,
        judge: idleAgent,
        loadFactory: async () => () => ({
          async init() {},
          async handleBossInput() {
            return outcome;
          },
          async resumePlaybookCall() {
            return { outcome: 'no-action', state: structuredState };
          },
          async dispose() {},
        }),
      });

      const result = await executor.run(
        {
          kind: 'compile',
          definitionPath: join(root, 'phase.md'),
          source: join(root, 'src.md'),
          target: join(root, 'out.ts'),
        },
        new AbortController().signal,
      );
      expect(result.status).toBe(status);
    },
  );

  it('reports disposal failure instead of returning success', async () => {
    const target = join(root, 'out.ts');
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init() {},
        async handleBossInput() {
          await writeFile(target, 'fresh');
          return { outcome: 'terminal', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {
          throw new Error('trace drain failed');
        },
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
    expect(result.diagnostics).toContain(
      'compiled runtime disposal failed: trace drain failed',
    );
  });

  it.each([
    ['session id', { sessionId: ' ', playbookId: 'phase' }],
    ['playbook id', { sessionId: 'session', playbookId: '' }],
  ])(
    'rejects an empty %s before runtime initialization',
    async (_name, ids) => {
      let initialized = false;
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract: 'composed-v2',
        playbookId: ids.playbookId,
        createSessionId: () => ids.sessionId,
        player: idleAgent,
        judge: idleAgent,
        loadFactory: async () => () => ({
          async init() {
            initialized = true;
          },
          async handleBossInput() {
            return { outcome: 'no-action', state: structuredState };
          },
          async resumePlaybookCall() {
            return { outcome: 'no-action', state: structuredState };
          },
          async dispose() {},
        }),
      });

      await expect(
        executor.run(
          {
            kind: 'compile',
            definitionPath: join(root, 'phase.md'),
            source: join(root, 'src.md'),
            target: join(root, 'out.ts'),
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow(/must be non-empty/);
      expect(initialized).toBe(false);
    },
  );

  it('reports error when the artifact has no createPlaybookRuntime export', async () => {
    const bad = join(root, 'bad.mjs');
    await writeFile(bad, 'export const notDefault = 1;\n');
    const executor = createCompiledExecutor({
      artifactPath: bad,
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]).toMatch(/no createPlaybookRuntime/);
  });
});

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

  it('hands the runtime only Playbook ports (PHEXEC-23)', async () => {
    let keys: string[] = [];
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(ports: Record<string, unknown>) {
          keys = Object.keys(ports);
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

    expect([...keys].sort()).toEqual([
      'callJudge',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
    expect(keys).not.toContain('drainDiagnostics');
  });

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

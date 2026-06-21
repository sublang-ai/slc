// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

// Integration: a compiled `phase` artifact run through the executor over a fixture
// run root (PHEXEC-26).
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

  it('writes the target and yields ok, carrying drained diagnostics', async () => {
    const result = await runFixture('hello');
    expect(result.status).toBe('ok');
    // The artifact's own diagnostics plus the drained status emission.
    expect(result.diagnostics).toEqual(['compiled ok', 'fixture wrote target']);
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe('compiled:hello');
  });

  it('maps a blocked artifact result to a blocked outcome', async () => {
    const result = await runFixture('BLOCK');
    expect(result.status).toBe('blocked');
    expect(result.diagnostics).toContain('BLOCKED: fixture blocked');
  });

  it('maps an errored artifact result to an error outcome', async () => {
    const result = await runFixture('ERR');
    expect(result.status).toBe('error');
    expect(result.diagnostics).toContain('fixture error');
  });

  it('hands the artifact only Playbook ports and the file capability (PHEXEC-23)', async () => {
    let keys: string[] = [];
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadRunner: async () => ({
        async run(_input, ports) {
          keys = Object.keys(ports);
          return { status: 'ok', diagnostics: [] };
        },
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
      'list',
      'read',
      'write',
    ]);
    expect(keys).not.toContain('drainDiagnostics');
  });

  it('reports error when the artifact has no createPhaseRunner export', async () => {
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
    expect(result.diagnostics[0]).toMatch(/no createPhaseRunner/);
  });
});

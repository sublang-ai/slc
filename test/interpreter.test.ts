// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runPhase, type ExecuteRequest } from '../src/execution.js';
import {
  type AgentClient,
  type AgentRunRequest,
  type AgentRunResult,
  buildPhasePrompt,
  createInterpretedExecutor,
} from '../src/interpreter.js';

const compileRequest = (
  overrides: Partial<Extract<ExecuteRequest, { kind: 'compile' }>> = {},
) =>
  ({
    kind: 'compile',
    definitionPath: '/defs/text2gears.md',
    source: '/src/onboarding.md',
    target: '/out/onboarding.gears.md',
    ...overrides,
  }) satisfies ExecuteRequest;

describe('buildPhasePrompt (PHEXEC-11, PHEXEC-14, PHEXEC-15)', () => {
  it('embeds the definition, the target, and the agent contract for a compile phase', () => {
    const prompt = buildPhasePrompt({
      request: compileRequest(),
      definition: '## Formats\n\nTransform text to gears.',
    });
    expect(prompt).toContain('Transform text to gears.');
    expect(prompt).toContain('authoritative');
    expect(prompt).toContain('write only /out/onboarding.gears.md');
    expect(prompt).toContain('not commit');
    expect(prompt).toContain('source to read: /src/onboarding.md');
    expect(prompt).toContain('BLOCKED:');
  });

  it('lists ordered objects, the link target, and options for a link phase', () => {
    const prompt = buildPhasePrompt({
      request: {
        kind: 'link',
        definitionPath: '/defs/link.md',
        objects: ['/o/main.fsm.ts', '/o/helper.fsm.ts'],
        linkTarget: '/o/runner.ts',
        options: [{ name: 'seed', value: '42' }],
        linked: '/o/app.run.ts',
      },
      definition: '## Link Targets',
    });
    expect(prompt).toContain('/o/main.fsm.ts, /o/helper.fsm.ts');
    expect(prompt).toContain('link target module: /o/runner.ts');
    expect(prompt).toContain('options: seed=42');
    expect(prompt).toContain('write only /o/app.run.ts');
  });
});

describe('createInterpretedExecutor (PHEXEC-12, PHEXEC-13)', () => {
  let dir: string;
  let request: ExecuteRequest;

  const recordingAgent = (
    response: AgentRunResult,
  ): AgentClient & { calls: AgentRunRequest[] } => {
    const calls: AgentRunRequest[] = [];
    return {
      calls,
      run: (req) => {
        calls.push(req);
        return Promise.resolve(response);
      },
    };
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-interp-'));
    await writeFile(join(dir, 'text2gears.md'), '## Formats\n\ndo the thing');
    request = compileRequest({ definitionPath: join(dir, 'text2gears.md') });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('invokes the agent exactly once with the definition in the prompt', async () => {
    const agent = recordingAgent({
      status: 'success',
      text: 'wrote the gears',
    });
    const executor = createInterpretedExecutor({ agent });

    const result = await executor.run(request, new AbortController().signal);

    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0].prompt).toContain('do the thing');
    expect(result).toEqual({ status: 'ok', diagnostics: ['wrote the gears'] });
  });

  it('passes the configured model and cwd to the agent (PHEXEC-13)', async () => {
    const agent = recordingAgent({ status: 'success', text: 'ok' });
    const executor = createInterpretedExecutor({
      agent,
      config: { model: 'some-model', cwd: '/work' },
    });

    await executor.run(request, new AbortController().signal);

    expect(agent.calls[0]).toMatchObject({ model: 'some-model', cwd: '/work' });
  });

  it('maps a BLOCKED reply to a blocked result (PHEXEC-7)', async () => {
    const agent = recordingAgent({
      status: 'success',
      text: 'BLOCKED: the source has no headings',
    });
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      new AbortController().signal,
    );
    expect(result).toEqual({
      status: 'blocked',
      diagnostics: ['BLOCKED: the source has no headings'],
    });
  });

  it('maps an error agent status to an error result', async () => {
    const agent = recordingAgent({ status: 'error', text: '' });
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
  });

  it('maps an unfinished agent run to an error result', async () => {
    const agent = recordingAgent({ status: 'incomplete', text: '' });
    const result = await createInterpretedExecutor({ agent }).run(
      request,
      new AbortController().signal,
    );
    expect(result).toEqual({
      status: 'error',
      diagnostics: ['agent did not finish'],
    });
  });
});

describe('interpreted executor through the boundary (DR-003 + DR-004)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-interp-run-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('passes generic checks when the agent writes the target', async () => {
    await writeFile(join(dir, 'text2gears.md'), '## Formats');
    await writeFile(join(dir, 'onboarding.md'), 'prose');
    const request: ExecuteRequest = {
      kind: 'compile',
      definitionPath: join(dir, 'text2gears.md'),
      source: join(dir, 'onboarding.md'),
      target: join(dir, 'onboarding.gears.md'),
    };

    // Fake agent that "performs the transformation" by writing the target.
    const agent: AgentClient = {
      run: async () => {
        await writeFile(request.target, 'gears output');
        return { status: 'success', text: 'done' };
      },
    };

    const result = await runPhase({
      request,
      phase: 'text2gears',
      targetExt: '.md',
      executor: createInterpretedExecutor({ agent }),
    });

    expect(result.ok).toBe(true);
  });
});

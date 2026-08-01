// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import type { AgentAdapter, AgentEvent, AgentOptions } from '@sublang/cligent';

import { createCligentAgent } from '../src/cligent-agent.js';

describe('createCligentAgent player continuation', () => {
  it('forwards explicit selection and exposes the returned resume token', async () => {
    const resumes: Array<string | undefined> = [];
    const allowedTools: Array<string[] | undefined> = [];
    let run = 0;
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      async *run(_prompt: string, options?: AgentOptions) {
        resumes.push(options?.resume);
        allowedTools.push(options?.allowedTools);
        run++;
        yield {
          type: 'done',
          agent: 'fixture',
          timestamp: run,
          sessionId: `transport-${run}`,
          payload: {
            status: 'success',
            result: `result-${run}`,
            resumeToken: `returned-${run}`,
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        };
      },
    };
    const client = createCligentAgent({ adapter });
    const signal = new AbortController().signal;

    const fresh = await client.run({
      prompt: 'fresh',
      resume: false,
      allowedTools: [],
      signal,
    });
    const resumed = await client.run({
      prompt: 'resume',
      resume: 'explicit-session',
      signal,
    });

    // Cligent maps false to a fresh adapter run and a string to explicit resume.
    expect(resumes).toEqual([undefined, 'explicit-session']);
    expect(allowedTools).toEqual([[], undefined]);
    expect(fresh).toMatchObject({
      status: 'success',
      text: 'result-1',
      resumeToken: 'returned-1',
    });
    expect(resumed).toMatchObject({
      status: 'success',
      text: 'result-2',
      resumeToken: 'returned-2',
    });
  });
});

const event = (
  type: string,
  payload: Record<string, unknown> = {},
): AgentEvent =>
  ({
    type,
    agent: 'fixture',
    timestamp: 1,
    sessionId: 'stall-session',
    payload,
  }) as unknown as AgentEvent;

describe('createCligentAgent stall watchdog (PHEXEC-36, PHEXEC-38)', () => {
  it('aborts a call that goes silent and reports the inactivity duration', async () => {
    let runs = 0;
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      // Yields one event, then stalls forever: only an abort can end the run.
      async *run(_prompt: string, options?: AgentOptions) {
        runs++;
        yield event('init', { model: 'm', cwd: '.', tools: [] });
        await new Promise<void>((resolve) => {
          options?.abortSignal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      },
    };
    const client = createCligentAgent({ adapter, stallTimeoutMs: 40 });

    const result = await client.run({
      prompt: 'stall',
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('error');
    expect(result.text).toContain('stalled');
    expect(result.text).toContain('0s'); // the 40 ms window, as elapsed text
    expect(runs).toBe(1); // no retry of the aborted call (PHEXEC-12)
  });

  it('treats any adapter event as activity and lets a chatty call finish', async () => {
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      async *run() {
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          yield event('tool_use', {
            toolName: 'Write',
            toolUseId: `t${i}`,
            input: {},
          });
        }
        yield event('done', {
          status: 'success',
          result: 'finished',
          usage: { inputTokens: 0, outputTokens: 0, toolUses: 5 },
          durationMs: 125,
        });
      },
    };
    // The window outlives every gap but not the whole run, so only per-event
    // resets let this succeed.
    const client = createCligentAgent({ adapter, stallTimeoutMs: 80 });

    const result = await client.run({
      prompt: 'chatty',
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: 'success', text: 'finished' });
  });

  it('keeps a caller abort a plain interruption, not a stall error', async () => {
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      async *run(_prompt: string, options?: AgentOptions) {
        yield event('init', { model: 'm', cwd: '.', tools: [] });
        await new Promise<void>((resolve) => {
          options?.abortSignal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      },
    };
    const client = createCligentAgent({ adapter, stallTimeoutMs: 60_000 });
    const controller = new AbortController();

    const running = client.run({
      prompt: 'interrupt',
      signal: controller.signal,
    });
    controller.abort();
    const result = await running;

    expect(result.status).toBe('incomplete');
    expect(result.text).not.toContain('stalled');
  });
});

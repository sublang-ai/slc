// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import type { AgentAdapter, AgentEvent, AgentOptions } from '@sublang/cligent';

import {
  createCligentAgent,
  defaultWatchdogTimers,
} from '../src/cligent-agent.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';

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

describe('createCligentAgent stall watchdog (phase-execution-36, phase-execution-38)', () => {
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
    expect(runs).toBe(1); // no retry of the aborted call (phase-execution-12)
  });

  it('preserves a stalled Reviewer diagnostic and does not retry it', async () => {
    let reviewerRuns = 0;
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      async *run(_prompt: string, options?: AgentOptions) {
        reviewerRuns++;
        yield event('init', { model: 'm', cwd: '.', tools: [] });
        await new Promise<void>((resolve) => {
          options?.abortSignal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      },
    };
    const reviewer = createCligentAgent({ adapter, stallTimeoutMs: 40 });
    const reviewed = createReviewingAgent({
      coder: {
        async run() {
          return { status: 'success', text: 'coder finished' };
        },
      },
      reviewer: () => reviewer,
    });

    const result = await reviewed.run({
      prompt: 'review the artifact',
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('error');
    expect(result.text).toContain('Reviewer returned error');
    expect(result.text).toContain('no agent activity for 0s');
    expect(reviewerRuns).toBe(1);
  });

  it('arms a referenced timer so a dead transport still trips the watchdog', () => {
    // Regression: an unref'd watchdog timer lets Node exit before the window
    // elapses whenever the stalled transport holds no I/O of its own — the
    // process dies with an unsettled-await warning and the stall is never
    // diagnosed. Assert the production timers directly: an injected fake
    // would bypass the very property under test, and vitest's own event loop
    // hides the failure from any behavioral assertion.
    const handle = defaultWatchdogTimers.setTimeout(() => {}, 60_000) as {
      hasRef?: () => boolean;
    };
    try {
      expect(handle.hasRef?.()).toBe(true);
    } finally {
      defaultWatchdogTimers.clearTimeout(handle);
    }
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

  it('honors a real success that lands inside the post-abort drain', async () => {
    // Cligent gives the adapter a 500 ms grace after an abort and yields a
    // genuine terminal event verbatim. A phase that finishes in that window
    // did its work and wrote its artifact; reporting a hang would discard a
    // completed — and expensive — phase.
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      async *run(_prompt: string, options?: AgentOptions) {
        yield event('init', { model: 'm', cwd: '.', tools: [] });
        // A long, event-silent model turn that happens to finish just after
        // the watchdog fires.
        await new Promise<void>((resolve) => {
          options?.abortSignal?.addEventListener(
            'abort',
            () => setTimeout(resolve, 60),
            { once: true },
          );
        });
        yield event('done', {
          status: 'success',
          result: 'the real artifact summary',
          resumeToken: 'sess-9',
          usage: { inputTokens: 1, outputTokens: 1, toolUses: 0 },
          durationMs: 1,
        });
      },
    };
    const client = createCligentAgent({ adapter, stallTimeoutMs: 40 });

    const result = await client.run({
      prompt: 'silent-turn',
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: 'success',
      text: 'the real artifact summary',
      resumeToken: 'sess-9',
    });
    expect(result.text).not.toContain('stalled');
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

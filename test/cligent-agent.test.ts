// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import type { AgentAdapter, AgentOptions } from '@sublang/cligent';

import { createCligentAgent } from '../src/cligent-agent.js';

describe('createCligentAgent player continuation', () => {
  it('forwards explicit selection and exposes the returned resume token', async () => {
    const resumes: Array<string | undefined> = [];
    let run = 0;
    const adapter: AgentAdapter = {
      agent: 'fixture',
      async isAvailable() {
        return true;
      },
      async *run(_prompt: string, options?: AgentOptions) {
        resumes.push(options?.resume);
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
      signal,
    });
    const resumed = await client.run({
      prompt: 'resume',
      resume: 'explicit-session',
      signal,
    });

    // Cligent maps false to a fresh adapter run and a string to explicit resume.
    expect(resumes).toEqual([undefined, 'explicit-session']);
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

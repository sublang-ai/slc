// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';
import type { AgentOptions } from '@sublang/cligent';

import { resolveRunConfig } from '../src/app.js';
import {
  type AdapterFactory,
  createConfiguredAgentClient,
  resolveAgentSelection,
} from '../src/config.js';
import { ultracodeOptionsFor } from '../src/ultracode.js';

describe('independent role Ultracode configuration', () => {
  it('resolves both roles with environment precedence and preserves false', async () => {
    const config = resolveRunConfig(
      { SLC_ULTRACODE: 'false', SLC_REVIEWER_ULTRACODE: 'true' },
      {
        agent: 'claude-code',
        reviewerAgent: 'claude-code',
        ultracode: true,
        reviewerUltracode: false,
      },
    );
    expect(config.selection.ultracode).toBe(false);
    expect(config.selection.reviewer?.ultracode).toBe(true);
    const calls: AgentOptions[] = [];
    const adapterFactory: AdapterFactory = (agent) => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(_prompt, options) {
        if (options) calls.push(options);
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: 'ultracode',
          payload: {
            status: 'success',
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as const;
      },
    });
    for (const role of [config.selection, config.selection.reviewer!]) {
      const client = createConfiguredAgentClient(role, { adapterFactory });
      await client.run({
        prompt: 'check',
        signal: new AbortController().signal,
      });
    }
    expect(calls.map((options) => options.ultracode)).toEqual([false, true]);
  });
  it('rejects malformed values and Reviewer settings without its agent', () => {
    for (const key of ['SLC_ULTRACODE', 'SLC_REVIEWER_ULTRACODE']) {
      expect(() =>
        resolveAgentSelection({
          SLC_AGENT: 'claude-code',
          SLC_REVIEWER_AGENT: 'claude-code',
          [key]: 'yes',
        }),
      ).toThrow(key);
    }
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_REVIEWER_ULTRACODE: 'false',
      }),
    ).toThrow('require a reviewer agent');
  });
  it('omits unsupported false and rejects activation independently for each role', () => {
    expect(ultracodeOptionsFor('codex', false)).toEqual({});
    expect(() =>
      resolveAgentSelection({ SLC_AGENT: 'codex', SLC_ULTRACODE: 'true' }),
    ).toThrow(/SLC_ULTRACODE.*adapter "codex"/);
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_REVIEWER_AGENT: 'codex',
        SLC_REVIEWER_ULTRACODE: 'true',
      }),
    ).toThrow(/SLC_REVIEWER_ULTRACODE.*adapter "codex"/);
    expect(ultracodeOptionsFor('claude-code', undefined)).toEqual({});
  });
});

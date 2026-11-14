// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it, vi } from 'vitest';

const metadata = vi.hoisted(() => ({ available: true }));
vi.mock('@sublang/cligent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isUltracodeSupported: (agent: string) =>
    metadata.available && agent === 'claude-code',
}));

import { resolveRunConfig } from '../src/app.js';
import { resolveAgentSelection } from '../src/config.js';
import { ultracodeOptionsFor } from '../src/ultracode.js';

describe('independent role Ultracode configuration', () => {
  it('resolves both roles with environment precedence and preserves false', () => {
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
    expect(ultracodeOptionsFor('claude-code', false)).toEqual({
      ultracode: false,
    });
    expect(ultracodeOptionsFor('claude-code', true)).toEqual({
      ultracode: true,
    });
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
    ).toThrow('SLC_ULTRACODE');
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_REVIEWER_AGENT: 'codex',
        SLC_REVIEWER_ULTRACODE: 'true',
      }),
    ).toThrow('SLC_REVIEWER_ULTRACODE');
    expect(ultracodeOptionsFor('claude-code', undefined)).toEqual({});
  });
});

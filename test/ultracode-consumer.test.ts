// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { expect, it, vi } from 'vitest';
import { resolveAgentSelection } from '../src/config.js';
import { ultracodeOptionsFor } from '../src/ultracode.js';

vi.mock('@sublang/cligent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isUltracodeSupported: undefined,
  defaultAgentModels: undefined,
}));

it('uses provider defaults and rejects unrepresentable requests on older Cligent', () => {
  const config = resolveAgentSelection(
    { SLC_AGENT: 'claude-code', SLC_REVIEWER_AGENT: 'codex' },
    { modelDefaults: true },
  );
  for (const role of [config, config.reviewer!]) {
    expect(role.model).toBeUndefined();
    expect(role.subagentModel).toBeUndefined();
  }
  expect(() => ultracodeOptionsFor('codex', true)).toThrow(
    'ultracode is not supported by adapter "codex"',
  );
  expect(ultracodeOptionsFor('claude-code', undefined)).toEqual({});
  expect(ultracodeOptionsFor('codex', false)).toEqual({});
  expect(() => ultracodeOptionsFor('claude-code', false)).toThrow(
    'upgrade Cligent',
  );
  expect(
    resolveAgentSelection({ SLC_AGENT: 'claude-code', SLC_EFFORT: 'ultracode' })
      .effort,
  ).toBe('ultracode');
  for (const value of ['true', 'false']) {
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_EFFORT: 'ultracode',
        SLC_ULTRACODE: value,
      }),
    ).toThrow('upgrade Cligent');
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_REVIEWER_AGENT: 'claude-code',
        SLC_REVIEWER_EFFORT: 'ultracode',
        SLC_REVIEWER_ULTRACODE: value,
      }),
    ).toThrow('upgrade Cligent');
  }
  expect(() =>
    resolveAgentSelection({ SLC_AGENT: 'claude-code', SLC_ULTRACODE: 'true' }),
  ).toThrow('upgrade Cligent');
  expect(() =>
    resolveAgentSelection({
      SLC_AGENT: 'claude-code',
      SLC_REVIEWER_AGENT: 'claude-code',
      SLC_REVIEWER_ULTRACODE: 'true',
    }),
  ).toThrow('upgrade Cligent');
});

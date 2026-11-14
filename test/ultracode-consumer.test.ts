// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import * as cligent from '@sublang/cligent';
import { expect, it } from 'vitest';
import { resolveAgentSelection } from '../src/config.js';
import { ultracodeOptionsFor } from '../src/ultracode.js';

it('keeps older consumers loadable while refusing unrepresentable activation', () => {
  if (
    typeof (cligent as unknown as Record<string, unknown>)
      .isUltracodeSupported === 'function'
  )
    return;
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

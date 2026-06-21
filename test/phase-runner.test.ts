// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { type PhaseResult, mapPhaseResult } from '../src/phase-runner.js';

describe('mapPhaseResult (PHEXEC-24)', () => {
  it.each(['ok', 'blocked', 'error'] as const)(
    'carries the %s status to the executor outcome',
    (status) => {
      const result: PhaseResult = { status, diagnostics: [] };
      expect(mapPhaseResult(result).status).toBe(status);
    },
  );

  it('surfaces diagnostics for every status, including an ok run', () => {
    expect(
      mapPhaseResult({ status: 'ok', diagnostics: ['resolved an ambiguity'] }),
    ).toEqual({
      status: 'ok',
      diagnostics: ['resolved an ambiguity'],
    });
    expect(
      mapPhaseResult({ status: 'error', diagnostics: ['a', 'b'] }).diagnostics,
    ).toEqual(['a', 'b']);
  });
});

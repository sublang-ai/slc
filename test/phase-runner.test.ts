// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import {
  type PhaseInput,
  type PhaseResult,
  mapPhaseResult,
  resolvesToPlaybook,
  seedPhaseTurn,
} from '../src/phase-runner.js';

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

// The settled SLC-to-runtime seeding contract: a prose directive naming the
// request kind, then the full request as one `Request: `-introduced JSON line.
describe('seedPhaseTurn (PHEXEC-29)', () => {
  const requestLine = (seed: string): string => {
    const line = seed
      .split('\n')
      .find((candidate) => candidate.startsWith('Request: '));
    expect(line).toBeDefined();
    return (line as string).slice('Request: '.length);
  };

  it('seeds a compile request as a directive plus one JSON line', () => {
    const input: PhaseInput = {
      kind: 'compile',
      source: '/run/src.md',
      target: '/run/out.ts',
    };
    const seed = seedPhaseTurn(input);
    expect(seed.split('\n')[0]).toMatch(/compile phase non-interactively/);
    expect(JSON.parse(requestLine(seed))).toEqual(input);
  });

  it('seeds a link request as a directive plus one JSON line', () => {
    const input: PhaseInput = {
      kind: 'link',
      objects: ['/run/a.ts', '/run/b.ts'],
      linkTarget: '/run/target',
      options: { entry: 'main' },
      linked: '/run/linked.ts',
    };
    const seed = seedPhaseTurn(input);
    expect(seed.split('\n')[0]).toMatch(/link phase non-interactively/);
    expect(JSON.parse(requestLine(seed))).toEqual(input);
  });
});

describe('resolvesToPlaybook (PIN-13)', () => {
  it('recognizes a createPlaybookRuntime default export', () => {
    expect(
      resolvesToPlaybook(
        'export default function createPlaybookRuntime() {}\n',
      ),
    ).toBe(true);
    expect(
      resolvesToPlaybook(
        'const f = createPlaybookRuntime;\nexport default createPlaybookRuntime;',
      ),
    ).toBe(true);
  });

  it('rejects a module that does not expose the factory', () => {
    expect(resolvesToPlaybook('export const value = 42;\n')).toBe(false);
    expect(resolvesToPlaybook('export default () => ({});\n')).toBe(false);
    expect(resolvesToPlaybook('compiled artifact bytes\n')).toBe(false);
  });
});

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
        'const createPlaybookRuntime = () => ({});\nexport default createPlaybookRuntime;',
      ),
    ).toBe(true);
    expect(
      resolvesToPlaybook(
        'export function createPlaybookRuntime() {}\nexport { createPlaybookRuntime as default };',
      ),
    ).toBe(true);
  });

  it('recognizes the DR-019 thin shared-engine factory call (DR-017)', () => {
    expect(
      resolvesToPlaybook(
        [
          "import { createXStatePlaybookRuntime } from '@sublang/playbook/xstate-runtime';",
          "import { machine } from './flow.fsm.ts';",
          'const createPlaybookRuntime = createXStatePlaybookRuntime(machine, {});',
          'export default createPlaybookRuntime;',
        ].join('\n'),
      ),
    ).toBe(true);
  });

  it('rejects a factory call whose callee is not the shared engine import', () => {
    expect(
      resolvesToPlaybook(
        [
          "import { somethingElse } from 'another-package';",
          'const createPlaybookRuntime = somethingElse();',
          'export default createPlaybookRuntime;',
        ].join('\n'),
      ),
    ).toBe(false);
    // A type-only import of the engine cannot carry the runtime callee.
    expect(
      resolvesToPlaybook(
        [
          "import type { createXStatePlaybookRuntime } from '@sublang/playbook/xstate-runtime';",
          'const createPlaybookRuntime = createXStatePlaybookRuntime({}, {});',
          'export default createPlaybookRuntime;',
        ].join('\n'),
      ),
    ).toBe(false);
  });

  it('rejects a module that does not expose the factory', () => {
    expect(resolvesToPlaybook('export const value = 42;\n')).toBe(false);
    expect(resolvesToPlaybook('export default () => ({});\n')).toBe(false);
    expect(resolvesToPlaybook('compiled artifact bytes\n')).toBe(false);
    expect(
      resolvesToPlaybook(
        '// export default function createPlaybookRuntime() {}\nexport const value = 1;',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'const decoy = "export default function createPlaybookRuntime() {}";',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook('export default function createPlaybookRuntime('),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'const createPlaybookRuntime = 42; export default createPlaybookRuntime;',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'const createPlaybookRuntime = Number(42); export default createPlaybookRuntime;',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'enum Mode { Run } export default function createPlaybookRuntime() {}',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'namespace Runtime { export const value = 1 } export default function createPlaybookRuntime() {}',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'class Runtime { constructor(public value: string) {} } export default function createPlaybookRuntime() {}',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'export default function createPlaybookRuntime() {} export default createPlaybookRuntime;',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'export default async function createPlaybookRuntime() {}',
      ),
    ).toBe(false);
    expect(
      resolvesToPlaybook('export default function* createPlaybookRuntime() {}'),
    ).toBe(false);
    expect(
      resolvesToPlaybook(
        'const createPlaybookRuntime = async () => ({}); export default createPlaybookRuntime;',
      ),
    ).toBe(false);
  });

  it('accepts an erasable angle-bracket assertion around the factory', () => {
    expect(
      resolvesToPlaybook(
        'type Factory = () => unknown; const createPlaybookRuntime = <Factory>(() => ({})); export default createPlaybookRuntime;',
      ),
    ).toBe(true);
  });
});

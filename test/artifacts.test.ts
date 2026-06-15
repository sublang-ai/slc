// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  artifactDir,
  artifactPath,
  parseSource,
  planArtifacts,
  SourceError,
} from '../src/artifacts.js';
import type { Phase } from '../src/phase.js';

const phase = (
  name: string,
  source: [string, string],
  target: [string, string],
): Phase => ({
  name,
  source: { format: source[0], ext: source[1] },
  target: { format: target[0], ext: target[1] },
});

describe('parseSource (PIPE-6)', () => {
  it('accepts the plain entry form', () => {
    expect(
      parseSource({
        path: 'flows/onboarding.md',
        sourceFormat: 'text',
        ext: '.md',
        entry: true,
      }),
    ).toEqual({ basename: 'onboarding', dir: 'flows' });
  });

  it('accepts the qualified entry form and strips the source format', () => {
    expect(
      parseSource({
        path: 'flows/onboarding.text.md',
        sourceFormat: 'text',
        ext: '.md',
        entry: true,
      }),
    ).toEqual({ basename: 'onboarding', dir: 'flows' });
  });

  it('accepts the qualified non-entry form', () => {
    expect(
      parseSource({
        path: 'flows/onboarding.playbook/onboarding.gears.md',
        sourceFormat: 'gears',
        ext: '.md',
        entry: false,
      }),
    ).toEqual({
      basename: 'onboarding',
      dir: join('flows', 'onboarding.playbook'),
    });
  });

  it('preserves dots within the basename', () => {
    expect(
      parseSource({
        path: 'my.flow.md',
        sourceFormat: 'text',
        ext: '.md',
        entry: true,
      }).basename,
    ).toBe('my.flow');
    expect(
      parseSource({
        path: 'my.flow.gears.md',
        sourceFormat: 'gears',
        ext: '.md',
        entry: false,
      }).basename,
    ).toBe('my.flow');
  });

  it('refuses the plain form for a non-entry phase', () => {
    expect(() =>
      parseSource({
        path: 'flows/onboarding.md',
        sourceFormat: 'gears',
        ext: '.md',
        entry: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-source-name' }));
  });

  it('refuses a wrong extension', () => {
    expect(() =>
      parseSource({
        path: 'onboarding.txt',
        sourceFormat: 'text',
        ext: '.md',
        entry: true,
      }),
    ).toThrow(SourceError);
  });
});

describe('artifactDir (PIPE-7)', () => {
  it('places artifacts in a canonical sibling directory', () => {
    expect(artifactDir('flows', 'onboarding', 'playbook')).toBe(
      join('flows', 'onboarding.playbook'),
    );
  });

  it('reuses the canonical directory without nesting', () => {
    const inside = join('flows', 'onboarding.playbook');
    expect(artifactDir(inside, 'onboarding', 'playbook')).toBe(inside);
  });
});

describe('artifactPath and planArtifacts (PIPE-8)', () => {
  const artDir = join('flows', 'onboarding.playbook');
  const chain = [
    phase('text2gears', ['text', '.md'], ['gears', '.md']),
    phase('gears2fsm', ['gears', '.md'], ['fsm', '.ts']),
  ];

  it('builds a <basename>.<format>.<ext> path', () => {
    expect(artifactPath(artDir, 'onboarding', 'gears', '.md')).toBe(
      join(artDir, 'onboarding.gears.md'),
    );
  });

  it('plans canonical intermediates and output', () => {
    const plan = planArtifacts({
      phases: chain,
      basename: 'onboarding',
      artDir,
    });
    expect(plan).toEqual([
      {
        phase: chain[0],
        role: 'intermediate',
        path: join(artDir, 'onboarding.gears.md'),
      },
      {
        phase: chain[1],
        role: 'output',
        path: join(artDir, 'onboarding.fsm.ts'),
      },
    ]);
  });

  it('lets -o override only the output, leaving intermediates canonical', () => {
    const plan = planArtifacts({
      phases: chain,
      basename: 'onboarding',
      artDir,
      output: join('out', 'custom.ts'),
    });
    expect(plan[0].path).toBe(join(artDir, 'onboarding.gears.md'));
    expect(plan[1]).toEqual({
      phase: chain[1],
      role: 'output',
      path: join('out', 'custom.ts'),
    });
  });

  it('treats a single phase target as the output', () => {
    const plan = planArtifacts({
      phases: [phase('text2fsm', ['text', '.md'], ['fsm', '.ts'])],
      basename: 'onboarding',
      artDir,
    });
    expect(plan).toEqual([
      {
        phase: expect.objectContaining({ name: 'text2fsm' }),
        role: 'output',
        path: join(artDir, 'onboarding.fsm.ts'),
      },
    ]);
  });
});

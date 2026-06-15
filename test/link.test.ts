// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LinkError,
  linkedArtifactPath,
  loadLinkFile,
  parseLinkPhase,
} from '../src/link.js';

const linkDoc = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | TypeScript module exporting a compatible runner. |

Required symbols:
- createRunner

Options:

| Name | Meaning |
| --- | --- |
| seed | Random seed. |

Validation:
Reject invocations with anything other than one object.
`;

describe('parseLinkPhase (PIPE-11, PIPE-19)', () => {
  it('reads formats, target forms, required symbols, options, and validation', () => {
    const link = parseLinkPhase(linkDoc);
    expect(link.source).toEqual({ format: 'fsm', ext: '.ts' });
    expect(link.target).toEqual({ format: 'run', ext: '.ts' });
    expect(link.targetForms).toEqual(['<path>.ts']);
    expect(link.requiredSymbols).toEqual(['createRunner']);
    expect(link.options).toEqual(['seed']);
    expect(link.validation).toContain('Reject invocations');
  });

  it('leaves optional blocks empty when absent', () => {
    const minimal = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | A runner module. |
`;
    const link = parseLinkPhase(minimal);
    expect(link.requiredSymbols).toEqual([]);
    expect(link.options).toEqual([]);
    expect(link.validation).toBeNull();
  });

  it('refuses a linked format token equal to the object source token (PIPE-19)', () => {
    const collide = linkDoc.replace(
      '| target | run | .ts |',
      '| target | fsm | .ts |',
    );
    expect(() => parseLinkPhase(collide)).toThrow(
      expect.objectContaining({ code: 'linked-format-collision' }),
    );
  });

  it('refuses a missing ## Link Targets section', () => {
    const noTargets = linkDoc.slice(0, linkDoc.indexOf('## Link Targets'));
    expect(() => parseLinkPhase(noTargets)).toThrow(
      expect.objectContaining({ code: 'missing-link-targets' }),
    );
  });

  it('refuses a ## Link Targets section with no target-form rows', () => {
    const emptyTargets = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

Required symbols:
- createRunner
`;
    expect(() => parseLinkPhase(emptyTargets)).toThrow(
      expect.objectContaining({ code: 'missing-link-targets' }),
    );
  });

  it('refuses a ## Link Targets table whose header is not "Target form"', () => {
    const wrongHeader = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Form | Meaning |
| --- | --- |
| <path>.ts | A runner module. |
`;
    expect(() => parseLinkPhase(wrongHeader)).toThrow(
      expect.objectContaining({ code: 'missing-link-targets' }),
    );
  });

  it('refuses a missing ## Formats section', () => {
    expect(() =>
      parseLinkPhase('## Link Targets\n\n| Target form |\n| --- |\n| x.ts |\n'),
    ).toThrow(expect.objectContaining({ code: 'missing-formats' }));
  });
});

describe('loadLinkFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-link-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads and parses a link.md from disk', async () => {
    const path = join(dir, 'link.md');
    await writeFile(path, linkDoc);
    const link = await loadLinkFile(path);
    expect(link.target.format).toBe('run');
  });
});

describe('linkedArtifactPath (PIPE-15, PIPE-18)', () => {
  const fsm = { format: 'fsm', ext: '.ts' };
  const playbook = { format: 'playbook', ext: '.ts' };

  it('places a full-pipeline linked artifact in the artifact directory', () => {
    const artDir = join('flows', 'onboarding.playbook');
    expect(
      linkedArtifactPath({
        kind: 'full',
        artDir,
        basename: 'onboarding',
        linked: playbook,
        output: null,
      }),
    ).toBe(join(artDir, 'onboarding.playbook.ts'));
  });

  it('lets -o override the full-pipeline linked artifact', () => {
    expect(
      linkedArtifactPath({
        kind: 'full',
        artDir: 'd',
        basename: 'onboarding',
        linked: playbook,
        output: 'out/app.ts',
      }),
    ).toBe('out/app.ts');
  });

  it('places a single-object .link artifact source-adjacent', () => {
    expect(
      linkedArtifactPath({
        kind: 'link',
        pipeline: 'playbook',
        objects: [join('flows', 'onboarding.playbook', 'onboarding.fsm.ts')],
        source: fsm,
        linked: playbook,
        output: null,
      }),
    ).toBe(join('flows', 'onboarding.playbook', 'onboarding.playbook.ts'));
  });

  it('requires -o for a multi-object .link', () => {
    expect(() =>
      linkedArtifactPath({
        kind: 'link',
        pipeline: 'playbook',
        objects: ['main.fsm.ts', 'helper.fsm.ts'],
        source: fsm,
        linked: playbook,
        output: null,
      }),
    ).toThrow(expect.objectContaining({ code: 'output-required' }));
  });

  it('uses -o for a multi-object .link', () => {
    expect(
      linkedArtifactPath({
        kind: 'link',
        pipeline: 'playbook',
        objects: ['main.fsm.ts', 'helper.fsm.ts'],
        source: fsm,
        linked: playbook,
        output: 'app.run.ts',
      }),
    ).toBe('app.run.ts');
  });

  it('is a LinkError type for the output-required failure', () => {
    try {
      linkedArtifactPath({
        kind: 'link',
        pipeline: 'p',
        objects: ['a.ts', 'b.ts'],
        source: fsm,
        linked: playbook,
        output: null,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LinkError);
    }
  });
});

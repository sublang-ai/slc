// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluatePins } from '../src/pin-currency.js';
import { generatePinRecord, writePinFile } from '../src/pin-generate.js';
import { PINS_FILE } from '../src/pins.js';

/** A compiled artifact that resolves to the linked `playbook` format (PIN-13). */
const PHASE_ARTIFACT =
  'export default function createPlaybookRuntime() {\n  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };\n}\n';

describe('pin generation (PIN-16)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-gen-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };

  const writeReviewedBundle = async (prefix = ''): Promise<void> => {
    const root = `${prefix}text2gears.slc/`;
    await write(`${root}text2gears.playbook.ts`, PHASE_ARTIFACT);
    for (const name of [
      'text2gears.fsm.ts',
      'text2gears.gears.md',
      'text2gears.gears-fsm.test.ts',
      'text2gears.fsm.introspect.test.ts',
      'text2gears.prompt-contract.test.ts',
      'text2gears.fsm.coverage.test.ts',
    ]) {
      await write(`${root}${name}`, `fixture: ${name}\n`);
    }
  };

  const writePackage = async (
    root: string,
    version: string,
    implementation: string,
  ): Promise<void> => {
    await write(
      `${root}/package.json`,
      `${JSON.stringify({ name: 'pkg', version, main: 'index.js' })}\n`,
    );
    await write(`${root}/index.js`, implementation);
  };

  /** Writes a phase whose definition cites one semantic input and a link target. */
  const writeFixture = async (): Promise<void> => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write('reference/gears.md', 'gears reference body\n');
    await writeReviewedBundle();
    await write('link/code.ts', 'link target bytes\n');
    await writePackage(
      'node_modules/pkg',
      '1.0.0',
      'export const version = 1;\n',
    );
  };

  const spec = {
    definition: 'text2gears.md',
    artifact: 'text2gears.slc/text2gears.playbook.ts',
    artifactBundle: 'text2gears.slc',
    linkTarget: { kind: 'file' as const, locator: 'link/code.ts' },
    runtimeDependencies: [
      {
        kind: 'package' as const,
        locator: 'node_modules/pkg',
        provenance: 'pkg@1',
        specifier: 'pkg',
      },
    ],
    roles: { 'reference/gears.md': 'reference' },
  };

  it('generates a record whose closure and link identity validate as current', async () => {
    await writeFixture();
    const record = await generatePinRecord(dir, spec);
    await writePinFile(dir, { text2gears: record });

    const result = await evaluatePins(dir);
    expect(result.path).toBe(join(dir, PINS_FILE));
    expect(result.verdicts?.text2gears).toEqual({ status: 'current' });
  });

  it('records the definition, enumerated closure, and link-target identity', async () => {
    await writeFixture();
    const record = await generatePinRecord(dir, spec);

    expect(record.definition.path).toBe('text2gears.md');
    expect(record.definition.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(record.semanticInputs).toEqual([
      {
        path: 'reference/gears.md',
        hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        role: 'reference',
      },
    ]);
    expect(record.linkTarget).toMatchObject({
      kind: 'file',
      locator: 'link/code.ts',
      identity: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(record.externalInputs).toEqual([]);
    expect(record.runtimeDependencies).toEqual([
      {
        kind: 'package',
        locator: 'node_modules/pkg',
        identity: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        provenance: 'pkg@1',
        specifier: 'pkg',
      },
    ]);
    expect(record.artifactBundle).toEqual({
      path: 'text2gears.slc',
      hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it('reports a generated pin stale when its runtime dependency drifts', async () => {
    await writeFixture();
    const record = await generatePinRecord(dir, spec);
    await writePinFile(dir, { text2gears: record });

    await write('node_modules/pkg/index.js', 'export const version = 2;\n');

    expect((await evaluatePins(dir)).verdicts?.text2gears).toMatchObject({
      status: 'stale',
      reason: expect.stringMatching(
        /runtimeDependencies\[0\] changed/,
      ) as string,
    });
  });

  it.each([
    [
      'with a manifest',
      true,
      /runtimeDependencies\[0\] (?:resolution changed|import no longer resolves)/,
    ],
    [
      'without a manifest',
      false,
      /runtimeDependencies\[0\] (?:resolution changed|import no longer resolves)/,
    ],
  ])(
    'reports stale when a nearer package %s shadows the pinned dependency',
    async (_label, withManifest, reason) => {
      const pipelineDir = join(dir, 'pipelines', 'playbook');
      await write('pipelines/playbook/text2gears.md', '# definition\n');
      await writeReviewedBundle('pipelines/playbook/');
      await write('pipelines/playbook/link/code.ts', 'link target bytes\n');
      await writePackage(
        'node_modules/pkg',
        '1.0.0',
        'export const selected = "root";\n',
      );
      const boundary = { boundary: '../..' };
      const record = await generatePinRecord(
        pipelineDir,
        {
          definition: 'text2gears.md',
          artifact: 'text2gears.slc/text2gears.playbook.ts',
          artifactBundle: 'text2gears.slc',
          linkTarget: { kind: 'file', locator: 'link/code.ts' },
          runtimeDependencies: [
            {
              kind: 'package',
              locator: '../../node_modules/pkg',
              specifier: 'pkg',
            },
          ],
        },
        boundary,
      );
      await writePinFile(pipelineDir, { text2gears: record }, boundary);
      expect((await evaluatePins(pipelineDir)).verdicts?.text2gears).toEqual({
        status: 'current',
      });

      if (withManifest) {
        await writePackage(
          'pipelines/playbook/node_modules/pkg',
          '1.0.0',
          'export const selected = "shadow";\n',
        );
      } else {
        await write(
          'pipelines/playbook/node_modules/pkg/index.js',
          'export const selected = "manifestless-shadow";\n',
        );
      }

      expect(
        (await evaluatePins(pipelineDir)).verdicts?.text2gears,
      ).toMatchObject({
        status: 'stale',
        reason: expect.stringMatching(reason) as string,
      });
    },
  );

  it('writes a well-formed pin file the validator re-reads', async () => {
    await writeFixture();
    await writePinFile(dir, { text2gears: await generatePinRecord(dir, spec) });

    const parsed = JSON.parse(await readFile(join(dir, PINS_FILE), 'utf8'));
    expect(parsed.schema).toBe('sublang.slc.pins.v2');
    expect(parsed.pins.text2gears.artifact.path).toBe(
      'text2gears.slc/text2gears.playbook.ts',
    );
  });

  it('rejects an artifact outside its reviewed bundle', async () => {
    await writeFixture();
    await write('standalone.playbook.ts', PHASE_ARTIFACT);
    await expect(
      generatePinRecord(dir, {
        ...spec,
        artifact: 'standalone.playbook.ts',
      }),
    ).rejects.toThrow(/child of artifactBundle/);
  });

  it('rejects a nested artifact inside its reviewed bundle', async () => {
    await writeFixture();
    await write('text2gears.slc/nested/text2gears.playbook.ts', PHASE_ARTIFACT);
    await expect(
      generatePinRecord(dir, {
        ...spec,
        artifact: 'text2gears.slc/nested/text2gears.playbook.ts',
      }),
    ).rejects.toThrow(/direct child/);
  });

  it('pins a link target outside the pipeline directory under a widened boundary', async () => {
    // The pipeline directory sits two levels below a repo-like root; the link
    // target (an installed package module) sits outside it (PIN-15, DR-007).
    const pipelineDir = join(dir, 'pipelines', 'playbook');
    await write('pipelines/playbook/text2gears.md', '# def\n');
    await writeReviewedBundle('pipelines/playbook/');
    await write('node_modules/pkg/runtime.ts', 'export type Contract = 1;\n');

    const boundary = { boundary: '../..' };
    const record = await generatePinRecord(
      pipelineDir,
      {
        definition: 'text2gears.md',
        artifact: 'text2gears.slc/text2gears.playbook.ts',
        artifactBundle: 'text2gears.slc',
        linkTarget: {
          kind: 'file' as const,
          locator: '../../node_modules/pkg/runtime.ts',
        },
      },
      boundary,
    );
    await writePinFile(pipelineDir, { text2gears: record }, boundary);

    const result = await evaluatePins(pipelineDir);
    expect(result.verdicts?.text2gears).toEqual({ status: 'current' });

    // The widened boundary still validates currency: a changed target is stale.
    await write('node_modules/pkg/runtime.ts', 'export type Contract = 2;\n');
    const drifted = await evaluatePins(pipelineDir);
    expect(drifted.verdicts?.text2gears).toMatchObject({
      status: 'stale',
      reason: expect.stringMatching(/linkTarget changed/) as string,
    });
  });
});

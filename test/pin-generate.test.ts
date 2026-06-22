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

  /** Writes a phase whose definition cites one semantic input and a link target. */
  const writeFixture = async (): Promise<void> => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write('reference/gears.md', 'gears reference body\n');
    await write('text2gears.phase.ts', PHASE_ARTIFACT);
    await write('link/code.ts', 'link target bytes\n');
  };

  const spec = {
    definition: 'text2gears.md',
    artifact: 'text2gears.phase.ts',
    linkTarget: { kind: 'file' as const, locator: 'link/code.ts' },
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
  });

  it('writes a well-formed pin file the validator re-reads', async () => {
    await writeFixture();
    await writePinFile(dir, { text2gears: await generatePinRecord(dir, spec) });

    const parsed = JSON.parse(await readFile(join(dir, PINS_FILE), 'utf8'));
    expect(parsed.schema).toBe('sublang.slc.pins.v1');
    expect(parsed.pins.text2gears.artifact.path).toBe('text2gears.phase.ts');
  });
});

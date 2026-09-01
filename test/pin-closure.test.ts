// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closureMatchesRecord,
  deriveClosure,
  parsePinInputs,
} from '../src/pin-closure.js';
import { PIN_INPUTS_FILE, PIN_INPUTS_SCHEMA } from '../src/pin-inputs.js';
import type { PinRecord } from '../src/pins.js';

const H = `sha256:${'a'.repeat(64)}`;

const record = (definition: string, semanticInputs: string[]): PinRecord => ({
  artifact: { path: 'a.phase.ts', hash: H },
  artifactBundle: { path: 'a.phase', hash: H },
  definition: { path: definition, hash: H },
  semanticInputs: semanticInputs.map((path) => ({ path, hash: H })),
  externalInputs: [],
  runtimeDependencies: [],
  linkTarget: { kind: 'file', locator: 'x', identity: H },
});

describe('parsePinInputs (pinning-4)', () => {
  it('extracts inline-code paths from the ## Pin Inputs section only', () => {
    const md = [
      '# Title',
      '',
      '## Pin Inputs',
      '',
      '- `reference/gears.md`',
      '- `reference/base.md`',
      '',
      '## Other',
      '- `not-an-input.md`',
    ].join('\n');

    expect(parsePinInputs(md)).toEqual([
      'reference/gears.md',
      'reference/base.md',
    ]);
  });

  it('returns [] when there is no Pin Inputs section', () => {
    expect(parsePinInputs('# Title\n\nbody only\n')).toEqual([]);
  });
});

describe('deriveClosure (pinning-2, pinning-4)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-closure-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };

  const writeSidecar = async (
    closures: Record<string, string[]>,
    base = '',
  ): Promise<void> => {
    await write(
      `${base}${PIN_INPUTS_FILE}`,
      JSON.stringify({ schema: PIN_INPUTS_SCHEMA, closures }),
    );
  };

  it('derives the transitive closure across Markdown Pin Inputs', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write(
      'reference/gears.md',
      '## Pin Inputs\n\n- `reference/base.md`\n',
    );
    await write('reference/base.md', 'no section here\n');

    expect(await deriveClosure(dir, '.', 'text2gears.md')).toEqual(
      new Set([
        resolve(dir, 'text2gears.md'),
        resolve(dir, 'reference/gears.md'),
        resolve(dir, 'reference/base.md'),
      ]),
    );
  });

  it('terminates at non-Markdown inputs and sectionless Markdown inputs', async () => {
    await write(
      'text2gears.md',
      '## Pin Inputs\n\n- `data.json`\n- `plain.md`\n',
    );
    // Non-Markdown: a member, but its citation-shaped content is not parsed.
    await write('data.json', '## Pin Inputs\n- `ignored.md`\n');
    // Markdown without the section: a member, no recursion.
    await write('plain.md', 'just prose, no section\n');

    expect(await deriveClosure(dir, '.', 'text2gears.md')).toEqual(
      new Set([
        resolve(dir, 'text2gears.md'),
        resolve(dir, 'data.json'),
        resolve(dir, 'plain.md'),
      ]),
    );
  });

  it('terminates on a citation cycle', async () => {
    await write('a.md', '## Pin Inputs\n\n- `b.md`\n');
    await write('b.md', '## Pin Inputs\n\n- `a.md`\n');

    expect(await deriveClosure(dir, '.', 'a.md')).toEqual(
      new Set([resolve(dir, 'a.md'), resolve(dir, 'b.md')]),
    );
  });

  it('includes a cited file that does not exist on disk', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/missing.md`\n');

    expect(await deriveClosure(dir, '.', 'text2gears.md')).toEqual(
      new Set([
        resolve(dir, 'text2gears.md'),
        resolve(dir, 'reference/missing.md'),
      ]),
    );
  });

  it('uses a phase sidecar entry as the authoritative flattened closure', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `inline.md`\n');
    await write('inline.md', 'inline input\n');
    await write('declared.md', '## Pin Inputs\n\n- `must-not-expand.md`\n');
    await write('must-not-expand.md', 'transitive input\n');
    await writeSidecar({ text2gears: ['declared.md'] });

    expect(
      await deriveClosure(dir, '.', 'text2gears.md', 'text2gears'),
    ).toEqual(
      new Set([resolve(dir, 'text2gears.md'), resolve(dir, 'declared.md')]),
    );
  });

  it('treats a present empty sidecar entry as authoritative', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `inline.md`\n');
    await write('inline.md', 'inline input\n');
    await writeSidecar({ text2gears: [] });

    expect(
      await deriveClosure(dir, '.', 'text2gears.md', 'text2gears'),
    ).toEqual(new Set([resolve(dir, 'text2gears.md')]));
  });

  it('falls back to inline derivation when the phase key is absent', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `inline.md`\n');
    await write('inline.md', 'inline input\n');
    await writeSidecar({ link: [] });

    expect(
      await deriveClosure(dir, '.', 'text2gears.md', 'text2gears'),
    ).toEqual(
      new Set([resolve(dir, 'text2gears.md'), resolve(dir, 'inline.md')]),
    );
  });

  it('keeps an explicit Markdown reference inline-declared', async () => {
    await write('reference.md', '## Pin Inputs\n\n- `inline.md`\n');
    await write('inline.md', 'inline input\n');
    await write('sidecar.md', 'sidecar input\n');
    await writeSidecar({ reference: ['sidecar.md'] });

    expect(await deriveClosure(dir, '.', 'reference.md')).toEqual(
      new Set([resolve(dir, 'reference.md'), resolve(dir, 'inline.md')]),
    );
  });

  it('derives a sidecar closure for a matching definition outside the pipeline directory', async () => {
    const pipelineDir = join(dir, 'pipelines', 'playbook');
    await write(
      'node_modules/@sublang/playbook/slc/text2gears.md',
      '# Package definition\n',
    );
    await write('package-lock.json', '{}\n');
    await writeSidecar(
      { text2gears: ['../../package-lock.json'] },
      'pipelines/playbook/',
    );

    expect(
      await deriveClosure(
        pipelineDir,
        '../..',
        '../../node_modules/@sublang/playbook/slc/text2gears.md',
        'text2gears',
      ),
    ).toEqual(
      new Set([
        resolve(dir, 'node_modules/@sublang/playbook/slc/text2gears.md'),
        resolve(dir, 'package-lock.json'),
      ]),
    );
  });

  it('rejects a sidecar member that resolves to the definition', async () => {
    await write('text2gears.md', '# Definition\n');
    await writeSidecar({ text2gears: ['./text2gears.md'] });

    await expect(
      deriveClosure(dir, '.', 'text2gears.md', 'text2gears'),
    ).rejects.toThrow(/definition or another closure member/);
  });
});

describe('closureMatchesRecord (pinning-4)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'slc-closure-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };

  const writeSidecar = async (
    closures: Record<string, string[]>,
  ): Promise<void> => {
    await write(
      PIN_INPUTS_FILE,
      JSON.stringify({ schema: PIN_INPUTS_SCHEMA, closures }),
    );
  };

  it('matches when the recorded closure equals the derived closure', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write('reference/gears.md', 'no section\n');

    expect(
      await closureMatchesRecord(
        dir,
        '.',
        record('text2gears.md', ['reference/gears.md']),
      ),
    ).toBe(true);
  });

  it('is a mismatch when the record omits a derived input', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `reference/gears.md`\n');
    await write('reference/gears.md', 'no section\n');

    expect(
      await closureMatchesRecord(dir, '.', record('text2gears.md', [])),
    ).toBe(false);
  });

  it('is a mismatch when the record adds an undeclared input', async () => {
    await write('text2gears.md', 'no pin inputs section\n');

    expect(
      await closureMatchesRecord(
        dir,
        '.',
        record('text2gears.md', ['reference/extra.md']),
      ),
    ).toBe(false);
  });

  it('matches the recorded closure against the selected sidecar phase', async () => {
    await write('text2gears.md', '## Pin Inputs\n\n- `inline.md`\n');
    await write('inline.md', 'inline input\n');
    await write('declared.md', 'sidecar input\n');
    await writeSidecar({ text2gears: ['declared.md'] });

    expect(
      await closureMatchesRecord(
        dir,
        '.',
        record('text2gears.md', ['declared.md']),
        'text2gears',
      ),
    ).toBe(true);
  });
});

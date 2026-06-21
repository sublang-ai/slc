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
import type { PinRecord } from '../src/pins.js';

const H = `sha256:${'a'.repeat(64)}`;

const record = (definition: string, semanticInputs: string[]): PinRecord => ({
  artifact: { path: 'a.phase.ts', hash: H },
  definition: { path: definition, hash: H },
  semanticInputs: semanticInputs.map((path) => ({ path, hash: H })),
  externalInputs: [],
  linkTarget: { kind: 'file', locator: 'x', identity: H },
});

describe('parsePinInputs (PIN-4)', () => {
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

describe('deriveClosure (PIN-2, PIN-4)', () => {
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
});

describe('closureMatchesRecord (PIN-4)', () => {
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
});

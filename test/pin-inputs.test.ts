// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadPinInputsFile,
  parsePinInputsFile,
  PIN_INPUTS_FILE,
  PIN_INPUTS_SCHEMA,
} from '../src/pin-inputs.js';

describe('pin-input sidecar parsing and loading (pinning-18)', () => {
  let root: string;
  let pipelineDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-pin-inputs-'));
    pipelineDir = join(root, 'pipelines', 'playbook');
    await mkdir(pipelineDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const write = async (rel: string, content: string): Promise<void> => {
    const path = join(root, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  };

  const source = (closures: Record<string, unknown>): string =>
    JSON.stringify({ schema: PIN_INPUTS_SCHEMA, closures });

  const malformedCases: Array<[string, string, RegExp]> = [
    ['invalid JSON', '{ nope', /valid JSON/],
    [
      'unsupported schema',
      JSON.stringify({ schema: 'other', closures: {} }),
      /schema/,
    ],
    [
      'unknown field',
      JSON.stringify({
        schema: PIN_INPUTS_SCHEMA,
        closures: {},
        extra: true,
      }),
      /extra/,
    ],
    [
      'wrong closures type',
      JSON.stringify({ schema: PIN_INPUTS_SCHEMA, closures: [] }),
      /closures/,
    ],
    ['non-portable phase key', source({ 'bad/name': [] }), /bad\/name/],
    [
      'duplicate literal path',
      source({ text2gears: ['input.md', 'input.md'] }),
      /duplicates closure path/,
    ],
    ['empty path', source({ text2gears: [''] }), /text2gears\[0\]/],
    [
      'absolute path',
      source({ text2gears: ['/tmp/input'] }),
      /text2gears\[0\]/,
    ],
    [
      'backslash path',
      source({ text2gears: ['reference\\input.md'] }),
      /text2gears\[0\]/,
    ],
  ];

  it('parses portable phase closures and an authoritative empty closure', () => {
    const parsed = parsePinInputsFile(
      source({
        text2gears: ['../../package-lock.json'],
        link: [],
      }),
    );

    expect(parsed.schema).toBe(PIN_INPUTS_SCHEMA);
    expect(parsed.closures.text2gears).toEqual(['../../package-lock.json']);
    expect(parsed.closures.link).toEqual([]);
  });

  it('returns no declaration when the sidecar is absent', async () => {
    await expect(loadPinInputsFile(pipelineDir, '../..')).resolves.toEqual({});
  });

  it('loads a regular sidecar and validates every path inside its boundary', async () => {
    await write('package-lock.json', '{}\n');
    await write(
      `pipelines/playbook/${PIN_INPUTS_FILE}`,
      source({ text2gears: ['../../package-lock.json'] }),
    );

    const loaded = await loadPinInputsFile(pipelineDir, '../..');
    expect(loaded.path).toBe(join(pipelineDir, PIN_INPUTS_FILE));
    expect(loaded.file?.closures.text2gears).toEqual([
      '../../package-lock.json',
    ]);
  });

  it.each(malformedCases)('rejects %s', (_label, declaration, diagnostic) => {
    expect(() => parsePinInputsFile(declaration)).toThrow(diagnostic);
  });

  it('rejects a closure path that escapes the supplied boundary', async () => {
    await write(
      `pipelines/playbook/${PIN_INPUTS_FILE}`,
      source({ text2gears: ['../../../outside.md'] }),
    );

    await expect(loadPinInputsFile(pipelineDir, '../..')).rejects.toThrow(
      /text2gears\[0\].*escapes the path boundary/,
    );
  });

  it('rejects a symbolic-link sidecar', async () => {
    await write('declaration.json', source({ text2gears: [] }));
    await symlink(
      join(root, 'declaration.json'),
      join(pipelineDir, PIN_INPUTS_FILE),
    );

    await expect(loadPinInputsFile(pipelineDir, '../..')).rejects.toThrow(
      /regular non-symbolic-link file/,
    );
  });
});

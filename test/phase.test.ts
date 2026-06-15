// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import {
  checkExtensionConsistency,
  parsePhase,
  PhaseError,
  type Phase,
} from '../src/phase.js';

const text2gears = `# text2gears

## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | text | .md |
| target | gears | .md |

## Rules

Transform prose into GEARS.
`;

const gears2fsm = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | gears | .md |
| target | fsm | .ts |
`;

describe('parsePhase (PIPE-1, PIPE-2)', () => {
  it('reads the source and target declarations from ## Formats', () => {
    const phase = parsePhase({ name: 'text2gears.md', content: text2gears });
    expect(phase).toEqual<Phase>({
      name: 'text2gears',
      source: { format: 'text', ext: '.md' },
      target: { format: 'gears', ext: '.md' },
    });
  });

  it('supports differing source and target extensions', () => {
    const phase = parsePhase({ name: 'gears2fsm.md', content: gears2fsm });
    expect(phase.source).toEqual({ format: 'gears', ext: '.md' });
    expect(phase.target).toEqual({ format: 'fsm', ext: '.ts' });
  });

  it('tolerates whitespace, header, and separator variations in the table', () => {
    const content = `## Formats

|Role|Format|Extension|
|:---|:---:|---:|
|  source  |  text  |  .md  |
| target | gears | .md |
`;
    const phase = parsePhase({ name: 'text2gears.md', content });
    expect(phase.source.format).toBe('text');
    expect(phase.target.format).toBe('gears');
  });

  it('refuses a phase with no ## Formats section', () => {
    expect(() =>
      parsePhase({ name: 'text2gears.md', content: '# nope\n' }),
    ).toThrow(expect.objectContaining({ code: 'missing-formats' }));
  });

  it('refuses a phase missing a role row', () => {
    const content = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | text | .md |
`;
    expect(() => parsePhase({ name: 'text2gears.md', content })).toThrow(
      expect.objectContaining({ code: 'missing-role' }),
    );
  });

  it('refuses a malformed format token', () => {
    const content = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | Text! | .md |
| target | gears | .md |
`;
    expect(() => parsePhase({ name: 'text2gears.md', content })).toThrow(
      expect.objectContaining({ code: 'malformed-formats' }),
    );
  });

  it('refuses an extension without a leading dot', () => {
    const content = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | text | md |
| target | gears | .md |
`;
    expect(() => parsePhase({ name: 'text2gears.md', content })).toThrow(
      expect.objectContaining({ code: 'malformed-formats' }),
    );
  });

  it('refuses a filename whose tokens do not match the table (PIPE-2)', () => {
    expect(() =>
      parsePhase({ name: 'text2fsm.md', content: text2gears }),
    ).toThrow(expect.objectContaining({ code: 'filename-mismatch' }));
  });

  it('refuses a non-.md phase filename (PIPE-2)', () => {
    expect(() =>
      parsePhase({ name: 'text2gears.txt', content: text2gears }),
    ).toThrow(PhaseError);
  });
});

describe('checkExtensionConsistency (PIPE-3)', () => {
  const phase = (
    name: string,
    source: Phase['source'],
    target: Phase['target'],
  ): Phase => ({
    name,
    source,
    target,
  });

  it('accepts phases that agree on each format token', () => {
    const phases = [
      phase(
        'text2gears',
        { format: 'text', ext: '.md' },
        { format: 'gears', ext: '.md' },
      ),
      phase(
        'gears2fsm',
        { format: 'gears', ext: '.md' },
        { format: 'fsm', ext: '.ts' },
      ),
    ];
    expect(() => checkExtensionConsistency(phases)).not.toThrow();
  });

  it('refuses phases that declare conflicting extensions for one token', () => {
    const phases = [
      phase(
        'text2gears',
        { format: 'text', ext: '.md' },
        { format: 'gears', ext: '.md' },
      ),
      phase(
        'gears2fsm',
        { format: 'gears', ext: '.txt' },
        { format: 'fsm', ext: '.ts' },
      ),
    ];
    expect(() => checkExtensionConsistency(phases)).toThrow(
      expect.objectContaining({ code: 'extension-conflict' }),
    );
  });
});

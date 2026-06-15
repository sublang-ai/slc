// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { findSection, parseTable } from '../src/markdown.js';

const doc = `# Title

## Formats

| Role | Format |
| --- | --- |
| source | text |

## Next

after
`;

describe('findSection', () => {
  it('returns the lines under a heading up to the next heading', () => {
    expect(findSection(doc, 'Formats')).toEqual([
      '',
      '| Role | Format |',
      '| --- | --- |',
      '| source | text |',
      '',
    ]);
  });

  it('matches case-insensitively and ignores heading level', () => {
    expect(findSection('### formats\n| a | b |\n', 'Formats')).toEqual([
      '| a | b |',
      '',
    ]);
  });

  it('returns null when the heading is absent', () => {
    expect(findSection(doc, 'Missing')).toBeNull();
  });
});

describe('parseTable', () => {
  it('returns cell rows and drops the separator row', () => {
    expect(
      parseTable(['| Role | Format |', '| --- | --- |', '| source | text |']),
    ).toEqual([
      ['Role', 'Format'],
      ['source', 'text'],
    ]);
  });

  it('ignores non-table lines', () => {
    expect(parseTable(['prose', '| a | b |', ''])).toEqual([['a', 'b']]);
  });
});

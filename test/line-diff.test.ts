// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { unifiedLineDiff } from '../src/line-diff.js';

describe('unifiedLineDiff (INCR-14)', () => {
  it('returns the empty string for identical texts', () => {
    expect(unifiedLineDiff('a\nb\n', 'a\nb\n')).toBe('');
  });

  it('renders one hunk with context for a middle edit', () => {
    const prior = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n';
    const current = 'one\ntwo\nthree\nFOUR\nfive\nsix\nseven\neight\n';
    expect(unifiedLineDiff(prior, current)).toBe(
      [
        '@@ -1,7 +1,7 @@',
        ' one',
        ' two',
        ' three',
        '-four',
        '+FOUR',
        ' five',
        ' six',
        ' seven',
      ].join('\n'),
    );
  });

  it('merges nearby edits into one hunk and splits distant ones', () => {
    const base = Array.from({ length: 30 }, (_, i) => `line${i + 1}`);
    const changedNear = [...base];
    changedNear[4] = 'edited5';
    changedNear[8] = 'edited9';
    const near = unifiedLineDiff(`${base.join('\n')}\n`, `${changedNear.join('\n')}\n`);
    expect(near?.match(/@@/g)).toHaveLength(2); // one hunk, one @@ pair marker per hunk header

    const changedFar = [...base];
    changedFar[1] = 'editedA';
    changedFar[28] = 'editedB';
    const far = unifiedLineDiff(`${base.join('\n')}\n`, `${changedFar.join('\n')}\n`);
    expect(far?.match(/@@ /g)).toHaveLength(2); // two hunk headers
  });

  it('handles pure insertion at the start', () => {
    const diff = unifiedLineDiff('b\nc\n', 'a\nb\nc\n');
    expect(diff).toBe(['@@ -1,2 +1,3 @@', '+a', ' b', ' c'].join('\n'));
  });

  it('handles deletion to empty', () => {
    const diff = unifiedLineDiff('only\n', '');
    expect(diff).toBe(['@@ -1,1 +0,0 @@', '-only'].join('\n'));
  });

  it('handles text without a trailing newline', () => {
    const diff = unifiedLineDiff('a\nb', 'a\nc');
    expect(diff).toBe(['@@ -1,2 +1,2 @@', ' a', '-b', '+c'].join('\n'));
  });

  it('returns null for an unbounded one-sided change', () => {
    const added = Array.from({ length: 10_001 }, (_, i) => `new ${i}`).join(
      '\n',
    );
    expect(unifiedLineDiff('', added)).toBeNull();
    expect(unifiedLineDiff(`a\n${added}\nb\n`, 'a\nb\n')).toBeNull();
  });

  it('returns null past the cell budget', () => {
    // 2001 x 2001 unique-per-side middle exceeds 4M cells.
    const left = Array.from({ length: 2001 }, (_, i) => `L${i}`).join('\n');
    const right = Array.from({ length: 2001 }, (_, i) => `R${i}`).join('\n');
    expect(unifiedLineDiff(left, right)).toBeNull();
  });

  it('stays fast and exact on a large mostly-common text', () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => `line ${i}`);
    const edited = [...lines];
    edited[25_000] = 'edited';
    const diff = unifiedLineDiff(`${lines.join('\n')}\n`, `${edited.join('\n')}\n`);
    expect(diff).toContain('-line 25000');
    expect(diff).toContain('+edited');
  });
});

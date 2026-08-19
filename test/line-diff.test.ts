// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { unifiedLineDiff } from '../src/line-diff.js';

describe('unifiedLineDiff (INCR-15)', () => {
  it('returns an empty hint for identical text', () => {
    expect(unifiedLineDiff('same\n', 'same\n')).toBe('');
  });

  it('renders one bounded hunk around the changed middle', () => {
    expect(
      unifiedLineDiff(
        'one\ntwo\nthree\nold\nfive\nsix\nseven\neight\n',
        'one\ntwo\nthree\nnew\nfive\nsix\nseven\neight\n',
      ),
    ).toBe(
      '@@ -1,7 +1,7 @@\n one\n two\n three\n-old\n+new\n five\n six\n seven',
    );
  });

  it('does not erase a trailing-newline-only change', () => {
    expect(unifiedLineDiff('one\n', 'one')).toContain('-');
  });

  it('returns unavailable instead of rendering an oversized prompt', () => {
    expect(unifiedLineDiff(`${'a'.repeat(70_000)}\n`, 'small\n')).toBeNull();
  });
});

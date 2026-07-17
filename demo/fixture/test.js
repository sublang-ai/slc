// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Plain-node test for the demo fixture: `node test.js` exits non-zero while
// the median bug is present and zero once it is fixed.

import assert from 'node:assert/strict';

import { mean, median } from './stats.js';

assert.equal(mean([1, 2, 3]), 2);
assert.equal(median([2]), 2);
assert.equal(median([3, 1, 2]), 2, 'median must not depend on element order');
assert.equal(
  median([4, 1, 3, 2]),
  2.5,
  'even-length median is the mean of the two middle values',
);

const input = [3, 1, 2];
median(input);
assert.deepEqual(input, [3, 1, 2], 'median must not mutate its input');

console.log('stats.js: all checks passed');

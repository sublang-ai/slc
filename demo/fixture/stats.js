// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Tiny statistics helpers for the slc/playbook demo.
 *
 * Known defect (the demo's bug-fix task): `median` ignores element order and
 * even-length arrays, so `median([3, 1, 2])` and `median([4, 1, 3, 2])` are
 * both wrong.
 */

export function mean(values) {
  if (values.length === 0) throw new RangeError('mean of an empty array');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
  if (values.length === 0) throw new RangeError('median of an empty array');
  return values[Math.floor(values.length / 2)];
}

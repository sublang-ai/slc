// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { name, run, version } from '../src/index.js';

describe('slc scaffold', () => {
  it('exposes its name', () => {
    expect(name).toBe('slc');
  });

  it('reports a semver version', () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints the version with --version and exits 0', () => {
    expect(run(['--version'])).toBe(0);
  });

  it('exits non-zero when no command is given', () => {
    expect(run([])).toBe(1);
  });
});

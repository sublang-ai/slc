// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { name, run, version } from '../src/index.js';

describe('slc bin entry', () => {
  it('exposes its name', () => {
    expect(name).toBe('slc');
  });

  it('reports a semver version', () => {
    expect(version()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('prints the version with --version and exits 0 (CLI-1)', async () => {
    const out: string[] = [];
    const code = await run(['--version'], {
      env: {},
      stdout: (text) => out.push(text),
    });
    expect(code).toBe(0);
    expect(out.join('')).toContain(version());
  });

  it('prints usage with --help and exits 0 (CLI-2)', async () => {
    const out: string[] = [];
    const code = await run(['--help'], {
      env: {},
      stdout: (text) => out.push(text),
    });
    expect(code).toBe(0);
    expect(out.join('')).toMatch(/Usage:/);
    expect(out.join('')).toContain('SLC_AGENT');
  });

  it('exits non-zero on a malformed invocation (CLI-4)', async () => {
    const err: string[] = [];
    const code = await run([], { env: {}, stderr: (text) => err.push(text) });
    expect(code).not.toBe(0);
    expect(err.join('')).not.toBe('');
  });
});

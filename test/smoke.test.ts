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

  it('exits non-zero naming SLC_AGENT when the agent is unset (CLI-12)', async () => {
    const err: string[] = [];
    const code = await run([], { env: {}, stderr: (text) => err.push(text) });
    expect(code).toBe(1);
    expect(err.join('')).toContain('SLC_AGENT');
  });

  it('maps a runSlc failure to a stderr report and non-zero exit (CLI-4, CLI-11)', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['missing', 'onboarding.md'], {
      env: {},
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      // Resolve to no pipeline directory so runSlc rejects the reference,
      // exercising the result-to-stderr failure mapping (not the config path).
      buildDeps: ({ signal }) => ({
        resolver: () => [],
        executor: { run: async () => ({ status: 'ok', diagnostics: [] }) },
        signal,
      }),
    });
    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('missing');
  });
});

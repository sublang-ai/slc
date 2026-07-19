// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  it('seeds the user config on a bare first run (CLI-29, DR-015)', async () => {
    // Pin cwd (and the XDG root) to an empty temp dir so this repo's committed
    // slc.config.yaml is not discovered: the first run seeds the user config,
    // then still refuses the empty invocation.
    const cwd = await mkdtemp(join(tmpdir(), 'slc-smoke-'));
    try {
      const err: string[] = [];
      const code = await run([], {
        env: { XDG_CONFIG_HOME: cwd },
        cwd,
        stderr: (text) => err.push(text),
      });
      expect(code).toBe(1);
      expect(err.join('')).toContain('seeded');
      expect(err.join('')).toContain(join(cwd, 'slc', 'config.yaml'));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONFIG_FILE,
  ConfigFileError,
  HOME_CONFIG,
  loadConfigFile,
} from '../src/config-file.js';

describe('loadConfigFile (CLI-20, CLI-21)', () => {
  let cwd: string;
  let home: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'slc-cfg-cwd-'));
    home = await mkdtemp(join(tmpdir(), 'slc-cfg-home-'));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  async function write(
    dir: string,
    rel: string,
    content: string,
  ): Promise<string> {
    const path = join(dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return path;
  }

  it('parses a full config into a partial selection', async () => {
    const path = await write(
      cwd,
      CONFIG_FILE,
      'agent: codex\nmodel: gpt-5.5\npipelinePath:\n  - ./pipes\n  - /abs/pipes\n',
    );

    const loaded = await loadConfigFile({ cwd, configHome: home });

    expect(loaded.path).toBe(path);
    expect(loaded.config).toEqual({
      agent: 'codex',
      model: 'gpt-5.5',
      pipelinePath: ['./pipes', '/abs/pipes'],
    });
  });

  it('discovers the cwd config in preference to the home config', async () => {
    const cwdPath = await write(cwd, CONFIG_FILE, 'agent: codex\n');
    await write(home, HOME_CONFIG, 'agent: gemini\n');

    const loaded = await loadConfigFile({ cwd, configHome: home });

    expect(loaded.path).toBe(cwdPath);
    expect(loaded.config.agent).toBe('codex');
  });

  it('falls back to the home config when the cwd has none', async () => {
    const homePath = await write(home, HOME_CONFIG, 'agent: gemini\n');

    const loaded = await loadConfigFile({ cwd, configHome: home });

    expect(loaded.path).toBe(homePath);
    expect(loaded.config.agent).toBe('gemini');
  });

  it('resolves the home config under XDG_CONFIG_HOME from the environment', async () => {
    const homePath = await write(home, HOME_CONFIG, 'agent: opencode\n');

    const loaded = await loadConfigFile({
      cwd,
      env: { XDG_CONFIG_HOME: home },
    });

    expect(loaded.path).toBe(homePath);
    expect(loaded.config.agent).toBe('opencode');
  });

  it('seeds and loads the user config on a discovery miss (CLI-30)', async () => {
    const seeded: string[] = [];
    const loaded = await loadConfigFile({
      cwd,
      configHome: home,
      onSeed: (path) => seeded.push(path),
    });

    const expected = join(home, 'slc', 'config.yaml');
    expect(loaded.path).toBe(expected);
    expect(loaded.config).toEqual({ agent: 'claude-code' });
    expect(seeded).toEqual([expected]);
  });

  it('does not seed when the working-directory file exists (CLI-30)', async () => {
    await write(cwd, CONFIG_FILE, 'agent: codex\n');
    const seeded: string[] = [];
    const loaded = await loadConfigFile({
      cwd,
      configHome: home,
      onSeed: (path) => seeded.push(path),
    });

    expect(loaded.config).toEqual({ agent: 'codex' });
    expect(seeded).toEqual([]);
    expect(existsSync(join(home, 'slc', 'config.yaml'))).toBe(false);
  });

  it('loads an explicit --config file and disables discovery', async () => {
    await write(cwd, CONFIG_FILE, 'agent: codex\n');
    const explicit = await write(cwd, 'custom.yaml', 'agent: gemini\n');

    const loaded = await loadConfigFile({
      cwd,
      configPath: explicit,
      configHome: home,
    });

    expect(loaded.path).toBe(explicit);
    expect(loaded.config.agent).toBe('gemini');
  });

  it('resolves a relative --config path against the cwd', async () => {
    const explicit = await write(cwd, 'custom.yaml', 'agent: gemini\n');

    const loaded = await loadConfigFile({
      cwd,
      configPath: 'custom.yaml',
      configHome: home,
    });

    expect(loaded.path).toBe(explicit);
    expect(loaded.config.agent).toBe('gemini');
  });

  it('errors when an explicit --config file is absent', async () => {
    await expect(
      loadConfigFile({ cwd, configPath: 'missing.yaml', configHome: home }),
    ).rejects.toMatchObject({ code: 'config-not-found' });
  });

  it('treats an empty or comment-only document as an empty config', async () => {
    const path = await write(cwd, CONFIG_FILE, '# just a comment\n');

    const loaded = await loadConfigFile({ cwd, configHome: home });

    expect(loaded.path).toBe(path);
    expect(loaded.config).toEqual({});
  });

  it('rejects malformed YAML', async () => {
    await write(cwd, CONFIG_FILE, 'agent: [unterminated\n');

    await expect(
      loadConfigFile({ cwd, configHome: home }),
    ).rejects.toMatchObject({ code: 'config-parse' });
  });

  it('rejects an unknown key', async () => {
    await write(cwd, CONFIG_FILE, 'agent: codex\nadapter: codex\n');

    await expect(
      loadConfigFile({ cwd, configHome: home }),
    ).rejects.toMatchObject({ code: 'config-invalid' });
  });

  it('rejects a non-mapping document', async () => {
    await write(cwd, CONFIG_FILE, '- codex\n- gemini\n');

    await expect(
      loadConfigFile({ cwd, configHome: home }),
    ).rejects.toMatchObject({ code: 'config-invalid' });
  });

  it('rejects a wrong-typed agent', async () => {
    await write(cwd, CONFIG_FILE, 'agent: 42\n');

    await expect(
      loadConfigFile({ cwd, configHome: home }),
    ).rejects.toMatchObject({ code: 'config-invalid' });
  });

  it('rejects a pipelinePath that is not a sequence', async () => {
    await write(cwd, CONFIG_FILE, 'pipelinePath: ./pipes\n');

    await expect(
      loadConfigFile({ cwd, configHome: home }),
    ).rejects.toMatchObject({ code: 'config-invalid' });
  });

  it('rejects a pipelinePath entry that is not a non-empty string', async () => {
    await write(cwd, CONFIG_FILE, 'pipelinePath:\n  - ./pipes\n  - ""\n');

    await expect(
      loadConfigFile({ cwd, configHome: home }),
    ).rejects.toBeInstanceOf(ConfigFileError);
  });
});

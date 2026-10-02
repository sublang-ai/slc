// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { expect, test } from 'vitest';
import { parse } from 'yaml';

const execFileAsync = promisify(execFile);
const repo = fileURLToPath(new URL('..', import.meta.url));
const hostRoot = join(repo, 'node_modules', '@sublang', 'playbook');

test('the supplied demo home lists both reference registries with explicit agent settings (release-24)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'slc-demo-onboarding-'));
  try {
    const spexHome = join(scratch, '.spex');
    const primary = join(spexHome, 'config', 'playbook.config.yaml');
    await mkdir(dirname(primary), { recursive: true });
    await copyFile(join(repo, 'demo', 'playbook.config.yaml'), primary);
    await cp(join(repo, 'demo', 'reference'), join(scratch, 'reference'), {
      recursive: true,
    });
    await copyFile(join(repo, 'demo', 'sample.c'), join(scratch, 'sample.c'));
    await copyFile(
      join(repo, 'demo', 'package.json'),
      join(scratch, 'package.json'),
    );
    await symlink(join(repo, 'node_modules'), join(scratch, 'node_modules'));
    await writeFile(join(scratch, '.gitignore'), 'node_modules/\n.spex/\n');
    const git = (args) => execFileAsync('git', args, { cwd: scratch });
    await git(['init', '--quiet']);
    await git(['add', '.']);
    await git([
      '-c',
      'user.name=Demo Participant',
      '-c',
      'user.email=demo@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'chore: Record demo baseline',
    ]);
    const baseline = (await git(['rev-parse', 'HEAD'])).stdout;
    expect((await git(['status', '--porcelain'])).stdout).toBe('');
    const config = parse(await readFile(primary, 'utf8'));
    expect(config.playbooks.workflow.roles).toEqual({
      coder: 'demo.coder',
      reviewer: 'demo.reviewer',
    });
    expect(config.playbooks['workflow.zh'].roles).toEqual({
      编码者: 'demo.coder',
      审查者: 'demo.reviewer',
    });
    for (const agent of [config.captain, ...Object.values(config.players)]) {
      expect(agent.model).toBe('claude-opus-5-5');
      expect(agent.effort).toBe('high');
      expect(agent.subagentModel).toBe('inherit');
      expect(agent.subagentEffort).toBe('high');
    }

    const manifest = JSON.parse(
      await readFile(join(hostRoot, 'package.json'), 'utf8'),
    );
    const bin = join(hostRoot, manifest.bin.playbook);
    const { stdout } = await execFileAsync(
      process.execPath,
      [bin, '--list', '--no-provision'],
      {
        cwd: scratch,
        env: {
          ...process.env,
          SPEX_HOME: spexHome,
          XDG_CONFIG_HOME: join(scratch, 'config'),
          XDG_STATE_HOME: join(scratch, 'state'),
        },
      },
    );
    expect(stdout).toContain('/workflow  workflow  —  ');
    expect(stdout).toContain('/workflow.zh  workflow.zh  —  ');
    // List validates the real registry/role boundary without creating an
    // agent session or changing the participant's configuration.
    expect(parse(await readFile(primary, 'utf8'))).toEqual(config);
    expect((await git(['rev-parse', 'HEAD'])).stdout).toBe(baseline);
    expect((await git(['status', '--porcelain'])).stdout).toBe('');
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

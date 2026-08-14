// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { access } from 'node:fs/promises';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  emitEntryModule,
  emitEntryModuleAtPaths,
} from '../src/entry-module.js';

describe('stage-capable entry emission (SELFHOST-17)', () => {
  let root: string;
  let gearsPath: string;
  let textPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-entry-paths-'));
    gearsPath = join(root, 'flow.gears.md');
    textPath = join(root, 'flow.text.md');
    await writeFile(
      gearsPath,
      'Players:\n\n- Writer\n\n## Behaviors\n',
      'utf8',
    );
    await writeFile(textPath, '# Flow\n\nLead line.\n', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('writes only the candidate path with canonical bytes and no staging locator', async () => {
    const canonicalEntry = await emitEntryModule({
      cwd: root,
      basename: 'flow',
      pipeline: 'playbook',
      gearsPath,
      textPath,
    });
    const canonicalBytes = await readFile(canonicalEntry, 'utf8');
    await unlink(canonicalEntry);

    const candidateDir = join(root, '.slc-stage-candidate');
    const candidateEntry = join(candidateDir, 'entry.ts');
    await mkdir(candidateDir);
    expect(
      await emitEntryModuleAtPaths({
        basename: 'flow',
        gearsPath,
        textPath,
        outputPath: candidateEntry,
        logicalEntryPath: canonicalEntry,
        logicalBundlePath: join(root, 'flow.playbook'),
      }),
    ).toBe(candidateEntry);

    await expect(access(canonicalEntry)).rejects.toThrow();
    const candidateBytes = await readFile(candidateEntry, 'utf8');
    expect(candidateBytes).toBe(canonicalBytes);
    expect(candidateBytes).toContain(
      "import createPlaybookRuntime from './flow.playbook/flow.playbook.ts'",
    );
    expect(candidateBytes).not.toContain('.slc-stage-candidate');
  });

  it('derives imports from logical paths and preserves collision failure', async () => {
    const candidateDir = join(root, '.candidate');
    const candidateEntry = join(candidateDir, 'flow.ts');
    await mkdir(candidateDir);
    await emitEntryModuleAtPaths({
      basename: 'flow',
      gearsPath,
      textPath,
      outputPath: candidateEntry,
      logicalEntryPath: join(root, 'registry', 'flow.ts'),
      logicalBundlePath: join(root, 'artifacts', 'flow.playbook'),
    });
    expect(await readFile(candidateEntry, 'utf8')).toContain(
      "import createPlaybookRuntime from '../artifacts/flow.playbook/flow.playbook.ts'",
    );

    await writeFile(
      gearsPath,
      'Players:\n\n- Writer\n- writer\n\n## Behaviors\n',
      'utf8',
    );
    const rejectedPath = join(candidateDir, 'rejected.ts');
    await expect(
      emitEntryModuleAtPaths({
        basename: 'flow',
        gearsPath,
        textPath,
        outputPath: rejectedPath,
        logicalEntryPath: join(root, 'flow.ts'),
        logicalBundlePath: join(root, 'flow.playbook'),
      }),
    ).rejects.toThrow(/collide case-insensitively/);
    await expect(access(rejectedPath)).rejects.toThrow();
  });

  it('prefixes a hidden sibling bundle with an explicit relative marker', async () => {
    const outputPath = join(root, 'candidate', '.flow.ts');
    await mkdir(join(root, 'candidate'));
    await emitEntryModuleAtPaths({
      basename: '.flow',
      gearsPath,
      textPath,
      outputPath,
      logicalEntryPath: join(root, '.flow.ts'),
      logicalBundlePath: join(root, '.flow.playbook'),
    });

    expect(await readFile(outputPath, 'utf8')).toContain(
      "import createPlaybookRuntime from './.flow.playbook/.flow.playbook.ts'",
    );
  });
});

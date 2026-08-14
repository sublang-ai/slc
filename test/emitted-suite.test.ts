// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runEmittedSuite,
  runMappedEmittedSuite,
  type EmittedSuiteCommand,
} from '../src/emitted-suite.js';
import { checkEmittedLoadIntegrity } from '../src/emitted-imports.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'slc-emitted-suite-'));
  roots.push(root);
  return root;
}

describe('emitted suite runner', () => {
  it('invokes a fixed no-shell command with exactly the supplied inventory', async () => {
    const root = await tempRoot();
    const first = join(root, 'one.test.ts');
    const second = join(root, 'two[1].test.ts');
    const cli = join(root, 'vitest.mjs');
    await Promise.all([
      writeFile(first, 'export {};\n'),
      writeFile(second, 'export {};\n'),
      writeFile(cli, 'export {};\n'),
    ]);
    let command: EmittedSuiteCommand | undefined;

    const result = await runEmittedSuite({
      cwd: root,
      testPaths: [second, first],
      vitestCliPath: cli,
      execute: async (received) => {
        command = received;
        return {
          exitCode: 0,
          signal: null,
          stdout: 'passed',
          stderr: '',
          error: null,
          aborted: false,
        };
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'passed',
      stdout: 'passed',
      diagnostics: [],
    });
    expect(command?.executable).toBe(process.execPath);
    expect(command?.cwd).toBe(root);
    expect(command?.args).not.toContain(second);
    expect(command?.args).not.toContain(first);
    expect(command?.env.SLC_EMITTED_SUITE_INCLUDE_V1).toBe(
      JSON.stringify(['two\\[1\\].test.ts', 'one.test.ts']),
    );
    expect(command?.args).toContain('--config');
    expect(command?.args).toContain('--root');
    expect(command?.args).toContain('--no-color');
  });

  it('returns structured failure and abort outcomes', async () => {
    const root = await tempRoot();
    const testPath = join(root, 'one.test.ts');
    const cli = join(root, 'vitest.mjs');
    await Promise.all([
      writeFile(testPath, 'export {};\n'),
      writeFile(cli, 'export {};\n'),
    ]);

    const failed = await runEmittedSuite({
      cwd: root,
      testPaths: [testPath],
      vitestCliPath: cli,
      execute: async () => ({
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: 'assertion failed',
        error: 'command failed',
        aborted: false,
      }),
    });
    expect(failed).toMatchObject({
      ok: false,
      status: 'failed',
      exitCode: 1,
      diagnostics: [
        'emitted verification suite failed',
        'assertion failed',
        'command failed',
      ],
    });

    let called = false;
    const aborted = await runEmittedSuite({
      cwd: root,
      testPaths: [testPath],
      vitestCliPath: cli,
      signal: AbortSignal.abort(),
      execute: async () => {
        called = true;
        throw new Error('must not run');
      },
    });
    expect(aborted).toMatchObject({ ok: false, status: 'aborted' });
    expect(called).toBe(false);
  });

  it('runs exactly an emitted passing suite through the production CLI', async () => {
    const root = await tempRoot();
    const testPath = join(root, 'generated.test.ts');
    const prefixCollision = join(root, 'generated.test.ts-evil.test.ts');
    await writeFile(
      testPath,
      [
        "import { describe, expect, it } from 'vitest';",
        "describe('generated', () => {",
        "  it('passes', () => expect(2 + 2).toBe(4));",
        '});',
        '',
      ].join('\n'),
    );
    await writeFile(
      prefixCollision,
      "import { it } from 'vitest'; it('must not run', () => { throw new Error('unrecorded test ran'); });\n",
    );

    const result = await runEmittedSuite({
      cwd: root,
      testPaths: [testPath],
    });
    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/1 passed/);
  });

  it('executes mapped retained inputs from one private NodeNext view', async () => {
    const root = await tempRoot();
    const logicalRoot = join(root, 'canonical');
    const logicalTest = join(logicalRoot, 'generated.test.ts');
    const logicalSource = join(logicalRoot, 'dep.ts');
    const logicalRuntime = join(logicalRoot, 'dep.js');
    const staged = join(root, 'staged');
    const retained = join(root, 'retained');
    const viewParent = join(root, 'private');
    await Promise.all([mkdir(staged), mkdir(retained), mkdir(viewParent)]);
    const physicalTest = join(staged, 'generated.test.ts');
    const physicalSource = join(retained, 'dep.ts');
    await writeFile(
      physicalTest,
      [
        "import { describe, expect, it } from 'vitest';",
        "import { value } from './dep.js';",
        "describe('mapped', () => {",
        "  it('uses retained bytes', () => expect(value).toBe(4));",
        '});',
        '',
      ].join('\n'),
    );
    await writeFile(physicalSource, 'export const value: number = 4;\n');
    await writeFile(
      join(staged, 'generated.test.ts-evil.test.ts'),
      "import { it } from 'vitest'; it('must not run', () => { throw new Error('unrecorded test ran'); });\n",
    );
    const before = await stat(physicalSource);
    const inventory = [
      { logicalPath: logicalTest, physicalPath: physicalTest },
      { logicalPath: logicalSource, physicalPath: physicalSource },
      { logicalPath: logicalRuntime, physicalPath: physicalSource },
    ];

    await expect(
      checkEmittedLoadIntegrity({ inventory, modules: [logicalTest] }),
    ).resolves.toEqual([]);
    const result = await runMappedEmittedSuite({
      inventory,
      logicalRoot,
      testPaths: [logicalTest],
      viewParent,
    });

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/1 passed/);
    expect(await readFile(physicalSource, 'utf8')).toBe(
      'export const value: number = 4;\n',
    );
    expect((await stat(physicalSource)).mtimeMs).toBe(before.mtimeMs);
    expect(await readdir(viewParent)).toEqual([]);
  });

  it('cleans the private mapped view after validation or runner failure', async () => {
    const root = await tempRoot();
    const logicalRoot = join(root, 'canonical');
    const logicalTest = join(logicalRoot, 'generated.test.ts');
    const physicalTest = join(root, 'generated.test.ts');
    const viewParent = join(root, 'private');
    const cli = join(root, 'vitest.mjs');
    await mkdir(viewParent);
    await writeFile(physicalTest, 'export {};\n');
    await writeFile(cli, 'export {};\n');

    const failed = await runMappedEmittedSuite({
      inventory: [{ logicalPath: logicalTest, physicalPath: physicalTest }],
      logicalRoot,
      testPaths: [logicalTest],
      viewParent,
      vitestCliPath: cli,
      execute: async () => ({
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: 'expected failure',
        error: 'command failed',
        aborted: false,
      }),
    });
    expect(failed).toMatchObject({ ok: false, status: 'failed' });
    expect(await readdir(viewParent)).toEqual([]);

    const invalid = await runMappedEmittedSuite({
      inventory: [{ logicalPath: logicalTest, physicalPath: physicalTest }],
      logicalRoot: join(logicalRoot, 'nested'),
      testPaths: [logicalTest],
      viewParent,
    });
    expect(invalid).toMatchObject({ ok: false, status: 'failed' });
    expect(invalid.diagnostics[0]).toMatch(/escapes logical root/u);
    expect(await readdir(viewParent)).toEqual([]);
  });

  it('refuses empty, duplicate, or non-file inventories before spawning', async () => {
    const root = await tempRoot();
    const testPath = join(root, 'generated.test.ts');
    await writeFile(testPath, 'export {};\n');
    let calls = 0;
    const execute = async () => {
      calls += 1;
      throw new Error('unexpected');
    };

    expect(
      await runEmittedSuite({ cwd: root, testPaths: [], execute }),
    ).toMatchObject({ ok: false, status: 'failed' });
    expect(
      await runEmittedSuite({
        cwd: root,
        testPaths: [testPath, testPath],
        execute,
      }),
    ).toMatchObject({ ok: false, status: 'failed' });
    expect(
      await runEmittedSuite({ cwd: root, testPaths: [root], execute }),
    ).toMatchObject({ ok: false, status: 'failed' });
    expect(calls).toBe(0);
  });
});

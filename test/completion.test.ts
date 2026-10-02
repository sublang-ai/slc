// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import {
  access,
  copyFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadBuildHistory, recordBuild } from '../src/build-history.js';
import { hashBytes } from '../src/hash.js';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repository, 'dist', 'cli.js');

describe('public retained-bundle completion (completion-6/7)', () => {
  let root: string;
  let cwd: string;
  let bundle: string;
  let name: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-completion-'));
    cwd = join(root, 'demo', 'reference');
    await mkdir(cwd, { recursive: true });
    await symlink(
      join(repository, 'node_modules'),
      join(root, 'node_modules'),
      'dir',
    );
    env = {
      ...process.env,
      HOME: join(root, 'home'),
      XDG_CONFIG_HOME: join(root, 'config'),
      SLC_PIPELINE_PATH: '',
      SLC_AGENT: 'unused-unsupported-agent',
      SLC_MODEL: '',
      SLC_EFFORT: '',
      SLC_REVIEWER_AGENT: '',
      SLC_REVIEWER_MODEL: '',
      SLC_REVIEWER_EFFORT: '',
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function fixture(lang = 'en') {
    name = lang === 'en' ? 'workflow' : 'workflow.zh';
    bundle = join(cwd, `${name}.playbook`);
    await mkdir(bundle);
    for (const suffix of [
      'text.md',
      'gears.md',
      'gears.raw.md',
      'fsm.ts',
      'playbook.ts',
    ]) {
      await copyFile(
        join(
          repository,
          'demo',
          'reference',
          `${name}.playbook`,
          `${name}.${suffix}`,
        ),
        join(bundle, `${name}.${suffix}`),
      );
    }
  }

  async function invoke(args: string[] = [], from = cwd) {
    try {
      const result = await exec(
        process.execPath,
        [
          cli,
          'playbook',
          join(bundle, `${name}.text.md`),
          '--complete',
          ...args,
        ],
        { cwd: from, env },
      );
      return { ok: true, ...result };
    } catch (error) {
      const result = error as { stdout: string; stderr: string };
      return { ok: false, stdout: result.stdout, stderr: result.stderr };
    }
  }

  async function noDerivedFiles() {
    const files = await readdir(bundle);
    expect(files).not.toContain('.slc-verify');
    expect(files.some((file) => file.endsWith('.test.ts'))).toBe(false);
    await expect(access(join(cwd, `${name}.ts`))).rejects.toThrow();
  }

  it.each(['en', 'zh'])(
    'checks and performs the actual %s retained entry without credentials or history',
    async (lang) => {
      await fixture(lang);
      const before = await readFile(join(bundle, `${name}.fsm.ts`));
      const result = await invoke();
      expect(result.ok, result.stderr).toBe(true);
      expect(result.stdout.trim().split('\n')).toHaveLength(11);
      expect(result.stderr).toContain(
        'no phases executed or build history published',
      );
      expect(await readFile(join(bundle, `${name}.fsm.ts`))).toEqual(before);
      await expect(
        access(join(root, 'config', 'slc', 'config.yaml')),
      ).rejects.toThrow();
      await expect(access(join(bundle, '.slc'))).rejects.toThrow();
      // The unchanged maintained checker exercises real shared-factory runtime
      // success/failure paths with Git commits, installed registry validation,
      // all four emitted suites and independent artifact review; no agent call.
      await copyFile(
        join(repository, 'demo', 'reference', 'check.mjs'),
        join(cwd, 'check.mjs'),
      );
      await mkdir(join(root, 'scripts'));
      await copyFile(
        join(repository, 'scripts', 'verify-artifacts.mjs'),
        join(root, 'scripts', 'verify-artifacts.mjs'),
      );
      await symlink(join(repository, 'dist'), join(root, 'dist'), 'dir');
      const checked = await exec(
        process.execPath,
        [join(cwd, 'check.mjs'), lang],
        { cwd: root, env },
      );
      expect(checked.stdout).toContain(`all stages pass for ${lang}`);
    },
  );

  it('preserves an actual usable complete build byte for byte', async () => {
    await fixture();
    const source = join(bundle, `${name}.text.md`);
    const steps = [];
    for (const [kind, phase, suffix] of [
      ['compile', 'text2gears', 'gears.md'],
      ['compile', 'gears2fsm', 'fsm.ts'],
      ['link', 'link', 'playbook.ts'],
    ] as const) {
      const target = join(bundle, `${name}.${suffix}`);
      const bytes = await readFile(target);
      steps.push({
        kind,
        name: phase,
        target,
        inputs: [hashBytes(bytes)],
        output: hashBytes(bytes),
        bytes,
      });
    }
    await recordBuild({
      artDir: bundle,
      pipeline: 'playbook',
      sourcePath: source,
      sourceBytes: await readFile(source),
      steps,
    });
    expect(await loadBuildHistory(bundle)).not.toBeNull();
    const manifest = join(bundle, '.slc', 'builds', '1', 'manifest.json');
    const before = await readFile(manifest);
    const result = await invoke();
    expect(result.ok, result.stderr).toBe(true);
    expect(await readFile(manifest)).toEqual(before);
    expect(await readFile(join(bundle, '.slc', 'latest'), 'utf8')).toBe('1\n');
    expect(await readdir(join(bundle, '.slc', 'builds'))).toEqual(['1']);
  });

  it('emits a loadable canonical local import when invoked inside the bundle', async () => {
    await fixture();
    const result = await invoke([], bundle);
    expect(result.ok, result.stderr).toBe(true);
    const entry = join(bundle, `${name}.ts`);
    expect(await readFile(entry, 'utf8')).toContain(
      "from './workflow.playbook.ts'",
    );
    const loaded = await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const entry = (await import(${JSON.stringify(entry)})).default; console.log(entry.id, entry.requiredRoleIds.join(','));`,
      ],
      { cwd: root, env },
    );
    expect(loaded.stdout.trim()).toBe('workflow coder,reviewer');
  });

  it.each([false, true])(
    'permits a harmless stale JS sibling but refuses its runtime object edge=%s',
    async (importsJavaScript) => {
      await fixture();
      const fsm = join(bundle, `${name}.fsm.ts`);
      const linked = join(bundle, `${name}.playbook.ts`);
      const original = await readFile(linked, 'utf8');
      const stale = (await readFile(fsm, 'utf8')).replace(
        "scriptSucceeded: ({ event }) => scriptOutputOf(event)?.guard === 'ok'",
        'scriptSucceeded: () => false',
      );
      const javascript = ts.transpileModule(stale, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText;
      await writeFile(join(bundle, `${name}.fsm.js`), javascript);
      if (importsJavaScript)
        await writeFile(
          linked,
          original.replace(
            "from './workflow.fsm.ts'",
            "from './workflow.fsm.js'",
          ),
        );
      const before = await readFile(linked);
      const result = await invoke();
      expect(result.ok, result.stderr).toBe(!importsJavaScript);
      expect(await readFile(linked)).toEqual(before);
      expect(await readFile(join(bundle, `${name}.fsm.js`), 'utf8')).toBe(
        javascript,
      );
      if (importsJavaScript) {
        expect(result.stderr).toContain(
          'completion cannot verify JavaScript FSM import ./workflow.fsm.js',
        );
        expect(result.stderr).toContain('review and correct');
        await noDerivedFiles();
      } else {
        const loaded = await exec(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `console.log((await import(${JSON.stringify(join(cwd, `${name}.ts`))})).default.id);`,
          ],
          { cwd: root, env },
        );
        expect(loaded.stdout.trim()).toBe('workflow');
      }
    },
  );

  it.each([
    'Source',
    'GEARS',
    'TypeScript',
    'composition',
    'validator',
    'import',
    'missing',
    'coverage',
    'schema',
    'continuation',
  ])('refuses %s defects before derived writes', async (fault) => {
    await fixture();
    const text = join(bundle, `${name}.text.md`);
    const gears = join(bundle, `${name}.gears.md`);
    const fsm = join(bundle, `${name}.fsm.ts`);
    const linked = join(bundle, `${name}.playbook.ts`);
    if (fault === 'Source')
      await writeFile(
        text,
        `${await readFile(text, 'utf8')}\n\n\`\`\`markdown\nThis newly authored fragment must survive.\n\`\`\`\n`,
      );
    if (fault === 'GEARS')
      await writeFile(
        gears,
        `${await readFile(gears, 'utf8')}\n\n### EXTRA-1\n\nCaptain shall prompt Coder:\n\n> This item has no compiled state.\n`,
      );
    if (fault === 'TypeScript')
      await writeFile(
        fsm,
        `${await readFile(fsm, 'utf8')}\nexport const bad: string = 42;\n`,
      );
    if (fault === 'composition')
      await writeFile(
        linked,
        (await readFile(linked, 'utf8')).replace(
          'composePlayerPrompt: defaultComposePlayerPrompt',
          'composePlayerPrompt: () => "wrong prompt"',
        ),
      );
    if (fault === 'validator')
      await writeFile(
        linked,
        `${await readFile(linked, 'utf8')}\nexport const validateOptions = "not callable";\n`,
      );
    if (fault === 'import')
      await writeFile(
        linked,
        `${await readFile(linked, 'utf8')}\nimport "./missing.ts";\n`,
      );
    if (fault === 'missing') await rm(fsm);
    if (fault === 'continuation')
      await writeFile(
        fsm,
        (await readFile(fsm, 'utf8')).replaceAll(
          '{ bossReply: context.bossReply }',
          '{ bossReply: undefined }',
        ),
      );
    if (fault === 'coverage')
      await writeFile(
        fsm,
        (await readFile(fsm, 'utf8')).replace(
          "scriptSucceeded: ({ event }) => scriptOutputOf(event)?.guard === 'ok'",
          'scriptSucceeded: () => false',
        ),
      );
    if (fault === 'schema')
      await writeFile(
        linked,
        (await readFile(linked, 'utf8')).replace(
          'artifactSchema: 3, runtimeAbi: RUNTIME_ABI',
          'artifactSchema: 3, runtimeAbi: 999',
        ),
      );
    const result = await invoke();
    expect(result.ok, result.stderr).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
    await noDerivedFiles();
  });

  it.each([false, true])(
    'refuses a protected mutation before output, including probe error=%s',
    async (throws) => {
      await fixture();
      const linked = join(bundle, `${name}.playbook.ts`);
      const original = await readFile(linked, 'utf8');
      // A stateful composer stays valid through initial checking, then mutates
      // the Source during later test-content derivation. The prepare sink must
      // keep already-derived support content off disk until that probe settles.
      const modified = original.replace(
        'composePlayerPrompt: defaultComposePlayerPrompt,',
        `get composePlayerPrompt() {\n    composerReads++;\n    if (composerReads >= ${throws ? 1 : 2}) {\n      writeFileSync(new URL('./workflow.text.md', import.meta.url), 'mutated Source');\n      ${throws ? "throw new Error('probe stopped');" : ''}\n    }\n    return defaultComposePlayerPrompt;\n  },`,
      );
      expect(modified).not.toBe(original);
      await writeFile(
        linked,
        `import { writeFileSync } from 'node:fs';\nlet composerReads = 0;\n${modified}`,
      );
      const result = await invoke();
      expect(result.ok, result.stderr).toBe(false);
      expect(result.stderr).toContain('protected path');
      expect(result.stderr).toContain('changed during the run');
      await noDerivedFiles();
    },
  );

  it('refuses physical entry aliases before writing support', async () => {
    await fixture();
    await symlink(join(bundle, `${name}.text.md`), join(cwd, `${name}.ts`));
    const result = await invoke();
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/alias|symbolic|regular file/);
    expect(await readdir(bundle)).not.toContain('.slc-verify');
  });

  it('refuses compile flags, other forms, and raw Source without seeding config', async () => {
    await fixture();
    for (const args of [
      ['-o', 'elsewhere.ts'],
      ['--normalize'],
      ['-O'],
      ['--no-optimize'],
      ['--rebuild'],
      ['--link-option', 'a=b'],
    ]) {
      const result = await invoke(args);
      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('--complete requires');
    }
    for (const args of [
      ['other', 'source.md', '--complete'],
      ['playbook.gears2fsm', 'source.md', '--complete'],
      ['playbook.link', 'object.ts', 'runtime.ts', '--complete'],
      ['playbook', 'source.txt', '--complete'],
    ]) {
      await expect(
        exec(process.execPath, [cli, ...args], { cwd, env }),
      ).rejects.toMatchObject({ stdout: '' });
    }
    await noDerivedFiles();
    await expect(
      access(join(root, 'config', 'slc', 'config.yaml')),
    ).rejects.toThrow();
  });

  it('uses a retained callable validator and rejects non-object options', async () => {
    await fixture();
    const linked = join(bundle, `${name}.playbook.ts`);
    await writeFile(
      linked,
      `${await readFile(linked, 'utf8')}\nexport const validateOptions = (value: unknown): PlaybookRuntimeOptions => {\n  if (value === null) throw new Error('null is not an option record');\n  return snapshotOptions(value);\n};\n`,
    );
    const result = await invoke();
    expect(result.ok, result.stderr).toBe(true);
    const loaded = await exec(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const e = (await import(${JSON.stringify(join(cwd, `${name}.ts`))})).default; console.log(JSON.stringify(e.validateOptions({cwd:'/tmp'}))); try { e.validateOptions(null); process.exit(2); } catch {}`,
      ],
      { cwd: root, env },
    );
    expect(loaded.stdout.trim()).toBe('{"cwd":"/tmp"}');
  });

  it('reports actual partial writes when flushing the entry fails', async () => {
    await fixture();
    const entry = join(cwd, `${name}.ts`);
    await writeFile(entry, 'prior entry');
    await chmod(entry, 0o400);
    const result = await invoke();
    expect(result.ok, result.stderr).toBe(false);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('completion output write failed');
    expect(result.stderr.match(/completion already wrote /g)).toHaveLength(10);
    expect(await readFile(entry, 'utf8')).toBe('prior entry');
    expect(await readdir(join(bundle, '.slc-verify'))).toHaveLength(6);
  });
});

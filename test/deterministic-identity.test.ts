// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deterministicIdentityComponents } from '../src/deterministic-identity.js';
import { hashBytes } from '../src/hash.js';

const MODULES = [
  'deterministic-derivatives',
  'entry-module',
  'hash',
  'verify',
  'verify-coverage',
  'verify-support',
  'emitted-imports',
  'emitted-suite',
] as const;

const SUPPORT = [
  'hash.js',
  'hash.d.ts',
  'verify.js',
  'verify.d.ts',
  'verify-coverage.js',
  'verify-coverage.d.ts',
] as const;

describe('deterministic generator/checker identities', () => {
  let root: string;
  let modules: string;
  let support: string;
  let vitestPackage: string;
  let generatorXstatePackage: string;
  let xstatePackage: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-deterministic-identity-'));
    modules = join(root, 'src');
    support = join(root, 'dist');
    vitestPackage = join(root, 'vitest', 'package.json');
    generatorXstatePackage = join(root, 'generator-xstate', 'package.json');
    xstatePackage = join(root, 'xstate', 'package.json');
    await mkdir(modules, { recursive: true });
    await mkdir(support, { recursive: true });
    await mkdir(join(root, 'vitest'), { recursive: true });
    await mkdir(join(root, 'generator-xstate'), { recursive: true });
    await mkdir(join(root, 'xstate'), { recursive: true });
    await Promise.all(
      MODULES.map((name) =>
        writeFile(join(modules, `${name}.ts`), `${name}:1\n`, 'utf8'),
      ),
    );
    await Promise.all(
      SUPPORT.map((name) =>
        writeFile(
          join(support, name),
          `${name}:1\n//# sourceMappingURL=${name}.map\n`,
          'utf8',
        ),
      ),
    );
    await writeFile(
      vitestPackage,
      `${JSON.stringify({
        name: 'vitest',
        version: '4.1.9',
        dependencies: { '@vitest/runner': '4.1.9' },
        optionalDependencies: {
          'installed-optional': '1.0.0',
          'missing-optional': '1.0.0',
        },
      })}\n`,
      'utf8',
    );
    await writeFile(
      generatorXstatePackage,
      '{"name":"xstate","version":"5.32.4"}\n',
      'utf8',
    );
    await writeFile(
      xstatePackage,
      '{"name":"xstate","version":"5.32.4"}\n',
      'utf8',
    );
    await writeFile(join(root, 'vitest', 'runtime.js'), 'vitest:1\n', 'utf8');
    await writeFile(
      join(root, 'generator-xstate', 'runtime.js'),
      'generator-xstate:1\n',
      'utf8',
    );
    await writeFile(join(root, 'xstate', 'runtime.js'), 'xstate:1\n', 'utf8');
    const runnerRoot = join(root, 'node_modules', '@vitest', 'runner');
    const optionalRoot = join(root, 'node_modules', 'installed-optional');
    await mkdir(runnerRoot, { recursive: true });
    await mkdir(optionalRoot, { recursive: true });
    await writeFile(
      join(runnerRoot, 'package.json'),
      '{"name":"@vitest/runner","version":"4.1.9","exports":{".":"./index.js"}}\n',
      'utf8',
    );
    await writeFile(join(runnerRoot, 'index.js'), 'runner:1\n', 'utf8');
    await writeFile(
      join(optionalRoot, 'package.json'),
      '{"name":"installed-optional","version":"1.0.0"}\n',
      'utf8',
    );
    await writeFile(join(optionalRoot, 'index.js'), 'optional:1\n', 'utf8');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const identify = () =>
    deterministicIdentityComponents({
      moduleRoot: modules,
      moduleExtension: '.ts',
      supportRoot: support,
      vitestPackagePath: vitestPackage,
      generatorXstatePackagePath: generatorXstatePackage,
      xstatePackagePath: xstatePackage,
    });

  it('returns the exact canonical component set and normalized support hashes', async () => {
    const components = await identify();
    expect(components.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'generator:entry', kind: 'generator' },
      { id: 'generator:verification', kind: 'generator' },
      { id: 'checker:load-integrity', kind: 'checker' },
      { id: 'checker:verification', kind: 'checker' },
    ]);

    for (const component of components) {
      expect(component.source.kind).toBe('value');
      if (component.source.kind !== 'value') continue;
      expect(JSON.stringify(JSON.parse(component.source.value))).toBe(
        component.source.value,
      );
    }
    const generator = components[1];
    if (generator.source.kind !== 'value') throw new Error('not a value');
    const generatorValue = JSON.parse(generator.source.value) as {
      schema: string;
      dependencies: { name: string; hash: string }[];
    };
    expect(generatorValue.schema).toBe('sublang.slc.deterministic-identity.v1');
    expect(generatorValue.dependencies.map(({ name }) => name)).toEqual([
      'module:deterministic-derivatives',
      'module:hash',
      'module:verify',
      'module:verify-coverage',
      'module:verify-support',
      'support:hash.d.ts',
      'support:hash.js',
      'support:verify-coverage.d.ts',
      'support:verify-coverage.js',
      'support:verify.d.ts',
      'support:verify.js',
    ]);
    expect(generatorValue.dependencies).toContainEqual({
      name: 'support:hash.js',
      hash: hashBytes(new TextEncoder().encode('hash.js:1\n')),
    });

    const checker = components[3];
    if (checker.source.kind !== 'value') throw new Error('not a value');
    const checkerValue = JSON.parse(checker.source.value) as {
      runtime: { name: string; hash: string }[];
    };
    expect(checkerValue.runtime.map(({ name }) => name)).toEqual([
      'vitest',
      'xstate',
    ]);
    expect(
      checkerValue.runtime.every(({ hash }) =>
        /^sha256:[0-9a-f]{64}$/u.test(hash),
      ),
    ).toBe(true);
    expect(checker.source.value).not.toContain(root);
  });

  it('resolves the repository source-test layout', async () => {
    expect(
      (await deterministicIdentityComponents()).map(({ id, kind }) => ({
        id,
        kind,
      })),
    ).toEqual([
      { id: 'generator:entry', kind: 'generator' },
      { id: 'generator:verification', kind: 'generator' },
      { id: 'checker:load-integrity', kind: 'checker' },
      { id: 'checker:verification', kind: 'checker' },
    ]);
  });

  it('changes only affected closures and ignores unrelated bytes', async () => {
    const baseline = (await identify()).map((item) => item.source);
    const expected = new Map<string, number[]>([
      ['deterministic-derivatives.ts', [0, 1]],
      ['entry-module.ts', [0]],
      ['hash.ts', [0, 1]],
      ['verify.ts', [0, 1]],
      ['verify-coverage.ts', [0, 1]],
      ['verify-support.ts', [1]],
      ['emitted-imports.ts', [2]],
      ['emitted-suite.ts', [3]],
    ]);
    for (const [file, changed] of expected) {
      const path = join(modules, file);
      const original = await readFile(path, 'utf8');
      await writeFile(path, `${original}changed\n`, 'utf8');
      const next = (await identify()).map((item) => item.source);
      expect(
        next.map((item, index) => item.value !== baseline[index].value),
      ).toEqual([0, 1, 2, 3].map((index) => changed.includes(index)));
      await writeFile(path, original, 'utf8');
    }

    for (const file of SUPPORT) {
      const path = join(support, file);
      const original = await readFile(path, 'utf8');
      await writeFile(path, `changed\n${original}`, 'utf8');
      const next = (await identify()).map((item) => item.source);
      expect(
        next.map((item, index) => item.value !== baseline[index].value),
      ).toEqual([false, true, false, true]);
      await writeFile(path, original, 'utf8');
    }

    await writeFile(join(root, 'unrelated.ts'), 'changed\n', 'utf8');
    expect((await identify()).map((item) => item.source)).toEqual(baseline);
  });

  it('covers exact runtime package trees but ignores stripped source-map names', async () => {
    const baseline = (await identify()).map((item) => item.source);
    const vitestRuntime = join(root, 'vitest', 'runtime.js');
    await writeFile(vitestRuntime, 'vitest:2\n', 'utf8');
    let next = (await identify()).map((item) => item.source);
    expect(
      next.map((item, index) => item.value !== baseline[index].value),
    ).toEqual([false, false, false, true]);

    await writeFile(vitestRuntime, 'vitest:1\n', 'utf8');
    const runnerRuntime = join(
      root,
      'node_modules',
      '@vitest',
      'runner',
      'index.js',
    );
    await writeFile(runnerRuntime, 'runner:2\n', 'utf8');
    next = (await identify()).map((item) => item.source);
    expect(
      next.map((item, index) => item.value !== baseline[index].value),
    ).toEqual([false, false, false, true]);

    await writeFile(runnerRuntime, 'runner:1\n', 'utf8');
    const optionalRuntime = join(
      root,
      'node_modules',
      'installed-optional',
      'index.js',
    );
    await writeFile(optionalRuntime, 'optional:2\n', 'utf8');
    next = (await identify()).map((item) => item.source);
    expect(
      next.map((item, index) => item.value !== baseline[index].value),
    ).toEqual([false, false, false, true]);

    await writeFile(optionalRuntime, 'optional:1\n', 'utf8');
    const generatorXstateRuntime = join(root, 'generator-xstate', 'runtime.js');
    await writeFile(generatorXstateRuntime, 'generator-xstate:2\n', 'utf8');
    next = (await identify()).map((item) => item.source);
    expect(
      next.map((item, index) => item.value !== baseline[index].value),
    ).toEqual([false, true, false, false]);

    await writeFile(generatorXstateRuntime, 'generator-xstate:1\n', 'utf8');
    const checkerXstateRuntime = join(root, 'xstate', 'runtime.js');
    await writeFile(checkerXstateRuntime, 'xstate:2\n', 'utf8');
    next = (await identify()).map((item) => item.source);
    expect(
      next.map((item, index) => item.value !== baseline[index].value),
    ).toEqual([false, false, false, true]);

    await writeFile(checkerXstateRuntime, 'xstate:1\n', 'utf8');
    const supportPath = join(support, 'hash.js');
    await writeFile(
      supportPath,
      'hash.js:1\n//# sourceMappingURL=another.map\n',
      'utf8',
    );
    next = (await identify()).map((item) => item.source);
    expect(next).toEqual(baseline);
  });
});

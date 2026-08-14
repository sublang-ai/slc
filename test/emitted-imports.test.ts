// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkEmittedLoadIntegrity,
  unresolvableRelativeImports,
} from '../src/emitted-imports.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'slc-emitted-imports-'));
  roots.push(root);
  return root;
}

describe('emitted load integrity', () => {
  it('resolves logical imports through an exact alternate physical inventory', async () => {
    const root = await tempRoot();
    const logicalRoot = join(root, 'canonical');
    const physicalRoot = join(root, 'private', 'stage');
    await mkdir(physicalRoot, { recursive: true });
    const modulePhysical = join(physicalRoot, 'entry.ts');
    const dependencyPhysical = join(physicalRoot, 'hashed-fsm.ts');
    await writeFile(
      modulePhysical,
      [
        "import value from './workflow.fsm.js';",
        "const later = import('./helper.js');",
        'export default [value, later];',
        '',
      ].join('\n'),
    );
    await writeFile(dependencyPhysical, 'export default 1;\n');
    // A physical neighbor that is not in the exact inventory is not authority.
    await writeFile(join(physicalRoot, 'helper.js'), 'export default 2;\n');

    const findings = await checkEmittedLoadIntegrity({
      modules: [join(logicalRoot, 'entry.ts')],
      inventory: [
        {
          logicalPath: join(logicalRoot, 'entry.ts'),
          physicalPath: modulePhysical,
        },
        {
          logicalPath: join(logicalRoot, 'workflow.fsm.js'),
          physicalPath: dependencyPhysical,
        },
      ],
    });

    expect(findings).toEqual([
      {
        modulePath: join(logicalRoot, 'entry.ts'),
        specifier: './helper.js',
      },
    ]);
    expect(JSON.stringify(findings)).not.toContain(physicalRoot);
  });

  it('requires bound relative targets to resolve to files', async () => {
    const root = await tempRoot();
    const modulePath = join(root, 'entry.ts');
    const targetDirectory = join(root, 'target.js');
    await writeFile(modulePath, "export { default } from './target.js';\n");
    await mkdir(targetDirectory);

    await expect(
      checkEmittedLoadIntegrity({
        modules: [modulePath],
        inventory: [
          { logicalPath: modulePath, physicalPath: modulePath },
          {
            logicalPath: targetDirectory,
            physicalPath: targetDirectory,
          },
        ],
      }),
    ).resolves.toEqual([{ modulePath, specifier: './target.js' }]);
    await expect(unresolvableRelativeImports(modulePath)).resolves.toEqual([
      './target.js',
    ]);
  });

  it('rejects ambiguous and noncanonical inventory paths', async () => {
    const root = await tempRoot();
    const modulePath = join(root, 'entry.ts');
    await writeFile(modulePath, 'export {};\n');

    await expect(
      checkEmittedLoadIntegrity({
        modules: [modulePath],
        inventory: [
          { logicalPath: modulePath, physicalPath: modulePath },
          { logicalPath: modulePath, physicalPath: modulePath },
        ],
      }),
    ).rejects.toThrow(/duplicate emitted logical path/);
    await expect(
      checkEmittedLoadIntegrity({
        modules: [`${root}/sub/../entry.ts`],
        inventory: [{ logicalPath: modulePath, physicalPath: modulePath }],
      }),
    ).rejects.toThrow(/module path must be normalized/);
  });
});

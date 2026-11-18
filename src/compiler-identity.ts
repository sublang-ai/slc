// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Include emitted compiler code and its real checking tools, not just runner.js. */
export async function compilerIdentity(): Promise<{
  package: string;
  version: string;
  buildIdentity: string;
}> {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const installed = createRequire(import.meta.url);
  const manifest = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  ) as { name: string; version: string };
  const hash = createHash('sha256');
  const add = async (path: string, label: string) => {
    hash
      .update(label)
      .update('\0')
      .update(await readFile(path))
      .update('\0');
  };
  const tree = async (
    directory: string,
    prefix: string,
    filter: (path: string) => boolean,
  ) => {
    const files = await readdir(directory, { withFileTypes: true });
    for (const file of files.sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const path = join(directory, file.name);
      if (file.isDirectory())
        await tree(path, prefix + file.name + '/', filter);
      else if (file.isFile() && filter(file.name))
        await add(path, prefix + file.name);
    }
  };
  await add(join(root, 'package.json'), 'compiler/package.json');
  await tree(
    join(root, 'dist'),
    'compiler/dist/',
    (path) => !path.endsWith('.map'),
  );
  const tsEntry = installed.resolve('typescript');
  await add(tsEntry, 'toolchain/typescript.js');
  for (const grammar of [
    'scaffold/specs/meta.md',
    'scaffold/i18n/zh/specs/meta.md',
  ])
    await add(
      installed.resolve('@sublang/spex/' + grammar),
      'toolchain/spex/' + grammar,
    );
  const nodeManifest = installed.resolve('@types/node/package.json');
  await tree(
    dirname(nodeManifest),
    'toolchain/node-types/',
    (path) => path.endsWith('.d.ts') || path === 'package.json',
  );
  return {
    package: manifest.name,
    version: manifest.version,
    buildIdentity: hash.digest('hex'),
  };
}

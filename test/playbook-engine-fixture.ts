// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A synthetic installed `@sublang/playbook` package whose engine subpath
// declares (or omits) the DR-022 self-report the DR-028 contract-based
// selection keys on. Tests write one per variant and point a pin's link
// target at its `src/runtime.ts`.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface PlaybookEngineFixtureOptions {
  /** Package version; the release number never decides the contract. */
  version?: string;
  /** Package name; anything but `@sublang/playbook` is "not an installed engine". */
  name?: string;
  /** Exported `RUNTIME_ABI`; omitted when `omitRuntimeAbi` is set. */
  runtimeAbi?: unknown;
  /** Exported `SUPPORTED_ARTIFACT_SCHEMAS`; omitted when `omitSchemas` is set. */
  supportedArtifactSchemas?: unknown;
  omitRuntimeAbi?: boolean;
  omitSchemas?: boolean;
  /** Drop the `exports` map so the engine subpath cannot resolve. */
  omitExports?: boolean;
}

export interface PlaybookEngineFixture {
  packageRoot: string;
  /** The `src/runtime.ts` link target inside the package. */
  linkTarget: string;
  /** The engine module carrying the declaration. */
  engine: string;
}

/** Writes `<root>/node_modules/<name>/` as an installed engine package. */
export async function writePlaybookEngineFixture(
  root: string,
  options: PlaybookEngineFixtureOptions = {},
): Promise<PlaybookEngineFixture> {
  const name = options.name ?? '@sublang/playbook';
  const packageRoot = join(root, 'node_modules', ...name.split('/'));
  await mkdir(join(packageRoot, 'src'), { recursive: true });
  await writeFile(
    join(packageRoot, 'package.json'),
    `${JSON.stringify({
      name,
      version: options.version ?? '10.0.0',
      type: 'module',
      ...(options.omitExports === true
        ? {}
        : {
            exports: {
              './runtime': './src/runtime.js',
              './xstate-runtime': './src/xstate-runtime.js',
            },
          }),
    })}\n`,
  );
  const linkTarget = join(packageRoot, 'src', 'runtime.ts');
  await writeFile(linkTarget, 'export {};\n');
  await writeFile(join(packageRoot, 'src', 'runtime.js'), 'export {};\n');
  const engine = join(packageRoot, 'src', 'xstate-runtime.js');
  const declarations: string[] = [];
  if (options.omitRuntimeAbi !== true) {
    declarations.push(
      `export const RUNTIME_ABI = ${JSON.stringify(options.runtimeAbi ?? 1)};`,
    );
  }
  if (options.omitSchemas !== true) {
    declarations.push(
      `export const SUPPORTED_ARTIFACT_SCHEMAS = Object.freeze(${JSON.stringify(
        options.supportedArtifactSchemas ?? [3],
      )});`,
    );
  }
  await writeFile(engine, `${declarations.join('\n')}\nexport {};\n`);
  return { packageRoot, linkTarget, engine };
}

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Strict standalone FSM check without changing source or dependency resolution. */
export async function checkFsmTypeScript(
  target: string,
  signal?: AbortSignal,
): Promise<readonly string[]> {
  signal?.throwIfAborted();
  try {
    await stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  signal?.throwIfAborted();
  const findings = check(resolve(target));
  // Deliver timers/signals that became ready during synchronous TypeScript work.
  await delay(0);
  signal?.throwIfAborted();
  return findings;
}

function check(target: string): string[] {
  const installed = createRequire(import.meta.url);
  const ts = installed('typescript') as typeof import('typescript');
  const parsed = ts.parseCommandLine([
    '--noEmit',
    '--strict',
    '--noUnusedLocals',
    '--noUnusedParameters',
    '--noImplicitOverride',
    '--verbatimModuleSyntax',
    '--esModuleInterop',
    '--forceConsistentCasingInFileNames',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--lib',
    'ES2022',
    '--allowImportingTsExtensions',
    '--erasableSyntaxOnly',
    '--isolatedModules',
    '--moduleDetection',
    'force',
    '--noFallthroughCasesInSwitch',
    '--types',
    'node',
    '--typeRoots',
    dirname(dirname(installed.resolve('@types/node/package.json'))),
  ]);
  if (parsed.errors.length > 0) {
    throw new Error(
      ts.flattenDiagnosticMessageText(parsed.errors[0].messageText, '\n'),
    );
  }
  const bytes = readFileSync(target, 'utf8');
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    resolve(name) === target
      ? ts.createSourceFile(
          name,
          bytes,
          {
            ...(typeof languageVersion === 'object'
              ? languageVersion
              : { languageVersion }),
            impliedNodeFormat: ts.ModuleKind.ESNext,
          },
          true,
        )
      : getSourceFile(name, languageVersion, ...rest);
  const program = ts.createProgram([target], parsed.options, host);
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const location =
      diagnostic.file !== undefined && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
        : undefined;
    const file = diagnostic.file?.fileName ?? target;
    const at =
      location === undefined
        ? file
        : `${file}:${location.line + 1}:${location.character + 1}`;
    return `${at}: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`;
  });
}

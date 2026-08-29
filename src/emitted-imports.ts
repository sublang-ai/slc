// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Deterministic link-object import settlement and load-integrity checks for
 * emitted modules (pipeline-40, verification-18).
 *
 * A linked artifact is code whose relative imports Node resolves with exact
 * specifiers — `./workflow.fsm.js` does not find `workflow.fsm.ts`. An
 * agent-performed link can emit the wrong extension for its object import. The
 * host settles that exact edge mechanically against a `.js` or `.ts` sibling
 * that currently exists, then requires every relative specifier to name an
 * existing file beside it. A genuinely unloadable module still fails before
 * the first `playbook run`.
 */

import { existsSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const IMPORT_SPECIFIER =
  /\bfrom\s+(['"])([^'"\n]+)\1|\bimport\s*\(\s*(['"])([^'"\n]+)\3\s*\)|\bimport\s+(['"])([^'"\n]+)\5/g;

/** One deterministic extension correction applied to an emitted import. */
export interface ImportSpecifierRewrite {
  from: string;
  to: string;
}

const isRegularFile = (path: string): boolean =>
  statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * Settles relative `.js`/`.ts` imports of the link's object artifacts from the
 * files that actually exist beside an emitted module. A materialized
 * JavaScript sibling wins; otherwise the declared TypeScript object's sibling
 * is used when present. Unrelated imports and object specifiers with neither
 * sibling are left for
 * {@link unresolvableRelativeImports} to reject.
 */
export async function reconcileLinkObjectImportSpecifiers(
  modulePath: string,
  objectPaths: readonly string[],
): Promise<ImportSpecifierRewrite[]> {
  const source = await readFile(modulePath, 'utf8');
  const dir = dirname(modulePath);
  const emittedPath = resolve(modulePath);
  const objectStems = new Set(
    objectPaths
      .map((path) => resolve(path))
      .filter((path) => path.endsWith('.js') || path.endsWith('.ts'))
      .map((path) => path.slice(0, -3)),
  );
  const rewrites: ImportSpecifierRewrite[] = [];
  let cursor = 0;
  let reconciled = '';

  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (specifier === undefined || match.index === undefined) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    if (!specifier.endsWith('.js') && !specifier.endsWith('.ts')) continue;

    const stem = specifier.slice(0, -3);
    if (!objectStems.has(resolve(dir, stem))) continue;
    const jsSpecifier = `${stem}.js`;
    const tsSpecifier = `${stem}.ts`;
    const jsPath = resolve(dir, jsSpecifier);
    const tsPath = resolve(dir, tsSpecifier);
    const preferred =
      jsPath !== emittedPath && isRegularFile(jsPath)
        ? jsSpecifier
        : tsPath !== emittedPath && isRegularFile(tsPath)
          ? tsSpecifier
          : specifier;
    if (preferred === specifier) continue;

    const specifierIndex = match[0].indexOf(specifier);
    const start = match.index + specifierIndex;
    reconciled += source.slice(cursor, start) + preferred;
    cursor = start + specifier.length;
    rewrites.push({ from: specifier, to: preferred });
  }

  if (rewrites.length > 0) {
    reconciled += source.slice(cursor);
    await writeFile(modulePath, reconciled, 'utf8');
  }
  return rewrites;
}

/**
 * The relative import specifiers of a `.ts`/`.js` module that do not resolve
 * to an existing file from the module's own directory, in source order.
 */
export async function unresolvableRelativeImports(
  modulePath: string,
): Promise<string[]> {
  const source = await readFile(modulePath, 'utf8');
  const dir = dirname(modulePath);
  const missing: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (specifier === undefined) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    if (!existsSync(resolve(dir, specifier))) missing.push(specifier);
  }
  return missing;
}

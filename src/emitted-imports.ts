// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Deterministic load-integrity check for emitted modules (VERIFY-18).
 *
 * A linked artifact is code whose relative imports Node resolves with exact
 * specifiers — `./workflow.fsm.js` does not find `workflow.fsm.ts`. An
 * agent-performed link can emit the wrong extension, and a compile that
 * reports success for a module that cannot load defers the failure to the
 * first `playbook run`. This check reads the emitted module and requires
 * every relative specifier to name an existing file beside it.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const IMPORT_SPECIFIER =
  /\bfrom\s+(['"])([^'"\n]+)\1|\bimport\s*\(\s*(['"])([^'"\n]+)\3\s*\)|\bimport\s+(['"])([^'"\n]+)\5/g;

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

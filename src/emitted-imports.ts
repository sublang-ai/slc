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

import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

const IMPORT_SPECIFIER =
  /\bfrom\s+(['"])([^'"\n]+)\1|\bimport\s*\(\s*(['"])([^'"\n]+)\3\s*\)|\bimport\s+(['"])([^'"\n]+)\5/g;

/** One logical emitted-product path and the physical file that realizes it. */
export interface EmittedFileBinding {
  readonly logicalPath: string;
  readonly physicalPath: string;
}

/** One relative import that cannot load from the supplied product inventory. */
export interface UnresolvableRelativeImport {
  readonly modulePath: string;
  readonly specifier: string;
}

/**
 * Exact candidate inventory and the logical modules within it to inspect.
 *
 * Logical paths determine JavaScript import semantics. Physical paths grant
 * the filesystem authority used to read the staged or retained candidate.
 */
export interface EmittedLoadIntegrityRequest {
  readonly inventory: readonly EmittedFileBinding[];
  readonly modules: readonly string[];
}

/**
 * Finds every relative import that is absent or not a file in an exact,
 * explicitly bound emitted-product inventory.
 *
 * Files that merely happen to exist beside a staged module do not satisfy the
 * check: the logical target must be present in `inventory`, and that binding's
 * physical target must resolve to a file. Findings name only the stable
 * logical module and authored specifier, never a private staging locator.
 */
export async function checkEmittedLoadIntegrity(
  request: EmittedLoadIntegrityRequest,
): Promise<UnresolvableRelativeImport[]> {
  const inventory = indexInventory(request.inventory);
  const seenModules = new Set<string>();
  const missing: UnresolvableRelativeImport[] = [];

  for (const logicalModulePath of request.modules) {
    const moduleKey = canonicalAbsolute(logicalModulePath, 'module path');
    if (seenModules.has(moduleKey)) {
      throw new Error(`duplicate emitted module path: ${logicalModulePath}`);
    }
    seenModules.add(moduleKey);

    const module = inventory.get(moduleKey);
    if (module === undefined) {
      throw new Error(
        `emitted module is absent from the supplied inventory: ${logicalModulePath}`,
      );
    }
    const source = await readFile(module.physicalPath, 'utf8');
    for (const specifier of relativeSpecifiers(source)) {
      const logicalTarget = resolve(dirname(moduleKey), specifier);
      const target = inventory.get(logicalTarget);
      if (
        target === undefined ||
        !(await resolvesToRegularFile(target.physicalPath))
      ) {
        missing.push({
          modulePath: logicalModulePath,
          specifier,
        });
      }
    }
  }
  return missing;
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
  for (const specifier of relativeSpecifiers(source)) {
    if (!(await resolvesToRegularFile(resolve(dir, specifier)))) {
      missing.push(specifier);
    }
  }
  return missing;
}

function indexInventory(
  bindings: readonly EmittedFileBinding[],
): Map<string, EmittedFileBinding> {
  const inventory = new Map<string, EmittedFileBinding>();
  for (const binding of bindings) {
    const logical = canonicalAbsolute(binding.logicalPath, 'logical path');
    canonicalAbsolute(binding.physicalPath, 'physical path');
    if (inventory.has(logical)) {
      throw new Error(`duplicate emitted logical path: ${binding.logicalPath}`);
    }
    inventory.set(logical, binding);
  }
  return inventory;
}

function canonicalAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`emitted ${label} must be absolute: ${path}`);
  }
  const canonical = resolve(path);
  if (canonical !== path) {
    throw new Error(`emitted ${label} must be normalized: ${path}`);
  }
  return canonical;
}

function relativeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[2] ?? match[4] ?? match[6];
    if (specifier === undefined) continue;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
    specifiers.push(specifier);
  }
  return specifiers;
}

async function resolvesToRegularFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

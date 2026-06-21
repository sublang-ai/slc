// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Pin path-boundary resolution for the pin-currency validator (PIN-2, PIN-5;
 * DR-007).
 *
 * Every pin path is a relative POSIX-style path resolved from the pipeline
 * directory that contains `slc.pins.json`. Absolute paths are rejected. The pin
 * file records one path boundary (a relative POSIX path, defaulting to `.`, the
 * pipeline directory); every local pin path must resolve inside that boundary,
 * so `..` is permitted only when the recorded boundary is wide enough to contain
 * the result. A violation is a {@link PinError} naming the offending field, which
 * the currency engine maps to a malformed verdict. See specs/dev/pinning.md.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isAbsolute as posixIsAbsolute } from 'node:path/posix';

import { PinError } from './pins.js';

/**
 * Resolves a relative POSIX `relPath` against `pipelineDir`, requiring it to stay
 * inside `boundary` (also a relative POSIX path from `pipelineDir`) (PIN-2, PIN-5).
 *
 * @returns the resolved absolute host path.
 * @throws {PinError} (`pin-invalid`) when the recorded `boundary` is absolute
 *   (naming `pathBoundary.path`), or `relPath` is absolute or escapes the
 *   recorded boundary (naming `field`).
 */
export function resolvePinPath(
  pipelineDir: string,
  boundary: string,
  relPath: string,
  field: string,
): string {
  requireRelative(boundary, 'pathBoundary.path');
  requireRelative(relPath, field);
  const boundaryRoot = resolve(pipelineDir, ...splitPosix(boundary));
  const resolved = resolve(pipelineDir, ...splitPosix(relPath));
  if (!isInside(boundaryRoot, resolved)) {
    throw new PinError(
      'pin-invalid',
      `${field} "${relPath}" escapes the path boundary`,
    );
  }
  return resolved;
}

/** Rejects an absolute (POSIX or Windows) path, naming `field` (PIN-5). */
function requireRelative(path: string, field: string): void {
  if (posixIsAbsolute(path) || isWindowsAbsolute(path)) {
    throw new PinError(
      'pin-invalid',
      `${field} must be a relative path, got "${path}"`,
    );
  }
}

function splitPosix(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function isWindowsAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\');
}

function isInside(boundaryRoot: string, resolved: string): boolean {
  if (resolved === boundaryRoot) {
    return true;
  }
  const rel = relative(boundaryRoot, resolved);
  return (
    rel !== '' &&
    !rel.startsWith(`..${sep}`) &&
    rel !== '..' &&
    !isAbsolute(rel)
  );
}

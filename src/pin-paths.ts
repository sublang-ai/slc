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

import { realpathSync } from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
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
  // Lexical containment is not enough: an in-boundary symlink can resolve to
  // bytes outside the recorded boundary. Resolve the nearest existing
  // ancestors so the check remains fail-closed even for a missing leaf.
  const realBoundary = canonicalProspectivePath(
    boundaryRoot,
    'pathBoundary.path',
  );
  const realResolved = canonicalProspectivePath(resolved, field);
  if (!isInside(realBoundary, realResolved)) {
    throw new PinError(
      'pin-invalid',
      `${field} "${relPath}" resolves outside the path boundary`,
    );
  }
  return resolved;
}

/**
 * Canonicalizes an existing path or its nearest existing ancestor. Resolving
 * the ancestor is load-bearing for missing pinned files: `inside-link/missing`
 * must still be rejected as a symlink escape rather than misreported stale.
 */
function canonicalProspectivePath(path: string, field: string): string {
  const suffix: string[] = [];
  let cursor = path;
  while (true) {
    try {
      return resolve(realpathSync.native(cursor), ...suffix.reverse());
    } catch (error) {
      if (!isAbsentPath(error)) {
        throw new PinError(
          'pin-invalid',
          `${field} cannot be resolved safely: ${errorCode(error)}`,
        );
      }
    }

    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new PinError(
        'pin-invalid',
        `${field} cannot be resolved safely: no existing ancestor`,
      );
    }
    suffix.push(basename(cursor));
    cursor = parent;
  }
}

function isAbsentPath(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'unknown error';
}

/** Rejects an absolute (POSIX or Windows) path, naming `field` (PIN-5). */
function requireRelative(path: string, field: string): void {
  if (path === '' || path.includes('\\') || path.includes('\0')) {
    throw new PinError(
      'pin-invalid',
      `${field} must be a non-empty portable POSIX path`,
    );
  }
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
  return /^[a-zA-Z]:/.test(path);
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

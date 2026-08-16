// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Shared error inspection helpers.
 *
 * This module imports nothing: modules whose bytes are hashed into a
 * deterministic identity descriptor, or that are copied verbatim beside an
 * artifact, keep their own private copies instead of importing these.
 */

/** Renders any thrown value as a diagnostic string. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads a system error code, or `unknown error` when none is carried. */
export function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'unknown error';
}

/** True when a path operation failed because the path is not there. */
export function isAbsentPathError(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

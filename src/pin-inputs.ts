// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * SLC-owned semantic-input closure declarations (pinning-17, pinning-18;
 * DR-026).
 *
 * A pipeline's optional `slc.pin-inputs.json` maps a phase or pass name to its
 * complete flattened local semantic-input closure, excluding the separately
 * recorded definition. Strict loading validates every declared path; tolerant
 * inspection also retains independently valid paths for runtime protection.
 */

import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { errorCode, messageOf } from './errors.js';
import { resolvePinPath } from './pin-paths.js';
import { isPortablePhaseName } from './phase.js';
import { PinError } from './pins.js';

/** Optional per-pipeline semantic-input declaration filename (DR-026). */
export const PIN_INPUTS_FILE = 'slc.pin-inputs.json';
/** The only supported semantic-input declaration schema (DR-026). */
export const PIN_INPUTS_SCHEMA = 'sublang.slc.pin-inputs.v1';

/** Parsed SLC-owned semantic-input declarations. */
export interface PinInputsFile {
  schema: string;
  closures: Record<string, string[]>;
}

/** A loaded declaration and its path, or neither when the sidecar is absent. */
export interface LoadedPinInputs {
  path?: string;
  file?: PinInputsFile;
}

/** A tolerant boundary inspection used by runtime protected-input discovery. */
export interface InspectedPinInputs extends LoadedPinInputs {
  /** Resolved members by entry and source order; invalid members stay absent. */
  resolvedClosures: Record<string, Array<string | undefined>>;
  /** First boundary failure in file order, when any member is invalid. */
  issue?: PinError;
}

/**
 * Loads and validates `<pipelineDir>/slc.pin-inputs.json` (pinning-18).
 *
 * Every closure path is validated inside `boundary`, including paths belonging
 * to phases other than the one a caller is about to derive.
 */
export async function loadPinInputsFile(
  pipelineDir: string,
  boundary: string,
): Promise<LoadedPinInputs> {
  const inspected = await inspectPinInputsFile(pipelineDir, boundary);
  if (inspected.issue !== undefined) {
    throw inspected.issue;
  }
  if (inspected.path === undefined || inspected.file === undefined) {
    return {};
  }
  return { path: inspected.path, file: inspected.file };
}

/**
 * Reads the complete sidecar structure and inspects every member boundary.
 *
 * Unlike {@link loadPinInputsFile}, a member boundary failure is returned with
 * every independently valid resolved member. Structural failures still throw
 * because no trustworthy sidecar member list can be recovered; closure
 * inspection may separately recover inline paths for conservative protection.
 */
export async function inspectPinInputsFile(
  pipelineDir: string,
  boundary: string,
): Promise<InspectedPinInputs> {
  const loaded = await readPinInputsFile(pipelineDir);
  const resolvedClosures: Record<
    string,
    Array<string | undefined>
  > = Object.create(null) as Record<string, Array<string | undefined>>;
  if (loaded.file === undefined) {
    return { resolvedClosures };
  }

  let issue: PinError | undefined;
  for (const [phase, closure] of Object.entries(loaded.file.closures)) {
    const resolved: Array<string | undefined> = [];
    resolvedClosures[phase] = resolved;
    for (let index = 0; index < closure.length; index++) {
      try {
        resolved[index] = resolvePinPath(
          pipelineDir,
          boundary,
          closure[index],
          `${loaded.path}.closures.${phase}[${index}]`,
        );
      } catch (error) {
        if (!(error instanceof PinError)) throw error;
        issue ??= error;
      }
    }
  }
  return {
    ...loaded,
    resolvedClosures,
    ...(issue === undefined ? {} : { issue }),
  };
}

/** Reads and structurally validates the sidecar without resolving members. */
async function readPinInputsFile(
  pipelineDir: string,
): Promise<LoadedPinInputs> {
  const path = join(pipelineDir, PIN_INPUTS_FILE);
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return {};
    throw new PinError(
      'pin-invalid',
      `${path} cannot be inspected: ${errorCode(error)}`,
    );
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new PinError(
      'pin-invalid',
      `${path} must be a regular non-symbolic-link file`,
    );
  }

  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (error) {
    throw new PinError(
      'pin-invalid',
      `${path} cannot be read: ${errorCode(error)}`,
    );
  }
  const file = parsePinInputsFile(source, path);
  return { path, file };
}

/** Parses strict sidecar JSON and validates its complete field shape. */
export function parsePinInputsFile(
  source: string,
  path: string = PIN_INPUTS_FILE,
): PinInputsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch (error) {
    throw new PinError(
      'pin-parse',
      `${path} is not valid JSON: ${messageOf(error)}`,
    );
  }

  const input = requireObject(raw, path);
  rejectUnknownKeys(input, new Set(['schema', 'closures']), path);
  const schema = requireString(input.schema, `${path}.schema`);
  if (schema !== PIN_INPUTS_SCHEMA) {
    throw invalid(`${path}.schema`, `must be "${PIN_INPUTS_SCHEMA}"`);
  }
  return {
    schema,
    closures: normalizeClosures(input.closures, `${path}.closures`),
  };
}

function normalizeClosures(
  value: unknown,
  path: string,
): Record<string, string[]> {
  const input = requireObject(value, path);
  const closures: Record<string, string[]> = Object.create(null) as Record<
    string,
    string[]
  >;
  for (const [phase, rawClosure] of Object.entries(input)) {
    if (phase !== 'link' && !isPortablePhaseName(phase)) {
      throw invalid(
        `${path}.${phase}`,
        'key must be "link" or a portable phase/pass name',
      );
    }
    const values = requireArray(rawClosure, `${path}.${phase}`);
    const closure: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < values.length; index++) {
      const item = `${path}.${phase}[${index}]`;
      const declared = requirePortablePath(values[index], item);
      if (seen.has(declared)) {
        throw invalid(item, `duplicates closure path "${declared}"`);
      }
      seen.add(declared);
      closure.push(declared);
    }
    closures[phase] = closure;
  }
  return closures;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalid(path, 'must be an array');
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(path, 'must be a non-empty string');
  }
  return value;
}

function requirePortablePath(value: unknown, path: string): string {
  const result = requireString(value, path);
  if (
    result.includes('\\') ||
    result.includes('\0') ||
    result.startsWith('/') ||
    /^[a-zA-Z]:/.test(result)
  ) {
    throw invalid(path, 'must be a non-empty portable relative POSIX path');
  }
  return result;
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw invalid(`${path}.${key}`, 'is an unknown field');
    }
  }
}

function invalid(field: string, detail: string): PinError {
  return new PinError('pin-invalid', `${field} ${detail}`);
}

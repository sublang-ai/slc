// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Pin-file model and strict parser for the pin-currency validator (PIN-1, PIN-5;
 * DR-007).
 *
 * Loads a pipeline's committed `slc.pins.json` and structurally validates it into
 * a typed {@link PinFile}: the supported schema identifier and hash algorithm,
 * the optional path boundary, and each phase's pin record (with the reserved
 * `link` key naming the link phase). An absent file yields an empty result — no
 * pins — and a non-JSON file or a record violating the schema is rejected with a
 * {@link PinError} naming the offending field. This module performs structural
 * validation only: it does not hash inputs, resolve the path boundary, derive the
 * semantic closure, or judge currency — those are later validator stages. See
 * specs/dev/pinning.md.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Committed pin-index filename in a pipeline directory (DR-007). */
export const PINS_FILE = 'slc.pins.json';
/** The only supported pin-file schema identifier (DR-007). */
export const PIN_SCHEMA = 'sublang.slc.pins.v1';
/** The only supported pin hash algorithm (DR-007). */
export const PIN_HASH_ALGORITHM = 'sha256';

const LINK_TARGET_KINDS = new Set(['file', 'directory', 'package']);

/** A pinned local file recorded by path and exact-byte hash (DR-007). */
export interface PinFileRef {
  path: string;
  hash: string;
}

/** A semantic-input closure member: a local file plus a descriptive role (DR-007). */
export interface PinSemanticInput {
  path: string;
  hash: string;
  role?: string;
}

/** The immutable identity of the `slc.link` target consumed to produce the artifact (DR-007). */
export interface PinLinkTarget {
  kind: string;
  locator: string;
  identity: string;
  provenance?: string;
}

/** An immutable content-addressed external input; its field shape is reserved by DR-007. */
export type PinExternalInput = Record<string, unknown>;

/** Provenance of the producing meta-pipeline run; never a currency input (DR-007). */
export interface PinProducer {
  pipeline: string;
  slcVersion?: string;
  metaPipelineRevision?: string;
}

/** The pin record for one phase (DR-007). */
export interface PinRecord {
  artifact: PinFileRef;
  definition: PinFileRef;
  semanticInputs: PinSemanticInput[];
  externalInputs: PinExternalInput[];
  linkTarget: PinLinkTarget;
  producer?: PinProducer;
}

/** The recorded path boundary; defaults to the pipeline directory (`.`) (DR-007). */
export interface PinPathBoundary {
  path: string;
}

/** A parsed `slc.pins.json` (DR-007). */
export interface PinFile {
  schema: string;
  hashAlgorithm: string;
  pathBoundary: PinPathBoundary;
  pins: Record<string, PinRecord>;
}

/** A loaded pin file: the resolved path and parsed model, or both undefined when absent. */
export interface LoadedPins {
  path?: string;
  file?: PinFile;
}

/** Machine-readable reason a pin file was rejected (PIN-5). */
export type PinErrorCode = 'pin-parse' | 'pin-invalid';

/** Raised when `slc.pins.json` is not valid JSON or violates the pin schema (PIN-5). */
export class PinError extends Error {
  readonly code: PinErrorCode;

  constructor(code: PinErrorCode, message: string) {
    super(message);
    this.name = 'PinError';
    this.code = code;
  }
}

/**
 * Loads and validates `<pipelineDir>/slc.pins.json` (PIN-1, PIN-5).
 *
 * @returns `{ path, file }` when present and valid, or `{}` (no pins) when absent.
 * @throws {PinError} when the file is not valid JSON (`pin-parse`) or violates the
 *   schema (`pin-invalid`), with a diagnostic naming the offending field.
 */
export async function loadPinFile(pipelineDir: string): Promise<LoadedPins> {
  const path = join(pipelineDir, PINS_FILE);
  if (!existsSync(path)) {
    return {};
  }
  const source = await readFile(path, 'utf8');
  return { path, file: parsePinFile(source, path) };
}

/** Parses and structurally validates the text of a pin file into a {@link PinFile} (PIN-5). */
export function parsePinFile(
  source: string,
  path: string = PINS_FILE,
): PinFile {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch (error) {
    throw new PinError(
      'pin-parse',
      `${path} is not valid JSON: ${messageOf(error)}`,
    );
  }
  return normalizePinFile(raw, path);
}

function normalizePinFile(value: unknown, path: string): PinFile {
  const input = requireObject(value, path);
  rejectUnknownKeys(
    input,
    new Set(['schema', 'hashAlgorithm', 'pathBoundary', 'pins']),
    path,
  );

  const schema = requireString(input.schema, `${path}.schema`);
  if (schema !== PIN_SCHEMA) {
    throw invalid(`${path}.schema`, `must be "${PIN_SCHEMA}"`);
  }
  const hashAlgorithm = requireString(
    input.hashAlgorithm,
    `${path}.hashAlgorithm`,
  );
  if (hashAlgorithm !== PIN_HASH_ALGORITHM) {
    throw invalid(`${path}.hashAlgorithm`, `must be "${PIN_HASH_ALGORITHM}"`);
  }

  return {
    schema,
    hashAlgorithm,
    pathBoundary: normalizePathBoundary(
      input.pathBoundary,
      `${path}.pathBoundary`,
    ),
    pins: normalizePins(input.pins, `${path}.pins`),
  };
}

function normalizePathBoundary(value: unknown, path: string): PinPathBoundary {
  if (value === undefined) {
    return { path: '.' };
  }
  const input = requireObject(value, path);
  rejectUnknownKeys(input, new Set(['path']), path);
  return { path: requireString(input.path, `${path}.path`) };
}

function normalizePins(
  value: unknown,
  path: string,
): Record<string, PinRecord> {
  const input = requireObject(value, path);
  const pins: Record<string, PinRecord> = {};
  for (const [name, record] of Object.entries(input)) {
    pins[name] = normalizePinRecord(record, `${path}.${name}`);
  }
  return pins;
}

function normalizePinRecord(value: unknown, path: string): PinRecord {
  const input = requireObject(value, path);
  rejectUnknownKeys(
    input,
    new Set([
      'artifact',
      'definition',
      'semanticInputs',
      'externalInputs',
      'linkTarget',
      'producer',
    ]),
    path,
  );

  const record: PinRecord = {
    artifact: normalizeFileRef(input.artifact, `${path}.artifact`),
    definition: normalizeFileRef(input.definition, `${path}.definition`),
    linkTarget: normalizeLinkTarget(input.linkTarget, `${path}.linkTarget`),
    semanticInputs:
      input.semanticInputs === undefined
        ? []
        : normalizeSemanticInputs(
            input.semanticInputs,
            `${path}.semanticInputs`,
          ),
    externalInputs:
      input.externalInputs === undefined
        ? []
        : normalizeExternalInputs(
            input.externalInputs,
            `${path}.externalInputs`,
          ),
  };
  if (input.producer !== undefined) {
    record.producer = normalizeProducer(input.producer, `${path}.producer`);
  }
  return record;
}

function normalizeFileRef(value: unknown, path: string): PinFileRef {
  const input = requireObject(value, path);
  rejectUnknownKeys(input, new Set(['path', 'hash']), path);
  return {
    path: requireString(input.path, `${path}.path`),
    hash: requireString(input.hash, `${path}.hash`),
  };
}

function normalizeSemanticInputs(
  value: unknown,
  path: string,
): PinSemanticInput[] {
  return requireArray(value, path).map((entry, index) => {
    const item = `${path}[${index}]`;
    const input = requireObject(entry, item);
    rejectUnknownKeys(input, new Set(['path', 'hash', 'role']), item);
    const semanticInput: PinSemanticInput = {
      path: requireString(input.path, `${item}.path`),
      hash: requireString(input.hash, `${item}.hash`),
    };
    if (input.role !== undefined) {
      semanticInput.role = requireString(input.role, `${item}.role`);
    }
    return semanticInput;
  });
}

function normalizeLinkTarget(value: unknown, path: string): PinLinkTarget {
  const input = requireObject(value, path);
  rejectUnknownKeys(
    input,
    new Set(['kind', 'locator', 'identity', 'provenance']),
    path,
  );
  const kind = requireString(input.kind, `${path}.kind`);
  if (!LINK_TARGET_KINDS.has(kind)) {
    throw invalid(`${path}.kind`, 'must be one of: file, directory, package');
  }
  const linkTarget: PinLinkTarget = {
    kind,
    locator: requireString(input.locator, `${path}.locator`),
    identity: requireString(input.identity, `${path}.identity`),
  };
  if (input.provenance !== undefined) {
    linkTarget.provenance = requireString(
      input.provenance,
      `${path}.provenance`,
    );
  }
  return linkTarget;
}

function normalizeExternalInputs(
  value: unknown,
  path: string,
): PinExternalInput[] {
  return requireArray(value, path).map((entry, index) =>
    requireObject(entry, `${path}[${index}]`),
  );
}

function normalizeProducer(value: unknown, path: string): PinProducer {
  const input = requireObject(value, path);
  rejectUnknownKeys(
    input,
    new Set(['pipeline', 'slcVersion', 'metaPipelineRevision']),
    path,
  );
  const producer: PinProducer = {
    pipeline: requireString(input.pipeline, `${path}.pipeline`),
  };
  if (input.slcVersion !== undefined) {
    producer.slcVersion = requireString(input.slcVersion, `${path}.slcVersion`);
  }
  if (input.metaPipelineRevision !== undefined) {
    producer.metaPipelineRevision = requireString(
      input.metaPipelineRevision,
      `${path}.metaPipelineRevision`,
    );
  }
  return producer;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

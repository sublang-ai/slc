// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Strict codec for SLC's source-bound build record (INCR-7, INCR-9; DR-021).
 *
 * This module owns only the `sublang.slc.build.v1` wire format: exact field
 * shapes and order, canonical JSON, portable locators, hashes, ordering, and
 * self-contained cross references. Runner classification and persistence are
 * deliberately outside this foundation.
 */

import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { hashBytes, isHash, type Hash } from './hash.js';

export const BUILD_RECORD_FILE = '.slc-build.json';
export const SOURCE_SNAPSHOT_FILE = '.slc-source';
export const BUILD_RECORD_SCHEMA = 'sublang.slc.build.v1';
export const BUILD_HASH_ALGORITHM = 'sha256';
export const UPDATE_TRACE_SCHEMA = 'sublang.slc.update.v1';

const ID = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9._-]*)*$/;
const EXTENSION = /^\.[A-Za-z0-9]+$/;

/** Reports whether a string is a legal build-record ID. */
export function isBuildRecordId(value: string): boolean {
  return ID.test(value);
}

export type PlanInputKind =
  | 'definition'
  | 'executor'
  | 'semantic-input'
  | 'link-target'
  | 'generator'
  | 'checker'
  | 'compatibility'
  | 'option';
export type StepKind = 'normalize' | 'phase' | 'pass' | 'link';
export type Origin = 'ordinary' | 'updated' | 'user-adopted';

export interface BuildRecord {
  schema: typeof BUILD_RECORD_SCHEMA;
  hashAlgorithm: typeof BUILD_HASH_ALGORITHM;
  source: SourceRecord;
  plan: PlanRecord;
  products: ProductRecord[];
  provenance: ProvenanceRecord;
  lineage: LineageRecord;
}

export interface SourceRecord {
  locator: string;
  hash: Hash;
  snapshot: typeof SOURCE_SNAPSHOT_FILE;
  snapshotHash: Hash;
}

export interface PlanRecord {
  identity: Hash;
  pipeline: string;
  invocation: InvocationRecord;
  inputs: PlanInput[];
  deterministicInputs: string[];
  steps: StepRecord[];
}

/** Result-independent step fields that enter `plan.identity` (DR-021). */
export type PlanIdentityStep = Pick<
  StepRecord,
  'id' | 'kind' | 'name' | 'source' | 'target' | 'inputs' | 'inputClosure'
>;

/** The exact result-independent projection accepted by {@link planIdentity}. */
export interface PlanIdentityProjection {
  pipeline: string;
  invocation: InvocationRecord;
  inputs: PlanInput[];
  deterministicInputs: string[];
  steps: PlanIdentityStep[];
}

export interface InvocationRecord {
  kind: 'full' | 'full-link';
  normalize: boolean;
  optimize: boolean;
  link: LinkRecord | null;
}

export interface LinkRecord {
  target: string;
  options: LinkOptionRecord[];
}

export interface LinkOptionRecord {
  name: string;
  value: string;
}

export interface PlanInput {
  id: string;
  kind: PlanInputKind;
  locator: string | null;
  value: string | null;
  identity: Hash;
}

export interface StepRecord {
  id: string;
  kind: StepKind;
  name: string;
  source: FormatRecord;
  target: TargetRecord;
  inputKey: Hash;
  inputs: string[];
  inputClosure: 'closed' | 'open';
  origin: Origin;
  trace: UpdateTrace | null;
}

export interface FormatRecord {
  format: string;
  ext: string;
}

export interface TargetRecord extends FormatRecord {
  path: string;
  product: string;
}

export interface ProductRecord {
  id: string;
  kind: 'semantic' | 'entry' | 'verification';
  path: string;
  hash: Hash;
  inputs: string[];
}

export interface ProvenanceRecord {
  packages: PackageRecord[];
  compatibility: CompatibilityRecord[];
}

export interface PackageRecord {
  role: 'slc' | 'pipeline' | 'link-runtime';
  name: string;
  version: string | null;
}

export interface CompatibilityRecord {
  name: string;
  value: string;
  currentness: 'provenance' | 'gate';
  input: string | null;
}

export interface LineageRecord {
  generation: number;
  transition: IdentityTransition | null;
}

export interface IdentityTransition {
  from: Hash;
  to: Hash;
}

export interface UpdateTrace {
  schema: typeof UPDATE_TRACE_SCHEMA;
  input: PartitionRecord;
  target: PartitionRecord;
  dependencies: DependencyRecord[];
}

export interface PartitionRecord {
  hash: Hash;
  byteLength: number;
  scopes: ScopeRecord[];
}

export interface ScopeRecord {
  scope: string;
  start: number;
  end: number;
  classification: 'local' | 'structural' | 'global';
}

export interface DependencyRecord {
  input: string;
  targets: string[];
}

export type BuildRecordErrorCode =
  | 'record-parse'
  | 'record-invalid'
  | 'lineage-pair'
  | 'lineage-unsafe';

export type LoadedLineage =
  | { state: 'absent' }
  | { state: 'present'; record: BuildRecord; snapshot: Uint8Array };

export class BuildRecordError extends Error {
  readonly code: BuildRecordErrorCode;

  constructor(code: BuildRecordErrorCode, message: string) {
    super(message);
    this.name = 'BuildRecordError';
    this.code = code;
  }
}

/** Decode fatal UTF-8 and parse one canonical build record. */
export function decodeBuildRecord(
  bytes: Uint8Array,
  path: string = BUILD_RECORD_FILE,
): BuildRecord {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new BuildRecordError(
      'record-parse',
      `${path} is not valid UTF-8: ${messageOf(error)}`,
    );
  }
  if (!source.endsWith('\n') || source.endsWith('\n\n')) {
    throw invalid(path, 'must end with exactly one LF');
  }
  return parseBuildRecord(source.slice(0, -1), path);
}

/** Parse and validate the exact canonical `sublang.slc.build.v1` JSON. */
export function parseBuildRecord(
  source: string,
  path: string = BUILD_RECORD_FILE,
): BuildRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(source) as unknown;
  } catch (error) {
    throw new BuildRecordError(
      'record-parse',
      `${path} is not valid JSON: ${messageOf(error)}`,
    );
  }
  const record = normalizeBuildRecord(raw, path);
  const canonical = canonicalJson(record);
  if (source !== canonical) {
    throw invalid(
      path,
      'must use the exact canonical compact JSON encoding and field order',
    );
  }
  return record;
}

/** Validate and encode a record as exact canonical compact UTF-8 JSON plus LF. */
export function encodeBuildRecord(record: BuildRecord): Uint8Array {
  return new TextEncoder().encode(
    `${canonicalJson(normalizeBuildRecord(record, BUILD_RECORD_FILE))}\n`,
  );
}

/** Canonical JSON used by DR-021 identities and record encoding. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return canonicalString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw invalid('canonical JSON number', 'must be a safe integer');
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${canonicalString(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  throw invalid('canonical JSON value', `has unsupported type ${typeof value}`);
}

/** Compute the identity of DR-021's result-independent plan projection. */
export function planIdentity(plan: PlanIdentityProjection): Hash {
  const invocation = {
    kind: plan.invocation.kind,
    normalize: plan.invocation.normalize,
    optimize: plan.invocation.optimize,
    link:
      plan.invocation.link === null
        ? null
        : {
            target: plan.invocation.link.target,
            options: plan.invocation.link.options.map((option) => ({
              name: option.name,
              value: option.value,
            })),
          },
  };
  return hashBytes(
    new TextEncoder().encode(
      canonicalJson({
        pipeline: plan.pipeline,
        invocation,
        inputs: plan.inputs.map((input) => ({
          id: input.id,
          kind: input.kind,
          locator: input.locator,
          value: input.value,
          identity: input.identity,
        })),
        deterministicInputs: [...plan.deterministicInputs],
        steps: plan.steps.map((step) => ({
          id: step.id,
          kind: step.kind,
          name: step.name,
          source: { format: step.source.format, ext: step.source.ext },
          target: {
            format: step.target.format,
            ext: step.target.ext,
            path: step.target.path,
            product: step.target.product,
          },
          inputs: [...step.inputs],
          inputClosure: step.inputClosure,
        })),
      }),
    ),
  );
}

function normalizeBuildRecord(value: unknown, path: string): BuildRecord {
  const input = exactObject(value, path, [
    'schema',
    'hashAlgorithm',
    'source',
    'plan',
    'products',
    'provenance',
    'lineage',
  ]);
  const schema = literal(input.schema, BUILD_RECORD_SCHEMA, `${path}.schema`);
  const hashAlgorithm = literal(
    input.hashAlgorithm,
    BUILD_HASH_ALGORITHM,
    `${path}.hashAlgorithm`,
  );
  const source = normalizeSource(input.source, `${path}.source`);
  const plan = normalizePlan(input.plan, `${path}.plan`);
  const products = normalizeProducts(input.products, `${path}.products`);
  const provenance = normalizeProvenance(
    input.provenance,
    `${path}.provenance`,
  );
  const lineage = normalizeLineage(input.lineage, `${path}.lineage`);
  const record: BuildRecord = {
    schema,
    hashAlgorithm,
    source,
    plan,
    products,
    provenance,
    lineage,
  };
  validateRecord(record, path);
  return record;
}

function normalizeSource(value: unknown, path: string): SourceRecord {
  const input = exactObject(value, path, [
    'locator',
    'hash',
    'snapshot',
    'snapshotHash',
  ]);
  return {
    locator: relativePath(input.locator, `${path}.locator`, true),
    hash: hash(input.hash, `${path}.hash`),
    snapshot: literal(input.snapshot, SOURCE_SNAPSHOT_FILE, `${path}.snapshot`),
    snapshotHash: hash(input.snapshotHash, `${path}.snapshotHash`),
  };
}

function normalizePlan(value: unknown, path: string): PlanRecord {
  const input = exactObject(value, path, [
    'identity',
    'pipeline',
    'invocation',
    'inputs',
    'deterministicInputs',
    'steps',
  ]);
  return {
    identity: hash(input.identity, `${path}.identity`),
    pipeline: nonempty(input.pipeline, `${path}.pipeline`),
    invocation: normalizeInvocation(input.invocation, `${path}.invocation`),
    inputs: array(input.inputs, `${path}.inputs`).map((entry, index) =>
      normalizePlanInput(entry, `${path}.inputs[${index}]`),
    ),
    deterministicInputs: array(
      input.deterministicInputs,
      `${path}.deterministicInputs`,
    ).map((entry, index) => id(entry, `${path}.deterministicInputs[${index}]`)),
    steps: array(input.steps, `${path}.steps`).map((entry, index) =>
      normalizeStep(entry, `${path}.steps[${index}]`),
    ),
  };
}

function normalizeInvocation(value: unknown, path: string): InvocationRecord {
  const input = exactObject(value, path, [
    'kind',
    'normalize',
    'optimize',
    'link',
  ]);
  const kind = oneOf(
    input.kind,
    ['full', 'full-link'] as const,
    `${path}.kind`,
  );
  const link =
    input.link === null ? null : normalizeLink(input.link, `${path}.link`);
  if ((kind === 'full') !== (link === null)) {
    throw invalid(
      `${path}.link`,
      `must be ${kind === 'full' ? 'null' : 'an object'} for ${kind}`,
    );
  }
  return {
    kind,
    normalize: boolean(input.normalize, `${path}.normalize`),
    optimize: boolean(input.optimize, `${path}.optimize`),
    link,
  };
}

function normalizeLink(value: unknown, path: string): LinkRecord {
  const input = exactObject(value, path, ['target', 'options']);
  return {
    target: relativePath(input.target, `${path}.target`, true),
    options: array(input.options, `${path}.options`).map((entry, index) => {
      const item = `${path}.options[${index}]`;
      const option = exactObject(entry, item, ['name', 'value']);
      return {
        name: nonempty(option.name, `${item}.name`),
        value: string(option.value, `${item}.value`),
      };
    }),
  };
}

function normalizePlanInput(value: unknown, path: string): PlanInput {
  const input = exactObject(value, path, [
    'id',
    'kind',
    'locator',
    'value',
    'identity',
  ]);
  const kind = oneOf(
    input.kind,
    [
      'definition',
      'executor',
      'semantic-input',
      'link-target',
      'generator',
      'checker',
      'compatibility',
      'option',
    ] as const,
    `${path}.kind`,
  );
  const locator =
    input.locator === null
      ? null
      : relativePath(input.locator, `${path}.locator`, true);
  const recordedValue =
    input.value === null ? null : string(input.value, `${path}.value`);
  if ((locator === null) === (recordedValue === null)) {
    throw invalid(path, 'must contain exactly one non-null locator or value');
  }
  if (
    (kind === 'definition' || kind === 'semantic-input') &&
    locator === null
  ) {
    throw invalid(`${path}.locator`, `is required for ${kind}`);
  }
  if (
    (kind === 'compatibility' || kind === 'option') &&
    recordedValue === null
  ) {
    throw invalid(`${path}.value`, `is required for ${kind}`);
  }
  const identity = hash(input.identity, `${path}.identity`);
  if (
    recordedValue !== null &&
    identity !== hashBytes(new TextEncoder().encode(recordedValue))
  ) {
    throw invalid(`${path}.identity`, 'does not hash the exact value bytes');
  }
  return {
    id: id(input.id, `${path}.id`),
    kind,
    locator,
    value: recordedValue,
    identity,
  };
}

function normalizeStep(value: unknown, path: string): StepRecord {
  const input = exactObject(value, path, [
    'id',
    'kind',
    'name',
    'source',
    'target',
    'inputKey',
    'inputs',
    'inputClosure',
    'origin',
    'trace',
  ]);
  const kind = oneOf(
    input.kind,
    ['normalize', 'phase', 'pass', 'link'] as const,
    `${path}.kind`,
  );
  const trace =
    input.trace === null
      ? null
      : parseUpdateTrace(input.trace, `${path}.trace`);
  if (kind === 'link' && trace !== null) {
    throw invalid(`${path}.trace`, 'must be null for a link step');
  }
  return {
    id: id(input.id, `${path}.id`),
    kind,
    name: nonempty(input.name, `${path}.name`),
    source: normalizeFormat(input.source, `${path}.source`),
    target: normalizeTarget(input.target, `${path}.target`),
    inputKey: hash(input.inputKey, `${path}.inputKey`),
    inputs: array(input.inputs, `${path}.inputs`).map((entry, index) =>
      id(entry, `${path}.inputs[${index}]`),
    ),
    inputClosure: oneOf(
      input.inputClosure,
      ['closed', 'open'] as const,
      `${path}.inputClosure`,
    ),
    origin: oneOf(
      input.origin,
      ['ordinary', 'updated', 'user-adopted'] as const,
      `${path}.origin`,
    ),
    trace,
  };
}

function normalizeFormat(value: unknown, path: string): FormatRecord {
  const input = exactObject(value, path, ['format', 'ext']);
  return {
    format: nonempty(input.format, `${path}.format`),
    ext: extension(input.ext, `${path}.ext`),
  };
}

function normalizeTarget(value: unknown, path: string): TargetRecord {
  const input = exactObject(value, path, ['format', 'ext', 'path', 'product']);
  return {
    format: nonempty(input.format, `${path}.format`),
    ext: extension(input.ext, `${path}.ext`),
    path: managedPath(input.path, `${path}.path`),
    product: id(input.product, `${path}.product`),
  };
}

function normalizeProducts(value: unknown, path: string): ProductRecord[] {
  return array(value, path).map((entry, index) => {
    const item = `${path}[${index}]`;
    const input = exactObject(entry, item, [
      'id',
      'kind',
      'path',
      'hash',
      'inputs',
    ]);
    const kind = oneOf(
      input.kind,
      ['semantic', 'entry', 'verification'] as const,
      `${item}.kind`,
    );
    const productPath =
      kind === 'entry'
        ? entryPath(input.path, `${item}.path`)
        : managedPath(input.path, `${item}.path`);
    return {
      id: id(input.id, `${item}.id`),
      kind,
      path: productPath,
      hash: hash(input.hash, `${item}.hash`),
      inputs: array(input.inputs, `${item}.inputs`).map((value, inputIndex) =>
        id(value, `${item}.inputs[${inputIndex}]`),
      ),
    };
  });
}

function normalizeProvenance(value: unknown, path: string): ProvenanceRecord {
  const input = exactObject(value, path, ['packages', 'compatibility']);
  return {
    packages: array(input.packages, `${path}.packages`).map((entry, index) => {
      const item = `${path}.packages[${index}]`;
      const pkg = exactObject(entry, item, ['role', 'name', 'version']);
      return {
        role: oneOf(
          pkg.role,
          ['slc', 'pipeline', 'link-runtime'] as const,
          `${item}.role`,
        ),
        name: nonempty(pkg.name, `${item}.name`),
        version:
          pkg.version === null ? null : string(pkg.version, `${item}.version`),
      };
    }),
    compatibility: array(input.compatibility, `${path}.compatibility`).map(
      (entry, index) => {
        const item = `${path}.compatibility[${index}]`;
        const compatibility = exactObject(entry, item, [
          'name',
          'value',
          'currentness',
          'input',
        ]);
        return {
          name: nonempty(compatibility.name, `${item}.name`),
          value: string(compatibility.value, `${item}.value`),
          currentness: oneOf(
            compatibility.currentness,
            ['provenance', 'gate'] as const,
            `${item}.currentness`,
          ),
          input:
            compatibility.input === null
              ? null
              : id(compatibility.input, `${item}.input`),
        };
      },
    ),
  };
}

function normalizeLineage(value: unknown, path: string): LineageRecord {
  const input = exactObject(value, path, ['generation', 'transition']);
  let transition: IdentityTransition | null = null;
  if (input.transition !== null) {
    const item = exactObject(input.transition, `${path}.transition`, [
      'from',
      'to',
    ]);
    transition = {
      from: hash(item.from, `${path}.transition.from`),
      to: hash(item.to, `${path}.transition.to`),
    };
  }
  return {
    generation: positiveInteger(input.generation, `${path}.generation`),
    transition,
  };
}

export function parseUpdateTrace(
  value: unknown,
  path: string = UPDATE_TRACE_SCHEMA,
): UpdateTrace {
  const input = exactObject(value, path, [
    'schema',
    'input',
    'target',
    'dependencies',
  ]);
  const trace: UpdateTrace = {
    schema: literal(input.schema, UPDATE_TRACE_SCHEMA, `${path}.schema`),
    input: normalizePartition(input.input, `${path}.input`),
    target: normalizePartition(input.target, `${path}.target`),
    dependencies: array(input.dependencies, `${path}.dependencies`).map(
      (entry, index) => {
        const item = `${path}.dependencies[${index}]`;
        const dependency = exactObject(entry, item, ['input', 'targets']);
        return {
          input: scopeName(dependency.input, `${item}.input`),
          targets: array(dependency.targets, `${item}.targets`).map(
            (target, targetIndex) =>
              scopeName(target, `${item}.targets[${targetIndex}]`),
          ),
        };
      },
    ),
  };
  validateTrace(trace, path);
  return trace;
}

function normalizePartition(value: unknown, path: string): PartitionRecord {
  const input = exactObject(value, path, ['hash', 'byteLength', 'scopes']);
  return {
    hash: hash(input.hash, `${path}.hash`),
    byteLength: nonnegativeInteger(input.byteLength, `${path}.byteLength`),
    scopes: array(input.scopes, `${path}.scopes`).map((entry, index) => {
      const item = `${path}.scopes[${index}]`;
      const scope = exactObject(entry, item, [
        'scope',
        'start',
        'end',
        'classification',
      ]);
      return {
        scope: scopeName(scope.scope, `${item}.scope`),
        start: nonnegativeInteger(scope.start, `${item}.start`),
        end: nonnegativeInteger(scope.end, `${item}.end`),
        classification: oneOf(
          scope.classification,
          ['local', 'structural', 'global'] as const,
          `${item}.classification`,
        ),
      };
    }),
  };
}

/** Loads the reserved record/snapshot pair without classifying currentness. */
export async function loadLineagePair(
  artifactDir: string,
): Promise<LoadedLineage> {
  const artifactInfo = await optionalLstat(resolve(artifactDir));
  if (artifactInfo === null) return { state: 'absent' };
  if (!artifactInfo.isDirectory() || artifactInfo.isSymbolicLink()) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `${artifactDir} must be a regular non-symbolic-link directory`,
    );
  }
  const recordPath = resolve(artifactDir, BUILD_RECORD_FILE);
  const snapshotPath = resolve(artifactDir, SOURCE_SNAPSHOT_FILE);
  const [recordInfo, snapshotInfo] = await Promise.all([
    optionalLstat(recordPath),
    optionalLstat(snapshotPath),
  ]);
  if (recordInfo === null && snapshotInfo === null) return { state: 'absent' };
  if (recordInfo === null || snapshotInfo === null) {
    throw new BuildRecordError(
      'lineage-pair',
      `${artifactDir} has an orphaned lineage record or snapshot`,
    );
  }
  requireRegular(recordInfo, recordPath);
  requireRegular(snapshotInfo, snapshotPath);
  const [recordBytes, snapshot] = await Promise.all([
    readNoFollow(recordPath),
    readNoFollow(snapshotPath),
  ]);
  const record = decodeBuildRecord(recordBytes, recordPath);
  resolveReadLocator(artifactDir, record.source.locator, 'source.locator');
  if (record.plan.invocation.link !== null) {
    resolveReadLocator(
      artifactDir,
      record.plan.invocation.link.target,
      'plan.invocation.link.target',
    );
  }
  for (const input of record.plan.inputs) {
    if (input.locator !== null) {
      resolveReadLocator(
        artifactDir,
        input.locator,
        `plan.inputs.${input.id}.locator`,
      );
    }
  }
  const snapshotHash = hashBytes(snapshot);
  if (
    snapshotHash !== record.source.hash ||
    snapshotHash !== record.source.snapshotHash
  ) {
    throw invalid(
      `${recordPath}.source`,
      'hashes do not match the raw source snapshot bytes',
    );
  }
  const artifactName = basename(resolve(artifactDir));
  const suffix = `.${record.plan.pipeline}`;
  const entryBasename = artifactName.endsWith(suffix)
    ? `${artifactName.slice(0, -suffix.length)}.ts`
    : undefined;
  for (const product of record.products) {
    await resolveManagedPath(
      artifactDir,
      product.path,
      product.kind === 'entry' ? { entryBasename } : {},
    );
  }
  return { state: 'present', record, snapshot };
}

/** Encodes a resolved read path relative to the artifact directory. */
export function encodeReadLocator(artifactDir: string, path: string): string {
  const locator = relative(resolve(artifactDir), resolve(path))
    .split('\\')
    .join('/');
  relativePath(locator, 'read locator', true);
  return locator;
}

/** Resolves a canonical read-only locator, rejecting lexical aliases. */
export function resolveReadLocator(
  artifactDir: string,
  locator: string,
  field: string = 'read locator',
): string {
  relativePath(locator, field, true);
  const resolved = resolve(artifactDir, ...locator.split('/'));
  if (encodeReadLocator(artifactDir, resolved) !== locator) {
    throw invalid(field, 'must be a canonical artifact-directory locator');
  }
  return resolved;
}

/** Resolves one confined product path, with the exact sibling-entry exception. */
export async function resolveManagedPath(
  artifactDir: string,
  path: string,
  options: { entryBasename?: string; requireFile?: boolean } = {},
): Promise<string> {
  const artRoot = resolve(artifactDir);
  const artInfo = await optionalLstat(artRoot);
  if (artInfo === null || !artInfo.isDirectory() || artInfo.isSymbolicLink()) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `${artRoot} must be a regular non-symbolic-link directory`,
    );
  }
  const productPath =
    options.entryBasename === undefined
      ? managedPath(path, 'managed path')
      : entryPath(path, 'managed path');
  const resolved = resolve(artRoot, ...productPath.split('/'));
  const exactEntry =
    options.entryBasename === undefined
      ? undefined
      : resolve(dirname(artRoot), options.entryBasename);
  const rel = relative(artRoot, resolved);
  const confined = rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
  if (!confined && resolved !== exactEntry) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `managed path "${path}" escapes the artifact directory`,
    );
  }
  await rejectSymlinkComponents(
    resolved,
    resolved === exactEntry ? dirname(artRoot) : artRoot,
    options.requireFile ?? false,
  );
  return resolved;
}

function validateRecord(record: BuildRecord, path: string): void {
  if (record.source.hash !== record.source.snapshotHash) {
    throw invalid(`${path}.source`, 'hash and snapshotHash must match');
  }
  orderedUnique(record.plan.inputs, (item) => item.id, `${path}.plan.inputs`);
  orderedUnique(
    record.plan.deterministicInputs,
    (item) => item,
    `${path}.plan.deterministicInputs`,
  );
  orderedUnique(record.products, (item) => item.path, `${path}.products`);
  unique(record.products, (item) => item.id, `${path}.products`);
  if (
    record.products.filter((product) => product.kind === 'entry').length > 1
  ) {
    throw invalid(`${path}.products`, 'must contain at most one entry product');
  }
  unique(record.plan.steps, (item) => item.id, `${path}.plan.steps`);
  const inputs = new Map(record.plan.inputs.map((input) => [input.id, input]));
  const declaredDeterministic = record.plan.inputs
    .filter((input) => input.kind === 'generator' || input.kind === 'checker')
    .map((input) => input.id);
  if (
    canonicalJson(declaredDeterministic) !==
    canonicalJson(record.plan.deterministicInputs)
  ) {
    throw invalid(
      `${path}.plan.deterministicInputs`,
      'must contain every and only generator/checker plan input',
    );
  }
  const productDeterministicInputs = [
    ...new Set(
      record.products
        .filter((product) => product.kind !== 'semantic')
        .flatMap((product) => product.inputs),
    ),
  ].sort(compareStrings);
  if (
    canonicalJson(productDeterministicInputs) !==
    canonicalJson(record.plan.deterministicInputs)
  ) {
    throw invalid(
      `${path}.plan.deterministicInputs`,
      'must equal the generator/checker inputs used by deterministic products',
    );
  }
  for (const id of record.plan.deterministicInputs) {
    const input = inputs.get(id);
    if (
      input === undefined ||
      (input.kind !== 'generator' && input.kind !== 'checker')
    ) {
      throw invalid(
        `${path}.plan.deterministicInputs`,
        `references non-deterministic input "${id}"`,
      );
    }
  }
  for (const [index, product] of record.products.entries()) {
    orderedUnique(
      product.inputs,
      (input) => input,
      `${path}.products[${index}].inputs`,
    );
    if (product.kind === 'semantic' && product.inputs.length !== 0) {
      throw invalid(
        `${path}.products[${index}].inputs`,
        'must be empty for a semantic product',
      );
    }
    if (product.kind !== 'semantic' && product.inputs.length === 0) {
      throw invalid(
        `${path}.products[${index}].inputs`,
        'must name a generator or checker for a deterministic product',
      );
    }
    for (const inputId of product.inputs) {
      const input = inputs.get(inputId);
      if (input?.kind !== 'generator' && input?.kind !== 'checker') {
        throw invalid(
          `${path}.products[${index}].inputs`,
          `references non-deterministic input "${inputId}"`,
        );
      }
    }
  }
  const products = new Map(
    record.products.map((product) => [product.id, product]),
  );
  const semanticTargets = new Set<string>();
  if (record.plan.steps.length === 0) {
    throw invalid(`${path}.plan.steps`, 'must contain at least one step');
  }
  const linkSteps = record.plan.steps.filter((step) => step.kind === 'link');
  if (
    (record.plan.invocation.kind === 'full' && linkSteps.length !== 0) ||
    (record.plan.invocation.kind === 'full-link' &&
      (linkSteps.length !== 1 || record.plan.steps.at(-1)?.kind !== 'link'))
  ) {
    throw invalid(
      `${path}.plan.steps`,
      'must contain exactly one final link step only for full-link',
    );
  }
  const ownedInputs = new Map<string, number>();
  for (let index = 0; index < record.plan.steps.length; index++) {
    const step = record.plan.steps[index];
    orderedUnique(
      step.inputs,
      (item) => item,
      `${path}.plan.steps[${index}].inputs`,
    );
    for (const input of step.inputs) {
      if (!inputs.has(input)) {
        throw invalid(
          `${path}.plan.steps[${index}].inputs`,
          `references unknown input "${input}"`,
        );
      }
      ownedInputs.set(input, (ownedInputs.get(input) ?? 0) + 1);
    }
    const stepPlanInputs = step.inputs.map((input) => inputs.get(input));
    const count = (kind: PlanInputKind): number =>
      stepPlanInputs.filter((input) => input?.kind === kind).length;
    if (count('definition') !== 1 || count('executor') !== 1) {
      throw invalid(
        `${path}.plan.steps[${index}].inputs`,
        'must own exactly one definition and one executor',
      );
    }
    if (step.kind === 'link') {
      const link = record.plan.invocation.link;
      const linkTargets = stepPlanInputs.filter(
        (input) => input?.kind === 'link-target',
      );
      const options = stepPlanInputs.filter(
        (input) => input?.kind === 'option',
      );
      if (
        link === null ||
        linkTargets.length !== 1 ||
        (linkTargets[0]?.locator !== null &&
          linkTargets[0]?.locator !== link.target) ||
        options.length !== link.options.length ||
        !sameMultiset(
          options.map((input) => input?.value ?? ''),
          link.options.map((option) => option.value),
        )
      ) {
        throw invalid(
          `${path}.plan.steps[${index}].inputs`,
          'must own the invocation link target and every link option',
        );
      }
    } else if (count('link-target') !== 0 || count('option') !== 0) {
      throw invalid(
        `${path}.plan.steps[${index}].inputs`,
        'compile steps must not own link targets or options',
      );
    }
    const product = products.get(step.target.product);
    if (
      product === undefined ||
      product.kind !== 'semantic' ||
      product.path !== step.target.path
    ) {
      throw invalid(
        `${path}.plan.steps[${index}].target`,
        'does not match one semantic product',
      );
    }
    if (semanticTargets.has(product.id)) {
      throw invalid(
        `${path}.plan.steps`,
        `targets product "${product.id}" more than once`,
      );
    }
    semanticTargets.add(product.id);
    const operand =
      index === 0
        ? { kind: 'source', hash: record.source.hash }
        : {
            kind: 'product',
            product: record.plan.steps[index - 1].target.product,
            hash: products.get(record.plan.steps[index - 1].target.product)
              ?.hash,
          };
    const expectedInputKey = hashBytes(
      new TextEncoder().encode(canonicalJson([step.id, [operand]])),
    );
    if (step.inputKey !== expectedInputKey) {
      throw invalid(
        `${path}.plan.steps[${index}].inputKey`,
        'does not match its canonical request-input projection',
      );
    }
    if (step.trace !== null) {
      const predecessorHash =
        index === 0
          ? record.source.hash
          : products.get(record.plan.steps[index - 1].target.product)?.hash;
      if (
        step.trace.input.hash !== predecessorHash ||
        step.trace.target.hash !== product.hash
      ) {
        throw invalid(
          `${path}.plan.steps[${index}].trace`,
          'does not bind the recorded input and target products',
        );
      }
    }
  }
  for (const input of record.plan.inputs) {
    if (
      (input.kind === 'definition' ||
        input.kind === 'executor' ||
        input.kind === 'semantic-input' ||
        input.kind === 'link-target' ||
        input.kind === 'option') &&
      ownedInputs.get(input.id) !== 1
    ) {
      throw invalid(
        `${path}.plan.inputs`,
        `input "${input.id}" must be owned by exactly one step`,
      );
    }
  }
  for (const step of record.plan.steps) {
    if (
      step.inputs.some((inputId) => {
        const input = inputs.get(inputId);
        return input?.kind === 'generator' || input?.kind === 'checker';
      })
    ) {
      throw invalid(
        `${path}.plan.steps`,
        'semantic steps must not own deterministic generator/checker inputs',
      );
    }
  }
  for (const product of record.products) {
    if (product.kind === 'semantic' && !semanticTargets.has(product.id)) {
      throw invalid(
        `${path}.products`,
        `semantic product "${product.id}" has no producing step`,
      );
    }
  }
  const roles = record.provenance.packages.map((pkg) => pkg.role);
  const expectedRoles =
    record.plan.invocation.kind === 'full'
      ? ['slc', 'pipeline']
      : ['slc', 'pipeline', 'link-runtime'];
  if (canonicalJson(roles) !== canonicalJson(expectedRoles)) {
    throw invalid(
      `${path}.provenance.packages`,
      `must have roles ${expectedRoles.join(', ')}`,
    );
  }
  orderedUnique(
    record.provenance.compatibility,
    (item) => item.name,
    `${path}.provenance.compatibility`,
  );
  for (const compatibility of record.provenance.compatibility) {
    if (compatibility.currentness === 'provenance') {
      if (compatibility.input !== null) {
        throw invalid(
          `${path}.provenance.compatibility`,
          'provenance input must be null',
        );
      }
    } else {
      const input =
        compatibility.input === null
          ? undefined
          : inputs.get(compatibility.input);
      if (
        input?.kind !== 'compatibility' ||
        input.value !== compatibility.value
      ) {
        throw invalid(
          `${path}.provenance.compatibility`,
          `gate "${compatibility.name}" has no matching input`,
        );
      }
    }
  }
  for (const input of record.plan.inputs.filter(
    (candidate) => candidate.kind === 'compatibility',
  )) {
    if (
      record.provenance.compatibility.filter(
        (compatibility) => compatibility.input === input.id,
      ).length !== 1
    ) {
      throw invalid(
        `${path}.plan.inputs`,
        `compatibility input "${input.id}" must belong to exactly one gate`,
      );
    }
  }
  if (
    record.lineage.transition !== null &&
    (record.lineage.transition.from === record.lineage.transition.to ||
      record.lineage.transition.to !== record.plan.identity)
  ) {
    throw invalid(
      `${path}.lineage.transition`,
      'must identify a distinct transition to plan.identity',
    );
  }
  for (const step of record.plan.steps) {
    if (step.origin === 'user-adopted' && step.trace !== null) {
      throw invalid(`${path}.plan.steps`, 'user-adopted steps clear traces');
    }
    if (
      step.origin === 'updated' &&
      (step.kind === 'link' || step.trace === null)
    ) {
      throw invalid(
        `${path}.plan.steps`,
        'updated steps must be non-link steps with replacement traces',
      );
    }
  }
  if (
    record.lineage.transition !== null &&
    record.plan.steps.some(
      (step) => step.origin !== 'user-adopted' || step.trace !== null,
    )
  ) {
    throw invalid(
      `${path}.lineage.transition`,
      'requires a whole user-adopted lineage with cleared traces',
    );
  }
  if (planIdentity(record.plan) !== record.plan.identity) {
    throw invalid(
      `${path}.plan.identity`,
      'does not match its canonical projection',
    );
  }
}

function validateTrace(trace: UpdateTrace, path: string): void {
  for (const [name, partition] of [
    ['input', trace.input],
    ['target', trace.target],
  ] as const) {
    if (partition.byteLength === 0 && partition.scopes.length !== 0) {
      throw invalid(`${path}.${name}.scopes`, 'must be empty for zero bytes');
    }
    if (partition.byteLength > 0 && partition.scopes.length === 0) {
      throw invalid(`${path}.${name}.scopes`, 'must cover nonempty bytes');
    }
    const seen = new Set<string>();
    let cursor = 0;
    for (const scope of partition.scopes) {
      if (
        scope.start !== cursor ||
        scope.end <= scope.start ||
        scope.end > partition.byteLength
      ) {
        throw invalid(
          `${path}.${name}.scopes`,
          'must be adjacent nonempty ranges covering the bytes',
        );
      }
      if (seen.has(scope.scope)) {
        throw invalid(
          `${path}.${name}.scopes`,
          `duplicates scope "${scope.scope}"`,
        );
      }
      seen.add(scope.scope);
      cursor = scope.end;
    }
    if (cursor !== partition.byteLength) {
      throw invalid(
        `${path}.${name}.scopes`,
        'must cover the complete byte length',
      );
    }
  }
  if (trace.dependencies.length !== trace.input.scopes.length) {
    throw invalid(
      `${path}.dependencies`,
      'must contain one entry per input scope',
    );
  }
  const targetOrder = new Map(
    trace.target.scopes.map((scope, index) => [scope.scope, index]),
  );
  trace.dependencies.forEach((dependency, index) => {
    if (dependency.input !== trace.input.scopes[index]?.scope) {
      throw invalid(
        `${path}.dependencies[${index}].input`,
        'must follow input-scope order',
      );
    }
    let previous = -1;
    for (const target of dependency.targets) {
      const order = targetOrder.get(target);
      if (order === undefined || order <= previous) {
        throw invalid(
          `${path}.dependencies[${index}].targets`,
          'must name unique target scopes in target order',
        );
      }
      previous = order;
    }
  });
}

function exactObject(
  value: unknown,
  path: string,
  fields: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(path, 'must be an object');
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.length !== fields.length ||
    keys.some((key, index) => key !== fields[index])
  ) {
    throw invalid(path, `must contain fields in order: ${fields.join(', ')}`);
  }
  return input;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(path, 'must be an array');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw invalid(path, 'must be a string');
  return value;
}

function nonempty(value: unknown, path: string): string {
  const result = string(value, path);
  if (result.length === 0) throw invalid(path, 'must be non-empty');
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw invalid(path, 'must be a boolean');
  return value;
}

function hash(value: unknown, path: string): Hash {
  const result = string(value, path);
  if (!isHash(result)) throw invalid(path, 'must be a lowercase sha256 hash');
  return result;
}

function id(value: unknown, path: string): string {
  const result = string(value, path);
  if (!ID.test(result)) throw invalid(path, 'must be a valid record ID');
  return result;
}

function extension(value: unknown, path: string): string {
  const result = string(value, path);
  if (!EXTENSION.test(result))
    throw invalid(path, 'must be a canonical extension');
  return result;
}

function scopeName(value: unknown, path: string): string {
  const result = nonempty(value, path);
  for (const character of result) {
    const code = character.codePointAt(0) as number;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      throw invalid(path, 'must not contain control characters');
    }
  }
  return result;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalid(path, 'must be a positive safe integer');
  }
  return value as number;
}

function nonnegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalid(path, 'must be a nonnegative safe integer');
  }
  return value as number;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  const result = string(value, path);
  if (!allowed.includes(result)) {
    throw invalid(path, `must be one of: ${allowed.join(', ')}`);
  }
  return result as T[number];
}

function literal<const T extends string>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) throw invalid(path, `must be "${expected}"`);
  return expected;
}

function relativePath(
  value: unknown,
  path: string,
  allowParent: boolean,
): string {
  const result = string(value, path);
  if (
    result.length === 0 ||
    result.includes('\\') ||
    result.includes('\0') ||
    result.startsWith('/') ||
    /^[A-Za-z]:/.test(result)
  ) {
    throw invalid(path, 'must be a non-empty relative POSIX path');
  }
  const segments = result.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.')) {
    throw invalid(path, 'has an empty, dot, or trailing segment');
  }
  let nonParent = false;
  for (const segment of segments) {
    if (segment === '..') {
      if (!allowParent || nonParent) {
        throw invalid(path, 'is not a canonical relative locator');
      }
    } else {
      nonParent = true;
    }
  }
  return result;
}

function managedPath(value: unknown, path: string): string {
  const result = relativePath(value, path, false);
  if (result === BUILD_RECORD_FILE || result === SOURCE_SNAPSHOT_FILE) {
    throw invalid(path, 'must not name reserved lineage metadata');
  }
  return result;
}

function entryPath(value: unknown, path: string): string {
  const result = relativePath(value, path, true);
  const segments = result.split('/');
  if (
    segments.length !== 2 ||
    segments[0] !== '..' ||
    segments[1].length === 0 ||
    segments[1] === '.' ||
    segments[1] === '..'
  ) {
    throw invalid(path, 'must name exactly one canonical sibling entry');
  }
  return result;
}

function sameMultiset(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const value of left) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const value of right) {
    const count = counts.get(value);
    if (count === undefined) return false;
    if (count === 1) counts.delete(value);
    else counts.set(value, count - 1);
  }
  return counts.size === 0;
}

function orderedUnique<T>(
  values: readonly T[],
  key: (item: T) => string,
  path: string,
): void {
  let previous: Uint8Array | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = key(value);
    if (seen.has(candidate)) throw invalid(path, `duplicates "${candidate}"`);
    const encoded = new TextEncoder().encode(candidate);
    if (previous !== undefined && compareBytes(previous, encoded) >= 0) {
      throw invalid(path, 'must be sorted by UTF-8 bytes');
    }
    seen.add(candidate);
    previous = encoded;
  }
}

function unique<T>(
  values: readonly T[],
  key: (item: T) => string,
  path: string,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = key(value);
    if (seen.has(candidate)) throw invalid(path, `duplicates "${candidate}"`);
    seen.add(candidate);
  }
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function compareStrings(left: string, right: string): number {
  return compareBytes(
    new TextEncoder().encode(left),
    new TextEncoder().encode(right),
  );
}

function canonicalString(value: string): string {
  let result = '"';
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw invalid(
          'canonical JSON string',
          'contains an unpaired surrogate',
        );
      }
      result += value[index] + value[index + 1];
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw invalid('canonical JSON string', 'contains an unpaired surrogate');
    }
    const character = value[index];
    const short: Record<string, string> = {
      '"': '\\"',
      '\\': '\\\\',
      '\b': '\\b',
      '\f': '\\f',
      '\n': '\\n',
      '\r': '\\r',
      '\t': '\\t',
    };
    if (short[character] !== undefined) {
      result += short[character];
    } else if (code <= 0x1f) {
      result += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      result += character;
    }
  }
  return `${result}"`;
}

async function optionalLstat(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw new BuildRecordError(
      'lineage-unsafe',
      `${path} cannot be inspected: ${errorCode(error)}`,
    );
  }
}

function requireRegular(
  info: Awaited<ReturnType<typeof lstat>>,
  path: string,
): void {
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `${path} must be a regular non-symbolic-link file`,
    );
  }
}

async function readNoFollow(path: string): Promise<Uint8Array> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new BuildRecordError(
        'lineage-unsafe',
        `${path} must be a regular file`,
      );
    }
    return await handle.readFile();
  } catch (error) {
    if (error instanceof BuildRecordError) throw error;
    throw new BuildRecordError(
      'lineage-unsafe',
      `${path} cannot be read safely: ${errorCode(error)}`,
    );
  } finally {
    await handle?.close();
  }
}

async function rejectSymlinkComponents(
  path: string,
  boundary: string,
  requireFile: boolean,
): Promise<void> {
  const boundaryInfo = await optionalLstat(boundary);
  if (
    boundaryInfo === null ||
    !boundaryInfo.isDirectory() ||
    boundaryInfo.isSymbolicLink()
  ) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `${boundary} must be a regular non-symbolic-link directory`,
    );
  }
  const realBoundary = await realpath(boundary);
  const components: string[] = [];
  let cursor = path;
  while (cursor !== boundary && cursor !== dirname(cursor)) {
    components.push(cursor);
    cursor = dirname(cursor);
  }
  if (cursor !== boundary) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `${path} has no safe artifact-directory ancestor`,
    );
  }
  for (const component of components.reverse()) {
    const info = await optionalLstat(component);
    if (info === null) continue;
    if (info.isSymbolicLink()) {
      throw new BuildRecordError(
        'lineage-unsafe',
        `${component} is a symbolic link`,
      );
    }
  }
  const realParent = await nearestExistingRealPath(dirname(path));
  const rel = relative(realBoundary, realParent);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    throw new BuildRecordError(
      'lineage-unsafe',
      `${path} resolves outside its path boundary`,
    );
  }
  if (requireFile) {
    const info = await optionalLstat(path);
    if (info === null || !info.isFile() || info.isSymbolicLink()) {
      throw new BuildRecordError(
        'lineage-unsafe',
        `${path} must be a regular non-symbolic-link file`,
      );
    }
  }
}

async function nearestExistingRealPath(path: string): Promise<string> {
  let cursor = path;
  while (true) {
    try {
      return await realpath(cursor);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
}

function invalid(field: string, detail: string): BuildRecordError {
  return new BuildRecordError('record-invalid', `${field} ${detail}`);
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'unknown error';
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

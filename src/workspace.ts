// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Host-owned logical-to-physical phase workspace binding (DR-021). */

import { constants } from 'node:fs';
import { access, lstat, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

import { canonicalJson } from './build-record.js';
import type { ExecuteRequest } from './execution.js';
import { hashBytes, isHash, type Hash } from './hash.js';
import { hashTree } from './pin-currency.js';

export const WORKSPACE_SCHEMA = 'sublang.slc.workspace.v1' as const;
export const WORKSPACE_BEGIN = 'SLC_WORKSPACE_BEGIN';
export const WORKSPACE_END = 'SLC_WORKSPACE_END';

const AGENT_WORKSPACE_RULES = [
  'Host workspace contract (SubLang Compiler):',
  '- Treat canonical logical paths as semantic identifiers only; they grant no filesystem authority.',
  '- Use the final physical binding as the sole authority for its named host-supplied reads and one write sink.',
  '- Write only that physical sink, never a differing canonical logical target or any unrelated file.',
  '- Do not edit sources, phase or link definitions, specs, link targets, or object artifacts.',
  '- Do not commit or otherwise touch version control.',
  '- Produce a complete artifact, preserve all definition-required semantics and verbatim content, and add no domain semantics of your own.',
  '- Verify the complete artifact against the authoritative definition before finishing.',
  '- Reply with a concise summary, any benign ambiguity resolved, and any diagnostics.',
].join('\n');

export interface WorkspaceReadBinding {
  readonly role: string;
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly kind: 'file' | 'directory';
  readonly identity: Hash;
}

export interface WorkspaceWriteBinding {
  readonly role: 'target' | 'linked';
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly kind: 'file';
}

export interface WorkspaceRecord {
  readonly schema: typeof WORKSPACE_SCHEMA;
  readonly reads: readonly WorkspaceReadBinding[];
  readonly write: WorkspaceWriteBinding;
}

/** One definition-declared semantic input in its authored order. */
export interface WorkspaceSemanticInput {
  logicalPath: string;
  physicalPath?: string;
}

export interface CreateWorkspaceOptions {
  /** Root used only to normalize relative semantic request paths. */
  runRoot?: string;
  /** Physical-path overrides keyed by the exact generated read role. */
  physicalReads?: Readonly<Record<string, string>>;
  /** Definition-declared semantic inputs in declaration order. */
  semanticInputs?: readonly WorkspaceSemanticInput[];
  /** The sole physical output sink; defaults to the canonical logical target. */
  physicalWrite?: string;
  /**
   * Physical prior operand and target paths bound only by an update compile,
   * with the canonical logical names they stand for.
   */
  priorReads?: {
    input: string;
    inputLogical: string;
    target: string;
    targetLogical: string;
  };
}

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** Builds and validates the exact ordinary compile/link workspace record. */
export async function createWorkspaceRecord(
  request: ExecuteRequest,
  options: CreateWorkspaceOptions = {},
): Promise<WorkspaceRecord> {
  const root = resolve(options.runRoot ?? process.cwd());
  const logical = (path: string): string => resolve(root, path);
  const physical = (role: string, path: string): string =>
    resolve(root, options.physicalReads?.[role] ?? path);
  const specifications: Array<{
    role: string;
    logicalPath: string;
    physicalPath: string;
  }> = [];
  const add = (role: string, path: string): void => {
    specifications.push({
      role,
      logicalPath: logical(path),
      physicalPath: physical(role, path),
    });
  };

  add('definition', request.definitionPath);
  if (request.kind === 'compile') {
    add('source', request.source);
    for (const [index, path] of (request.references ?? []).entries()) {
      add(`reference:${index}`, path);
    }
  } else {
    for (const [index, path] of request.objects.entries()) {
      add(`object:${index}`, path);
    }
    add('link-target', request.linkTarget);
  }
  for (const [index, input] of (options.semanticInputs ?? []).entries()) {
    const role = `semantic-input:${index}`;
    specifications.push({
      role,
      logicalPath: logical(input.logicalPath),
      physicalPath: resolve(root, input.physicalPath ?? input.logicalPath),
    });
  }

  // An update compile appends exactly one prior-input and one prior-target
  // after every ordinary role (DR-021 §Physical workspace binding). The
  // logical names stay canonical while the physical paths carry the prior
  // accepted bytes the request declares.
  if (request.kind === 'compile' && options.priorReads !== undefined) {
    specifications.push({
      role: 'prior-input',
      logicalPath: logical(options.priorReads.inputLogical),
      physicalPath: resolve(root, options.priorReads.input),
    });
    specifications.push({
      role: 'prior-target',
      logicalPath: logical(options.priorReads.targetLogical),
      physicalPath: resolve(root, options.priorReads.target),
    });
  }

  const reads: WorkspaceReadBinding[] = [];
  for (const specification of specifications) {
    reads.push(await identifyRead(specification));
  }
  const logicalWrite = logical(
    request.kind === 'compile' ? request.target : request.linked,
  );
  const physicalWrite = resolve(
    root,
    options.physicalWrite ??
      (request.kind === 'compile' ? request.target : request.linked),
  );
  const record: WorkspaceRecord = {
    schema: WORKSPACE_SCHEMA,
    reads,
    write: {
      role: request.kind === 'compile' ? 'target' : 'linked',
      logicalPath: logicalWrite,
      physicalPath: physicalWrite,
      kind: 'file',
    },
  };
  await validateWorkspaceRecord(record, request, {
    runRoot: root,
    semanticInputs: options.semanticInputs,
    priorReads: options.priorReads,
  });
  return freezeWorkspaceRecord(record);
}

/** Validates exact shape, request cross-binding, identities, and sink safety. */
export async function validateWorkspaceRecord(
  record: WorkspaceRecord,
  request: ExecuteRequest,
  options: Pick<
    CreateWorkspaceOptions,
    'runRoot' | 'semanticInputs' | 'priorReads'
  > = {},
): Promise<void> {
  requireExactKeys(record, ['schema', 'reads', 'write'], 'workspace');
  if (record.schema !== WORKSPACE_SCHEMA || !Array.isArray(record.reads)) {
    throw invalid('workspace schema or reads are invalid');
  }
  const root = resolve(options.runRoot ?? process.cwd());
  const expectedReads = [
    ...coreLogicalRoles(request, root),
    ...(options.semanticInputs ?? []).map((input, index) => ({
      role: `semantic-input:${index}`,
      logicalPath: resolve(root, input.logicalPath),
    })),
    // The update form appends exactly these two, last (DR-021).
    ...(request.kind === 'compile' && options.priorReads !== undefined
      ? [
          {
            role: 'prior-input',
            logicalPath: resolve(root, options.priorReads.inputLogical),
          },
          {
            role: 'prior-target',
            logicalPath: resolve(root, options.priorReads.targetLogical),
          },
        ]
      : []),
  ];
  if (record.reads.length !== expectedReads.length) {
    throw invalid('workspace does not carry the exact required read roles');
  }
  const roles = new Set<string>();
  const physical = new Map<string, { kind: string; identity: Hash }>();
  const readInodes: Array<{ dev: bigint | number; ino: bigint | number }> = [];
  for (const [index, read] of record.reads.entries()) {
    requireExactKeys(
      read,
      ['role', 'logicalPath', 'physicalPath', 'kind', 'identity'],
      `workspace.reads[${index}]`,
    );
    if (
      typeof read.role !== 'string' ||
      read.role.length === 0 ||
      roles.has(read.role)
    ) {
      throw invalid(
        `workspace read role is invalid or duplicated: ${read.role}`,
      );
    }
    roles.add(read.role);
    const expected = expectedReads[index];
    if (
      expected === undefined ||
      read.role !== expected.role ||
      read.logicalPath !== expected.logicalPath
    ) {
      throw invalid(`workspace read ${index} does not match the request`);
    }
    requireAbsoluteNormalized(read.logicalPath, `${read.role} logical path`);
    requireAbsoluteNormalized(read.physicalPath, `${read.role} physical path`);
    if (!['file', 'directory'].includes(read.kind) || !isHash(read.identity)) {
      throw invalid(
        `workspace read ${read.role} has an invalid kind or identity`,
      );
    }
    const observed = await observeRead(read.physicalPath);
    if (observed.kind !== read.kind || observed.identity !== read.identity) {
      throw invalid(
        `workspace read ${read.role} does not match physical bytes`,
      );
    }
    const prior = physical.get(read.physicalPath);
    if (
      prior !== undefined &&
      (prior.kind !== read.kind || prior.identity !== read.identity)
    ) {
      throw invalid('one physical read has conflicting workspace identities');
    }
    physical.set(read.physicalPath, {
      kind: read.kind,
      identity: read.identity,
    });
    const info = await stat(read.physicalPath, { bigint: true });
    readInodes.push({ dev: info.dev, ino: info.ino });
  }

  requireExactKeys(
    record.write,
    ['role', 'logicalPath', 'physicalPath', 'kind'],
    'workspace.write',
  );
  const logicalWrite = resolve(
    root,
    request.kind === 'compile' ? request.target : request.linked,
  );
  if (
    record.write.role !== (request.kind === 'compile' ? 'target' : 'linked') ||
    record.write.logicalPath !== logicalWrite ||
    record.write.kind !== 'file'
  ) {
    throw invalid('workspace write does not match the semantic request');
  }
  requireAbsoluteNormalized(record.write.logicalPath, 'write logical path');
  requireAbsoluteNormalized(record.write.physicalPath, 'write physical path');
  if (physical.has(record.write.physicalPath)) {
    throw invalid('workspace write aliases a physical read path');
  }
  await assertWriteSink(record.write.physicalPath, readInodes);
}

/** Exact three-line suffix transported to a performing coding agent. */
export function encodeWorkspaceContract(record: WorkspaceRecord): string {
  return [WORKSPACE_BEGIN, canonicalJson(record), WORKSPACE_END].join('\n');
}

/** Appends the sole workspace suffix and rejects ambiguous precomposed markers. */
export function appendWorkspaceContract(
  prompt: string,
  record: WorkspaceRecord,
): string {
  if (prompt.includes(WORKSPACE_BEGIN) || prompt.includes(WORKSPACE_END)) {
    throw invalid('performing prompt already contains a workspace marker');
  }
  return `${prompt}\n\n${AGENT_WORKSPACE_RULES}\n\n${encodeWorkspaceContract(record)}`;
}

/** Copies a validated binding into an immutable host-owned value. */
export function freezeWorkspaceRecord(
  record: WorkspaceRecord,
): WorkspaceRecord {
  const reads = Object.freeze(
    record.reads.map((read) =>
      Object.freeze({
        role: read.role,
        logicalPath: read.logicalPath,
        physicalPath: read.physicalPath,
        kind: read.kind,
        identity: read.identity,
      }),
    ),
  );
  return Object.freeze({
    schema: WORKSPACE_SCHEMA,
    reads,
    write: Object.freeze({
      role: record.write.role,
      logicalPath: record.write.logicalPath,
      physicalPath: record.write.physicalPath,
      kind: record.write.kind,
    }),
  });
}

function coreLogicalRoles(
  request: ExecuteRequest,
  root: string,
): Array<{ role: string; logicalPath: string }> {
  const result = [
    { role: 'definition', logicalPath: resolve(root, request.definitionPath) },
  ];
  if (request.kind === 'compile') {
    result.push({ role: 'source', logicalPath: resolve(root, request.source) });
    for (const [index, path] of (request.references ?? []).entries()) {
      result.push({
        role: `reference:${index}`,
        logicalPath: resolve(root, path),
      });
    }
  } else {
    for (const [index, path] of request.objects.entries()) {
      result.push({
        role: `object:${index}`,
        logicalPath: resolve(root, path),
      });
    }
    result.push({
      role: 'link-target',
      logicalPath: resolve(root, request.linkTarget),
    });
  }
  return result;
}

async function identifyRead(specification: {
  role: string;
  logicalPath: string;
  physicalPath: string;
}): Promise<WorkspaceReadBinding> {
  const observed = await observeRead(specification.physicalPath);
  return {
    role: specification.role,
    logicalPath: specification.logicalPath,
    physicalPath: specification.physicalPath,
    kind: observed.kind,
    identity: observed.identity,
  };
}

async function observeRead(
  path: string,
): Promise<{ kind: 'file' | 'directory'; identity: Hash }> {
  const info = await stat(path);
  if (info.isFile()) {
    return { kind: 'file', identity: hashBytes(await readFile(path)) };
  }
  if (info.isDirectory()) {
    return {
      kind: 'directory',
      identity: (await hashTree(path)) as Hash,
    };
  }
  throw invalid(`workspace read is not a regular file or directory: ${path}`);
}

async function assertWriteSink(
  path: string,
  readInodes: readonly { dev: bigint | number; ino: bigint | number }[],
): Promise<void> {
  await assertNoWritableSymlinkComponents(path);
  let info;
  try {
    info = await lstat(path, { bigint: true });
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return;
    throw invalid(`workspace write cannot be inspected: ${errorCode(error)}`);
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) {
    throw invalid(
      'workspace write must be absent or one independent regular file',
    );
  }
  if (
    readInodes.some((read) => read.dev === info.dev && read.ino === info.ino)
  ) {
    throw invalid('workspace write is a hard link to a readable input');
  }
}

async function assertNoWritableSymlinkComponents(path: string): Promise<void> {
  requireAbsoluteNormalized(path, 'workspace path');
  const root = parse(path).root;
  let cursor = root;
  const segments = path.slice(root.length).split(sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor);
      if (info.isSymbolicLink()) {
        try {
          await access(dirname(cursor), constants.W_OK);
          throw invalid(
            'workspace write traverses a writable symbolic-link component',
          );
        } catch (error) {
          if (error instanceof WorkspaceError) throw error;
        }
        continue;
      }
      if (index < segments.length - 1 && !info.isDirectory()) {
        throw invalid(`workspace path traverses a non-directory: ${cursor}`);
      }
    } catch (error) {
      if (errorCode(error) === 'ENOENT' && index === segments.length - 1) {
        return;
      }
      if (error instanceof WorkspaceError) throw error;
      throw invalid('workspace write path cannot be inspected safely');
    }
  }
}

function requireAbsoluteNormalized(path: string, field: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) {
    throw invalid(`${field} is not a normalized absolute path`);
  }
}

function requireExactKeys(
  value: unknown,
  expected: readonly string[],
  field: string,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`${field} is not an object`);
  }
  const keys = Object.keys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw invalid(`${field} fields are missing, unknown, or unordered`);
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : 'unknown error';
}

function invalid(message: string): WorkspaceError {
  return new WorkspaceError(message);
}

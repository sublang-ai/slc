// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Candidate managed-path overlays for incremental lineage transactions
 * (INCR-8; DR-021).
 *
 * This module stages and seals candidate files, calculates the exact managed
 * overlay, and revalidates the accepted basis. It deliberately cannot promote
 * anything: journal ordering and recovery belong to the next transaction
 * layer, so an overlay bug cannot partially mutate canonical state.
 */

import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  BUILD_RECORD_FILE,
  BuildRecordError,
  SOURCE_SNAPSHOT_FILE,
  isBuildRecordId,
  resolveManagedPath,
} from './build-record.js';
import { hashBytes, isHash, type Hash } from './hash.js';

export type OverlayRole =
  | 'semantic'
  | 'entry'
  | 'verification'
  | 'source-snapshot'
  | 'build-record';

export interface AcceptedOverlayMember {
  id: string;
  role: OverlayRole;
  path: string;
  identity: Hash;
}

export interface CandidateOverlayMember {
  id: string;
  role: OverlayRole;
  path: string;
  disposition: 'stage' | 'retain';
}

export type OverlayObservation =
  | { kind: 'absent' }
  | { kind: 'file' | 'tree' | 'value'; identity: Hash };

/** A source, build-input, or other exact basis identity supplied by planning. */
export interface OverlayIdentityGuard {
  id: string;
  expected: OverlayObservation;
  observe: () => OverlayObservation | Promise<OverlayObservation>;
}

export interface CreateCandidateOverlayOptions {
  artifactDir: string;
  /** Pipeline name used to derive the sole canonical sibling entry path. */
  pipeline: string;
  /** Empty for cold/pre-lineage output, otherwise from one trusted valid record. */
  accepted: readonly AcceptedOverlayMember[];
  candidate: readonly CandidateOverlayMember[];
  guards?: readonly OverlayIdentityGuard[];
}

export interface OverlayReplace {
  id: string;
  role: OverlayRole;
  path: string;
  canonicalPath: string;
  stagedPath: string;
  prior: OverlayObservation;
  candidateIdentity: Hash;
}

export interface OverlayRemove {
  id: string;
  role: OverlayRole;
  path: string;
  canonicalPath: string;
  priorIdentity: Hash;
}

export interface OverlayRetain {
  id: string;
  role: OverlayRole;
  path: string;
  canonicalPath: string;
  identity: Hash;
}

/** Immutable input to the later promotion journal. */
export interface OverlayManifest {
  replace: readonly OverlayReplace[];
  remove: readonly OverlayRemove[];
  retain: readonly OverlayRetain[];
}

export interface CandidateOverlay {
  readonly root: string;
  stagePath(path: string): string;
  readPath(path: string): string;
  assertBasisCurrent(): Promise<void>;
  seal(): Promise<SealedOverlay>;
  discard(): Promise<void>;
}

export interface SealedOverlay {
  readonly root: string;
  readonly manifest: OverlayManifest;
  assertReady(): Promise<void>;
  discard(): Promise<void>;
}

export type BuildOverlayErrorCode =
  | 'overlay-invalid'
  | 'overlay-conflict'
  | 'overlay-unsafe'
  | 'overlay-state';

export class BuildOverlayError extends Error {
  readonly code: BuildOverlayErrorCode;

  constructor(code: BuildOverlayErrorCode, message: string) {
    super(message);
    this.name = 'BuildOverlayError';
    this.code = code;
  }
}

interface ResolvedAccepted extends AcceptedOverlayMember {
  canonicalPath: string;
}

interface ResolvedCandidate extends CandidateOverlayMember {
  canonicalPath: string;
  stagedPath?: string;
}

/**
 * Creates one private candidate overlay after validating its accepted basis.
 *
 * Canonical paths are only observed; this function creates no artifact
 * directory and writes only beneath a private sibling staging directory.
 */
export async function createCandidateOverlay(
  options: CreateCandidateOverlayOptions,
): Promise<CandidateOverlay> {
  const artifactDir = resolve(options.artifactDir);
  const entryBasename = deriveEntryBasename(artifactDir, options.pipeline);
  const accepted = await resolveAccepted(
    artifactDir,
    entryBasename,
    options.accepted,
  );
  const candidate = await resolveCandidate(
    artifactDir,
    entryBasename,
    options.candidate,
  );
  validateMembers(accepted, candidate);
  const guards = normalizeGuards(options.guards ?? []);

  const basis = new Basis(
    artifactDir,
    entryBasename,
    accepted,
    candidate,
    guards,
  );
  await basis.capture();
  await basis.assertCurrent();

  const parent = dirname(artifactDir);
  const root = await mkdtemp(
    join(parent, `.${basename(artifactDir)}.slc-stage-`),
  );
  await chmod(root, 0o700);
  try {
    const stagedArtifactDir = join(root, basename(artifactDir));
    await mkdir(stagedArtifactDir, { recursive: true, mode: 0o700 });
    const staged = candidate
      .filter((member) => member.disposition === 'stage')
      .sort((left, right) => compareUtf8(left.path, right.path));
    for (const member of staged) {
      member.stagedPath =
        member.role === 'entry'
          ? join(root, entryBasename)
          : join(stagedArtifactDir, ...member.path.split('/'));
      await mkdir(dirname(member.stagedPath), {
        recursive: true,
        mode: 0o700,
      });
    }
    return new Overlay(root, basis, accepted, candidate);
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

class Basis {
  readonly expected = new Map<string, OverlayObservation>();

  constructor(
    private readonly artifactDir: string,
    private readonly entryBasename: string,
    private readonly accepted: readonly ResolvedAccepted[],
    private readonly candidate: readonly ResolvedCandidate[],
    private readonly guards: readonly OverlayIdentityGuard[],
  ) {}

  async capture(): Promise<void> {
    for (const member of this.accepted) {
      this.expected.set(member.canonicalPath, {
        kind: 'file',
        identity: member.identity,
      });
    }
    for (const member of this.candidate) {
      if (!this.expected.has(member.canonicalPath)) {
        this.expected.set(
          member.canonicalPath,
          member.role === 'build-record' || member.role === 'source-snapshot'
            ? { kind: 'absent' }
            : await observeCanonicalFile(member.canonicalPath),
        );
      }
    }
  }

  prior(path: string): OverlayObservation {
    const observation = this.expected.get(path);
    if (observation === undefined) {
      throw stateError(`canonical path ${path} has no captured basis`);
    }
    return observation;
  }

  async assertCurrent(): Promise<void> {
    for (const [path, expected] of this.expected) {
      const member = { path, role: roleForPath(path, this.artifactDir) };
      await resolveCanonicalPath(
        this.artifactDir,
        this.entryBasename,
        member.role,
        relativeMemberPath(path, this.artifactDir),
      );
      const actual = await observeCanonicalFile(path);
      requireSameObservation(`managed path ${path}`, expected, actual);
    }
    for (const guard of this.guards) {
      const actual = await guard.observe();
      validateObservation(actual, `guard ${guard.id} observation`);
      requireSameObservation(`guard ${guard.id}`, guard.expected, actual);
    }
  }
}

class Overlay implements CandidateOverlay, SealedOverlay {
  private state: 'open' | 'sealed' | 'discarded' = 'open';
  private sealedManifest: OverlayManifest | undefined;

  constructor(
    readonly root: string,
    private readonly basis: Basis,
    private readonly accepted: readonly ResolvedAccepted[],
    private readonly candidate: readonly ResolvedCandidate[],
  ) {}

  get manifest(): OverlayManifest {
    if (this.state !== 'sealed' || this.sealedManifest === undefined) {
      throw stateError('overlay has not been sealed');
    }
    return this.sealedManifest;
  }

  stagePath(path: string): string {
    this.requireLive();
    const member = this.candidate.find((item) => item.path === path);
    if (member?.disposition !== 'stage' || member.stagedPath === undefined) {
      throw invalid(`candidate path "${path}" is not staged`);
    }
    return member.stagedPath;
  }

  readPath(path: string): string {
    this.requireLive();
    const member = this.candidate.find((item) => item.path === path);
    if (member === undefined) {
      throw invalid(`candidate path "${path}" is unknown`);
    }
    return member.disposition === 'stage'
      ? (member.stagedPath as string)
      : member.canonicalPath;
  }

  async assertBasisCurrent(): Promise<void> {
    this.requireLive();
    await this.basis.assertCurrent();
  }

  async seal(): Promise<SealedOverlay> {
    if (this.state !== 'open') {
      throw stateError(`cannot seal an overlay in ${this.state} state`);
    }
    const candidateIdentities = new Map<string, Hash>();
    for (const member of this.candidate) {
      if (member.disposition === 'stage') {
        candidateIdentities.set(
          member.path,
          await observeStagedFile(this.root, member.stagedPath as string),
        );
      }
    }
    await this.basis.assertCurrent();
    this.sealedManifest = freezeManifest(
      buildManifest(
        this.accepted,
        this.candidate,
        candidateIdentities,
        this.basis,
      ),
    );
    this.state = 'sealed';
    return this;
  }

  async assertReady(): Promise<void> {
    if (this.state !== 'sealed' || this.sealedManifest === undefined) {
      throw stateError('only a sealed overlay can be promoted');
    }
    for (const operation of this.sealedManifest.replace) {
      const identity = await observeStagedFile(this.root, operation.stagedPath);
      if (identity !== operation.candidateIdentity) {
        throw conflict(`staged candidate changed: ${operation.path}`);
      }
    }
    await this.basis.assertCurrent();
  }

  async discard(): Promise<void> {
    if (this.state === 'discarded') return;
    await rm(this.root, { recursive: true, force: true });
    this.state = 'discarded';
  }

  private requireLive(): void {
    if (this.state === 'discarded') {
      throw stateError('overlay has been discarded');
    }
  }
}

function buildManifest(
  accepted: readonly ResolvedAccepted[],
  candidate: readonly ResolvedCandidate[],
  candidateIdentities: ReadonlyMap<string, Hash>,
  basis: Basis,
): OverlayManifest {
  const acceptedByPath = new Map(
    accepted.map((member) => [member.canonicalPath, member]),
  );
  const candidatePaths = new Set(
    candidate.map((member) => member.canonicalPath),
  );
  const replace: OverlayReplace[] = [];
  const retain: OverlayRetain[] = [];
  for (const member of candidate) {
    if (member.disposition === 'stage') {
      const candidateIdentity = candidateIdentities.get(member.path) as Hash;
      const priorObservation = basis.prior(member.canonicalPath);
      if (
        member.role !== 'build-record' &&
        priorObservation.kind === 'file' &&
        priorObservation.identity === candidateIdentity
      ) {
        retain.push({
          id: member.id,
          role: member.role,
          path: member.path,
          canonicalPath: member.canonicalPath,
          identity: candidateIdentity,
        });
        continue;
      }
      replace.push({
        id: member.id,
        role: member.role,
        path: member.path,
        canonicalPath: member.canonicalPath,
        stagedPath: member.stagedPath as string,
        prior: { ...priorObservation },
        candidateIdentity,
      });
    } else {
      const prior = acceptedByPath.get(
        member.canonicalPath,
      ) as ResolvedAccepted;
      retain.push({
        id: member.id,
        role: member.role,
        path: member.path,
        canonicalPath: member.canonicalPath,
        identity: prior.identity,
      });
    }
  }
  const remove = accepted
    .filter((member) => !candidatePaths.has(member.canonicalPath))
    .map(
      (member): OverlayRemove => ({
        id: member.id,
        role: member.role,
        path: member.path,
        canonicalPath: member.canonicalPath,
        priorIdentity: member.identity,
      }),
    );
  return {
    replace: replace.sort(operationOrder),
    remove: remove.sort(operationOrder),
    retain: retain.sort(operationOrder),
  };
}

async function resolveAccepted(
  artifactDir: string,
  entryBasename: string,
  members: readonly AcceptedOverlayMember[],
): Promise<ResolvedAccepted[]> {
  const result: ResolvedAccepted[] = [];
  for (const member of members) {
    validateMember(member);
    if (!isHash(member.identity)) {
      throw invalid(`accepted member "${member.id}" has an invalid identity`);
    }
    result.push({
      ...member,
      canonicalPath: await resolveCanonicalPath(
        artifactDir,
        entryBasename,
        member.role,
        member.path,
      ),
    });
  }
  return result;
}

async function resolveCandidate(
  artifactDir: string,
  entryBasename: string,
  members: readonly CandidateOverlayMember[],
): Promise<ResolvedCandidate[]> {
  const result: ResolvedCandidate[] = [];
  for (const member of members) {
    validateMember(member);
    result.push({
      ...member,
      canonicalPath: await resolveCanonicalPath(
        artifactDir,
        entryBasename,
        member.role,
        member.path,
      ),
    });
  }
  return result;
}

function validateMembers(
  accepted: readonly ResolvedAccepted[],
  candidate: readonly ResolvedCandidate[],
): void {
  uniqueMembers(accepted, 'accepted');
  uniqueMembers(candidate, 'candidate');
  requireLineagePair(accepted, 'accepted');
  requireLineagePair(candidate, 'candidate');
  rejectPathOverlap(accepted, 'accepted');
  rejectPathOverlap(candidate, 'candidate');
  if (
    candidate.find((member) => member.role === 'build-record')?.disposition !==
    'stage'
  ) {
    throw invalid('the candidate build record must be staged');
  }
  const acceptedByPath = new Map(
    accepted.map((member) => [member.canonicalPath, member]),
  );
  for (const member of candidate) {
    const prior = acceptedByPath.get(member.canonicalPath);
    if (member.disposition === 'retain') {
      if (prior === undefined) {
        throw invalid(`retained path "${member.path}" has no accepted member`);
      }
      if (prior.role !== member.role || prior.id !== member.id) {
        throw invalid(
          `retained path "${member.path}" must keep its accepted ID and role`,
        );
      }
    }
  }
}

function rejectPathOverlap(
  members: readonly { canonicalPath: string }[],
  label: string,
): void {
  const paths = members.map((member) => member.canonicalPath);
  for (const parent of paths) {
    for (const candidate of paths) {
      if (candidate !== parent && candidate.startsWith(`${parent}${sep}`)) {
        throw invalid(`${label} path ${parent} is an ancestor of ${candidate}`);
      }
    }
  }
}

function validateMember(member: {
  id: string;
  role: OverlayRole;
  path: string;
}): void {
  if (!isBuildRecordId(member.id)) {
    throw invalid(`member ID "${member.id}" is not canonical`);
  }
  if (member.path.length === 0) {
    throw invalid(`member "${member.id}" has an empty path`);
  }
}

function uniqueMembers(
  members: readonly { id: string; canonicalPath: string }[],
  label: string,
): void {
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id))
      throw invalid(`${label} duplicates ID ${member.id}`);
    if (paths.has(member.canonicalPath)) {
      throw invalid(`${label} duplicates path ${member.canonicalPath}`);
    }
    ids.add(member.id);
    paths.add(member.canonicalPath);
  }
}

function requireLineagePair(
  members: readonly { role: OverlayRole }[],
  label: string,
): void {
  const records = members.filter((member) => member.role === 'build-record');
  const snapshots = members.filter(
    (member) => member.role === 'source-snapshot',
  );
  const expected = label === 'candidate' || members.length > 0 ? 1 : 0;
  if (records.length !== expected || snapshots.length !== expected) {
    throw invalid(`${label} lineage metadata must be a complete unique pair`);
  }
}

async function resolveCanonicalPath(
  artifactDir: string,
  entryBasename: string,
  role: OverlayRole,
  path: string,
): Promise<string> {
  if (role === 'build-record' || role === 'source-snapshot') {
    const expected =
      role === 'build-record' ? BUILD_RECORD_FILE : SOURCE_SNAPSHOT_FILE;
    if (path !== expected) {
      throw invalid(`${role} must use the reserved path ${expected}`);
    }
    await assertArtifactDirectory(artifactDir);
    return resolve(artifactDir, expected);
  }
  try {
    return await resolveManagedPath(
      artifactDir,
      path,
      role === 'entry'
        ? { entryBasename, allowMissingArtifactDir: true }
        : { allowMissingArtifactDir: true },
    );
  } catch (error) {
    if (error instanceof BuildRecordError) throw unsafe(error.message);
    throw error;
  }
}

async function assertArtifactDirectory(artifactDir: string): Promise<void> {
  const info = await optionalLstat(artifactDir);
  if (info !== null) {
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw unsafe(
        `${artifactDir} must be a regular non-symbolic-link directory`,
      );
    }
    return;
  }
  const parent = dirname(artifactDir);
  const parentInfo = await optionalLstat(parent);
  if (
    parentInfo === null ||
    !parentInfo.isDirectory() ||
    parentInfo.isSymbolicLink()
  ) {
    throw unsafe(`${parent} must be a regular non-symbolic-link directory`);
  }
}

function normalizeGuards(
  guards: readonly OverlayIdentityGuard[],
): OverlayIdentityGuard[] {
  const ids = new Set<string>();
  return guards.map((guard) => {
    if (!isBuildRecordId(guard.id) || ids.has(guard.id)) {
      throw invalid(`guard ID "${guard.id}" is invalid or duplicated`);
    }
    ids.add(guard.id);
    validateObservation(guard.expected, `guard ${guard.id} expected value`);
    return {
      id: guard.id,
      expected: { ...guard.expected },
      observe: guard.observe,
    };
  });
}

function validateObservation(
  observation: OverlayObservation,
  field: string,
): void {
  if (!['absent', 'file', 'tree', 'value'].includes(observation.kind)) {
    throw invalid(`${field} has an unsupported kind`);
  }
  if (
    observation.kind !== 'absent' &&
    (!('identity' in observation) || !isHash(observation.identity))
  ) {
    throw invalid(`${field} has an invalid identity`);
  }
}

function requireSameObservation(
  field: string,
  expected: OverlayObservation,
  actual: OverlayObservation,
): void {
  if (
    expected.kind !== actual.kind ||
    (expected.kind !== 'absent' &&
      (actual.kind === 'absent' || expected.identity !== actual.identity))
  ) {
    throw conflict(`${field} changed after planning`);
  }
}

async function observeCanonicalFile(path: string): Promise<OverlayObservation> {
  const info = await optionalLstat(path);
  if (info === null) return { kind: 'absent' };
  if (!info.isFile() || info.isSymbolicLink()) {
    throw unsafe(`${path} must be a regular non-symbolic-link file`);
  }
  return { kind: 'file', identity: await hashRegularFile(path, false) };
}

async function observeStagedFile(root: string, path: string): Promise<Hash> {
  if (relativeStagePath(root, path) === null) {
    throw unsafe(`${path} escapes the private staging root`);
  }
  await assertStageComponents(root, path);
  return hashRegularFile(path, true);
}

async function hashRegularFile(
  path: string,
  singleLink: boolean,
): Promise<Hash> {
  let handle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || (singleLink && info.nlink !== 1)) {
      throw unsafe(
        `${path} must be a fresh regular non-symbolic-link candidate file`,
      );
    }
    return hashBytes(await handle.readFile());
  } catch (error) {
    if (error instanceof BuildOverlayError) throw error;
    throw unsafe(`${path} cannot be read safely: ${errorCode(error)}`);
  } finally {
    await handle?.close();
  }
}

async function assertStageComponents(
  root: string,
  path: string,
): Promise<void> {
  const rootInfo = await optionalLstat(root);
  if (
    rootInfo === null ||
    !rootInfo.isDirectory() ||
    rootInfo.isSymbolicLink()
  ) {
    throw unsafe(`${root} is not a private staging directory`);
  }
  const relative = relativeStagePath(root, path) as string;
  let cursor = root;
  const segments = relative.split('/');
  for (const [index, segment] of segments.entries()) {
    cursor = join(cursor, segment);
    const info = await optionalLstat(cursor);
    if (info === null) throw unsafe(`${cursor} is missing from staged state`);
    if (info.isSymbolicLink()) throw unsafe(`${cursor} is a symbolic link`);
    const leaf = index === segments.length - 1;
    if ((leaf && !info.isFile()) || (!leaf && !info.isDirectory())) {
      throw unsafe(`${cursor} has the wrong staged file type`);
    }
  }
}

function relativeStagePath(root: string, path: string): string | null {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const locator = relative(resolvedRoot, resolvedPath);
  if (
    locator.length === 0 ||
    locator === '..' ||
    locator.startsWith(`..${sep}`) ||
    isAbsolute(locator)
  ) {
    return null;
  }
  return locator.split(sep).join('/');
}

async function optionalLstat(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw unsafe(`${path} cannot be inspected: ${errorCode(error)}`);
  }
}

function roleForPath(path: string, artifactDir: string): OverlayRole {
  if (path === resolve(artifactDir, BUILD_RECORD_FILE)) return 'build-record';
  if (path === resolve(artifactDir, SOURCE_SNAPSHOT_FILE)) {
    return 'source-snapshot';
  }
  const locator = relative(resolve(artifactDir), resolve(path));
  return locator !== '..' &&
    !locator.startsWith(`..${sep}`) &&
    !isAbsolute(locator)
    ? 'semantic'
    : 'entry';
}

function relativeMemberPath(path: string, artifactDir: string): string {
  const root = resolve(artifactDir);
  const locator = relative(root, resolve(path));
  if (
    locator !== '..' &&
    !locator.startsWith(`..${sep}`) &&
    !isAbsolute(locator)
  ) {
    return locator.split(sep).join('/');
  }
  return `../${basename(path)}`;
}

function freezeManifest(manifest: OverlayManifest): OverlayManifest {
  const freeze = <T extends object>(value: T): T => Object.freeze(value);
  return freeze({
    replace: freeze(
      manifest.replace.map((item) =>
        freeze({ ...item, prior: freeze({ ...item.prior }) }),
      ),
    ),
    remove: freeze(manifest.remove.map((item) => freeze(item))),
    retain: freeze(manifest.retain.map((item) => freeze(item))),
  });
}

function operationOrder(
  left: { path: string },
  right: { path: string },
): number {
  return compareUtf8(left.path, right.path);
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function deriveEntryBasename(artifactDir: string, pipeline: string): string {
  if (
    pipeline.length === 0 ||
    pipeline === '.' ||
    pipeline === '..' ||
    basename(pipeline) !== pipeline ||
    pipeline.includes('\\') ||
    pipeline.includes('\0')
  ) {
    throw invalid(`pipeline "${pipeline}" is not a portable name`);
  }
  const artifactName = basename(artifactDir);
  const suffix = `.${pipeline}`;
  if (!artifactName.endsWith(suffix) || artifactName.length === suffix.length) {
    throw invalid(
      `artifact directory "${artifactName}" does not match pipeline "${pipeline}"`,
    );
  }
  const value = `${artifactName.slice(0, -suffix.length)}.ts`;
  requireEntryBasename(value);
  return value;
}

function requireEntryBasename(value: string): void {
  if (
    value.length === 0 ||
    value === '.' ||
    value === '..' ||
    value.includes('\\') ||
    value.includes('\0') ||
    basename(value) !== value
  ) {
    throw invalid(`entry basename "${value}" is not portable`);
  }
}

function invalid(message: string): BuildOverlayError {
  return new BuildOverlayError('overlay-invalid', message);
}

function conflict(message: string): BuildOverlayError {
  return new BuildOverlayError('overlay-conflict', message);
}

function unsafe(message: string): BuildOverlayError {
  return new BuildOverlayError('overlay-unsafe', message);
}

function stateError(message: string): BuildOverlayError {
  return new BuildOverlayError('overlay-state', message);
}

function errorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'unknown error';
}

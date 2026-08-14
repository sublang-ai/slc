// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Read-only currentness and conflict classification for build-v1 lineage. */

import { lstat, readdir } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import type { CanonicalBuildPlan, PlannedProduct } from './build-plan.js';
import {
  BuildRecordError,
  canonicalJson,
  encodeReadLocator,
  loadLineagePair,
  readRegularFileNoFollow,
  resolveManagedPath,
  resolveReadLocator,
  type BuildRecord,
  type PlanInput,
  type ProductRecord,
  type StepRecord,
} from './build-record.js';
import { VERIFICATION_TEST_FILES } from './deterministic-derivatives.js';
import { errorCode, messageOf } from './errors.js';
import { hashBytes, type Hash } from './hash.js';
import {
  VERIFIER_SUPPORT_DIR,
  VERIFIER_SUPPORT_FILES,
} from './verify-support.js';

export type LineageIssueCode =
  | 'lineage-invalid'
  | 'record-inventory-invalid'
  | 'source-invalid'
  | 'source-locator-changed'
  | 'source-changed'
  | 'plan-input-changed'
  | 'plan-changed'
  | 'plan-topology-incompatible'
  | 'product-inventory-changed'
  | 'semantic-product-missing'
  | 'semantic-product-changed'
  | 'deterministic-product-missing'
  | 'deterministic-product-changed'
  | 'managed-product-unsafe';

/** One stable, machine-readable reason contributing to classification. */
export interface LineageIssue {
  readonly code: LineageIssueCode;
  readonly detail: string;
  readonly inputId?: string;
  readonly productId?: string;
  readonly path?: string;
}

export interface ProductObservation {
  readonly id: string;
  readonly kind: ProductRecord['kind'];
  readonly path: string;
  readonly state: 'exact' | 'changed' | 'missing';
  readonly identity: Hash | null;
}

/** Validated prior bytes safe for later planning, but never mutated here. */
export interface LineageBasis {
  readonly record: BuildRecord;
  readonly snapshot: Uint8Array;
  readonly sourceHash: Hash;
  readonly products: readonly ProductObservation[];
  readonly recordedInputDriftIds: readonly string[];
}

export type LineageClassification =
  | { readonly state: 'cold'; readonly issues: readonly [] }
  | {
      readonly state: 'current';
      readonly issues: readonly [];
      readonly basis: LineageBasis;
      readonly wholeLineageReusable: boolean;
      readonly openStepIds: readonly string[];
    }
  | {
      readonly state: 'dirty-input';
      readonly issues: readonly LineageIssue[];
      readonly basis: LineageBasis;
      readonly ordinaryDirtySteps: readonly string[];
    }
  | {
      readonly state: 'automatic-conflict';
      readonly issues: readonly LineageIssue[];
      readonly basis: LineageBasis;
      readonly recovery: readonly ['rebuild'];
    }
  | {
      readonly state: 'adoption-eligible-conflict';
      readonly issues: readonly LineageIssue[];
      readonly basis: LineageBasis;
      readonly recovery: readonly ['adopt', 'rebuild'];
    }
  | {
      readonly state: 'incompatible';
      readonly issues: readonly LineageIssue[];
      readonly recovery: readonly ['rebuild'];
    };

/**
 * Loads and classifies one canonical lineage without invoking an executor or
 * writing any path. The supplied plan must already have passed pin validation.
 */
export async function classifyLineage(
  currentPlan: CanonicalBuildPlan,
): Promise<LineageClassification> {
  let loaded;
  try {
    loaded = await loadLineagePair(currentPlan.topology.artifactDir);
  } catch (error) {
    return incompatible(issueFromLoad(error));
  }
  if (loaded.state === 'absent') return { state: 'cold', issues: [] };

  const { record, snapshot } = loaded;
  const inventoryIssue = validateRecordedInventory(
    currentPlan.topology.artifactDir,
    record,
    currentPlan,
  );
  if (inventoryIssue !== null) return incompatible(inventoryIssue);

  const expectedLocator = encodeReadLocator(
    currentPlan.topology.artifactDir,
    currentPlan.topology.sourcePath,
  );
  if (record.source.locator !== expectedLocator) {
    return incompatible({
      code: 'source-locator-changed',
      detail: `recorded source locator ${JSON.stringify(record.source.locator)} does not match current locator ${JSON.stringify(expectedLocator)}`,
    });
  }

  let sourceHash: Hash;
  try {
    sourceHash = hashBytes(
      await readRegularFileNoFollow(currentPlan.topology.sourcePath),
    );
  } catch (error) {
    return incompatible({
      code: 'source-invalid',
      detail: messageOf(error),
      path: currentPlan.topology.sourcePath,
    });
  }

  const inputDrift = await observeRecordedInputs(
    currentPlan.topology.artifactDir,
    record,
    currentPlan,
  );
  const products = await observeProducts(
    currentPlan.topology.artifactDir,
    record,
  );
  if (products.unsafe.length > 0) return incompatible(...products.unsafe);
  const currentOnlyDeterministic = await observeCurrentOnlyDeterministic(
    currentPlan,
    record,
  );
  if (currentOnlyDeterministic.unsafe.length > 0) {
    return incompatible(...currentOnlyDeterministic.unsafe);
  }

  const topologyCompatible = sameAdoptionTopology(record, currentPlan);
  const inventoryExact = sameProductInventory(
    record.products,
    currentPlan.products,
  );
  const planExact = record.plan.identity === currentPlan.plan.identity;
  const sourceExact = sourceHash === record.source.hash;
  const adopted = isWholeLineageAdopted(record);
  const semanticMissing = products.observations.filter(
    (product) => product.kind === 'semantic' && product.state === 'missing',
  );
  const recordedProductDrift = products.observations.filter(
    (product) => product.state !== 'exact',
  );
  const deterministicPlanDrift = currentOnlyDeterministic.observations;
  const issueProductDrift = [
    ...recordedProductDrift,
    ...deterministicPlanDrift,
  ];
  const hasOutputConflict = recordedProductDrift.length > 0;

  const issues: LineageIssue[] = [];
  if (!sourceExact) {
    issues.push({
      code: 'source-changed',
      detail: 'current source bytes differ from the recorded source snapshot',
      path: currentPlan.topology.sourcePath,
    });
  }
  issues.push(...inputDrift.issues);
  if (!planExact) {
    issues.push({
      code: 'plan-changed',
      detail: 'the current canonical build identity differs from the record',
    });
  }
  if (!topologyCompatible) {
    issues.push({
      code: 'plan-topology-incompatible',
      detail:
        'the ordered semantic step roles, formats, or canonical target paths changed',
    });
  }
  if (!inventoryExact) {
    issues.push({
      code: 'product-inventory-changed',
      detail: 'the current planned product inventory differs from the record',
    });
  }
  issues.push(
    ...issueProductDrift.map(
      (product): LineageIssue => ({
        code:
          product.kind === 'semantic'
            ? product.state === 'missing'
              ? 'semantic-product-missing'
              : 'semantic-product-changed'
            : product.state === 'missing'
              ? 'deterministic-product-missing'
              : 'deterministic-product-changed',
        detail: `${product.kind} product ${product.path} is ${product.state}`,
        productId: product.id,
        path: product.path,
      }),
    ),
  );

  const basis: LineageBasis = {
    record,
    snapshot,
    sourceHash,
    products: products.observations,
    recordedInputDriftIds: inputDrift.ids,
  };

  if (semanticMissing.length > 0) {
    return incompatible(...issues);
  }
  if (hasOutputConflict) {
    if (!sourceExact) {
      return {
        state: 'automatic-conflict',
        issues,
        basis,
        recovery: ['rebuild'],
      };
    }
    if (!topologyCompatible) return incompatible(...issues);
    return {
      state: 'adoption-eligible-conflict',
      issues,
      basis,
      recovery: ['adopt', 'rebuild'],
    };
  }

  const hasPlanOrInputDrift =
    !planExact || !inventoryExact || inputDrift.ids.length > 0;
  if (adopted && (!sourceExact || hasPlanOrInputDrift)) {
    if (!sourceExact) {
      return {
        state: 'automatic-conflict',
        issues,
        basis,
        recovery: ['rebuild'],
      };
    }
    if (!topologyCompatible) return incompatible(...issues);
    return {
      state: 'adoption-eligible-conflict',
      issues,
      basis,
      recovery: ['adopt', 'rebuild'],
    };
  }
  if (!sourceExact || hasPlanOrInputDrift) {
    return {
      state: 'dirty-input',
      issues,
      basis,
      ordinaryDirtySteps: deriveOrdinaryDirtySteps({
        record,
        currentPlan,
        sourceChanged: !sourceExact,
        topologyCompatible,
        inputDriftIds: inputDrift.ids,
      }),
    };
  }

  const openStepIds = record.plan.steps
    .filter((step) => step.inputClosure === 'open')
    .map((step) => step.id);
  return {
    state: 'current',
    issues: [],
    basis,
    wholeLineageReusable: adopted || openStepIds.length === 0,
    openStepIds,
  };
}

/** Formats one classification without hiding or inventing recovery choices. */
export function formatLineageClassification(
  classification: LineageClassification,
): string[] {
  switch (classification.state) {
    case 'cold':
      return [];
    case 'current':
      return [
        classification.wholeLineageReusable
          ? 'build lineage is current; exact no-op handling is not enabled yet'
          : `build lineage is current, but steps with open input closure require execution: ${classification.openStepIds.join(', ')}`,
      ];
    case 'dirty-input':
      return [
        `build inputs changed; ordinary incremental execution is not enabled yet${formatIssues(classification.issues)}`,
      ];
    case 'automatic-conflict':
      return [
        `build lineage conflicts with current bytes${formatIssues(classification.issues)}; recovery: --rebuild`,
      ];
    case 'adoption-eligible-conflict':
      return [
        `build lineage has an unchanged-source refinement or compatible rebaseline${formatIssues(classification.issues)}; recovery: --adopt or --rebuild`,
      ];
    case 'incompatible':
      return [
        `build lineage is incompatible${formatIssues(classification.issues)}; recovery: --rebuild`,
      ];
  }
}

function incompatible(
  ...issues: readonly LineageIssue[]
): Extract<LineageClassification, { state: 'incompatible' }> {
  return { state: 'incompatible', issues, recovery: ['rebuild'] };
}

function issueFromLoad(error: unknown): LineageIssue {
  return {
    code: 'lineage-invalid',
    detail:
      error instanceof BuildRecordError ? error.message : messageOf(error),
  };
}

function formatIssues(issues: readonly LineageIssue[]): string {
  if (issues.length === 0) return '';
  return ` (${issues.map((issue) => issue.detail).join('; ')})`;
}

function isWholeLineageAdopted(record: BuildRecord): boolean {
  return record.plan.steps.every(
    (step) => step.origin === 'user-adopted' && step.trace === null,
  );
}

function sameAdoptionTopology(
  record: BuildRecord,
  currentPlan: CanonicalBuildPlan,
): boolean {
  if (record.plan.steps.length !== currentPlan.plan.steps.length) return false;
  return record.plan.steps.every((step, index) => {
    const current = currentPlan.plan.steps[index];
    return (
      current !== undefined &&
      step.kind === current.kind &&
      sameFormat(step.source, current.source) &&
      sameFormat(step.target, current.target) &&
      step.target.path === current.target.path
    );
  });
}

function sameFormat(
  left: { readonly format: string; readonly ext: string },
  right: { readonly format: string; readonly ext: string },
): boolean {
  return left.format === right.format && left.ext === right.ext;
}

function sameProductInventory(
  recorded: readonly ProductRecord[],
  current: readonly PlannedProduct[],
): boolean {
  return (
    canonicalJson(recorded.map(productDescriptor)) ===
    canonicalJson(current.map(productDescriptor))
  );
}

function productDescriptor(product: PlannedProduct | ProductRecord): {
  id: string;
  kind: ProductRecord['kind'];
  path: string;
  inputs: string[];
} {
  return {
    id: product.id,
    kind: product.kind,
    path: product.path,
    inputs: [...product.inputs],
  };
}

async function observeRecordedInputs(
  artifactDir: string,
  record: BuildRecord,
  currentPlan: CanonicalBuildPlan,
): Promise<{ ids: string[]; issues: LineageIssue[] }> {
  const current = new Map(
    currentPlan.plan.inputs.map((input) => [input.id, input]),
  );
  const ids: string[] = [];
  const issues: LineageIssue[] = [];
  for (const input of record.plan.inputs) {
    let exact = false;
    let reason = 'is absent from the current canonical plan';
    if (input.locator === null) {
      const candidate = current.get(input.id);
      exact = candidate !== undefined && samePlanInput(input, candidate);
      if (!exact && candidate !== undefined) {
        reason = 'has a different current value or identity';
      }
    } else {
      const path = resolveReadLocator(
        artifactDir,
        input.locator,
        `plan.inputs.${input.id}.locator`,
      );
      try {
        const identity = await observeIdentityPath(path);
        exact = identity === input.identity;
        reason = exact
          ? ''
          : `has identity ${identity}, expected ${input.identity}`;
      } catch (error) {
        reason = `cannot be observed safely: ${messageOf(error)}`;
      }
      const candidate = current.get(input.id);
      if (candidate === undefined || !samePlanInput(input, candidate)) {
        exact = false;
        if (reason.length === 0) reason = 'differs from the current plan';
      }
    }
    if (!exact) {
      ids.push(input.id);
      issues.push({
        code: 'plan-input-changed',
        detail: `recorded plan input ${input.id} ${reason}`,
        inputId: input.id,
        ...(input.locator === null ? {} : { path: input.locator }),
      });
    }
  }
  return { ids, issues };
}

function samePlanInput(left: PlanInput, right: PlanInput): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.locator === right.locator &&
    left.value === right.value &&
    left.identity === right.identity
  );
}

async function observeIdentityPath(path: string): Promise<Hash> {
  const before = await lstat(path);
  if (before.isSymbolicLink()) {
    throw new Error(`${path} is a symbolic link`);
  }
  if (before.isFile()) {
    return hashBytes(await readRegularFileNoFollow(path));
  }
  if (!before.isDirectory()) {
    throw new Error(`${path} is neither a regular file nor a real directory`);
  }
  return observeTreeNoFollow(path);
}

interface ExactTreeRecord {
  readonly path: string;
  readonly serialized: string;
}

async function observeTreeNoFollow(root: string): Promise<Hash> {
  const records: ExactTreeRecord[] = [];
  await collectTreeNoFollow(root, '', records);
  records.sort((left, right) => compareUtf8(left.path, right.path));
  return hashBytes(
    new TextEncoder().encode(
      records.map((record) => record.serialized).join('\n'),
    ),
  );
}

async function collectTreeNoFollow(
  root: string,
  prefix: string,
  records: ExactTreeRecord[],
): Promise<void> {
  const here = prefix ? join(root, ...prefix.split('/')) : root;
  const before = await lstat(here);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`${here} is not a real directory`);
  }
  const entriesBefore = await readDirectorySnapshot(here);
  for (const entry of entriesBefore) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(root, ...rel.split('/'));
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      throw new Error(`tree contains a symbolic link: ${rel}`);
    }
    if (info.isDirectory()) {
      await collectTreeNoFollow(root, rel, records);
    } else if (info.isFile()) {
      records.push({
        path: rel,
        serialized: serializeTreeRecord(
          'file',
          rel,
          hashBytes(await readRegularFileNoFollow(path)),
        ),
      });
    } else {
      throw new Error(`tree contains an unsupported entry: ${rel}`);
    }
  }
  const entriesAfter = await readDirectorySnapshot(here);
  const after = await lstat(here);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs ||
    canonicalJson(entriesBefore) !== canonicalJson(entriesAfter)
  ) {
    throw new Error(`${here} changed while its tree identity was read`);
  }
}

async function readDirectorySnapshot(
  path: string,
): Promise<Array<{ name: string; kind: string }>> {
  const entries = await readdir(path, {
    withFileTypes: true,
    encoding: 'buffer',
  });
  const result = entries.map((entry) => {
    const raw = entry.name;
    const name = raw.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(raw)) {
      throw new Error('tree contains a filename that is not valid UTF-8');
    }
    return {
      name,
      kind: entry.isFile()
        ? 'file'
        : entry.isDirectory()
          ? 'directory'
          : entry.isSymbolicLink()
            ? 'symlink'
            : 'other',
    };
  });
  result.sort((left, right) => compareUtf8(left.name, right.name));
  return result;
}

function serializeTreeRecord(
  kind: 'file',
  path: string,
  identity: string,
): string {
  return `[${canonicalJsonString(kind)},${canonicalJsonString(path)},${canonicalJsonString(identity)}]`;
}

function canonicalJsonString(value: string): string {
  let serialized = '"';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new Error('tree entry contains an unpaired Unicode surrogate');
    }
    if (character === '"' || character === '\\') {
      serialized += `\\${character}`;
    } else if (codePoint <= 0x1f) {
      serialized += `\\u${codePoint.toString(16).padStart(4, '0')}`;
    } else {
      serialized += character;
    }
  }
  return `${serialized}"`;
}

async function observeProducts(
  artifactDir: string,
  record: BuildRecord,
): Promise<{
  observations: ProductObservation[];
  unsafe: LineageIssue[];
}> {
  const observations: ProductObservation[] = [];
  const unsafe: LineageIssue[] = [];
  const artifactBase = artifactBasename(artifactDir, record.plan.pipeline);
  const entryBasename = `${artifactBase}.ts`;
  for (const product of record.products) {
    let path: string;
    try {
      path = await resolveManagedPath(
        artifactDir,
        product.path,
        product.kind === 'entry' ? { entryBasename } : {},
      );
    } catch (error) {
      unsafe.push(productUnsafe(product, messageOf(error)));
      continue;
    }
    let observed: Awaited<ReturnType<typeof observeOptionalManagedFile>>;
    try {
      observed = await observeOptionalManagedFile(artifactDir, path);
    } catch (error) {
      unsafe.push(productUnsafe(product, messageOf(error)));
      continue;
    }
    observations.push({
      id: product.id,
      kind: product.kind,
      path: product.path,
      state:
        observed === null
          ? 'missing'
          : observed === product.hash
            ? 'exact'
            : 'changed',
      identity: observed,
    });
  }
  return { observations, unsafe };
}

async function observeCurrentOnlyDeterministic(
  currentPlan: CanonicalBuildPlan,
  record: BuildRecord,
): Promise<{
  observations: ProductObservation[];
  unsafe: LineageIssue[];
}> {
  const observations: ProductObservation[] = [];
  const unsafe: LineageIssue[] = [];
  const artifactDir = currentPlan.topology.artifactDir;
  const entryBasename = `${currentPlan.topology.basename}.ts`;
  const currentOnly = currentPlan.products.filter(
    (product) =>
      product.kind !== 'semantic' &&
      !record.products.some(
        (prior) =>
          prior.id === product.id &&
          prior.kind === product.kind &&
          prior.path === product.path &&
          canonicalJson(prior.inputs) === canonicalJson(product.inputs),
      ),
  );
  for (const product of currentOnly) {
    let path: string;
    try {
      path = await resolveManagedPath(
        artifactDir,
        product.path,
        product.kind === 'entry' ? { entryBasename } : {},
      );
    } catch (error) {
      unsafe.push(plannedProductUnsafe(product, messageOf(error)));
      continue;
    }
    try {
      const identity = await observeOptionalManagedFile(artifactDir, path);
      observations.push({
        id: product.id,
        kind: product.kind,
        path: product.path,
        state: identity === null ? 'missing' : 'changed',
        identity,
      });
    } catch (error) {
      unsafe.push(plannedProductUnsafe(product, messageOf(error)));
    }
  }
  return { observations, unsafe };
}

async function observeOptionalManagedFile(
  artifactDir: string,
  path: string,
): Promise<Hash | null> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${path} must be a regular non-symbolic-link file`);
  }
  const parents = await captureManagedParents(artifactDir, path);
  const identity = hashBytes(await readRegularFileNoFollow(path));
  await requireManagedParentsCurrent(parents);
  return identity;
}

interface ParentIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

async function captureManagedParents(
  artifactDir: string,
  path: string,
): Promise<ParentIdentity[]> {
  const artifactRoot = resolve(artifactDir);
  const productParent = dirname(resolve(path));
  const local = isWithin(artifactRoot, productParent);
  const boundary = local ? artifactRoot : dirname(artifactRoot);
  const locator = relative(boundary, productParent);
  const directories = [boundary];
  if (locator !== '') {
    let cursor = boundary;
    for (const segment of locator.split(sep)) {
      cursor = join(cursor, segment);
      directories.push(cursor);
    }
  }
  const result: ParentIdentity[] = [];
  for (const directory of directories) {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error(
        `${directory} must be a regular non-symbolic-link directory`,
      );
    }
    result.push({
      path: directory,
      dev: info.dev,
      ino: info.ino,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
    });
  }
  return result;
}

async function requireManagedParentsCurrent(
  parents: readonly ParentIdentity[],
): Promise<void> {
  for (const expected of parents) {
    const current = await lstat(expected.path);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      current.mtimeMs !== expected.mtimeMs ||
      current.ctimeMs !== expected.ctimeMs
    ) {
      throw new Error(
        `${expected.path} changed while a managed product was read`,
      );
    }
  }
}

function isWithin(root: string, path: string): boolean {
  const locator = relative(root, path);
  return (
    locator === '' ||
    (!locator.startsWith(`..${sep}`) &&
      locator !== '..' &&
      !isAbsolute(locator))
  );
}

function productUnsafe(product: ProductRecord, detail: string): LineageIssue {
  return {
    code: 'managed-product-unsafe',
    detail: `${product.kind} product ${product.path} is unsafe: ${detail}`,
    productId: product.id,
    path: product.path,
  };
}

function plannedProductUnsafe(
  product: PlannedProduct,
  detail: string,
): LineageIssue {
  return {
    code: 'managed-product-unsafe',
    detail: `${product.kind} product ${product.path} is unsafe: ${detail}`,
    productId: product.id,
    path: product.path,
  };
}

function validateRecordedInventory(
  artifactDir: string,
  record: BuildRecord,
  currentPlan: CanonicalBuildPlan,
): LineageIssue | null {
  let artifactBase: string;
  try {
    artifactBase = artifactBasename(artifactDir, record.plan.pipeline);
  } catch (error) {
    return recordInventoryInvalid(messageOf(error));
  }
  const semantic = new Map(
    record.products
      .filter((product) => product.kind === 'semantic')
      .map((product) => [product.id, product]),
  );
  let phaseOrdinal = 0;
  let passOrdinal = 0;
  let normalizeSeen = false;
  let linkSeen = false;
  const phaseCount = record.plan.steps.filter(
    (step) => step.kind === 'phase',
  ).length;
  const hasNormalize = record.plan.steps.some(
    (step) => step.kind === 'normalize',
  );
  const hasPass = record.plan.steps.some((step) => step.kind === 'pass');
  if (phaseCount === 0) {
    return recordInventoryInvalid(
      'a canonical full build must schedule at least one phase',
    );
  }
  if (hasNormalize !== record.plan.invocation.normalize) {
    return recordInventoryInvalid(
      'the normalization step must be present exactly when invocation.normalize is true',
    );
  }
  if (!record.plan.invocation.optimize && hasPass) {
    return recordInventoryInvalid(
      'an invocation with optimize=false cannot schedule pass steps',
    );
  }
  for (const [index, step] of record.plan.steps.entries()) {
    const expectedId = (() => {
      switch (step.kind) {
        case 'normalize':
          return 'normalize:000000';
        case 'phase':
          return `phase:${ordinal(phaseOrdinal++)}`;
        case 'pass':
          return `pass:${ordinal(passOrdinal++)}`;
        case 'link':
          return 'link:000000';
      }
    })();
    if (step.id !== expectedId) {
      return recordInventoryInvalid(
        `step ${index} ID ${JSON.stringify(step.id)} is not canonical ${JSON.stringify(expectedId)}`,
      );
    }
    if (
      !isFormatToken(step.source.format) ||
      !isFormatToken(step.target.format)
    ) {
      return recordInventoryInvalid(
        `step ${step.id} has a noncanonical format token`,
      );
    }
    if (step.kind === 'normalize') {
      if (
        normalizeSeen ||
        index !== 0 ||
        step.name !== 'normalize' ||
        !sameFormat(step.source, step.target)
      ) {
        return recordInventoryInvalid(
          'normalization must be the single first normalize:000000 identity step',
        );
      }
      normalizeSeen = true;
    } else if (step.kind === 'phase') {
      if (
        step.source.format === step.target.format ||
        step.name !== `${step.source.format}2${step.target.format}`
      ) {
        return recordInventoryInvalid(
          `phase ${step.id} name/formats are not canonically related`,
        );
      }
    } else if (step.kind === 'pass') {
      const firstPass = previousNonPass(record.plan.steps, index);
      if (
        !sameFormat(step.source, step.target) ||
        firstPass?.kind !== 'phase' ||
        !isPortableName(step.name)
      ) {
        return recordInventoryInvalid(
          `pass ${step.id} is not a canonical phase-owned format-preserving pass`,
        );
      }
    } else if (
      linkSeen ||
      index !== record.plan.steps.length - 1 ||
      step.name !== 'link' ||
      step.source.format === step.target.format
    ) {
      return recordInventoryInvalid(
        'link must be the single final link:000000 identity step',
      );
    } else {
      linkSeen = true;
    }
    const predecessor = record.plan.steps[index - 1];
    if (
      predecessor !== undefined &&
      !sameFormat(predecessor.target, step.source)
    ) {
      return recordInventoryInvalid(
        `step ${step.id} source format does not follow its predecessor target`,
      );
    }
    const expectedProduct =
      step.kind === 'normalize'
        ? 'semantic:normalize.normalize'
        : step.kind === 'link'
          ? 'semantic:link.link'
          : `semantic:${step.id.replace(':', '.')}`;
    if (step.target.product !== expectedProduct) {
      return recordInventoryInvalid(
        `step ${step.id} target product is not ${expectedProduct}`,
      );
    }
    const expectedPath = canonicalSemanticPath(
      artifactBase,
      record.plan.steps,
      index,
    );
    if (step.target.path !== expectedPath) {
      return recordInventoryInvalid(
        `step ${step.id} target path is not canonical ${expectedPath}`,
      );
    }
    const product = semantic.get(expectedProduct);
    if (product?.path !== expectedPath) {
      return recordInventoryInvalid(
        `semantic product ${expectedProduct} does not own ${expectedPath}`,
      );
    }
  }

  const missingBuiltIn = missingRequiredBuiltInProduct(record, artifactBase);
  if (missingBuiltIn !== null) {
    return recordInventoryInvalid(
      `reserved deterministic inventory is missing or invalid: ${missingBuiltIn}`,
    );
  }

  for (const product of record.products) {
    if (product.kind === 'semantic') continue;
    if (
      !isKnownDeterministicProduct(record, currentPlan, artifactBase, product)
    ) {
      return recordInventoryInvalid(
        `deterministic product ${product.id} at ${product.path} is not derivable from the canonical build-v1 layout`,
      );
    }
  }
  return null;
}

function missingRequiredBuiltInProduct(
  record: BuildRecord,
  artifactBase: string,
): string | null {
  if (
    (record.plan.pipeline !== 'playbook' && record.plan.pipeline !== 'slc') ||
    !hasCanonicalSemanticFormat(record, artifactBase, 'gears') ||
    !hasCanonicalSemanticFormat(record, artifactBase, 'fsm')
  ) {
    return null;
  }
  const expected: Array<{
    id: string;
    kind: 'entry' | 'verification';
    path: string;
    inputs: string[];
  }> = [
    ...VERIFIER_SUPPORT_FILES.map((file) => ({
      id: `verification:support.${file}`,
      kind: 'verification' as const,
      path: `${VERIFIER_SUPPORT_DIR}/${file}`,
      inputs: ['checker:verification', 'generator:verification'],
    })),
    ...VERIFICATION_TEST_FILES.map((file) => ({
      id: `verification:test.${file}`,
      kind: 'verification' as const,
      path: `${artifactBase}.${file}`,
      inputs: [
        'checker:load-integrity',
        'checker:verification',
        'generator:verification',
      ],
    })),
  ];
  if (
    record.plan.pipeline === 'playbook' &&
    record.plan.invocation.kind === 'full-link' &&
    hasCanonicalLinkedPlaybook(record, artifactBase)
  ) {
    expected.push({
      id: `entry:${artifactBase}`,
      kind: 'entry',
      path: `../${artifactBase}.ts`,
      inputs: ['checker:load-integrity', 'generator:entry'],
    });
  }
  for (const descriptor of expected) {
    const product = record.products.find(
      (candidate) =>
        candidate.id === descriptor.id &&
        candidate.kind === descriptor.kind &&
        candidate.path === descriptor.path,
    );
    if (
      product === undefined ||
      !hasExactProductInputs(record, product, descriptor.inputs)
    ) {
      return `${descriptor.id} at ${descriptor.path}`;
    }
  }
  return null;
}

function artifactBasename(artifactDir: string, pipeline: string): string {
  const leaf = basename(resolve(artifactDir));
  const suffix = `.${pipeline}`;
  if (!leaf.endsWith(suffix) || leaf.length === suffix.length) {
    throw new Error(
      `artifact directory ${leaf} is not canonical for pipeline ${pipeline}`,
    );
  }
  return leaf.slice(0, -suffix.length);
}

function canonicalSemanticPath(
  artifactBase: string,
  steps: readonly StepRecord[],
  index: number,
): string {
  const step = steps[index];
  if (step === undefined) throw new Error(`missing step ${index}`);
  let qualifier = '';
  if (step.kind === 'phase' && steps[index + 1]?.kind === 'pass') {
    qualifier = '.raw';
  } else if (step.kind === 'pass' && steps[index + 1]?.kind === 'pass') {
    qualifier = `.opt${passIndexWithinGroup(steps, index) + 1}`;
  }
  return `${artifactBase}.${step.target.format}${qualifier}${step.target.ext}`;
}

function passIndexWithinGroup(
  steps: readonly StepRecord[],
  index: number,
): number {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (steps[cursor]?.kind !== 'pass') break;
    count++;
  }
  return count;
}

function previousNonPass(
  steps: readonly StepRecord[],
  index: number,
): StepRecord | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const step = steps[cursor];
    if (step?.kind !== 'pass') return step;
  }
  return undefined;
}

function isKnownDeterministicProduct(
  record: BuildRecord,
  currentPlan: CanonicalBuildPlan,
  artifactBase: string,
  product: ProductRecord,
): boolean {
  if (
    currentPlan.products.some(
      (candidate) =>
        candidate.id === product.id &&
        candidate.kind === product.kind &&
        candidate.path === product.path &&
        canonicalJson(candidate.inputs) === canonicalJson(product.inputs),
    )
  ) {
    return true;
  }
  if (
    product.kind === 'entry' &&
    record.plan.pipeline === 'playbook' &&
    record.plan.invocation.kind === 'full-link' &&
    hasCanonicalLinkedPlaybook(record, artifactBase) &&
    hasCanonicalSemanticFormat(record, artifactBase, 'gears') &&
    hasCanonicalSemanticFormat(record, artifactBase, 'fsm') &&
    hasExactProductInputs(record, product, [
      'checker:load-integrity',
      'generator:entry',
    ])
  ) {
    return (
      product.id === `entry:${artifactBase}` &&
      product.path === `../${artifactBase}.ts`
    );
  }
  if (
    product.kind !== 'verification' ||
    (record.plan.pipeline !== 'playbook' && record.plan.pipeline !== 'slc') ||
    !hasCanonicalSemanticFormat(record, artifactBase, 'gears') ||
    !hasCanonicalSemanticFormat(record, artifactBase, 'fsm')
  ) {
    return false;
  }
  for (const file of VERIFIER_SUPPORT_FILES) {
    if (
      product.id === `verification:support.${file}` &&
      product.path === `${VERIFIER_SUPPORT_DIR}/${file}` &&
      hasExactProductInputs(record, product, [
        'checker:verification',
        'generator:verification',
      ])
    ) {
      return true;
    }
  }
  for (const file of VERIFICATION_TEST_FILES) {
    if (
      product.id === `verification:test.${file}` &&
      product.path === `${artifactBase}.${file}` &&
      hasExactProductInputs(record, product, [
        'checker:load-integrity',
        'checker:verification',
        'generator:verification',
      ])
    ) {
      return true;
    }
  }
  return false;
}

function hasCanonicalLinkedPlaybook(
  record: BuildRecord,
  artifactBase: string,
): boolean {
  const final = record.plan.steps.at(-1);
  return (
    final?.kind === 'link' &&
    final.target.format === 'playbook' &&
    final.target.ext === '.ts' &&
    final.target.path === `${artifactBase}.playbook.ts` &&
    final.target.product === 'semantic:link.link'
  );
}

function hasCanonicalSemanticFormat(
  record: BuildRecord,
  artifactBase: string,
  format: 'gears' | 'fsm',
): boolean {
  return record.plan.steps.some((step, index) => {
    if (step.kind !== 'phase' || step.target.format !== format) return false;
    let final = step;
    for (let cursor = index + 1; cursor < record.plan.steps.length; cursor++) {
      const candidate = record.plan.steps[cursor];
      if (candidate?.kind !== 'pass') break;
      final = candidate;
    }
    return (
      final.target.format === format &&
      final.target.path === `${artifactBase}.${format}${final.target.ext}`
    );
  });
}

function hasExactProductInputs(
  record: BuildRecord,
  product: ProductRecord,
  inputs: readonly string[],
): boolean {
  if (canonicalJson(product.inputs) !== canonicalJson(inputs)) return false;
  const byId = new Map(record.plan.inputs.map((input) => [input.id, input]));
  return inputs.every((id) => {
    const input = byId.get(id);
    return (
      input?.kind === (id.startsWith('checker:') ? 'checker' : 'generator')
    );
  });
}

function recordInventoryInvalid(detail: string): LineageIssue {
  return { code: 'record-inventory-invalid', detail };
}

function ordinal(index: number): string {
  return index.toString().padStart(6, '0');
}

function isFormatToken(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isPortableName(value: string): boolean {
  return (
    value.length > 0 &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0')
  );
}

function deriveOrdinaryDirtySteps(options: {
  record: BuildRecord;
  currentPlan: CanonicalBuildPlan;
  sourceChanged: boolean;
  topologyCompatible: boolean;
  inputDriftIds: readonly string[];
}): string[] {
  if (!options.topologyCompatible) {
    return options.currentPlan.plan.steps.map((step) => step.id);
  }
  const dirty = new Set<string>();
  if (options.sourceChanged) {
    const first = options.currentPlan.plan.steps[0];
    if (first !== undefined) dirty.add(first.id);
  }
  const inputDrift = new Set(options.inputDriftIds);
  const priorInputs = new Map(
    options.record.plan.inputs.map((input) => [input.id, input]),
  );
  const currentInputs = new Map(
    options.currentPlan.plan.inputs.map((input) => [input.id, input]),
  );
  for (const [index, step] of options.currentPlan.plan.steps.entries()) {
    const prior = options.record.plan.steps[index];
    if (prior === undefined || !sameStepIdentity(prior, step)) {
      dirty.add(step.id);
      continue;
    }
    for (const id of new Set([...prior.inputs, ...step.inputs])) {
      const left = priorInputs.get(id);
      const right = currentInputs.get(id);
      if (
        inputDrift.has(id) ||
        left === undefined ||
        right === undefined ||
        !samePlanInput(left, right)
      ) {
        dirty.add(step.id);
        break;
      }
    }
  }
  if (
    canonicalJson(
      options.record.plan.inputs.filter(
        (input) => input.kind === 'compatibility',
      ),
    ) !==
    canonicalJson(
      options.currentPlan.plan.inputs.filter(
        (input) => input.kind === 'compatibility',
      ),
    )
  ) {
    for (const step of options.currentPlan.plan.steps) dirty.add(step.id);
  }
  if (
    canonicalJson(options.record.plan.invocation.link?.options ?? []) !==
    canonicalJson(options.currentPlan.plan.invocation.link?.options ?? [])
  ) {
    const link = options.currentPlan.plan.steps.find(
      (step) => step.kind === 'link',
    );
    if (link !== undefined) dirty.add(link.id);
  }
  return [...dirty];
}

function sameStepIdentity(
  prior: StepRecord,
  current: CanonicalBuildPlan['plan']['steps'][number],
): boolean {
  return (
    prior.id === current.id &&
    prior.kind === current.kind &&
    prior.name === current.name &&
    sameFormat(prior.source, current.source) &&
    sameFormat(prior.target, current.target) &&
    prior.target.path === current.target.path &&
    prior.target.product === current.target.product &&
    prior.inputClosure === current.inputClosure &&
    canonicalJson(prior.inputs) === canonicalJson(current.inputs)
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

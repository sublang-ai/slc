// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Canonical build orchestration for source-bound lineage (DR-021). */

import { lstat, readdir, writeFile } from 'node:fs/promises';
import {
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  identifyBuildPlan,
  planFullBuild,
  BuildPlanError,
  type BuildIdentityContext,
  type CanonicalBuildPlan,
  type CompiledSelection,
  type FullBuildTopology,
  type PlannedExecutorSelection,
  type ScheduledStep,
} from './build-plan.js';
import {
  BUILD_HASH_ALGORITHM,
  BUILD_RECORD_FILE,
  BUILD_RECORD_SCHEMA,
  SOURCE_SNAPSHOT_FILE,
  encodeBuildRecord,
  encodeReadLocator,
  loadLineagePair,
  readRegularFileNoFollow,
  resolveReadLocator,
  stepInputKey,
  type BuildRecord,
  type LoadedLineage,
  type ProductRecord,
  type StepRecord,
} from './build-record.js';
import {
  createCandidateOverlay,
  type AcceptedOverlayMember,
  type CandidateOverlay,
  type CandidateOverlayMember,
  type OverlayManifest,
  type OverlayRole,
} from './build-overlay.js';
import { promoteLineage, recoverLineagePromotion } from './build-promotion.js';
import {
  bindDeterministicDerivatives,
  describeDeterministicDerivatives,
  emitDeterministicDerivatives,
  identifyDeterministicDerivatives,
  type BoundDeterministicProduct,
  type DeterministicDerivativeDescription,
} from './deterministic-derivatives.js';
import {
  checkEmittedLoadIntegrity,
  type EmittedFileBinding,
} from './emitted-imports.js';
import { runMappedEmittedSuite } from './emitted-suite.js';
import {
  formatFailureReport,
  runPhase,
  type PhaseExecutor,
} from './execution.js';
import { hashBytes, hashFile, type Hash } from './hash.js';
import type { Invocation } from './invocation.js';
import { loadLinkFile } from './link.js';
import { loadPipeline } from './pipeline.js';
import type { ProgressSink } from './progress.js';
import {
  classifyLineage,
  formatLineageClassification,
} from './lineage-classification.js';

/** Host identities are re-derived for both initial planning and final guards. */
export type BuildIdentityProvider = (
  topology: FullBuildTopology,
) => BuildIdentityContext | Promise<BuildIdentityContext>;

/** The runner capabilities needed by the cold-lineage coordinator. */
export interface ColdLineageHost {
  executor: PhaseExecutor;
  compiled?: (selection: CompiledSelection) => PhaseExecutor;
  buildIdentity: BuildIdentityProvider;
  cwd: string;
  signal?: AbortSignal;
  progress?: ProgressSink;
}

/** A canonical lineage run returns only public outputs after promotion. */
export interface ColdLineageResult {
  ok: boolean;
  outputs: string[];
  diagnostics: string[];
}

/** Execution-control state excluded from the canonical plan identity. */
export interface CanonicalLineageOptions {
  rebuild?: true;
}

/** Executes or classifies one canonical source-bound lineage invocation. */
export async function runColdLineage(
  topology: FullBuildTopology,
  host: ColdLineageHost,
  options: CanonicalLineageOptions = {},
): Promise<ColdLineageResult> {
  await recoverLineagePromotion({
    artifactDir: topology.artifactDir,
    pipeline: topology.pipelineName,
  });
  const identified = await identifyCurrentPlan(topology, host);
  let prior: LoadedLineage = { state: 'absent' };
  let generation = 1;
  if (options.rebuild === true) {
    prior = await loadLineagePair(topology.artifactDir);
    generation = nextRebuildGeneration(prior, topology);
  } else {
    const classification = await classifyLineage(identified);
    if (classification.state !== 'cold') {
      return {
        ok: false,
        outputs: [],
        diagnostics: formatLineageClassification(classification),
      };
    }
  }
  const sourceBytes = await readSource(topology.sourcePath);
  const sourceHash = hashBytes(sourceBytes);
  const description = describeDeterministicDerivatives(topology);
  const candidate = candidateMembers(identified);
  let overlay: CandidateOverlay | undefined;
  let promotionStarted = false;

  try {
    overlay = await createCandidateOverlay({
      artifactDir: topology.artifactDir,
      pipeline: topology.pipelineName,
      accepted: acceptedLineageMembers(prior),
      candidate,
      guards: [
        {
          id: 'basis:source',
          expected: { kind: 'file', identity: sourceHash },
          observe: async () => ({
            kind: 'file' as const,
            identity: hashBytes(await readSource(topology.sourcePath)),
          }),
        },
        {
          id: 'basis:plan',
          expected: { kind: 'value', identity: identified.plan.identity },
          observe: async () => ({
            kind: 'value' as const,
            identity: (await identifyFreshPlan(topology, host)).plan.identity,
          }),
        },
      ],
    });
    await writeFile(overlay.stagePath(SOURCE_SNAPSHOT_FILE), sourceBytes);

    const execution = await executeColdSteps(identified, overlay, host);
    if (!execution.ok) return execution;

    const deterministic = await acceptDeterministicProducts(
      identified,
      description,
      overlay,
      host.cwd,
      host.signal,
    );
    if (!deterministic.ok) {
      return {
        ok: false,
        outputs: [],
        diagnostics: [...execution.diagnostics, ...deterministic.diagnostics],
      };
    }

    const record = await buildColdRecord(
      identified,
      overlay,
      sourceHash,
      generation,
    );
    const encodedRecord = encodeBuildRecord(record);
    await writeFile(overlay.stagePath(BUILD_RECORD_FILE), encodedRecord);
    const sealed = await overlay.seal();
    assertManifestMatchesRecord(
      sealed.manifest,
      record,
      sourceHash,
      hashBytes(encodedRecord),
    );

    promotionStarted = true;
    try {
      await promoteLineage({ overlay: sealed });
    } catch (error) {
      await recoverLineagePromotion({
        artifactDir: topology.artifactDir,
        pipeline: topology.pipelineName,
      });
      await sealed.discard().catch(() => undefined);
      throw error;
    }

    return {
      ok: true,
      outputs: [...execution.outputs, ...deterministic.outputs],
      diagnostics: [...execution.diagnostics, ...deterministic.diagnostics],
    };
  } finally {
    if (overlay !== undefined && !promotionStarted) {
      await overlay.discard();
    }
  }
}

async function identifyCurrentPlan(
  topology: FullBuildTopology,
  host: ColdLineageHost,
): Promise<CanonicalBuildPlan> {
  try {
    const context = await host.buildIdentity(topology);
    const deterministic = await identifyDeterministicDerivatives(topology);
    return await identifyBuildPlan(topology, {
      ...context,
      ...(deterministic === undefined
        ? { deterministic: undefined }
        : { deterministic }),
    });
  } catch (error) {
    if (error instanceof BuildPlanError && error.code === 'pin-invalid') {
      throw new BuildPlanError(
        'pin-invalid',
        `${error.message}; restore the pin through the explicit compiled-artifact build-and-review flow before retrying`,
      );
    }
    throw error;
  }
}

async function identifyFreshPlan(
  original: FullBuildTopology,
  host: ColdLineageHost,
): Promise<CanonicalBuildPlan> {
  const pipeline = await loadPipeline(original.pipeline.dir);
  const invocation = reconstructedInvocation(original);
  const topology = planFullBuild({
    invocation,
    pipeline,
    cwd: host.cwd,
    ...(invocation.kind === 'full-link'
      ? { link: await loadLinkFile(pipeline.linkFile as string) }
      : {}),
  });
  return identifyCurrentPlan(topology, host);
}

function reconstructedInvocation(
  topology: FullBuildTopology,
): Extract<Invocation, { kind: 'full' | 'full-link' }> {
  const base = {
    pipeline: topology.pipelineName,
    source: topology.sourcePath,
    output: null,
    optimize: topology.invocation.optimize,
    noOptimize: !topology.invocation.optimize,
    normalize: topology.invocation.normalize,
  };
  if (topology.invocation.kind === 'full') {
    return { kind: 'full', ...base };
  }
  const link = topology.invocation.link;
  if (link === null) throw new Error('full-link topology has no link record');
  return {
    kind: 'full-link',
    ...base,
    linkTarget: resolveReadLocator(topology.artifactDir, link.target),
    options: link.options.map((option) => ({ ...option })),
  };
}

function acceptedLineageMembers(
  lineage: LoadedLineage,
): AcceptedOverlayMember[] {
  if (lineage.state === 'absent') return [];
  return [
    {
      id: 'lineage:source-snapshot',
      role: 'source-snapshot',
      path: SOURCE_SNAPSHOT_FILE,
      identity: hashBytes(lineage.snapshot),
    },
    {
      id: 'lineage:build-record',
      role: 'build-record',
      path: BUILD_RECORD_FILE,
      identity: hashBytes(encodeBuildRecord(lineage.record)),
    },
  ];
}

function nextRebuildGeneration(
  lineage: LoadedLineage,
  topology: FullBuildTopology,
): number {
  if (lineage.state === 'absent') return 1;
  const locator = encodeReadLocator(topology.artifactDir, topology.sourcePath);
  if (locator !== lineage.record.source.locator) return 1;
  if (lineage.record.lineage.generation === Number.MAX_SAFE_INTEGER) {
    throw new Error(
      'build lineage generation cannot advance beyond Number.MAX_SAFE_INTEGER',
    );
  }
  return lineage.record.lineage.generation + 1;
}

function candidateMembers(plan: CanonicalBuildPlan): CandidateOverlayMember[] {
  return [
    ...plan.products.map((product) => ({
      id: product.id,
      role: product.kind as OverlayRole,
      path: product.path,
      disposition: 'stage' as const,
    })),
    {
      id: 'lineage:source-snapshot',
      role: 'source-snapshot' as const,
      path: SOURCE_SNAPSHOT_FILE,
      disposition: 'stage' as const,
    },
    {
      id: 'lineage:build-record',
      role: 'build-record' as const,
      path: BUILD_RECORD_FILE,
      disposition: 'stage' as const,
    },
  ];
}

async function executeColdSteps(
  plan: CanonicalBuildPlan,
  overlay: CandidateOverlay,
  host: ColdLineageHost,
): Promise<ColdLineageResult> {
  const outputs: string[] = [];
  const diagnostics: string[] = [];
  const physical = semanticPhysicalMap(plan, overlay);
  const definitions = chainDefinitions(plan.topology);
  const selections = new Map(
    plan.selections.map((selection) => [selection.stepId, selection]),
  );

  for (const step of plan.topology.steps) {
    await overlay.assertBasisCurrent();
    const target = targetOf(step);
    const startedAt = Date.now();
    host.progress?.({ kind: 'phase-start', phase: step.name, target });
    const failProgress = (): void =>
      host.progress?.({
        kind: 'phase-fail',
        phase: step.name,
        target,
        elapsedMs: Date.now() - startedAt,
      });
    let executor: PhaseExecutor;
    try {
      executor = selectedExecutor(selections.get(step.id), step, host);
    } catch (error) {
      failProgress();
      return {
        ok: false,
        outputs: [],
        diagnostics: [
          formatFailureReport({
            phase: step.name,
            target,
            reasons: [messageOf(error)],
          }),
        ],
      };
    }
    const semanticInputs = await workspaceSemanticInputs(step, plan, physical);
    const physicalReads = physicalReadOverrides(step, physical, host.cwd);
    const result = await runPhase({
      request: step.request,
      phase: step.name,
      targetExt: step.targetExt,
      executor,
      definitions,
      revalidate: async () =>
        void (await loadPipeline(plan.topology.pipeline.dir)),
      workspaceOptions: {
        runRoot: host.cwd,
        semanticInputs,
        physicalReads,
        physicalWrite: physical.get(resolve(target)) as string,
      },
      signal: host.signal,
    });
    if (!result.ok) {
      failProgress();
      return {
        ok: false,
        outputs: [],
        diagnostics: [...diagnostics, formatFailureReport(result.report)],
      };
    }
    diagnostics.push(...result.diagnostics);
    host.progress?.({
      kind: 'phase-finish',
      phase: step.name,
      target,
      elapsedMs: Date.now() - startedAt,
    });
    outputs.push(target);
  }
  return { ok: true, outputs, diagnostics };
}

function selectedExecutor(
  selection: PlannedExecutorSelection | undefined,
  step: ScheduledStep,
  host: ColdLineageHost,
): PhaseExecutor {
  if (selection === undefined) {
    throw new Error(`canonical plan has no executor selection for ${step.id}`);
  }
  if (selection.kind === 'interpreted') return host.executor;
  if (host.compiled === undefined) {
    throw new Error(
      `phase "${step.name}" is pinned to a compiled artifact, but this host has no compiled executor configured`,
    );
  }
  return host.compiled(selection.selection);
}

async function workspaceSemanticInputs(
  step: ScheduledStep,
  plan: CanonicalBuildPlan,
  physical: ReadonlyMap<string, string>,
): Promise<Array<{ logicalPath: string; physicalPath: string }>> {
  const captured = plan.workspaceReads.find(
    (candidate) => candidate.stepId === step.id,
  );
  if (captured === undefined) {
    throw new Error(`canonical plan has no workspace reads for ${step.id}`);
  }
  return captured.semanticInputs.map((logicalPath) => {
    const logical = resolve(logicalPath);
    return {
      logicalPath: logical,
      physicalPath: physical.get(logical) ?? logical,
    };
  });
}

function physicalReadOverrides(
  step: ScheduledStep,
  physical: ReadonlyMap<string, string>,
  runRoot: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  const bind = (role: string, path: string): void => {
    const logical = resolve(runRoot, path);
    result[role] = physical.get(logical) ?? logical;
  };
  bind('definition', step.request.definitionPath);
  if (step.request.kind === 'compile') {
    bind('source', step.request.source);
    for (const [index, path] of (step.request.references ?? []).entries()) {
      bind(`reference:${index}`, path);
    }
  } else {
    for (const [index, path] of step.request.objects.entries()) {
      bind(`object:${index}`, path);
    }
    bind('link-target', step.request.linkTarget);
  }
  return result;
}

function semanticPhysicalMap(
  plan: CanonicalBuildPlan,
  overlay: CandidateOverlay,
): Map<string, string> {
  const result = new Map<string, string>();
  result.set(plan.topology.sourcePath, plan.topology.sourcePath);
  for (const step of plan.topology.steps) {
    const planned = plan.products.find(
      (product) => product.id === step.product,
    );
    if (planned === undefined) {
      throw new Error(`canonical step ${step.id} has no planned product`);
    }
    result.set(resolve(targetOf(step)), overlay.stagePath(planned.path));
  }
  return result;
}

async function acceptDeterministicProducts(
  plan: CanonicalBuildPlan,
  description: DeterministicDerivativeDescription,
  overlay: CandidateOverlay,
  runRoot: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: boolean; outputs: string[]; diagnostics: string[] }> {
  const semantic = semanticPhysicalMap(plan, overlay);
  const products = new Map(
    plan.products.map((product) => [product.id, product]),
  );
  const bindings = bindDeterministicDerivatives(description, (id) => {
    const product = products.get(id);
    if (product === undefined) {
      throw new Error(`deterministic product ${id} is absent from the plan`);
    }
    return overlay.stagePath(product.path);
  });
  const emission = await emitDeterministicDerivatives({
    description,
    bindings,
    semantic: {
      ...(description.entry === undefined
        ? {}
        : { text: bindingFor(description.entry.logicalTextPath, semantic) }),
      gears: bindingFor(
        description.verification?.gearsPath ?? plan.topology.sourcePath,
        semantic,
      ),
      fsm: bindingFor(
        description.verification?.fsmPath ?? plan.topology.sourcePath,
        semantic,
      ),
      ...(description.verification?.linkedPath === undefined
        ? {}
        : {
            linked: bindingFor(description.verification.linkedPath, semantic),
          }),
    },
  });
  if (emission.failures.length > 0) {
    return {
      ok: false,
      outputs: [],
      diagnostics: emission.failures.map(
        (failure) =>
          `deterministic product ${failure.productId} failed: ${failure.message}`,
      ),
    };
  }

  const inventory = await emittedInventory(plan, bindings, semantic, runRoot);
  const modules = [
    ...plan.topology.steps
      .filter(
        (step) =>
          step.kind === 'link' &&
          (step.targetExt === '.ts' || step.targetExt === '.js'),
      )
      .map((step) => resolve(targetOf(step))),
    ...(description.entry === undefined
      ? []
      : [resolve(description.entry.logicalPath)]),
    ...(description.verification?.tests.map((test) =>
      resolve(test.logicalPath),
    ) ?? []),
  ];
  const missing = await checkEmittedLoadIntegrity({ inventory, modules });
  if (missing.length > 0) {
    return {
      ok: false,
      outputs: [],
      diagnostics: missing.map(
        ({ modulePath, specifier }) =>
          `emitted module ${modulePath} has unresolvable relative import ${specifier} (VERIFY-18)`,
      ),
    };
  }

  const verification = description.verification;
  if (verification !== undefined) {
    const testPaths = verification.tests.map((test) =>
      resolve(test.logicalPath),
    );
    const suite = await runMappedEmittedSuite({
      inventory,
      logicalRoot: commonLogicalRoot([
        ...inventory.map((binding) => binding.logicalPath),
        ...testPaths,
      ]),
      testPaths,
      viewParent: overlay.root,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!suite.ok) {
      return { ok: false, outputs: [], diagnostics: [...suite.diagnostics] };
    }
  }

  return {
    ok: true,
    outputs: emission.written.map((product) => product.logicalPath),
    diagnostics: [...emission.diagnostics],
  };
}

function bindingFor(
  logicalPath: string,
  physical: ReadonlyMap<string, string>,
): EmittedFileBinding {
  const logical = resolve(logicalPath);
  return {
    logicalPath: logical,
    physicalPath: physical.get(logical) ?? logical,
  };
}

async function emittedInventory(
  plan: CanonicalBuildPlan,
  deterministic: readonly BoundDeterministicProduct[],
  semantic: ReadonlyMap<string, string>,
  runRoot: string,
): Promise<EmittedFileBinding[]> {
  const indexed = new Map<string, string>();
  const add = (logicalPath: string, physicalPath: string): void => {
    const logical = resolve(logicalPath);
    const physical = resolve(physicalPath);
    const prior = indexed.get(logical);
    if (prior !== undefined && prior !== physical) {
      throw new Error(`emitted inventory has conflicting path ${logical}`);
    }
    indexed.set(logical, physical);
    if (extname(logical) === '.ts') {
      const runtime = `${logical.slice(0, -3)}.js`;
      const runtimePrior = indexed.get(runtime);
      if (runtimePrior !== undefined && runtimePrior !== physical) {
        throw new Error(`emitted inventory has conflicting path ${runtime}`);
      }
      indexed.set(runtime, physical);
    }
  };
  add(plan.topology.sourcePath, plan.topology.sourcePath);
  const externalPaths = new Set<string>();
  for (const step of plan.topology.steps) {
    externalPaths.add(resolve(runRoot, step.request.definitionPath));
    if (step.request.kind === 'compile') {
      for (const reference of step.request.references ?? []) {
        externalPaths.add(resolve(runRoot, reference));
      }
    } else {
      externalPaths.add(resolve(runRoot, step.request.linkTarget));
    }
  }
  for (const reads of plan.workspaceReads) {
    for (const path of reads.semanticInputs) externalPaths.add(resolve(path));
  }
  for (const path of [...externalPaths].sort(compareUtf8)) {
    await addExternalRead(path, add);
  }
  for (const [logical, physical] of semantic) add(logical, physical);
  for (const product of deterministic) {
    add(product.logicalPath, product.physicalPath);
  }
  return [...indexed].map(([logicalPath, physicalPath]) => ({
    logicalPath,
    physicalPath,
  }));
}

async function addExternalRead(
  path: string,
  add: (logicalPath: string, physicalPath: string) => void,
): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) {
    throw new Error(`external workspace read is a symbolic link: ${path}`);
  }
  if (info.isFile()) {
    add(path, path);
    return;
  }
  if (!info.isDirectory()) {
    throw new Error(`external workspace read has the wrong type: ${path}`);
  }
  const entries = (await readdir(path, { withFileTypes: true })).sort(
    (left, right) => compareUtf8(left.name, right.name),
  );
  for (const entry of entries) {
    await addExternalRead(resolve(path, entry.name), add);
  }
}

function commonLogicalRoot(paths: readonly string[]): string {
  if (paths.length === 0) {
    throw new Error('emitted suite has no logical inventory');
  }
  let root = dirname(resolve(paths[0]));
  for (const candidate of paths) {
    const path = resolve(candidate);
    while (!isStrictDescendant(root, path)) {
      const parent = dirname(root);
      if (parent === root) {
        throw new Error(`cannot derive a logical suite root for ${path}`);
      }
      root = parent;
    }
  }
  return root;
}

function isStrictDescendant(root: string, path: string): boolean {
  const locator = relative(root, path);
  return (
    locator !== '' &&
    !isAbsolute(locator) &&
    locator !== '..' &&
    !locator.startsWith(`..${sep}`)
  );
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

async function buildColdRecord(
  plan: CanonicalBuildPlan,
  overlay: CandidateOverlay,
  sourceHash: Hash,
  generation: number,
): Promise<BuildRecord> {
  const products: ProductRecord[] = await Promise.all(
    plan.products.map(async (product) => ({
      id: product.id,
      kind: product.kind,
      path: product.path,
      hash: await hashFile(overlay.readPath(product.path)),
      inputs: [...product.inputs],
    })),
  );
  const productById = new Map(products.map((product) => [product.id, product]));
  const steps: StepRecord[] = plan.plan.steps.map((step, index) => {
    const operand =
      index === 0
        ? ({ kind: 'source', hash: sourceHash } as const)
        : (() => {
            const predecessor = plan.plan.steps[index - 1];
            const product = productById.get(predecessor.target.product);
            if (product === undefined) {
              throw new Error(
                `predecessor product is missing: ${predecessor.target.product}`,
              );
            }
            return {
              kind: 'product' as const,
              product: product.id,
              hash: product.hash,
            };
          })();
    return {
      id: step.id,
      kind: step.kind,
      name: step.name,
      source: { ...step.source },
      target: { ...step.target },
      inputKey: stepInputKey(step.id, [operand]),
      inputs: [...step.inputs],
      inputClosure: step.inputClosure,
      origin: 'ordinary',
      trace: null,
    };
  });
  return {
    schema: BUILD_RECORD_SCHEMA,
    hashAlgorithm: BUILD_HASH_ALGORITHM,
    source: {
      locator: encodeReadLocator(
        plan.topology.artifactDir,
        plan.topology.sourcePath,
      ),
      hash: sourceHash,
      snapshot: SOURCE_SNAPSHOT_FILE,
      snapshotHash: sourceHash,
    },
    plan: {
      identity: plan.plan.identity,
      pipeline: plan.plan.pipeline,
      invocation: structuredClone(plan.plan.invocation),
      inputs: plan.plan.inputs.map((input) => ({ ...input })),
      deterministicInputs: [...plan.plan.deterministicInputs],
      steps,
    },
    products,
    provenance: {
      packages: plan.provenance.packages.map((pkg) => ({ ...pkg })),
      compatibility: plan.provenance.compatibility.map((value) => ({
        ...value,
      })),
    },
    lineage: { generation, transition: null },
  };
}

function assertManifestMatchesRecord(
  manifest: OverlayManifest,
  record: BuildRecord,
  snapshotHash: Hash,
  recordHash: Hash,
): void {
  const identities = new Map<string, Hash>();
  for (const replacement of manifest.replace) {
    identities.set(replacement.path, replacement.candidateIdentity);
  }
  for (const retained of manifest.retain) {
    identities.set(retained.path, retained.identity);
  }
  if (manifest.remove.length !== 0) {
    throw new Error('an ordinary lineage candidate cannot remove products');
  }
  const expectedPaths = new Set([
    ...record.products.map((product) => product.path),
    SOURCE_SNAPSHOT_FILE,
    BUILD_RECORD_FILE,
  ]);
  if (
    identities.size !== expectedPaths.size ||
    [...identities].some(([path]) => !expectedPaths.has(path))
  ) {
    throw new Error('sealed candidate inventory differs from its build record');
  }
  for (const product of record.products) {
    if (identities.get(product.path) !== product.hash) {
      throw new Error(
        `sealed product differs from its record: ${product.path}`,
      );
    }
  }
  if (identities.get(SOURCE_SNAPSHOT_FILE) !== snapshotHash) {
    throw new Error('sealed source snapshot differs from its record');
  }
  if (identities.get(BUILD_RECORD_FILE) !== recordHash) {
    throw new Error('sealed build record differs from its encoded bytes');
  }
}

async function readSource(path: string): Promise<Uint8Array> {
  return readRegularFileNoFollow(path);
}

function chainDefinitions(topology: FullBuildTopology): string[] {
  return [...topology.pipeline.phases, ...topology.pipeline.passes]
    .map((phase) => resolve(topology.pipeline.dir, `${phase.name}.md`))
    .concat(
      topology.pipeline.linkFile === null ? [] : [topology.pipeline.linkFile],
    );
}

function targetOf(step: ScheduledStep): string {
  return step.request.kind === 'compile'
    ? step.request.target
    : step.request.linked;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

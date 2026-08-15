// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Read-only full-build scheduling and canonical build-plan identity (DR-021).
 *
 * Scheduling is deliberately separate from execution: it computes the exact
 * normalize/phase/pass/link topology and paths without creating a directory or
 * constructing an executor. Identification then hashes every result-independent
 * input that can affect those steps. Product bytes, input keys, origins, traces,
 * staging, and persistence belong to later incremental-compilation layers.
 */

import { lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type ArtifactPlan,
  artifactDir,
  planArtifacts,
  parseSource,
} from './artifacts.js';
import {
  BUILD_RECORD_FILE,
  SOURCE_SNAPSHOT_FILE,
  canonicalJson,
  encodeReadLocator,
  isBuildRecordId,
  planIdentity,
  resolveReadLocator,
  type CompatibilityRecord,
  type FormatRecord,
  type InvocationRecord,
  type PackageRecord,
  type PlanIdentityProjection,
  type PlanIdentityStep,
  type PlanInput,
  type ProductRecord,
  type StepKind,
} from './build-record.js';
import type { ExecuteRequest } from './execution.js';
import { compareUtf8, hashBytes, hashFile, type Hash } from './hash.js';
import type { Invocation } from './invocation.js';
import { type LinkPhase, linkedArtifactPath } from './link.js';
import { evaluatePinFile, hashTree } from './pin-currency.js';
import { deriveDeclaredClosure } from './pin-closure.js';
import { PinError, loadPinFile, type PinRecord } from './pins.js';
import type { Phase } from './phase.js';
import type { Pipeline } from './pipeline.js';

/** A current pinned phase and the record selecting its compiled artifact. */
export interface CompiledSelection {
  phase: string;
  pipelineDir: string;
  record: PinRecord;
}

/** One scheduled semantic step, including execution paths excluded from identity. */
export interface ScheduledStep {
  id: string;
  kind: StepKind;
  name: string;
  source: FormatRecord;
  target: FormatRecord;
  product: string;
  /** Pin-map key, or null for the SLC-owned built-in normalizer. */
  pinKey: string | null;
  request: ExecuteRequest;
  targetExt: string;
}

/** Pure full/full-link topology shared by execution and lineage planning. */
export interface FullBuildTopology {
  pipeline: Pipeline;
  pipelineName: string;
  artifactDir: string;
  basename: string;
  sourcePath: string;
  invocation: InvocationRecord;
  artifacts: ArtifactPlan[];
  steps: ScheduledStep[];
}

/** File, directory-tree, or exact value material used to derive one identity. */
export type IdentitySource =
  | { kind: 'file'; path: string }
  | { kind: 'tree'; path: string }
  | { kind: 'value'; value: string };

/** One deterministic generator/checker whose identity enters the plan. */
export interface DeterministicComponent {
  id: string;
  kind: 'generator' | 'checker';
  source: IdentitySource;
}

/** One deterministic product expected from the current generator/checker set. */
export interface DeterministicProduct {
  id: string;
  kind: 'entry' | 'verification';
  path: string;
  inputs: string[];
}

/** One compatibility value, with gates entering currentness and provenance not. */
export interface CompatibilityValue {
  name: string;
  value: string;
  currentness: 'provenance' | 'gate';
}

/** Host-owned identities that generic planning cannot infer from JS functions. */
export interface BuildIdentityContext {
  /** Exact interpreted-executor implementation/configuration identity. */
  interpretedExecutor: IdentitySource;
  /** Exact compiled host transport/player/judge configuration identity. */
  compiledExecutor: IdentitySource;
  /** Stable runtime profile selected for a current compiled pin. */
  compiledProfile: (selection: CompiledSelection) => string;
  /** Optional package-resolved identity for the full-link target. */
  linkTarget?: IdentitySource;
  /** Stable deterministic tools and the products they own. */
  deterministic?: {
    components: readonly DeterministicComponent[];
    products: readonly DeterministicProduct[];
  };
  /** Package versions are provenance only and never enter plan.identity. */
  packages: readonly PackageRecord[];
  /** Compatibility gates enter plan inputs; provenance values do not. */
  compatibility?: readonly CompatibilityValue[];
}

/** Executor choice already validated while identifying the canonical plan. */
export type PlannedExecutorSelection =
  | { stepId: string; kind: 'interpreted' }
  | {
      stepId: string;
      kind: 'compiled';
      selection: CompiledSelection;
      profile: string;
    };

/** A product without result bytes, which are unavailable before execution. */
export type PlannedProduct = Pick<
  ProductRecord,
  'id' | 'kind' | 'path' | 'inputs'
>;

/** Result-independent canonical plan plus the execution topology it identifies. */
export interface CanonicalBuildPlan {
  topology: FullBuildTopology;
  plan: PlanIdentityProjection & { identity: Hash };
  products: PlannedProduct[];
  provenance: {
    packages: PackageRecord[];
    compatibility: CompatibilityRecord[];
  };
  selections: PlannedExecutorSelection[];
  /** Authored-order declared reads captured by the identified plan for execution. */
  workspaceReads: Array<{
    stepId: string;
    semanticInputs: string[];
  }>;
}

export type BuildPlanErrorCode =
  | 'plan-invalid'
  | 'pin-invalid'
  | 'identity-invalid';

export class BuildPlanError extends Error {
  readonly code: BuildPlanErrorCode;

  constructor(code: BuildPlanErrorCode, message: string) {
    super(message);
    this.name = 'BuildPlanError';
    this.code = code;
  }
}

/** Resolves the built-in pipeline-agnostic normalization definition (DR-013). */
export function normalizeDefinitionPath(): string {
  return fileURLToPath(new URL('./normalize.md', import.meta.url));
}

/** The authoritative definition path of one ordinary phase or pass. */
export function phaseDefinition(pipeline: Pipeline, name: string): string {
  return join(pipeline.dir, `${name}.md`);
}

/**
 * Plans a full or full-link run without filesystem writes or executor work.
 *
 * The effective optimize flag remains enabled by default and disabled only by
 * `--no-optimize`, matching the existing runner contract.
 */
export function planFullBuild(opts: {
  invocation: Extract<Invocation, { kind: 'full' | 'full-link' }>;
  pipeline: Pipeline;
  cwd: string;
  link?: LinkPhase;
}): FullBuildTopology {
  const { invocation, pipeline, cwd } = opts;
  const entry = pipeline.phases[0];
  if (entry === undefined) {
    throw new BuildPlanError('plan-invalid', 'pipeline has no entry phase');
  }
  if (invocation.kind === 'full-link' && opts.link === undefined) {
    throw new BuildPlanError(
      'plan-invalid',
      'full-link planning requires the loaded link definition',
    );
  }
  if (invocation.kind === 'full' && opts.link !== undefined) {
    throw new BuildPlanError(
      'plan-invalid',
      'a full build must not supply a link definition',
    );
  }

  const parsed = parseSource({
    path: invocation.source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const basename = parsed.basename;
  const normalize = invocation.normalize || parsed.raw;
  const optimize = !invocation.noOptimize;
  const resolvedCwd = resolve(cwd);
  const artDir = artifactDir(resolvedCwd, basename, invocation.pipeline);
  const artifacts = planArtifacts({
    phases: pipeline.phases,
    basename,
    artDir,
    output:
      invocation.kind === 'full' ? (invocation.output ?? undefined) : undefined,
  });
  const steps = buildCompileSteps({
    pipeline,
    plan: artifacts,
    source: invocation.source,
    artDir,
    basename,
    optimize,
    normalize,
  });

  let linkRecord: InvocationRecord['link'] = null;
  if (invocation.kind === 'full-link') {
    const link = opts.link as LinkPhase;
    const linked = linkedArtifactPath({
      kind: 'full',
      artDir,
      basename,
      linked: link.target,
      output: invocation.output,
    });
    steps.push({
      id: 'link:000000',
      kind: 'link',
      name: 'link',
      source: copyFormat(link.source),
      target: copyFormat(link.target),
      product: 'semantic:link.link',
      pinKey: 'link',
      request: {
        kind: 'link',
        definitionPath: pipeline.linkFile as string,
        objects: [artifacts[artifacts.length - 1].path],
        linkTarget: invocation.linkTarget,
        options: invocation.options.map((option) => ({ ...option })),
        linked,
      },
      targetExt: link.target.ext,
    });
    linkRecord = {
      target: encodeReadLocator(
        artDir,
        resolve(resolvedCwd, invocation.linkTarget),
      ),
      options: invocation.options.map((option) => ({ ...option })),
    };
  }

  return {
    pipeline,
    pipelineName: invocation.pipeline,
    artifactDir: artDir,
    basename,
    sourcePath: resolve(resolvedCwd, invocation.source),
    invocation: {
      kind: invocation.kind,
      normalize,
      optimize,
      link: linkRecord,
    },
    artifacts,
    steps,
  };
}

/** Builds one explicit ordinary/pass step for non-full runner forms. */
export function phaseStep(
  pipeline: Pipeline,
  phase: Phase,
  source: string,
  target: string,
  id: string = `${phase.pass ? 'pass' : 'phase'}:single`,
): ScheduledStep {
  const kind: StepKind = phase.pass ? 'pass' : 'phase';
  requireId(id, 'scheduled step');
  return {
    id,
    kind,
    name: phase.name,
    source: copyFormat(phase.source),
    target: copyFormat(phase.target),
    product: semanticProductId(id),
    pinKey: phase.name,
    request: {
      kind: 'compile',
      definitionPath: phaseDefinition(pipeline, phase.name),
      source,
      target,
    },
    targetExt: phase.target.ext,
  };
}

/**
 * Identifies every result-independent input of a full/full-link topology.
 *
 * This operation is read-only. It validates all pins before selecting their
 * recorded executor identity, but never instantiates or invokes an executor.
 */
export async function identifyBuildPlan(
  topology: FullBuildTopology,
  context: BuildIdentityContext,
): Promise<CanonicalBuildPlan> {
  const loadedPins = await loadPins(topology.pipeline.dir);
  const pinVerdicts =
    loadedPins === undefined
      ? undefined
      : await evaluatePinFile(topology.pipeline.dir, loadedPins);
  const malformed =
    pinVerdicts === undefined
      ? undefined
      : Object.entries(pinVerdicts).find(
          ([, verdict]) => verdict.status === 'malformed',
        );
  if (malformed !== undefined) {
    throw new BuildPlanError(
      'pin-invalid',
      `pin is malformed: ${malformed[1].status === 'malformed' ? malformed[1].reason : 'invalid pin index'}`,
    );
  }

  const allInputs: PlanInput[] = [];
  const identifiedSteps: PlanIdentityStep[] = [];
  const selections: PlannedExecutorSelection[] = [];
  const semanticProducts: PlannedProduct[] = [];
  const workspaceReads: CanonicalBuildPlan['workspaceReads'] = [];

  for (const step of topology.steps) {
    const token = stepToken(step);
    const definitionPath = step.request.definitionPath;
    const definitionId = `definition:${token}`;
    allInputs.push(
      await planInput(
        definitionId,
        'definition',
        {
          kind: 'file',
          path: definitionPath,
        },
        topology.artifactDir,
      ),
    );

    const references =
      step.request.kind === 'compile' ? (step.request.references ?? []) : [];
    const pin =
      step.pinKey === null ? undefined : loadedPins?.pins[step.pinKey];
    const closure = await deriveDeclaredClosure({
      pipelineDir: topology.pipeline.dir,
      definitionPath,
      boundary: pin === undefined ? undefined : loadedPins?.pathBoundary.path,
      references,
    });
    const referencePaths = new Set(references.map((path) => resolve(path)));
    workspaceReads.push({
      stepId: step.id,
      semanticInputs: [...closure.inputs]
        .map((path) => resolve(path))
        .filter((path) => !referencePaths.has(path)),
    });
    const semanticPaths = [...closure.inputs].sort((left, right) =>
      compareUtf8(
        encodeReadLocator(topology.artifactDir, left),
        encodeReadLocator(topology.artifactDir, right),
      ),
    );
    const stepInputIds = [definitionId];
    for (const [index, path] of semanticPaths.entries()) {
      const id = `semantic-input:${token}.${ordinal(index)}`;
      allInputs.push(
        await planInput(
          id,
          'semantic-input',
          { kind: 'file', path },
          topology.artifactDir,
        ),
      );
      stepInputIds.push(id);
    }

    const verdict =
      step.pinKey === null ? undefined : pinVerdicts?.[step.pinKey];
    const executorId = `executor:${token}`;
    if (pin === undefined) {
      allInputs.push(
        await planInput(
          executorId,
          'executor',
          context.interpretedExecutor,
          topology.artifactDir,
        ),
      );
      selections.push({ stepId: step.id, kind: 'interpreted' });
    } else {
      if (verdict?.status !== 'current') {
        throw new BuildPlanError(
          'pin-invalid',
          `phase "${step.name}" pin is ${verdict?.status ?? 'unavailable'}: ${verdict === undefined ? 'pin was not evaluated' : verdict.reason}`,
        );
      }
      const selection: CompiledSelection = {
        phase: step.pinKey as string,
        pipelineDir: topology.pipeline.dir,
        record: pin,
      };
      const profile = context.compiledProfile(selection);
      if (profile.length === 0) {
        throw new BuildPlanError(
          'identity-invalid',
          `compiled executor profile for "${step.name}" is empty`,
        );
      }
      allInputs.push(
        await planInput(
          executorId,
          'executor',
          await compiledExecutorSource(
            pin,
            profile,
            context.compiledExecutor,
            topology.artifactDir,
          ),
          topology.artifactDir,
        ),
      );
      selections.push({
        stepId: step.id,
        kind: 'compiled',
        selection,
        profile,
      });
    }
    stepInputIds.push(executorId);

    if (step.kind === 'link') {
      const request = step.request;
      if (request.kind !== 'link' || topology.invocation.link === null) {
        throw new BuildPlanError(
          'plan-invalid',
          'link step does not match the full-link invocation',
        );
      }
      const targetId = 'link-target:link';
      const resolvedTarget = resolveReadLocator(
        topology.artifactDir,
        topology.invocation.link.target,
      );
      allInputs.push(
        await planInput(
          targetId,
          'link-target',
          context.linkTarget ??
            (await filesystemIdentitySource(resolvedTarget)),
          topology.artifactDir,
        ),
      );
      stepInputIds.push(targetId);
      for (const [index, option] of request.options.entries()) {
        const id = `option:link.${ordinal(index)}`;
        allInputs.push({
          id,
          kind: 'option',
          locator: null,
          value: option.value,
          identity: hashValue(option.value),
        });
        stepInputIds.push(id);
      }
    }

    const targetPath = managedTargetPath(
      topology.artifactDir,
      step.request.kind === 'compile'
        ? step.request.target
        : step.request.linked,
    );
    identifiedSteps.push({
      id: step.id,
      kind: step.kind,
      name: step.name,
      source: copyFormat(step.source),
      target: {
        ...copyFormat(step.target),
        path: targetPath,
        product: step.product,
      },
      inputs: stepInputIds.sort(compareUtf8),
      inputClosure: closure.closed ? 'closed' : 'open',
    });
    semanticProducts.push({
      id: step.product,
      kind: 'semantic',
      path: targetPath,
      inputs: [],
    });
  }

  const deterministic = await identifyDeterministic(
    topology,
    context.deterministic,
  );
  allInputs.push(...deterministic.inputs);
  const compatibility = identifyCompatibility(context.compatibility ?? []);
  allInputs.push(...compatibility.inputs);
  allInputs.sort((left, right) => compareUtf8(left.id, right.id));
  unique(
    allInputs.map((input) => input.id),
    'plan input ID',
  );
  unique(
    identifiedSteps.map((step) => step.id),
    'plan step ID',
  );

  const projection: PlanIdentityProjection = {
    pipeline: topology.pipelineName,
    invocation: cloneInvocation(topology.invocation),
    inputs: allInputs,
    deterministicInputs: deterministic.inputs
      .map((input) => input.id)
      .sort(compareUtf8),
    steps: identifiedSteps,
  };
  const packages = normalizePackages(
    context.packages,
    projection.invocation.kind,
  );
  const products = [...semanticProducts, ...deterministic.products].sort(
    (left, right) => compareUtf8(left.path, right.path),
  );
  unique(
    products.map((product) => product.id),
    'product ID',
  );
  unique(
    products.map((product) => product.path),
    'product path',
  );
  if (products.filter((product) => product.kind === 'entry').length > 1) {
    throw new BuildPlanError(
      'identity-invalid',
      'the canonical plan contains more than one entry product',
    );
  }
  for (const product of products) {
    if (
      product.path === BUILD_RECORD_FILE ||
      product.path === SOURCE_SNAPSHOT_FILE
    ) {
      throw new BuildPlanError(
        'identity-invalid',
        `product "${product.id}" uses reserved lineage path "${product.path}"`,
      );
    }
  }

  return {
    topology,
    plan: { identity: planIdentity(projection), ...projection },
    products,
    provenance: {
      packages,
      compatibility: compatibility.records,
    },
    selections,
    workspaceReads,
  };
}

function buildCompileSteps(opts: {
  pipeline: Pipeline;
  plan: readonly ArtifactPlan[];
  source: string;
  artDir: string;
  basename: string;
  optimize: boolean;
  normalize: boolean;
}): ScheduledStep[] {
  const steps: ScheduledStep[] = [];
  let previous = opts.source;
  let phaseIndex = 0;
  let passIndex = 0;

  if (opts.normalize) {
    const entry = opts.pipeline.phases[0];
    const normalized = join(
      opts.artDir,
      `${opts.basename}.${entry.source.format}${entry.source.ext}`,
    );
    // A source that already sits at its own canonical normalized path would
    // have normalization read and then overwrite it. That destroys the user's
    // raw input, which COMPILE-7 requires to survive, and leaves the record
    // identifying bytes the file no longer holds — so the next run sees a
    // changed source and normalizes the normalized text again, forever.
    // Refusing is the only outcome that keeps the raw input intact.
    if (resolve(previous) === resolve(normalized)) {
      throw new BuildPlanError(
        'plan-invalid',
        `normalization would overwrite its own source ${normalized}; move the raw input outside the artifact directory, or drop --normalize`,
      );
    }
    steps.push({
      id: 'normalize:000000',
      kind: 'normalize',
      name: 'normalize',
      source: copyFormat(entry.source),
      target: copyFormat(entry.source),
      product: 'semantic:normalize.normalize',
      pinKey: null,
      request: {
        kind: 'compile',
        definitionPath: normalizeDefinitionPath(),
        source: previous,
        target: normalized,
        references: [phaseDefinition(opts.pipeline, entry.name)],
      },
      targetExt: entry.source.ext,
    });
    previous = normalized;
  }

  for (const artifact of opts.plan) {
    const phase = artifact.phase;
    const passes = opts.optimize
      ? opts.pipeline.passes.filter(
          (pass) => pass.source.format === phase.target.format,
        )
      : [];
    if (passes.length === 0) {
      const step = phaseStep(
        opts.pipeline,
        phase,
        previous,
        artifact.path,
        `phase:${ordinal(phaseIndex++)}`,
      );
      steps.push(step);
      previous = artifact.path;
      continue;
    }
    const raw = join(
      opts.artDir,
      `${opts.basename}.${phase.target.format}.raw${phase.target.ext}`,
    );
    steps.push(
      phaseStep(
        opts.pipeline,
        phase,
        previous,
        raw,
        `phase:${ordinal(phaseIndex++)}`,
      ),
    );
    previous = raw;
    passes.forEach((pass, index) => {
      const target =
        index === passes.length - 1
          ? artifact.path
          : join(
              opts.artDir,
              `${opts.basename}.${phase.target.format}.opt${index + 1}${phase.target.ext}`,
            );
      steps.push(
        phaseStep(
          opts.pipeline,
          pass,
          previous,
          target,
          `pass:${ordinal(passIndex++)}`,
        ),
      );
      previous = target;
    });
  }
  return steps;
}

async function planInput(
  id: string,
  kind: PlanInput['kind'],
  source: IdentitySource,
  artifactDirPath: string,
): Promise<PlanInput> {
  requireId(id, 'plan input');
  return { id, kind, ...(await identityMaterial(source, artifactDirPath)) };
}

async function identityMaterial(
  source: IdentitySource,
  artifactDirPath: string,
): Promise<Pick<PlanInput, 'locator' | 'value' | 'identity'>> {
  if (source.kind === 'value') {
    return {
      locator: null,
      value: source.value,
      identity: hashValue(source.value),
    };
  }
  await validateIdentitySource(source);
  const path = resolve(source.path);
  const identity =
    source.kind === 'file'
      ? await hashFile(path)
      : ((await hashTree(path, { rejectSymlinks: true })) as Hash);
  return {
    locator: encodeReadLocator(artifactDirPath, path),
    value: null,
    identity,
  };
}

async function filesystemIdentitySource(path: string): Promise<IdentitySource> {
  const resolved = resolve(path);
  const info = await lstat(resolved);
  if (info.isSymbolicLink()) {
    throw new BuildPlanError(
      'identity-invalid',
      `link-target identity is a symbolic link: ${resolved}`,
    );
  }
  if (info.isFile()) return { kind: 'file', path: resolved };
  if (info.isDirectory()) return { kind: 'tree', path: resolved };
  throw new BuildPlanError(
    'identity-invalid',
    `link-target identity has the wrong file type: ${resolved}`,
  );
}

async function compiledExecutorSource(
  record: PinRecord,
  profile: string,
  hostSource: IdentitySource,
  artifactDirPath: string,
): Promise<IdentitySource> {
  const runtimeDependencies = record.runtimeDependencies
    .map((dependency) => ({
      kind: dependency.kind,
      locator: dependency.locator,
      identity: dependency.identity,
      specifier: dependency.specifier ?? null,
    }))
    .sort((left, right) =>
      compareUtf8(canonicalJson(left), canonicalJson(right)),
    );
  const externalInputs = record.externalInputs
    .map((input) => ({
      identity: input.identity,
    }))
    .sort((left, right) =>
      compareUtf8(canonicalJson(left), canonicalJson(right)),
    );
  return {
    kind: 'value',
    value: canonicalJson({
      schema: 'sublang.slc.compiled-executor.v1',
      profile,
      host: await identityMaterial(hostSource, artifactDirPath),
      artifact: {
        path: record.artifact.path,
        hash: record.artifact.hash,
      },
      artifactBundle: {
        path: record.artifactBundle.path,
        hash: record.artifactBundle.hash,
      },
      externalInputs,
      runtimeDependencies,
      linkTarget: {
        kind: record.linkTarget.kind,
        locator: record.linkTarget.locator,
        identity: record.linkTarget.identity,
      },
    }),
  };
}

async function identifyDeterministic(
  topology: FullBuildTopology,
  deterministic: BuildIdentityContext['deterministic'],
): Promise<{ inputs: PlanInput[]; products: PlannedProduct[] }> {
  if (deterministic === undefined) return { inputs: [], products: [] };
  const inputs = await Promise.all(
    deterministic.components.map((component) =>
      planInput(
        component.id,
        component.kind,
        component.source,
        topology.artifactDir,
      ),
    ),
  );
  inputs.sort((left, right) => compareUtf8(left.id, right.id));
  unique(
    inputs.map((input) => input.id),
    'deterministic component ID',
  );
  const byId = new Map(inputs.map((input) => [input.id, input]));
  const products = deterministic.products.map((product) => {
    requireId(product.id, 'deterministic product');
    const productInputs = [...product.inputs].sort(compareUtf8);
    if (productInputs.length === 0) {
      throw new BuildPlanError(
        'identity-invalid',
        `deterministic product "${product.id}" has no generator or checker`,
      );
    }
    unique(productInputs, `deterministic product ${product.id} input`);
    for (const input of productInputs) {
      if (!byId.has(input)) {
        throw new BuildPlanError(
          'identity-invalid',
          `deterministic product "${product.id}" references unknown component "${input}"`,
        );
      }
    }
    const path = encodeReadLocator(topology.artifactDir, resolve(product.path));
    if (product.kind === 'entry') {
      if (path !== `../${topology.basename}.ts`) {
        throw new BuildPlanError(
          'identity-invalid',
          `entry product "${product.id}" is not the canonical sibling entry`,
        );
      }
    } else if (path.split('/').includes('..')) {
      throw new BuildPlanError(
        'identity-invalid',
        `verification product "${product.id}" escapes the artifact directory`,
      );
    }
    return {
      id: product.id,
      kind: product.kind,
      path,
      inputs: productInputs,
    };
  });
  unique(
    products.map((product) => product.id),
    'deterministic product ID',
  );
  unique(
    products.map((product) => product.path),
    'deterministic product path',
  );
  const used = [...new Set(products.flatMap((product) => product.inputs))].sort(
    compareUtf8,
  );
  if (canonicalJson(used) !== canonicalJson(inputs.map((input) => input.id))) {
    throw new BuildPlanError(
      'identity-invalid',
      'deterministic components must be used by an entry or verification product',
    );
  }
  return { inputs, products };
}

function identifyCompatibility(values: readonly CompatibilityValue[]): {
  inputs: PlanInput[];
  records: CompatibilityRecord[];
} {
  const ordered = values
    .map((value) => ({ ...value }))
    .sort((left, right) => compareUtf8(left.name, right.name));
  unique(
    ordered.map((value) => value.name),
    'compatibility name',
  );
  for (const value of ordered) {
    if (value.name.length === 0) {
      throw new BuildPlanError(
        'identity-invalid',
        'compatibility names must be non-empty',
      );
    }
  }
  const inputs: PlanInput[] = [];
  const records = ordered.map((value): CompatibilityRecord => {
    const input =
      value.currentness === 'gate'
        ? `compatibility:gate.${hashValue(value.name).slice('sha256:'.length)}`
        : null;
    if (input !== null) {
      inputs.push({
        id: input,
        kind: 'compatibility',
        locator: null,
        value: value.value,
        identity: hashValue(value.value),
      });
    }
    return { ...value, input };
  });
  return { inputs, records };
}

function normalizePackages(
  packages: readonly PackageRecord[],
  kind: InvocationRecord['kind'],
): PackageRecord[] {
  const order = new Map([
    ['slc', 0],
    ['pipeline', 1],
    ['link-runtime', 2],
  ]);
  const normalized = packages
    .map((pkg) => ({ ...pkg }))
    .sort(
      (left, right) =>
        (order.get(left.role) as number) - (order.get(right.role) as number),
    );
  const expected =
    kind === 'full' ? ['slc', 'pipeline'] : ['slc', 'pipeline', 'link-runtime'];
  if (
    canonicalJson(normalized.map((pkg) => pkg.role)) !== canonicalJson(expected)
  ) {
    throw new BuildPlanError(
      'identity-invalid',
      `package provenance must contain ${expected.join(', ')}`,
    );
  }
  for (const pkg of normalized) {
    if (
      pkg.name.length === 0 ||
      (pkg.version !== null && pkg.version.length === 0)
    ) {
      throw new BuildPlanError(
        'identity-invalid',
        `package provenance for ${pkg.role} is incomplete`,
      );
    }
  }
  return normalized;
}

function cloneInvocation(invocation: InvocationRecord): InvocationRecord {
  return {
    kind: invocation.kind,
    normalize: invocation.normalize,
    optimize: invocation.optimize,
    link:
      invocation.link === null
        ? null
        : {
            target: invocation.link.target,
            options: invocation.link.options.map((option) => ({ ...option })),
          },
  };
}

function managedTargetPath(artifactDirPath: string, target: string): string {
  const locator = encodeReadLocator(artifactDirPath, resolve(target));
  if (locator.split('/').includes('..')) {
    throw new BuildPlanError(
      'plan-invalid',
      `canonical semantic target escapes the artifact directory: ${target}`,
    );
  }
  return locator;
}

function semanticProductId(stepId: string): string {
  return `semantic:${stepId.replace(':', '.')}`;
}

function stepToken(step: ScheduledStep): string {
  return step.id.replace(':', '.');
}

function ordinal(index: number): string {
  return index.toString().padStart(6, '0');
}

function copyFormat(format: FormatRecord): FormatRecord {
  return { format: format.format, ext: format.ext };
}

function hashValue(value: string): Hash {
  return hashBytes(new TextEncoder().encode(value));
}

async function loadPins(pipelineDir: string) {
  try {
    return (await loadPinFile(pipelineDir)).file;
  } catch (error) {
    if (error instanceof PinError) {
      throw new BuildPlanError('pin-invalid', error.message);
    }
    throw error;
  }
}

function unique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new BuildPlanError(
        'identity-invalid',
        `${label} "${value}" is duplicated`,
      );
    }
    seen.add(value);
  }
}

function requireId(value: string, label: string): void {
  if (!isBuildRecordId(value)) {
    throw new BuildPlanError(
      'identity-invalid',
      `${label} ID "${value}" is not a canonical build-record ID`,
    );
  }
}

/** Ensures an identity path names the expected regular file/tree before hashing. */
export async function validateIdentitySource(
  source: IdentitySource,
): Promise<void> {
  if (source.kind === 'value') return;
  const info = await lstat(source.path);
  if (info.isSymbolicLink()) {
    throw new BuildPlanError(
      'identity-invalid',
      `identity ${source.kind} is a symbolic link: ${source.path}`,
    );
  }
  if (
    (source.kind === 'file' && !info.isFile()) ||
    (source.kind === 'tree' && !info.isDirectory())
  ) {
    throw new BuildPlanError(
      'identity-invalid',
      `identity ${source.kind} has the wrong file type: ${source.path}`,
    );
  }
}

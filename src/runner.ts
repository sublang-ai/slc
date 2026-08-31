// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * End-to-end `slc` runner: composes the generic mechanics (DR-001, DR-002) with
 * the execution boundary (DR-003) and an injected {@link PhaseExecutor}
 * (interpreted per DR-004). It parses an invocation, resolves and loads the
 * pipeline, computes artifact paths, then runs each phase through `runPhase`,
 * stopping at the first failure with its report. The resolver and executor are
 * injected so a host wires the real pipeline resolution and Cligent agent while
 * tests supply fakes. See specs/packages/pipeline.md and specs/packages/phase-execution.md.
 */

import { mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { artifactDir, planArtifacts, parseSource } from './artifacts.js';
import {
  encodeLocator,
  invalidateBuildHistory,
  loadBuildHistory,
  recordBuild,
  verifiedInput,
  type BuildHistory,
  type StepToRecord,
} from './build-history.js';
import { emitEntryModule } from './entry-module.js';
import {
  reconcileLinkObjectImportSpecifiers,
  unresolvableRelativeImports,
} from './emitted-imports.js';
import { messageOf } from './errors.js';
import {
  assertSafeTarget,
  type ExecuteRequest,
  type PhaseExecutor,
  formatFailureReport,
  pathsAlias,
  runPhase,
} from './execution.js';
import { hashBytes, isHash, type Hash } from './hash.js';
import { type Invocation, parseInvocation } from './invocation.js';
import { unifiedLineDiff } from './line-diff.js';
import { type LinkPhase, linkedArtifactPath, loadLinkFile } from './link.js';
import { deriveClosure } from './pin-closure.js';
import type { ProgressSink } from './progress.js';
import { evaluatePin, evaluatePinFile, hashTree } from './pin-currency.js';
import {
  PINS_FILE,
  PinError,
  loadPinFile,
  type PinFile,
  type PinRecord,
} from './pins.js';
import type { Phase } from './phase.js';
import {
  type Pipeline,
  type PipelineResolver,
  loadPipeline,
  resolvePipeline,
} from './pipeline.js';
import { defaultPlaybookLinkTarget, isReservedPipeline } from './resolver.js';
import {
  artifactSchemaForPlaybookProvenance,
  emitFsmCoverageTest,
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  emitPromptContractTest,
  playbookProvenanceForLinkTarget,
} from './verify.js';
import {
  VERIFIER_SUPPORT_MODULE,
  emitVerifierSupport,
  verifierSupportFiles,
} from './verify-support.js';

/** A current pinned phase and the record that selected its compiled artifact. */
export interface CompiledSelection {
  /** Pin key: the phase name, or `link` for the reserved link phase. */
  phase: string;
  /** The pipeline directory holding `slc.pins.json`. */
  pipelineDir: string;
  /** The current pin record naming the compiled artifact and its inputs. */
  record: PinRecord;
}

/** Host-supplied capabilities for a run. */
export interface SlcDeps {
  /** Resolves a pipeline reference to candidate directories (DR-001). */
  resolver: PipelineResolver;
  /** Executes a phase by interpretation; the fallback for an unpinned phase (DR-004). */
  executor: PhaseExecutor;
  /**
   * Builds the executor for a current pinned phase (DR-005, DR-007). When absent,
   * a host runs interpreted only, so a current pin fails closed rather than
   * silently interpreting a phase the pipeline pinned to a compiled artifact.
   */
  compiled?: (selection: CompiledSelection) => PhaseExecutor;
  /** Invocation working directory anchoring artifact placement (DR-014); defaults to the process cwd. */
  cwd?: string;
  signal?: AbortSignal;
  /**
   * Receives phase start/finish/failure events with elapsed times as the run
   * progresses (DR-019, cli-32). Absent for hosts that want a quiet run.
   */
  progress?: ProgressSink;
}

/** The outcome of an `slc` run. */
export interface SlcResult {
  ok: boolean;
  /** Artifact paths written, in order. */
  outputs: string[];
  /** Diagnostics: agent summaries on success, or the failure report. */
  diagnostics: string[];
  /** Present when incremental selection invoked no phase executor. */
  outcome?: 'up-to-date';
}

/**
 * Parses argv and runs the requested pipeline, phase, or link end-to-end.
 * Never rejects: malformed invocations, refusals, and phase failures all return
 * `{ ok: false }` with diagnostics.
 */
export async function runSlc(
  argv: readonly string[],
  deps: SlcDeps,
): Promise<SlcResult> {
  let invocation: Invocation;
  try {
    invocation = parseInvocation(argv);
  } catch (error) {
    return failure(messageOf(error));
  }

  try {
    switch (invocation.kind) {
      case 'full':
        // The reserved playbook pipeline supplies a default link target
        // (self-hosting-13): a bare full run becomes a full-link against the
        // installed @sublang/playbook runtime contract module (DR-014).
        if (invocation.pipeline === 'playbook') {
          return await runFullLink(
            {
              ...invocation,
              kind: 'full-link',
              linkTarget: defaultPlaybookLinkTarget(),
              options: [],
            },
            deps,
          );
        }
        return await runFull(invocation, deps);
      case 'phase':
        return await runSinglePhase(invocation, deps);
      case 'link':
        return await runDirectLink(invocation, deps);
      case 'full-link':
        return await runFullLink(invocation, deps);
    }
  } catch (error) {
    return failure(messageOf(error));
  }
}

async function runFull(
  invocation: Extract<Invocation, { kind: 'full' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const cwd = runCwd(deps);
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const entry = pipeline.phases[0];
  const source = resolve(cwd, invocation.source);
  const { basename, raw } = parseSource({
    path: source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const artDir = artifactDir(cwd, basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  const plan = planArtifacts({
    phases: pipeline.phases,
    basename,
    artDir,
    output:
      invocation.output === null ? undefined : resolve(cwd, invocation.output),
  });
  const steps = buildCompileSteps({
    pipeline,
    plan,
    source,
    artDir,
    basename,
    optimize: !invocation.noOptimize,
    normalize: invocation.normalize || raw,
  });
  const verification = {
    pipeline: invocation.pipeline,
    plan,
    artDir,
    basename,
  };
  return executeSteps(steps, pipeline, deps, {
    incremental: incrementalRun(invocation, artDir, source),
    hostTargets: verificationHostTargets(verification),
    complete: (result, guardTarget) =>
      emitVerification(result, verification, guardTarget),
  });
}

/** History covers only canonical full/full-link runs outside the `slc` meta-pipeline. */
function incrementalRun(
  invocation: Extract<Invocation, { kind: 'full' | 'full-link' }>,
  artDir: string,
  source: string,
): IncrementalRun | undefined {
  if (invocation.output !== null || invocation.pipeline === 'slc') {
    return undefined;
  }
  return {
    artDir,
    source,
    pipelineName: invocation.pipeline,
    rebuild: invocation.rebuild === true,
  };
}

async function runSinglePhase(
  invocation: Extract<Invocation, { kind: 'phase' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const cwd = runCwd(deps);
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const phase = [...pipeline.phases, ...pipeline.passes].find(
    (candidate) => candidate.name === invocation.phase,
  );
  if (phase === undefined) {
    return failure(
      `phase "${invocation.phase}" is not part of pipeline "${invocation.pipeline}"`,
    );
  }

  const source = resolve(cwd, invocation.source);
  const { basename, raw } = parseSource({
    path: source,
    sourceFormat: phase.source.format,
    ext: phase.source.ext,
    entry: pipeline.phases[0] === phase,
  });
  if (raw) {
    // A named phase cannot normalize (pipeline-37), so a raw entry source has no
    // path into the phase's declared source format here.
    return failure(
      `source "${invocation.source}" is a raw input; run the full pipeline to normalize it`,
    );
  }
  const artDir = artifactDir(cwd, basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  if (phase.pass) {
    // A standalone pass run cannot overwrite its own source: it writes the
    // `.opt` sibling unless `-o` relocates it (DR-013).
    const target =
      (invocation.output === null ? null : resolve(cwd, invocation.output)) ??
      join(artDir, `${basename}.${phase.target.format}.opt${phase.target.ext}`);
    const step = compileStep(pipeline, phase, source, target);
    return executeSteps([step], pipeline, deps);
  }

  // Plan over the whole chain so the named phase keeps its pipeline role: a
  // non-terminal phase writes its canonical intermediate and ignores `-o`
  // (DR-001 -- artifact location depends on role, not invocation mode).
  const plan = planArtifacts({
    phases: pipeline.phases,
    basename,
    artDir,
    output:
      invocation.output === null ? undefined : resolve(cwd, invocation.output),
  });
  const artifact = plan[pipeline.phases.indexOf(phase)];
  const step = compileStep(pipeline, phase, source, artifact.path);
  return executeSteps([step], pipeline, deps);
}

async function runDirectLink(
  invocation: Extract<Invocation, { kind: 'link' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const cwd = runCwd(deps);
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const link = await requireLink(pipeline, invocation.pipeline);
  const linked = linkedArtifactPath({
    kind: 'link',
    pipeline: invocation.pipeline,
    objects: invocation.objects.map((path) => resolve(cwd, path)),
    source: link.source,
    linked: link.target,
    output: invocation.output === null ? null : resolve(cwd, invocation.output),
    cwd,
  });
  await mkdir(dirname(linked), { recursive: true });

  const step: PhaseStep = {
    request: {
      kind: 'link',
      definitionPath: pipeline.linkFile as string,
      objects: invocation.objects.map((path) => resolve(cwd, path)),
      linkTarget: resolve(cwd, invocation.linkTarget),
      options: invocation.options,
      linked,
    },
    phase: 'link',
    pinKey: 'link',
    targetExt: link.target.ext,
  };
  return executeSteps([step], pipeline, deps);
}

async function runFullLink(
  invocation: Extract<Invocation, { kind: 'full-link' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const cwd = runCwd(deps);
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const link = await requireLink(pipeline, invocation.pipeline);
  const entry = pipeline.phases[0];
  const source = resolve(cwd, invocation.source);
  const { basename, raw } = parseSource({
    path: source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const normalize = invocation.normalize || raw;
  const artDir = artifactDir(cwd, basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  // Compile chain: the exit artifact becomes the object artifact (pipeline-15).
  const plan = planArtifacts({ phases: pipeline.phases, basename, artDir });
  const compileSteps = buildCompileSteps({
    pipeline,
    plan,
    source,
    artDir,
    basename,
    optimize: !invocation.noOptimize,
    normalize,
  });

  const linked = linkedArtifactPath({
    kind: 'full',
    artDir,
    basename,
    linked: link.target,
    output: invocation.output === null ? null : resolve(cwd, invocation.output),
  });
  const linkStep: PhaseStep = {
    request: {
      kind: 'link',
      definitionPath: pipeline.linkFile as string,
      objects: [plan[plan.length - 1].path],
      linkTarget: resolve(cwd, invocation.linkTarget),
      options: invocation.options,
      linked,
    },
    phase: 'link',
    pinKey: 'link',
    targetExt: link.target.ext,
  };
  const steps = [...compileSteps, linkStep];
  const gearsPlan = plan.find(
    (artifact) => artifact.phase.target.format === 'gears',
  );
  const entryCandidate =
    invocation.pipeline === 'playbook' &&
    invocation.output === null &&
    gearsPlan !== undefined
      ? resolve(cwd, `${basename}.ts`)
      : null;
  const entryAliasesSource =
    entryCandidate !== null && (await pathsAlias(entryCandidate, source));
  const entryPath = entryAliasesSource ? null : entryCandidate;
  const verification = {
    pipeline: invocation.pipeline,
    plan,
    artDir,
    basename,
    linkTarget: resolve(cwd, invocation.linkTarget),
  };
  return executeSteps(steps, pipeline, deps, {
    incremental: incrementalRun(invocation, artDir, source),
    hostTargets: [
      ...verificationHostTargets(verification),
      ...(entryPath === null ? [] : [{ path: entryPath }]),
    ],
    complete: async (result, guardTarget) => {
      const verified = await emitVerification(
        result,
        verification,
        guardTarget,
      );

      if (verified.ok && entryCandidate !== null && entryAliasesSource) {
        return {
          ...verified,
          diagnostics: [
            ...verified.diagnostics,
            `entry module ${entryCandidate} not emitted because it aliases the invocation source`,
          ],
        };
      }

      // Entry-module emission (DR-014, self-hosting-15): only the playbook
      // pipeline, only with the linked artifact at its canonical path.
      if (verified.ok && entryPath !== null && gearsPlan !== undefined) {
        await guardTarget(entryPath);
        const textPath = normalize
          ? join(
              artDir,
              `${basename}.${entry.source.format}${entry.source.ext}`,
            )
          : source;
        await emitEntryModule({
          cwd,
          basename,
          pipeline: invocation.pipeline,
          gearsPath: gearsPlan.path,
          textPath,
        });
        const missing = await unresolvableRelativeImports(entryPath);
        if (missing.length > 0) {
          return {
            ok: false,
            outputs: verified.outputs,
            diagnostics: [
              ...verified.diagnostics,
              `entry module ${entryPath} has unresolvable relative imports: ` +
                `${missing.join(', ')} (verification-18)`,
            ],
          };
        }
        return { ...verified, outputs: [...verified.outputs, entryPath] };
      }
      return verified;
    },
  });
}

/** The invocation working directory anchoring artifact placement (DR-014). */
function runCwd(deps: SlcDeps): string {
  return resolve(deps.cwd ?? process.cwd());
}

/**
 * After a reserved-pipeline full run produces a `gears` intermediate and an `fsm`
 * object at their canonical `<basename>.playbook/` locations, emits the
 * artifact-local checker support plus compilation-correctness tests beside
 * them as `slc` output, appending their paths to the outputs (verification-2,
 * verification-4;
 * [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).
 * Non-reserved pipelines, runs without a gears+fsm pair, and runs whose `fsm` was
 * relocated out of that directory by `-o` (pipeline-8) are left unchanged, so an
 * emitted test never imports a file that was not written beside it. A test whose
 * emission needs the produced `fsm` imported (the pinned introspection) degrades
 * to a diagnostic when the artifact cannot be loaded, leaving the run outcome
 * unchanged — the conformance test still fails at test time on a broken module.
 */
async function emitVerification(
  result: SlcResult,
  ctx: VerificationContext,
  guardTarget?: CompletionTargetGuard,
): Promise<SlcResult> {
  if (!result.ok) return result;
  const hostTargets = verificationHostTargets(ctx);
  if (hostTargets.length === 0) return result;
  const fsm = ctx.plan.find(
    (artifact) => artifact.phase.target.format === 'fsm',
  );
  if (fsm === undefined) throw new Error('verification plan lost its FSM');
  const provenance =
    ctx.linkTarget === undefined
      ? undefined
      : await playbookProvenanceForLinkTarget(ctx.linkTarget);
  const artifactSchema = artifactSchemaForPlaybookProvenance(provenance);
  const outputs = [...result.outputs];
  const diagnostics = [...result.diagnostics];
  if (guardTarget !== undefined) {
    for (const target of verifierSupportFiles(ctx.artDir)) {
      await guardTarget(target.target);
    }
  }
  outputs.push(...(await emitVerifierSupport(ctx.artDir)));
  if (guardTarget !== undefined) {
    await guardTarget(join(ctx.artDir, `${ctx.basename}.gears-fsm.test.ts`));
  }
  outputs.push(
    await emitGearsFsmConformanceTest({
      artifactDir: ctx.artDir,
      basename: ctx.basename,
      verifyModule: VERIFIER_SUPPORT_MODULE,
      ...(artifactSchema === undefined ? {} : { artifactSchema }),
    }),
  );
  try {
    if (guardTarget !== undefined) {
      await guardTarget(
        join(ctx.artDir, `${ctx.basename}.fsm.introspect.test.ts`),
      );
    }
    outputs.push(
      await emitFsmIntrospectionTest({
        artifactDir: ctx.artDir,
        basename: ctx.basename,
        verifyModule: VERIFIER_SUPPORT_MODULE,
      }),
    );
  } catch (error) {
    diagnostics.push(
      `verification: introspection test not emitted: ${messageOf(error)}`,
    );
  }
  try {
    if (guardTarget !== undefined) {
      await guardTarget(
        join(ctx.artDir, `${ctx.basename}.prompt-contract.test.ts`),
      );
    }
    const promptContract = await emitPromptContractTest({
      artifactDir: ctx.artDir,
      basename: ctx.basename,
      verifyModule: VERIFIER_SUPPORT_MODULE,
      ...(provenance === undefined ? {} : { provenance }),
    });
    outputs.push(promptContract.path);
    diagnostics.push(
      ...promptContract.diagnostics.map(
        (diagnostic) => `verification: ${diagnostic}`,
      ),
    );
  } catch (error) {
    diagnostics.push(
      `verification: prompt-contract test not emitted: ${messageOf(error)}`,
    );
  }
  try {
    if (guardTarget !== undefined) {
      await guardTarget(
        join(ctx.artDir, `${ctx.basename}.fsm.coverage.test.ts`),
      );
    }
    const coverage = await emitFsmCoverageTest({
      artifactDir: ctx.artDir,
      basename: ctx.basename,
      verifyModule: VERIFIER_SUPPORT_MODULE,
    });
    outputs.push(coverage.path);
    diagnostics.push(
      ...coverage.diagnostics.map(
        (diagnostic) => `verification: ${diagnostic}`,
      ),
    );
  } catch (error) {
    diagnostics.push(
      `verification: coverage test not emitted: ${messageOf(error)}`,
    );
  }
  return { ...result, outputs, diagnostics };
}

interface VerificationContext {
  pipeline: string;
  plan: readonly {
    path: string;
    phase: { name: string; target: { format: string; ext: string } };
  }[];
  artDir: string;
  basename: string;
  /** Concrete full-link target whose owning package is this artifact's provenance. */
  linkTarget?: string;
}

/** Exact deterministic writes attempted by {@link emitVerification}. */
function verificationHostTargets(ctx: VerificationContext): HostTarget[] {
  if (!isReservedPipeline(ctx.pipeline)) return [];
  const fsm = ctx.plan.find(
    (artifact) => artifact.phase.target.format === 'fsm',
  );
  const hasGears = ctx.plan.some(
    (artifact) => artifact.phase.target.format === 'gears',
  );
  if (fsm === undefined || !hasGears) return [];
  const canonicalFsm = join(
    ctx.artDir,
    `${ctx.basename}.fsm${fsm.phase.target.ext}`,
  );
  if (fsm.path !== canonicalFsm) return [];

  return [
    ...verifierSupportFiles(ctx.artDir).map(({ source, target }) => ({
      path: target,
      protectedInputs: [source],
      allowVerifierOutput: true,
    })),
    { path: join(ctx.artDir, `${ctx.basename}.gears-fsm.test.ts`) },
    {
      path: join(ctx.artDir, `${ctx.basename}.fsm.introspect.test.ts`),
      required: false,
    },
    {
      path: join(ctx.artDir, `${ctx.basename}.prompt-contract.test.ts`),
      required: false,
    },
    {
      path: join(ctx.artDir, `${ctx.basename}.fsm.coverage.test.ts`),
      required: false,
    },
  ];
}

/** One phase to run: its execute request and the checks `runPhase` needs. */
interface PhaseStep {
  request: ExecuteRequest;
  phase: string;
  /** Pipeline pin key; absent for the host-owned normalization step. */
  pinKey?: string;
  targetExt: string;
}

/** A canonical full/full-link invocation eligible for history. */
interface IncrementalRun {
  artDir: string;
  source: string;
  pipelineName: string;
  rebuild: boolean;
}

interface AcceptedStep {
  step: PhaseStep;
  target: string;
  inputs: Hash[] | null;
  output: Hash | null;
}

/** The only live state needed by the success-only history transition. */
interface IncrementalState extends IncrementalRun {
  active: boolean;
  history: BuildHistory | null;
  sourceBytes: Buffer;
  invalidated: boolean;
  executed: number;
  accepted: AcceptedStep[];
}

interface StepIdentity {
  inputs: Hash[];
  /** Present only for a compile step, for rendering its update diff. */
  chainedInput?: Buffer;
}

interface DeclaredInputs {
  paths: string[];
  /** False when a runner-only incremental closure could not be derived. */
  complete: boolean;
}

type StepMode =
  | { mode: 'ordinary' }
  | { mode: 'reuse'; bytes: Buffer }
  | { mode: 'update'; priorInput: string; diff: string | null };

interface HostTarget {
  path: string;
  protectedInputs?: readonly string[];
  allowVerifierOutput?: boolean;
  /** False when the existing emitter already degrades this output to a diagnostic. */
  required?: boolean;
}

type CompletionTargetGuard = (path: string) => Promise<void>;

type CompleteRun = (
  result: SlcResult,
  guardTarget: CompletionTargetGuard,
  pinFile: PinFile | undefined,
) => Promise<SlcResult>;

interface ExecuteStepsOptions {
  incremental?: IncrementalRun;
  hostTargets?: readonly HostTarget[];
  complete?: CompleteRun;
}

/** Resolves the built-in pipeline-agnostic normalize definition (DR-013). */
export function normalizeDefinitionPath(): string {
  return fileURLToPath(new URL('./normalize.md', import.meta.url));
}

/**
 * Builds the ordered compile steps for a full run: an optional generic
 * normalize step ahead of the entry phase (`--normalize`), each chain phase,
 * and — with `-O` — the pipeline's pass phases spliced in after the phase
 * producing their format (DR-013). With passes active on a format, the
 * producing phase writes the `.raw` intermediate and the final pass lands on
 * the planned path, so downstream phases and verification see the canonical
 * artifact regardless of optimization.
 */
function buildCompileSteps(opts: {
  pipeline: Pipeline;
  plan: readonly { phase: Phase; path: string }[];
  source: string;
  artDir: string;
  basename: string;
  optimize: boolean;
  normalize: boolean;
}): PhaseStep[] {
  const { pipeline, plan, artDir, basename } = opts;
  const steps: PhaseStep[] = [];
  let previous = opts.source;

  if (opts.normalize) {
    const entry = pipeline.phases[0];
    const normalized = join(
      artDir,
      `${basename}.${entry.source.format}${entry.source.ext}`,
    );
    steps.push({
      request: {
        kind: 'compile',
        definitionPath: normalizeDefinitionPath(),
        source: previous,
        target: normalized,
        references: [phaseDefinition(pipeline, entry.name)],
      },
      phase: 'normalize',
      targetExt: entry.source.ext,
    });
    previous = normalized;
  }

  for (const artifact of plan) {
    const phase = artifact.phase;
    const passes = opts.optimize
      ? pipeline.passes.filter(
          (pass) => pass.source.format === phase.target.format,
        )
      : [];
    if (passes.length === 0) {
      steps.push(compileStep(pipeline, phase, previous, artifact.path));
      previous = artifact.path;
      continue;
    }
    const raw = join(
      artDir,
      `${basename}.${phase.target.format}.raw${phase.target.ext}`,
    );
    steps.push(compileStep(pipeline, phase, previous, raw));
    previous = raw;
    passes.forEach((pass, index) => {
      const target =
        index === passes.length - 1
          ? artifact.path
          : join(
              artDir,
              `${basename}.${phase.target.format}.opt${index + 1}${phase.target.ext}`,
            );
      steps.push(compileStep(pipeline, pass, previous, target));
      previous = target;
    });
  }
  return steps;
}

function compileStep(
  pipeline: Pipeline,
  phase: Phase,
  source: string,
  target: string,
): PhaseStep {
  return {
    request: {
      kind: 'compile',
      definitionPath: phaseDefinition(pipeline, phase.name),
      source,
      target,
    },
    phase: phase.name,
    pinKey: phase.name,
    targetExt: phase.target.ext,
  };
}

/**
 * Runs steps in order, selecting interpreted or compiled execution per phase from
 * the pin index and stopping at the first failure with its report (phase-execution-9,
 * phase-execution-27). An unparseable pin file fails the run closed before any phase.
 */
async function executeSteps(
  steps: readonly PhaseStep[],
  pipeline: Pipeline,
  deps: SlcDeps,
  opts: ExecuteStepsOptions = {},
): Promise<SlcResult> {
  const complete = opts.complete ?? (async (result: SlcResult) => result);
  const pinInputs = new Set<string>([join(pipeline.dir, PINS_FILE)]);
  let pinFile: PinFile | undefined;
  try {
    pinFile = (await loadPinFile(pipeline.dir)).file;
  } catch (error) {
    if (error instanceof PinError) {
      return { ok: false, outputs: [], diagnostics: [error.message] };
    }
    throw error;
  }
  if (pinFile !== undefined) {
    const verdicts = await evaluatePinFile(pipeline.dir, pinFile, {
      observePath: (path) => pinInputs.add(resolve(path)),
    });
    const malformed = Object.entries(verdicts).find(
      ([, verdict]) => verdict.status === 'malformed',
    );
    if (malformed !== undefined) {
      return {
        ok: false,
        outputs: [],
        diagnostics: [
          `pin is malformed: ${
            malformed[1].status === 'malformed'
              ? malformed[1].reason
              : 'invalid pin index'
          }`,
        ],
      };
    }
  }

  const definitions = [
    ...new Set([
      ...chainDefinitions(pipeline),
      ...steps.map((step) => step.request.definitionPath),
    ]),
  ];
  const outputs: string[] = [];
  const diagnostics: string[] = [];
  const state =
    opts.incremental === undefined
      ? undefined
      : await loadIncremental(opts.incremental);
  const invalidatedTargetDirs = new Set<string>();
  const targets = steps.map(stepTarget);
  const declaredByStep = await Promise.all(
    steps.map((step) => stepDeclaredInputs(step, pipeline, pinFile)),
  );
  const declaredInputs = [
    ...new Set(declaredByStep.flatMap((declared) => declared.paths)),
  ];
  const immutableInputs = externalInputPaths(steps);
  const hostInputs = (opts.hostTargets ?? []).flatMap(
    (target) => target.protectedInputs ?? [],
  );
  const protectedInputs = [
    ...new Set([
      ...immutableInputs,
      ...definitions,
      ...declaredInputs,
      ...hostInputs,
      ...pinInputs,
    ]),
  ];
  const plannedTargets = opts.hostTargets ?? [];
  for (let index = 0; index < plannedTargets.length; index++) {
    const planned = plannedTargets[index];
    try {
      await assertSafeTarget(
        planned.path,
        [
          ...protectedInputs,
          ...targets,
          ...(planned.protectedInputs ?? []),
          ...plannedTargets
            .filter((_, candidate) => candidate !== index)
            .map((candidate) => candidate.path),
        ],
        { allowVerifierOutput: planned.allowVerifierOutput },
      );
    } catch (error) {
      if (planned.required !== false) return failure(messageOf(error));
    }
  }

  const hostTargets = new Map(
    (opts.hostTargets ?? []).map((target) => [resolve(target.path), target]),
  );
  const guardCompletionTarget: CompletionTargetGuard = async (path) => {
    const planned = hostTargets.get(resolve(path));
    if (planned === undefined) {
      throw new Error(`unplanned deterministic output: ${path}`);
    }
    await assertSafeTarget(
      planned.path,
      [...protectedInputs, ...targets, ...(planned.protectedInputs ?? [])],
      { allowVerifierOutput: planned.allowVerifierOutput },
    );
  };

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const target = targets[index];

    const stepDeclared = declaredByStep[index];
    const identity =
      state === undefined
        ? null
        : await stepIdentity(
            step,
            state,
            index,
            stepDeclared.complete ? stepDeclared.paths : null,
          );
    const mode =
      state === undefined
        ? ({ mode: 'ordinary' } as const)
        : await selectStepMode(step, index, target, identity, state);

    // Reuse still honors pin currency, but it constructs no executor because
    // no phase runs. A stale/malformed pin can never be bypassed by history.
    if (mode.mode === 'reuse') {
      if (state === undefined) {
        throw new Error('internal error: reuse selected without history state');
      }
      let reasons: string[] | null;
      try {
        reasons = await reusePinFailure(step.pinKey, pipeline.dir, pinFile);
      } catch (error) {
        reasons = [messageOf(error)];
      }
      if (reasons !== null) {
        const startedAt = Date.now();
        deps.progress?.({ kind: 'phase-start', phase: step.phase, target });
        deps.progress?.({
          kind: 'phase-fail',
          phase: step.phase,
          target,
          elapsedMs: Date.now() - startedAt,
        });
        diagnostics.push(
          formatFailureReport({ phase: step.phase, target, reasons }),
        );
        return { ok: false, outputs, diagnostics };
      }
      deps.progress?.({
        kind: 'status',
        text: `reusing ${step.phase} → ${target}`,
      });
      state.accepted.push({
        step,
        target,
        inputs: identity?.inputs ?? null,
        output: hashBytes(mode.bytes),
      });
      continue;
    }

    // In-run progress (DR-019, cli-32): announce the phase, then report its
    // outcome with the elapsed time.
    const startedAt = Date.now();
    deps.progress?.({ kind: 'phase-start', phase: step.phase, target });
    const fail = (): void =>
      deps.progress?.({
        kind: 'phase-fail',
        phase: step.phase,
        target,
        elapsedMs: Date.now() - startedAt,
      });

    // Selecting a compiled executor can throw rather than return a verdict —
    // notably an unmapped pinned Playbook provenance, which the host factory
    // rejects (phase-execution-30). That is the same fail-closed family as a stale pin,
    // so it is reported through the phase-failure path; letting it unwind
    // would strand the phase-start line with no terminal event and drop the
    // phase and target from the report (cli-4, cli-32, phase-execution-27).
    let selection: Strategy;
    try {
      selection = await selectExecutor(
        step.phase,
        step.pinKey,
        pipeline.dir,
        pinFile,
        deps,
      );
    } catch (error) {
      selection = { kind: 'fail', reasons: [messageOf(error)] };
    }
    if (selection.kind === 'fail') {
      fail();
      diagnostics.push(
        formatFailureReport({
          phase: step.phase,
          target,
          reasons: selection.reasons,
        }),
      );
      return { ok: false, outputs, diagnostics };
    }

    if (mode.mode === 'update') {
      deps.progress?.({
        kind: 'status',
        text: `updating ${step.phase} → ${target}`,
      });
    }
    const request: ExecuteRequest =
      mode.mode === 'update' && step.request.kind === 'compile'
        ? {
            ...step.request,
            update: { priorInput: mode.priorInput, diff: mode.diff },
          }
        : step.request;

    const result = await runPhase({
      request,
      phase: step.phase,
      targetExt: step.targetExt,
      executor: selection.executor,
      definitions,
      protectedInputs: stepDeclared.paths,
      aliasInputs: [
        ...immutableInputs,
        ...declaredInputs,
        ...hostInputs,
        ...pinInputs,
        ...targets.filter((_, candidate) => candidate !== index),
      ],
      beforeExecute: () =>
        invalidateForExecution(state, target, invalidatedTargetDirs),
      revalidate: () => revalidateChain(pipeline.dir),
      signal: deps.signal,
    });
    if (!result.ok) {
      fail();
      diagnostics.push(formatFailureReport(result.report));
      return { ok: false, outputs, diagnostics };
    }
    diagnostics.push(...result.diagnostics);
    // Settle an agent-chosen `.js`/`.ts` link-object edge from the sibling that
    // currently exists (pipeline-40), then keep rejecting every genuinely
    // unresolved import (verification-18).
    if (
      step.phase === 'link' &&
      (step.targetExt === '.ts' || step.targetExt === '.js')
    ) {
      let missing: string[];
      try {
        const linked =
          step.request.kind === 'link' ? step.request.linked : target;
        const rewrites = await reconcileLinkObjectImportSpecifiers(
          linked,
          step.request.kind === 'link' ? step.request.objects : [],
        );
        diagnostics.push(
          ...rewrites.map(
            ({ from, to }) =>
              `linked module ${linked} reconciled link-object import ` +
              `${JSON.stringify(from)} to ${JSON.stringify(to)} (pipeline-40)`,
          ),
        );
        missing = await unresolvableRelativeImports(linked);
      } catch (error) {
        // A target that cannot be reconciled and checked is a dead artifact
        // too. Fail the link here so every started phase still reaches a
        // terminal event (cli-32).
        fail();
        diagnostics.push(
          `linked module ${target} could not be settled and checked: ` +
            `${messageOf(error)} — ` +
            'post-link completion and load integrity are mandatory ' +
            '(pipeline-40, verification-18)',
        );
        return { ok: false, outputs, diagnostics };
      }
      if (missing.length > 0) {
        fail();
        diagnostics.push(
          `linked module ${target} has unresolvable relative imports: ` +
            `${missing.join(', ')} — an emitted module that cannot load ` +
            'fails the link (verification-18)',
        );
        return { ok: false, outputs, diagnostics };
      }
    }

    deps.progress?.({
      kind: 'phase-finish',
      phase: step.phase,
      target,
      elapsedMs: Date.now() - startedAt,
    });
    outputs.push(target);
    if (state !== undefined) {
      let output: Hash | null = null;
      try {
        output = hashBytes(await readFile(target));
      } catch {
        // A successful compile remains successful when only history capture is
        // unavailable; final publication reports the advisory diagnostic.
      }
      state.executed++;
      state.accepted.push({
        step,
        target,
        inputs: identity?.inputs ?? null,
        output,
      });
    }
  }

  const selected: SlcResult = {
    ok: true,
    outputs,
    diagnostics,
    ...(state !== undefined &&
    state.executed === 0 &&
    steps.length > 0 &&
    state.accepted.length === steps.length
      ? { outcome: 'up-to-date' as const }
      : {}),
  };
  const completed = await complete(selected, guardCompletionTarget, pinFile);
  return state === undefined
    ? completed
    : publishIncremental(completed, state, steps);
}

function stepTarget(step: PhaseStep): string {
  return step.request.kind === 'compile'
    ? step.request.target
    : step.request.linked;
}

/**
 * Inputs supplied from outside this schedule. A normal predecessor target may
 * feed its successor, but source/reference/link operands supplied by the user
 * remain protected even when they collide with some scheduled output.
 */
function externalInputPaths(steps: readonly PhaseStep[]): string[] {
  const produced = new Set<string>();
  const external = new Set<string>();
  for (const step of steps) {
    if (step.request.kind === 'compile') {
      const source = resolve(step.request.source);
      if (!produced.has(source)) external.add(source);
      for (const reference of step.request.references ?? []) {
        external.add(resolve(reference));
      }
    } else {
      for (const object of step.request.objects) {
        const path = resolve(object);
        if (!produced.has(path)) external.add(path);
      }
      external.add(resolve(step.request.linkTarget));
    }
    produced.add(resolve(stepTarget(step)));
  }
  return [...external];
}

async function loadIncremental(run: IncrementalRun): Promise<IncrementalState> {
  const sourceBytes = await readFile(run.source);
  const active = await loadBuildHistory(run.artDir);
  const sourceLocator = encodeLocator(run.artDir, run.source);
  const history =
    !run.rebuild &&
    active?.manifest.pipeline === run.pipelineName &&
    active.manifest.source.path === sourceLocator
      ? active
      : null;
  return {
    ...run,
    active: active !== null,
    history,
    sourceBytes,
    invalidated: false,
    executed: 0,
    accepted: [],
  };
}

async function stepIdentity(
  step: PhaseStep,
  state: IncrementalState,
  index: number,
  declared: readonly string[] | null,
): Promise<StepIdentity | null> {
  if (declared === null) return null;
  try {
    if (step.request.kind === 'compile') {
      const chainedInput =
        index === 0 ? state.sourceBytes : await readFile(step.request.source);
      const roots = [
        step.request.definitionPath,
        ...(step.request.references ?? []),
      ];
      const rootHashes = await Promise.all(
        roots.map(async (path) => hashBytes(await readFile(path))),
      );
      return {
        chainedInput,
        inputs: [
          hashBytes(chainedInput),
          ...rootHashes,
          ...(await Promise.all(
            declared.map(async (path) => hashBytes(await readFile(path))),
          )),
        ],
      };
    }

    const inputs: Hash[] = [];
    for (const object of step.request.objects) {
      const path = resolve(object);
      inputs.push(
        framedHash(
          'object',
          encodeLocator(state.artDir, path),
          hashBytes(await readFile(path)),
        ),
      );
    }
    inputs.push(hashBytes(await readFile(step.request.definitionPath)));
    inputs.push(
      ...(await Promise.all(
        declared.map(async (path) => hashBytes(await readFile(path))),
      )),
    );

    const linkTarget = resolve(step.request.linkTarget);
    const targetInfo = await stat(linkTarget);
    let targetKind: 'file' | 'directory';
    let targetIdentity: Hash;
    if (targetInfo.isFile()) {
      targetKind = 'file';
      targetIdentity = hashBytes(await readFile(linkTarget));
    } else if (targetInfo.isDirectory()) {
      targetKind = 'directory';
      const identity = await hashTree(linkTarget);
      if (!isHash(identity)) throw new Error('invalid link-target tree hash');
      targetIdentity = identity;
    } else {
      throw new Error('link target is neither a file nor directory');
    }
    inputs.push(
      framedHash(
        'link-target',
        encodeLocator(state.artDir, linkTarget),
        targetKind,
        targetIdentity,
      ),
    );
    for (const option of step.request.options) {
      inputs.push(framedHash('option', option.name, option.value));
    }
    return { inputs };
  } catch {
    return null;
  }
}

async function stepDeclaredInputs(
  step: PhaseStep,
  pipeline: Pipeline,
  pinFile: PinFile | undefined,
): Promise<DeclaredInputs> {
  const roots =
    step.request.kind === 'compile'
      ? [step.request.definitionPath, ...(step.request.references ?? [])]
      : [step.request.definitionPath];
  return declaredInputPaths(pipeline, pinFile, roots);
}

/** Current local semantic-input closure for definitions and references. */
async function declaredInputPaths(
  pipeline: Pipeline,
  pinFile: PinFile | undefined,
  roots: readonly string[],
): Promise<DeclaredInputs> {
  const boundary = pinFile?.pathBoundary.path ?? '.';
  const base = new Set(roots.map((path) => resolve(path)));
  const seen = new Set(base);
  const inputs: string[] = [];
  let complete = true;
  const normalize = resolve(normalizeDefinitionPath());
  for (const root of roots) {
    const absolute = resolve(root);
    if (!absolute.toLowerCase().endsWith('.md') || absolute === normalize) {
      continue;
    }
    const locator = relative(pipeline.dir, absolute).split(sep).join('/');
    const closure = new Set<string>();
    try {
      await deriveClosure(pipeline.dir, boundary, locator, (path) =>
        closure.add(path),
      );
    } catch {
      // This derivation exists only for incremental identity and best-effort
      // target protection. Pin generation/currency remain fail-closed, while an
      // otherwise interpretable phase degrades to Ordinary execution.
      complete = false;
    }
    for (const path of closure) {
      const absolutePath = resolve(path);
      if (seen.has(absolutePath)) continue;
      seen.add(absolutePath);
      inputs.push(absolutePath);
    }
  }
  return { paths: inputs, complete };
}

async function selectStepMode(
  step: PhaseStep,
  index: number,
  target: string,
  identity: StepIdentity | null,
  state: IncrementalState,
): Promise<StepMode> {
  if (state.rebuild || state.history === null || identity === null) {
    return { mode: 'ordinary' };
  }
  const record = state.history.manifest.steps[index];
  const kind = step.request.kind;
  if (
    record === undefined ||
    record.kind !== kind ||
    record.name !== step.phase ||
    record.target !== encodeLocator(state.artDir, resolve(target))
  ) {
    return { mode: 'ordinary' };
  }

  let targetBytes: Buffer;
  try {
    targetBytes = await readFile(target);
  } catch {
    return { mode: 'ordinary' };
  }
  if (sameHashes(record.inputs, identity.inputs)) {
    return { mode: 'reuse', bytes: targetBytes };
  }
  if (step.request.kind !== 'compile' || identity.chainedInput === undefined) {
    return { mode: 'ordinary' };
  }
  const prior = await verifiedInput(state.history, index, record.inputs[0]);
  if (prior === null) return { mode: 'ordinary' };
  const diff =
    record.inputs[0] === identity.inputs[0]
      ? ''
      : renderInputDiff(prior.bytes, identity.chainedInput);
  return { mode: 'update', priorInput: prior.path, diff };
}

function renderInputDiff(
  prior: Uint8Array,
  current: Uint8Array,
): string | null {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return unifiedLineDiff(decoder.decode(prior), decoder.decode(current));
  } catch {
    return null;
  }
}

function framedHash(tag: string, ...fields: string[]): Hash {
  return hashBytes(Buffer.from(JSON.stringify([tag, ...fields]), 'utf8'));
}

function sameHashes(left: readonly Hash[], right: readonly Hash[]): boolean {
  return (
    left.length === right.length &&
    left.every((hash, index) => hash === right[index])
  );
}

async function reusePinFailure(
  pinKey: string | undefined,
  pipelineDir: string,
  pinFile: PinFile | undefined,
): Promise<string[] | null> {
  const record = ownPin(pinFile, pinKey);
  if (pinFile === undefined || pinKey === undefined || record === undefined) {
    return null;
  }
  const verdict = await evaluatePin(pipelineDir, pinFile, pinKey, record);
  return verdict.status === 'current'
    ? null
    : [`pin is ${verdict.status}: ${verdict.reason}`];
}

/**
 * Removes any complete snapshot that could otherwise bless this target after
 * executor work. Eligible runs already know their artifact directory; excluded
 * forms perform only this safety invalidation and never select from or publish
 * history.
 */
async function invalidateForExecution(
  state: IncrementalState | undefined,
  target: string,
  invalidatedTargetDirs: Set<string>,
): Promise<void> {
  if (state !== undefined) {
    if (state.invalidated) return;
    try {
      await invalidateBuildHistory(state.artDir, state.active);
      state.invalidated = true;
      return;
    } catch (error) {
      throw new Error(
        `active build history could not be invalidated: ${messageOf(error)}`,
        { cause: error },
      );
    }
  }

  const targetDir = dirname(resolve(target));
  if (invalidatedTargetDirs.has(targetDir)) return;
  const active = await loadBuildHistory(targetDir);
  const targetLocator = encodeLocator(targetDir, resolve(target));
  if (
    active !== null &&
    active.manifest.steps.some((step) => step.target === targetLocator)
  ) {
    try {
      await invalidateBuildHistory(targetDir, true);
    } catch (error) {
      throw new Error(
        `active build history could not be invalidated: ${messageOf(error)}`,
        { cause: error },
      );
    }
    invalidatedTargetDirs.add(targetDir);
  }
}

async function publishIncremental(
  result: SlcResult,
  state: IncrementalState,
  steps: readonly PhaseStep[],
): Promise<SlcResult> {
  if (!result.ok || state.executed === 0) return result;
  if (
    state.accepted.length !== steps.length ||
    state.accepted.some(
      (entry) => entry.inputs === null || entry.output === null,
    )
  ) {
    return historyDiagnostic(
      result,
      'one or more phase identities or output bytes were unavailable',
    );
  }

  const records: StepToRecord[] = [];
  try {
    for (const accepted of state.accepted) {
      const bytes = await readFile(accepted.target);
      if (hashBytes(bytes) !== accepted.output) {
        return historyDiagnostic(
          result,
          `accepted output changed before publication: ${accepted.target}`,
        );
      }
      records.push({
        kind: accepted.step.request.kind,
        name: accepted.step.phase,
        target: accepted.target,
        inputs: accepted.inputs as Hash[],
        output: accepted.output as Hash,
        bytes,
      });
    }
    await recordBuild({
      artDir: state.artDir,
      pipeline: state.pipelineName,
      sourcePath: state.source,
      sourceBytes: state.sourceBytes,
      steps: records,
    });
    return result;
  } catch (error) {
    return historyDiagnostic(result, messageOf(error));
  }
}

function historyDiagnostic(result: SlcResult, reason: string): SlcResult {
  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      `slc: build history not recorded: ${reason}`,
    ],
  };
}

/** An executor to run, or a fail-closed verdict that stops the run (phase-execution-27). */
type Strategy =
  | { kind: 'run'; executor: PhaseExecutor }
  | { kind: 'fail'; reasons: string[] };

/**
 * Selects a phase's execution strategy from the pin index (phase-execution-27; DR-005,
 * DR-007): a phase with no pin interprets, a current pin runs its compiled
 * artifact, and a stale or malformed pin fails closed and is never silently
 * interpreted.
 */
async function selectExecutor(
  phase: string,
  pinKey: string | undefined,
  pipelineDir: string,
  pinFile: PinFile | undefined,
  deps: SlcDeps,
): Promise<Strategy> {
  const record = ownPin(pinFile, pinKey);
  if (pinFile === undefined || pinKey === undefined || record === undefined) {
    return { kind: 'run', executor: deps.executor };
  }

  const verdict = await evaluatePin(pipelineDir, pinFile, pinKey, record);
  if (verdict.status === 'current') {
    if (deps.compiled === undefined) {
      return {
        kind: 'fail',
        reasons: [
          `phase "${phase}" is pinned to a compiled artifact, but this host has no compiled executor configured`,
        ],
      };
    }
    return {
      kind: 'run',
      executor: deps.compiled({ phase: pinKey, pipelineDir, record }),
    };
  }
  return {
    kind: 'fail',
    reasons: [`pin is ${verdict.status}: ${verdict.reason}`],
  };
}

function ownPin(
  pinFile: PinFile | undefined,
  pinKey: string | undefined,
): PinRecord | undefined {
  return pinFile !== undefined &&
    pinKey !== undefined &&
    Object.hasOwn(pinFile.pins, pinKey)
    ? pinFile.pins[pinKey]
    : undefined;
}

function phaseDefinition(pipeline: Pipeline, name: string): string {
  return join(pipeline.dir, `${name}.md`);
}

function chainDefinitions(pipeline: Pipeline): string[] {
  const definitions = [...pipeline.phases, ...pipeline.passes].map((phase) =>
    phaseDefinition(pipeline, phase.name),
  );
  if (pipeline.linkFile !== null) {
    definitions.push(pipeline.linkFile);
  }
  return definitions;
}

async function requireLink(
  pipeline: Pipeline,
  reference: string,
): Promise<LinkPhase> {
  if (pipeline.linkFile === null) {
    throw new Error(`pipeline "${reference}" has no link phase`);
  }
  // `loadLinkFile` relaxes the ## Link Targets requirement intrinsically for
  // Playbook's `playbook` linked format (DR-002, DR-009, pipeline-11), so the
  // requirement does not depend on how the pipeline reference resolved.
  return loadLinkFile(pipeline.linkFile);
}

async function revalidateChain(dir: string): Promise<void> {
  await loadPipeline(dir);
}

function failure(message: string): SlcResult {
  return { ok: false, outputs: [], diagnostics: [message] };
}

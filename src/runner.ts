// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * End-to-end `slc` runner: composes the generic mechanics (DR-001, DR-002) with
 * the execution boundary (DR-003) and an injected {@link PhaseExecutor}
 * (interpreted per DR-004). It parses an invocation, resolves and loads the
 * pipeline, computes artifact paths, then runs each phase through `runPhase`,
 * stopping at the first failure with its report. The resolver and executor are
 * injected so a host wires the real pipeline resolution and Cligent agent while
 * tests supply fakes. See specs/dev/pipeline.md and specs/dev/phase-execution.md.
 */

import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { artifactDir, planArtifacts, parseSource } from './artifacts.js';
import {
  type CompiledSelection,
  type ScheduledStep,
  phaseDefinition,
  phaseStep,
  planFullBuild,
} from './build-plan.js';
import type { PromotionCheckpointHandler } from './build-promotion.js';
import { runColdLineage, type BuildIdentityProvider } from './cold-lineage.js';
import { emitEntryModule } from './entry-module.js';
import { unresolvableRelativeImports } from './emitted-imports.js';
import { messageOf } from './errors.js';
import {
  type PhaseExecutor,
  formatFailureReport,
  runPhase,
} from './execution.js';
import { type Invocation, parseInvocation } from './invocation.js';
import { type LinkPhase, linkedArtifactPath, loadLinkFile } from './link.js';
import type { ProgressSink } from './progress.js';
import { evaluatePin, evaluatePinFile } from './pin-currency.js';
import { deriveDeclaredClosure } from './pin-closure.js';
import { PinError, loadPinFile, type PinFile } from './pins.js';
import {
  type Pipeline,
  type PipelineResolver,
  loadPipeline,
  resolvePipeline,
} from './pipeline.js';
import {
  defaultPlaybookLinkTarget,
  isReservedPipeline,
  RESERVED_SLC_PIPELINE,
} from './resolver.js';
import {
  emitFsmCoverageTest,
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  emitPromptContractTest,
} from './verify.js';
import {
  VERIFIER_SUPPORT_MODULE,
  emitVerifierSupport,
} from './verify-support.js';

export type { CompiledSelection } from './build-plan.js';
export type { BuildIdentityProvider } from './cold-lineage.js';

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
  /** Re-derives every exact host-owned input used by canonical lineage plans. */
  buildIdentity: BuildIdentityProvider;
  /** Invocation working directory anchoring artifact placement (DR-014); defaults to the process cwd. */
  cwd?: string;
  signal?: AbortSignal;
  /**
   * Receives phase start/finish/failure events with elapsed times as the run
   * progresses (DR-019, CLI-32). Absent for hosts that want a quiet run.
   */
  progress?: ProgressSink;
  /** Observes promotion checkpoints; the seam INCR-27 interruption acceptance drives. */
  promotionCheckpoint?: PromotionCheckpointHandler;
}

/** The outcome of an `slc` run. */
export interface SlcResult {
  ok: boolean;
  /** Artifact paths written, in order. */
  outputs: string[];
  /** Diagnostics: agent summaries on success, or the failure report. */
  diagnostics: string[];
  /**
   * Present when the run changed nothing because the accepted bundle already
   * satisfied it. Absent means the run produced the listed paths.
   */
  outcome?: 'up-to-date' | 'adopted';
  /** For an adoption: how many leading outputs were attested, not written. */
  attested?: number;
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
        // (SELFHOST-13): a bare full run becomes a full-link against the
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
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const topology = planFullBuild({
    invocation,
    pipeline,
    cwd: runCwd(deps),
  });
  if (
    invocation.output === null &&
    invocation.pipeline !== RESERVED_SLC_PIPELINE
  ) {
    return runColdLineage(
      topology,
      { ...deps, cwd: runCwd(deps) },
      invocation.rebuild === true
        ? { rebuild: true }
        : invocation.adopt === true
          ? { adopt: true }
          : {},
    );
  }
  await mkdir(topology.artifactDir, { recursive: true });
  const result = await executeSteps(topology.steps, pipeline, deps);
  return emitVerification(result, {
    pipeline: invocation.pipeline,
    plan: topology.artifacts,
    artDir: topology.artifactDir,
    basename: topology.basename,
  });
}

async function runSinglePhase(
  invocation: Extract<Invocation, { kind: 'phase' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
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

  const { basename, raw } = parseSource({
    path: invocation.source,
    sourceFormat: phase.source.format,
    ext: phase.source.ext,
    entry: pipeline.phases[0] === phase,
  });
  if (raw) {
    // A named phase cannot normalize (PIPE-37), so a raw entry source has no
    // path into the phase's declared source format here.
    return failure(
      `source "${invocation.source}" is a raw input; run the full pipeline to normalize it`,
    );
  }
  const artDir = artifactDir(runCwd(deps), basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  if (phase.pass) {
    // A standalone pass run cannot overwrite its own source: it writes the
    // `.opt` sibling unless `-o` relocates it (DR-013).
    const target =
      invocation.output ??
      join(artDir, `${basename}.${phase.target.format}.opt${phase.target.ext}`);
    const step = phaseStep(pipeline, phase, invocation.source, target);
    return executeSteps([step], pipeline, deps);
  }

  // Plan over the whole chain so the named phase keeps its pipeline role: a
  // non-terminal phase writes its canonical intermediate and ignores `-o`
  // (DR-001 -- artifact location depends on role, not invocation mode).
  const plan = planArtifacts({
    phases: pipeline.phases,
    basename,
    artDir,
    output: invocation.output ?? undefined,
  });
  const artifact = plan[pipeline.phases.indexOf(phase)];
  const step = phaseStep(pipeline, phase, invocation.source, artifact.path);
  return executeSteps([step], pipeline, deps);
}

async function runDirectLink(
  invocation: Extract<Invocation, { kind: 'link' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const link = await requireLink(pipeline, invocation.pipeline);
  const linked = linkedArtifactPath({
    kind: 'link',
    pipeline: invocation.pipeline,
    objects: invocation.objects,
    source: link.source,
    linked: link.target,
    output: invocation.output,
    cwd: runCwd(deps),
  });
  await mkdir(dirname(linked), { recursive: true });

  const step: ScheduledStep = {
    id: 'link:single',
    kind: 'link',
    name: 'link',
    source: { ...link.source },
    target: { ...link.target },
    product: 'semantic:link.link',
    pinKey: 'link',
    request: {
      kind: 'link',
      definitionPath: pipeline.linkFile as string,
      objects: invocation.objects,
      linkTarget: invocation.linkTarget,
      options: invocation.options,
      linked,
    },
    targetExt: link.target.ext,
  };
  return executeSteps([step], pipeline, deps);
}

async function runFullLink(
  invocation: Extract<Invocation, { kind: 'full-link' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const link = await requireLink(pipeline, invocation.pipeline);
  const topology = planFullBuild({
    invocation,
    pipeline,
    cwd: runCwd(deps),
    link,
  });
  if (
    invocation.output === null &&
    invocation.pipeline !== RESERVED_SLC_PIPELINE
  ) {
    return runColdLineage(
      topology,
      { ...deps, cwd: runCwd(deps) },
      invocation.rebuild === true
        ? { rebuild: true }
        : invocation.adopt === true
          ? { adopt: true }
          : {},
    );
  }
  await mkdir(topology.artifactDir, { recursive: true });
  const result = await executeSteps(topology.steps, pipeline, deps);
  const verified = await emitVerification(result, {
    pipeline: invocation.pipeline,
    plan: topology.artifacts,
    artDir: topology.artifactDir,
    basename: topology.basename,
  });

  // Entry-module emission (DR-014, SELFHOST-15): only the playbook pipeline,
  // only with the linked artifact at its canonical path.
  if (
    verified.ok &&
    invocation.pipeline === 'playbook' &&
    invocation.output === null
  ) {
    const gearsPlan = topology.artifacts.find(
      (artifact) => artifact.phase.target.format === 'gears',
    );
    if (gearsPlan !== undefined) {
      const entry = pipeline.phases[0];
      const textPath = topology.invocation.normalize
        ? join(
            topology.artifactDir,
            `${topology.basename}.${entry.source.format}${entry.source.ext}`,
          )
        : invocation.source;
      const entryPath = await emitEntryModule({
        cwd: runCwd(deps),
        basename: topology.basename,
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
              `${missing.join(', ')} (VERIFY-18)`,
          ],
        };
      }
      return { ...verified, outputs: [...verified.outputs, entryPath] };
    }
  }
  return verified;
}

/** The invocation working directory anchoring artifact placement (DR-014). */
function runCwd(deps: SlcDeps): string {
  return deps.cwd ?? process.cwd();
}

/**
 * After a reserved-pipeline full run produces a `gears` intermediate and an `fsm`
 * object at their canonical `<basename>.playbook/` locations, emits the
 * artifact-local checker support plus compilation-correctness tests beside
 * them as `slc` output, appending their paths to the outputs (VERIFY-2,
 * VERIFY-4;
 * [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).
 * Non-reserved pipelines, runs without a gears+fsm pair, and runs whose `fsm` was
 * relocated out of that directory by `-o` (PIPE-8) are left unchanged, so an
 * emitted test never imports a file that was not written beside it. A test whose
 * emission needs the produced `fsm` imported (the pinned introspection) degrades
 * to a diagnostic when the artifact cannot be loaded, leaving the run outcome
 * unchanged — the conformance test still fails at test time on a broken module.
 */
async function emitVerification(
  result: SlcResult,
  ctx: {
    pipeline: string;
    plan: readonly {
      path: string;
      phase: { target: { format: string; ext: string } };
    }[];
    artDir: string;
    basename: string;
  },
): Promise<SlcResult> {
  if (!result.ok || !isReservedPipeline(ctx.pipeline)) return result;
  const fsm = ctx.plan.find(
    (artifact) => artifact.phase.target.format === 'fsm',
  );
  const hasGears = ctx.plan.some(
    (artifact) => artifact.phase.target.format === 'gears',
  );
  if (fsm === undefined || !hasGears) return result;
  // The emitted tests import the canonical sibling FSM through the NodeNext
  // `./<basename>.fsm.js` specifier; skip when `-o` relocated the physical FSM
  // elsewhere (PIPE-8), so that edge never targets a missing sibling artifact.
  const canonicalFsm = join(
    ctx.artDir,
    `${ctx.basename}.fsm${fsm.phase.target.ext}`,
  );
  if (fsm.path !== canonicalFsm) return result;
  const outputs = [...result.outputs];
  const diagnostics = [...result.diagnostics];
  outputs.push(...(await emitVerifierSupport(ctx.artDir)));
  outputs.push(
    await emitGearsFsmConformanceTest({
      artifactDir: ctx.artDir,
      basename: ctx.basename,
      verifyModule: VERIFIER_SUPPORT_MODULE,
    }),
  );
  try {
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
    const promptContract = await emitPromptContractTest({
      artifactDir: ctx.artDir,
      basename: ctx.basename,
      verifyModule: VERIFIER_SUPPORT_MODULE,
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

/**
 * Runs steps in order, selecting interpreted or compiled execution per phase from
 * the pin index and stopping at the first failure with its report (PHEXEC-9,
 * PHEXEC-27). An unparseable pin file fails the run closed before any phase.
 */
async function executeSteps(
  steps: readonly ScheduledStep[],
  pipeline: Pipeline,
  deps: SlcDeps,
): Promise<SlcResult> {
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
    const verdicts = await evaluatePinFile(pipeline.dir, pinFile);
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

  const definitions = chainDefinitions(pipeline);
  const outputs: string[] = [];
  const diagnostics: string[] = [];

  for (const step of steps) {
    const target =
      step.request.kind === 'compile'
        ? step.request.target
        : step.request.linked;

    // In-run progress (DR-019, CLI-32): announce the phase, then report its
    // outcome with the elapsed time.
    const startedAt = Date.now();
    deps.progress?.({ kind: 'phase-start', phase: step.name, target });
    const fail = (): void =>
      deps.progress?.({
        kind: 'phase-fail',
        phase: step.name,
        target,
        elapsedMs: Date.now() - startedAt,
      });

    // Selecting a compiled executor can throw rather than return a verdict —
    // notably an unmapped pinned Playbook provenance, which the host factory
    // rejects (PHEXEC-30). That is the same fail-closed family as a stale pin,
    // so it is reported through the phase-failure path; letting it unwind
    // would strand the phase-start line with no terminal event and drop the
    // phase and target from the report (CLI-4, CLI-32, PHEXEC-27).
    let selection: Strategy;
    try {
      selection = await selectExecutor(
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
          phase: step.name,
          target,
          reasons: selection.reasons,
        }),
      );
      return { ok: false, outputs, diagnostics };
    }

    const semanticInputs = await workspaceSemanticInputs(
      step,
      pipeline,
      pinFile,
      runCwd(deps),
    );

    const result = await runPhase({
      request: step.request,
      phase: step.name,
      targetExt: step.targetExt,
      executor: selection.executor,
      definitions,
      revalidate: () => revalidateChain(pipeline.dir),
      workspaceOptions: {
        runRoot: runCwd(deps),
        semanticInputs,
      },
      signal: deps.signal,
    });
    if (!result.ok) {
      fail();
      diagnostics.push(formatFailureReport(result.report));
      return { ok: false, outputs, diagnostics };
    }
    diagnostics.push(...result.diagnostics);
    // A linked module that cannot resolve its own relative imports cannot
    // load under `playbook run`; fail the link rather than report success
    // for a dead artifact (VERIFY-18).
    if (
      step.kind === 'link' &&
      (step.targetExt === '.ts' || step.targetExt === '.js')
    ) {
      let missing: string[];
      try {
        missing = await unresolvableRelativeImports(
          step.request.kind === 'link' ? step.request.linked : target,
        );
      } catch (error) {
        // A target that cannot even be read is a dead artifact too — a
        // directory at the linked path passes the DR-003 existence and
        // extension checks and then fails the read. Fail the link here so
        // every started phase still reaches a terminal event (CLI-32).
        fail();
        diagnostics.push(
          `linked module ${target} could not be read: ${messageOf(error)} — ` +
            'an emitted module that cannot load fails the link (VERIFY-18)',
        );
        return { ok: false, outputs, diagnostics };
      }
      if (missing.length > 0) {
        fail();
        diagnostics.push(
          `linked module ${target} has unresolvable relative imports: ` +
            `${missing.join(', ')} — an emitted module that cannot load ` +
            'fails the link (VERIFY-18)',
        );
        return { ok: false, outputs, diagnostics };
      }
    }
    deps.progress?.({
      kind: 'phase-finish',
      phase: step.name,
      target,
      elapsedMs: Date.now() - startedAt,
    });
    outputs.push(target);
  }
  return { ok: true, outputs, diagnostics };
}

/** Derives the ordered declared reads not already represented as request references. */
async function workspaceSemanticInputs(
  step: ScheduledStep,
  pipeline: Pipeline,
  pinFile: PinFile | undefined,
  runRoot: string,
): Promise<Array<{ logicalPath: string }>> {
  const references =
    step.request.kind === 'compile'
      ? (step.request.references ?? []).map((path) => resolve(runRoot, path))
      : [];
  const referencePaths = new Set(references);
  const pin = step.pinKey === null ? undefined : pinFile?.pins[step.pinKey];
  const closure = await deriveDeclaredClosure({
    pipelineDir: pipeline.dir,
    definitionPath: step.request.definitionPath,
    boundary: pin === undefined ? undefined : pinFile?.pathBoundary.path,
    references,
  });
  return [...closure.inputs]
    .filter((path) => !referencePaths.has(resolve(path)))
    .map((logicalPath) => ({ logicalPath }));
}

/** An executor to run, or a fail-closed verdict that stops the run (PHEXEC-27). */
type Strategy =
  | { kind: 'run'; executor: PhaseExecutor }
  | { kind: 'fail'; reasons: string[] };

/**
 * Selects a phase's execution strategy from the pin index (PHEXEC-27; DR-005,
 * DR-007): a phase with no pin interprets, a current pin runs its compiled
 * artifact, and a stale or malformed pin fails closed and is never silently
 * interpreted.
 */
async function selectExecutor(
  phase: string | null,
  pipelineDir: string,
  pinFile: PinFile | undefined,
  deps: SlcDeps,
): Promise<Strategy> {
  if (phase === null) {
    return { kind: 'run', executor: deps.executor };
  }
  const record = pinFile?.pins[phase];
  if (pinFile === undefined || record === undefined) {
    return { kind: 'run', executor: deps.executor };
  }

  const verdict = await evaluatePin(pipelineDir, pinFile, phase, record);
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
      executor: deps.compiled({ phase, pipelineDir, record }),
    };
  }
  return {
    kind: 'fail',
    reasons: [`pin is ${verdict.status}: ${verdict.reason}`],
  };
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
  // Playbook's `playbook` linked format (DR-002, DR-009, PIPE-11), so the
  // requirement does not depend on how the pipeline reference resolved.
  return loadLinkFile(pipeline.linkFile);
}

async function revalidateChain(dir: string): Promise<void> {
  await loadPipeline(dir);
}

function failure(message: string): SlcResult {
  return { ok: false, outputs: [], diagnostics: [message] };
}

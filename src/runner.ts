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
import { dirname, join } from 'node:path';

import { artifactDir, planArtifacts, parseSource } from './artifacts.js';
import {
  type ExecuteRequest,
  type PhaseExecutor,
  formatFailureReport,
  runPhase,
} from './execution.js';
import { type Invocation, parseInvocation } from './invocation.js';
import { type LinkPhase, linkedArtifactPath, loadLinkFile } from './link.js';
import { evaluatePin } from './pin-currency.js';
import { PinError, loadPinFile, type PinFile, type PinRecord } from './pins.js';
import {
  type Pipeline,
  type PipelineResolver,
  loadPipeline,
  resolvePipeline,
} from './pipeline.js';
import { isReservedPipeline } from './resolver.js';
import { emitGearsFsmConformanceTest } from './verify.js';

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
  signal?: AbortSignal;
}

/** The outcome of an `slc` run. */
export interface SlcResult {
  ok: boolean;
  /** Artifact paths written, in order. */
  outputs: string[];
  /** Diagnostics: agent summaries on success, or the failure report. */
  diagnostics: string[];
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
  const entry = pipeline.phases[0];
  const { basename, dir: srcDir } = parseSource({
    path: invocation.source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const artDir = artifactDir(srcDir, basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  const plan = planArtifacts({
    phases: pipeline.phases,
    basename,
    artDir,
    output: invocation.output ?? undefined,
  });
  const steps: PhaseStep[] = plan.map((artifact, index) => ({
    request: {
      kind: 'compile',
      definitionPath: phaseDefinition(pipeline, artifact.phase.name),
      source: index === 0 ? invocation.source : plan[index - 1].path,
      target: artifact.path,
    },
    phase: artifact.phase.name,
    targetExt: artifact.phase.target.ext,
  }));
  const result = await executeSteps(steps, pipeline, deps);
  return emitVerification(result, {
    pipeline: invocation.pipeline,
    plan,
    artDir,
    basename,
  });
}

async function runSinglePhase(
  invocation: Extract<Invocation, { kind: 'phase' }>,
  deps: SlcDeps,
): Promise<SlcResult> {
  const pipeline = await loadPipeline(
    await resolvePipeline(invocation.pipeline, deps.resolver),
  );
  const phase = pipeline.phases.find(
    (candidate) => candidate.name === invocation.phase,
  );
  if (phase === undefined) {
    return failure(
      `phase "${invocation.phase}" is not part of pipeline "${invocation.pipeline}"`,
    );
  }

  const { basename, dir: srcDir } = parseSource({
    path: invocation.source,
    sourceFormat: phase.source.format,
    ext: phase.source.ext,
    entry: pipeline.phases[0] === phase,
  });
  const artDir = artifactDir(srcDir, basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

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
  const step: PhaseStep = {
    request: {
      kind: 'compile',
      definitionPath: phaseDefinition(pipeline, phase.name),
      source: invocation.source,
      target: artifact.path,
    },
    phase: phase.name,
    targetExt: phase.target.ext,
  };
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
  });
  await mkdir(dirname(linked), { recursive: true });

  const step: PhaseStep = {
    request: {
      kind: 'link',
      definitionPath: pipeline.linkFile as string,
      objects: invocation.objects,
      linkTarget: invocation.linkTarget,
      options: invocation.options,
      linked,
    },
    phase: 'link',
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
  const entry = pipeline.phases[0];
  const { basename, dir: srcDir } = parseSource({
    path: invocation.source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const artDir = artifactDir(srcDir, basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  // Compile chain: the exit artifact becomes the object artifact (PIPE-15).
  const plan = planArtifacts({ phases: pipeline.phases, basename, artDir });
  const compileSteps: PhaseStep[] = plan.map((artifact, index) => ({
    request: {
      kind: 'compile',
      definitionPath: phaseDefinition(pipeline, artifact.phase.name),
      source: index === 0 ? invocation.source : plan[index - 1].path,
      target: artifact.path,
    },
    phase: artifact.phase.name,
    targetExt: artifact.phase.target.ext,
  }));

  const linked = linkedArtifactPath({
    kind: 'full',
    artDir,
    basename,
    linked: link.target,
    output: invocation.output,
  });
  const linkStep: PhaseStep = {
    request: {
      kind: 'link',
      definitionPath: pipeline.linkFile as string,
      objects: [plan[plan.length - 1].path],
      linkTarget: invocation.linkTarget,
      options: invocation.options,
      linked,
    },
    phase: 'link',
    targetExt: link.target.ext,
  };
  const result = await executeSteps(
    [...compileSteps, linkStep],
    pipeline,
    deps,
  );
  return emitVerification(result, {
    pipeline: invocation.pipeline,
    plan,
    artDir,
    basename,
  });
}

/**
 * After a reserved-pipeline full run produces a `gears` intermediate and an `fsm`
 * object at their canonical `<basename>.playbook/` locations, emits the GEARS↔FSM
 * conformance test beside them as `slc` output, appending its path to the outputs
 * (VERIFY-2; [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).
 * Non-reserved pipelines, runs without a gears+fsm pair, and runs whose `fsm` was
 * relocated out of that directory by `-o` (PIPE-8) are left unchanged, so the
 * emitted test never imports a file that was not written beside it.
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
  // The emitted test imports the canonical `./<basename>.fsm.js` beside it; skip
  // when `-o` relocated the terminal fsm elsewhere (PIPE-8), so it never points
  // at a file that was not written under `<basename>.playbook/`.
  const canonicalFsm = join(
    ctx.artDir,
    `${ctx.basename}.fsm${fsm.phase.target.ext}`,
  );
  if (fsm.path !== canonicalFsm) return result;
  const testPath = await emitGearsFsmConformanceTest({
    artifactDir: ctx.artDir,
    basename: ctx.basename,
  });
  return { ...result, outputs: [...result.outputs, testPath] };
}

/** One phase to run: its execute request and the checks `runPhase` needs. */
interface PhaseStep {
  request: ExecuteRequest;
  phase: string;
  targetExt: string;
}

/**
 * Runs steps in order, selecting interpreted or compiled execution per phase from
 * the pin index and stopping at the first failure with its report (PHEXEC-9,
 * PHEXEC-27). An unparseable pin file fails the run closed before any phase.
 */
async function executeSteps(
  steps: readonly PhaseStep[],
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

  const definitions = chainDefinitions(pipeline);
  const outputs: string[] = [];
  const diagnostics: string[] = [];

  for (const step of steps) {
    const target =
      step.request.kind === 'compile'
        ? step.request.target
        : step.request.linked;

    const selection = await selectExecutor(
      step.phase,
      pipeline.dir,
      pinFile,
      deps,
    );
    if (selection.kind === 'fail') {
      diagnostics.push(
        formatFailureReport({
          phase: step.phase,
          target,
          reasons: selection.reasons,
        }),
      );
      return { ok: false, outputs, diagnostics };
    }

    const result = await runPhase({
      request: step.request,
      phase: step.phase,
      targetExt: step.targetExt,
      executor: selection.executor,
      definitions,
      revalidate: () => revalidateChain(pipeline.dir),
      signal: deps.signal,
    });
    if (!result.ok) {
      diagnostics.push(formatFailureReport(result.report));
      return { ok: false, outputs, diagnostics };
    }
    diagnostics.push(...result.diagnostics);
    outputs.push(target);
  }
  return { ok: true, outputs, diagnostics };
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
  phase: string,
  pipelineDir: string,
  pinFile: PinFile | undefined,
  deps: SlcDeps,
): Promise<Strategy> {
  const record = pinFile?.pins[phase];
  if (pinFile === undefined || record === undefined) {
    return { kind: 'run', executor: deps.executor };
  }

  const verdict = await evaluatePin(pipelineDir, pinFile, record);
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

function phaseDefinition(pipeline: Pipeline, name: string): string {
  return join(pipeline.dir, `${name}.md`);
}

function chainDefinitions(pipeline: Pipeline): string[] {
  const definitions = pipeline.phases.map((phase) =>
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

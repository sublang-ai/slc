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
import {
  type Pipeline,
  type PipelineResolver,
  loadPipeline,
  resolvePipeline,
} from './pipeline.js';

/** Host-supplied capabilities for a run. */
export interface SlcDeps {
  /** Resolves a pipeline reference to candidate directories (DR-001). */
  resolver: PipelineResolver;
  /** Executes a phase (interpreted in production). */
  executor: PhaseExecutor;
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
  return executeSteps(steps, pipeline, deps);
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
  return executeSteps([...compileSteps, linkStep], pipeline, deps);
}

/** One phase to run: its execute request and the checks `runPhase` needs. */
interface PhaseStep {
  request: ExecuteRequest;
  phase: string;
  targetExt: string;
}

/** Runs steps in order, stopping at the first failure with its report (PHEXEC-9). */
async function executeSteps(
  steps: readonly PhaseStep[],
  pipeline: Pipeline,
  deps: SlcDeps,
): Promise<SlcResult> {
  const definitions = chainDefinitions(pipeline);
  const outputs: string[] = [];
  const diagnostics: string[] = [];

  for (const step of steps) {
    const result = await runPhase({
      request: step.request,
      phase: step.phase,
      targetExt: step.targetExt,
      executor: deps.executor,
      definitions,
      revalidate: () => revalidateChain(pipeline.dir),
      signal: deps.signal,
    });
    if (!result.ok) {
      diagnostics.push(formatFailureReport(result.report));
      return { ok: false, outputs, diagnostics };
    }
    diagnostics.push(...result.diagnostics);
    outputs.push(
      step.request.kind === 'compile'
        ? step.request.target
        : step.request.linked,
    );
  }
  return { ok: true, outputs, diagnostics };
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

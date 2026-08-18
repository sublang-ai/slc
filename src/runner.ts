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

import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import type { Stats } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { artifactDir, planArtifacts, parseSource } from './artifacts.js';
import {
  HISTORY_DIR,
  SOURCE_COPY,
  encodeLocator,
  invalidateBuildHistory,
  loadBuildHistory,
  readSourceBytes,
  readStoreFile,
  recordBuild,
  resolveLocator,
  verifiedCopy,
  type BuildHistory,
  type StepHistoryRecord,
  type StepToRecord,
} from './build-history.js';
import { emitEntryModule } from './entry-module.js';
import { unresolvableRelativeImports } from './emitted-imports.js';
import { errorCode, messageOf } from './errors.js';
import {
  type ExecuteRequest,
  type PhaseExecutor,
  formatFailureReport,
  regularFileState,
  runPhase,
} from './execution.js';
import { hashBytes, hashFile, type Hash } from './hash.js';
import { type Invocation, parseInvocation } from './invocation.js';
import { unifiedLineDiff } from './line-diff.js';
import { type LinkPhase, linkedArtifactPath, loadLinkFile } from './link.js';
import { deriveClosure } from './pin-closure.js';
import { resolvePinPath } from './pin-paths.js';
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
  emitFsmCoverageTest,
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  emitPromptContractTest,
} from './verify.js';
import {
  VERIFIER_SUPPORT_DIR,
  VERIFIER_SUPPORT_MODULE,
  emitVerifierSupport,
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
   * progresses (DR-019, CLI-32). Absent for hosts that want a quiet run.
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
  /**
   * `up-to-date` when a full run reused every step: no agent was invoked and
   * no chain artifact or history was rewritten; deterministic derivatives
   * are still re-derived (DR-021, INCR-2).
   */
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
  // One canonical path boundary (PHEXEC-39): every filesystem operand is
  // resolved against the invocation working directory once, so identity,
  // protection, prompts, and history all speak the same absolute paths.
  invocation = canonicalInvocation(invocation, runCwd(deps));

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
  const entry = pipeline.phases[0];
  const { basename, raw } = parseSource({
    path: invocation.source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const artDir = artifactDir(runCwd(deps), basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  const plan = planArtifacts({
    phases: pipeline.phases,
    basename,
    artDir,
    output: invocation.output ?? undefined,
  });
  const steps = buildCompileSteps({
    pipeline,
    plan,
    source: invocation.source,
    artDir,
    basename,
    optimize: !invocation.noOptimize,
    normalize: invocation.normalize || raw,
  });
  const result = await executeSteps(
    steps,
    pipeline,
    deps,
    incrementalRun(invocation, artDir),
    hostPlan({ artDir, basename, pipeline: invocation.pipeline }),
  );
  // Deterministic derivation runs on every successful invocation, so an
  // all-reuse run restores a missing or drifted derivative (INCR-2).
  return emitVerification(result, {
    pipeline: invocation.pipeline,
    plan,
    artDir,
    basename,
  });
}

/**
 * Build history covers canonical full and full-link runs of every pipeline
 * except the reserved `slc` meta-pipeline (DR-021): `-o` and that
 * meta-pipeline neither consult nor write it (INCR-8).
 */
function incrementalRun(
  invocation: Extract<Invocation, { kind: 'full' | 'full-link' }>,
  artDir: string,
): IncrementalRun | undefined {
  if (invocation.output !== null || invocation.pipeline === 'slc') {
    return undefined;
  }
  return {
    artDir,
    source: invocation.source,
    pipelineName: invocation.pipeline,
    rebuild: invocation.rebuild === true,
  };
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
    const step = compileStep(pipeline, phase, invocation.source, target);
    return executeSteps(
      [step],
      pipeline,
      deps,
      undefined,
      hostPlan({ artDir, basename, pipeline: invocation.pipeline }),
    );
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
  const step = compileStep(pipeline, phase, invocation.source, artifact.path);
  return executeSteps(
    [step],
    pipeline,
    deps,
    undefined,
    hostPlan({ artDir, basename, pipeline: invocation.pipeline }),
  );
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
    kind: 'link',
  };
  // The linked path's parent is created only after plan validation (PHEXEC-39).
  return executeSteps([step], pipeline, deps, undefined, {
    ...EMPTY_HOST_PLAN,
    ensureDirs: [dirname(linked)],
  });
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
  const { basename, raw } = parseSource({
    path: invocation.source,
    sourceFormat: entry.source.format,
    ext: entry.source.ext,
    entry: true,
  });
  const normalize = invocation.normalize || raw;
  const artDir = artifactDir(runCwd(deps), basename, invocation.pipeline);
  await mkdir(artDir, { recursive: true });

  // Compile chain: the exit artifact becomes the object artifact (PIPE-15).
  const plan = planArtifacts({ phases: pipeline.phases, basename, artDir });
  const compileSteps = buildCompileSteps({
    pipeline,
    plan,
    source: invocation.source,
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
    kind: 'link',
  };
  // The runnable entry is a planned host write (DR-014) — except when the
  // invocation source already sits at its path, where emission is skipped
  // with a diagnostic below rather than refused (COMPILE-7).
  const entryPath = join(runCwd(deps), `${basename}.ts`);
  const emitsEntry =
    invocation.pipeline === 'playbook' &&
    invocation.output === null &&
    entryPath !== invocation.source;
  const result = await executeSteps(
    [...compileSteps, linkStep],
    pipeline,
    deps,
    incrementalRun(invocation, artDir),
    hostPlan({
      artDir,
      basename,
      pipeline: invocation.pipeline,
      entry: emitsEntry ? entryPath : undefined,
    }),
  );
  // Deterministic derivation and entry emission run on every successful
  // invocation, so an all-reuse run restores a missing or drifted
  // derivative (INCR-2).
  const verified = await emitVerification(result, {
    pipeline: invocation.pipeline,
    plan,
    artDir,
    basename,
  });

  // Entry-module emission (DR-014, SELFHOST-15): only the playbook pipeline,
  // only with the linked artifact at its canonical path.
  if (
    verified.ok &&
    invocation.pipeline === 'playbook' &&
    invocation.output === null
  ) {
    const gearsPlan = plan.find(
      (artifact) => artifact.phase.target.format === 'gears',
    );
    if (gearsPlan !== undefined) {
      const textPath = normalize
        ? join(artDir, `${basename}.${entry.source.format}${entry.source.ext}`)
        : invocation.source;
      // A raw `.ts` source named like the entry module would be its own
      // emission path; leave the input untouched and report why the entry
      // was not produced (COMPILE-7, DR-014).
      if (
        await samePhysicalFile(
          join(runCwd(deps), `${basename}.ts`),
          invocation.source,
        )
      ) {
        return {
          ...verified,
          diagnostics: [
            ...verified.diagnostics,
            `entry module ${basename}.ts not emitted: its path is the invocation source; rename the source to emit a runnable entry`,
          ],
        };
      }
      const entryPath = await emitEntryModule({
        cwd: runCwd(deps),
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
              `${missing.join(', ')} (VERIFY-18)`,
          ],
        };
      }
      return { ...verified, outputs: [...verified.outputs, entryPath] };
    }
  }
  return verified;
}

/**
 * The run's writes beyond the chain targets, and the directories it
 * reserves (PHEXEC-39): the verification tests and the runnable entry are
 * planned outputs like any target, and no operand may name or enter the
 * `.slc` history or `.slc-verify` support directories.
 */
interface HostPlan {
  /** Files the host itself writes after the chain. */
  writes: readonly string[];
  /** Reserved directories no operand or target may name or enter. */
  reserved: readonly string[];
  /** Parent directories created only once plan validation has passed. */
  ensureDirs: readonly string[];
}

const EMPTY_HOST_PLAN: HostPlan = { writes: [], reserved: [], ensureDirs: [] };

/**
 * The host plan for a run anchored at an artifact directory: a reserved
 * pipeline emits the four verification tests beside the artifact, and every
 * such run owns `.slc` and `.slc-verify` under it (PHEXEC-39). The runnable
 * entry joins the writes only when the invocation will emit it (DR-014).
 */
function hostPlan(opts: {
  artDir: string;
  basename: string;
  pipeline: string;
  entry?: string;
}): HostPlan {
  const writes: string[] = [];
  if (isReservedPipeline(opts.pipeline)) {
    for (const suffix of [
      'gears-fsm.test.ts',
      'fsm.introspect.test.ts',
      'prompt-contract.test.ts',
      'fsm.coverage.test.ts',
    ]) {
      writes.push(join(opts.artDir, `${opts.basename}.${suffix}`));
    }
  }
  if (opts.entry !== undefined) writes.push(opts.entry);
  return {
    writes,
    reserved: [
      join(opts.artDir, HISTORY_DIR),
      join(opts.artDir, VERIFIER_SUPPORT_DIR),
    ],
    ensureDirs: [],
  };
}

/**
 * The request inputs that are not produced by an earlier step — the
 * external source, link targets, references, and direct-link objects. A
 * planned output aliasing one of these would destroy user input; the check
 * is order-aware so `-o <source>` cannot launder the source into a "chain
 * artifact" (PHEXEC-39).
 */
function immutableInputs(steps: readonly PhaseStep[]): string[] {
  const producedBefore = new Set<string>();
  const inputs = new Set<string>();
  for (const step of steps) {
    const stepInputsList =
      step.request.kind === 'compile'
        ? [step.request.source, ...(step.request.references ?? [])]
        : [...step.request.objects, step.request.linkTarget];
    for (const input of stepInputsList) {
      if (!producedBefore.has(input)) inputs.add(input);
    }
    producedBefore.add(
      step.request.kind === 'compile'
        ? step.request.target
        : step.request.linked,
    );
  }
  return [...inputs];
}

/**
 * Rejects a plan whose outputs — chain targets and host writes — collide
 * with each other, physically alias a protected input from the plan-wide
 * immutable union, or touch a reserved directory (PHEXEC-39), before any
 * executor runs. Containment is checked lexically on the canonical paths
 * first — a missing parent must not defeat it — with physical resolution as
 * a supplement.
 */
async function plannedOutputConflict(
  steps: readonly PhaseStep[],
  immutable: readonly string[],
  host: HostPlan,
): Promise<string | null> {
  const targets = steps.map((step) =>
    step.request.kind === 'compile' ? step.request.target : step.request.linked,
  );
  const seen = new Set<string>();
  for (const target of targets) {
    if (seen.has(target)) {
      return `slc: planned outputs collide at "${target}"; adjust -o`;
    }
    seen.add(target);
  }
  for (const write of host.writes) {
    if (seen.has(write)) {
      return `slc: planned output "${write}" is also written by the run itself; adjust -o`;
    }
  }
  for (const dir of host.reserved) {
    for (const path of [...targets, ...host.writes, ...immutable]) {
      if (await pathInsideDir(path, dir)) {
        return `slc: "${path}" names or enters the reserved directory "${dir}"; refusing to run`;
      }
    }
  }
  for (const write of host.writes) {
    for (const input of immutable) {
      if (write === input || (await samePhysicalFile(write, input))) {
        return `slc: the run would write "${write}", which is the protected input "${input}"; refusing to overwrite it`;
      }
    }
  }
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      if (await samePhysicalFile(targets[i], targets[j])) {
        return `slc: planned outputs "${targets[i]}" and "${targets[j]}" are the same file; refusing to run`;
      }
    }
  }
  for (const target of targets) {
    if ((await regularFileState(target)) === 'unsafe') {
      return `slc: planned output "${target}" is not writable as a private regular file (symbolic link, non-regular, or hard-linked); refusing to run`;
    }
  }
  for (const input of immutable) {
    let inputInfo: Stats | null;
    try {
      inputInfo = await stat(input);
    } catch {
      inputInfo = null;
    }
    for (const target of targets) {
      if (target === input || (await samePhysicalFile(target, input))) {
        return `slc: planned output "${target}" is the protected input "${input}"; refusing to overwrite it`;
      }
      if (
        inputInfo?.isDirectory() === true &&
        (await pathInsideDir(target, input))
      ) {
        return `slc: planned output "${target}" is inside protected directory "${input}"; refusing to run`;
      }
    }
  }
  return null;
}

/** Resolves every filesystem operand of an invocation against `cwd`. */
function canonicalInvocation(invocation: Invocation, cwd: string): Invocation {
  const abs = (path: string): string => resolve(cwd, path);
  const output = invocation.output === null ? null : abs(invocation.output);
  switch (invocation.kind) {
    case 'full':
    case 'phase':
      return { ...invocation, source: abs(invocation.source), output };
    case 'full-link':
      return {
        ...invocation,
        source: abs(invocation.source),
        linkTarget: abs(invocation.linkTarget),
        output,
      };
    case 'link':
      return {
        ...invocation,
        objects: invocation.objects.map(abs),
        linkTarget: abs(invocation.linkTarget),
        output,
      };
  }
}

/**
 * Whether `path` names `dir` or lives inside it. The lexical check on the
 * canonical paths is primary — it holds even when neither exists yet — and
 * physical resolution supplements it so a symlinked ancestor cannot hide
 * the containment (PHEXEC-39).
 */
async function pathInsideDir(path: string, dir: string): Promise<boolean> {
  if (path === dir || path.startsWith(`${dir}${sep}`)) return true;
  try {
    const root = await realpath(dir);
    const resolved = join(await realpath(dirname(path)), basename(path));
    return resolved === root || resolved.startsWith(`${root}${sep}`);
  } catch {
    return false;
  }
}

/** Whether two paths name the same physical file (device and inode). */
async function samePhysicalFile(left: string, right: string): Promise<boolean> {
  try {
    const [a, b] = await Promise.all([stat(left), stat(right)]);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

/** The invocation working directory anchoring artifact placement (DR-014). */
function runCwd(deps: SlcDeps): string {
  // Resolved once: a relative injected cwd would otherwise mix relative
  // planned outputs with the absolute canonical operands (PHEXEC-39).
  return resolve(deps.cwd ?? process.cwd());
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

/** One phase to run: its execute request and the checks `runPhase` needs. */
interface PhaseStep {
  request: ExecuteRequest;
  phase: string;
  targetExt: string;
  /** Step role for history matching (DR-021, INCR-13). */
  kind: 'normalize' | 'phase' | 'pass' | 'link';
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
      kind: 'normalize',
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
    targetExt: phase.target.ext,
    kind: phase.pass ? 'pass' : 'phase',
  };
}

/** A full run eligible for build history (DR-021): where and what to record. */
interface IncrementalRun {
  artDir: string;
  /** Absolute invocation source path. */
  source: string;
  pipelineName: string;
  /** `--rebuild`: bypass reuse and update, still record fresh history. */
  rebuild: boolean;
}

/** Live incremental state threaded through one run of `executeSteps`. */
interface IncrementalState extends IncrementalRun {
  history: BuildHistory | null;
  /** Steps completed this run — executed or reused — with their input and
   * accepted-output identities. */
  completed: {
    step: PhaseStep;
    inputs: Hash[];
    target: string;
    output: Hash;
  }[];
  /** Steps that ran an executor to completion (not reused). */
  executed: number;
  /**
   * Steps whose executor was invoked. A touched step that did not complete
   * with a recordable identity — it failed, or its inputs were
   * unidentifiable — gets no record, so no later run can reuse whatever the
   * executor left at its target (INCR-6).
   */
  touched: Set<PhaseStep>;
  /**
   * Canonical paths a failed executor changed while protected (PHEXEC-39).
   * A prior record for such a path must not be carried forward: the target
   * is no longer what that record vouched for (INCR-34).
   */
  mutated: Set<string>;
  /**
   * Whether `.slc/latest` was removed. Before the first executor may write,
   * the marker is gone, so a crash, kill, rebind, or later recording
   * failure can never leave a stale record vouching for a mutated target;
   * one final build publishes on an orderly finish (INCR-30).
   */
  invalidated: boolean;
}

/** How one step proceeds under the loaded history (DR-021, INCR-13). */
type StepMode =
  | { mode: 'ordinary' | 'reuse' }
  | { mode: 'update'; priorInput: string; diff: string | null };

/**
 * Runs steps in order, selecting interpreted or compiled execution per phase from
 * the pin index and stopping at the first failure with its report (PHEXEC-9,
 * PHEXEC-27). An unparseable pin file fails the run closed before any phase.
 * With an {@link IncrementalRun}, recorded history selects reuse or update per
 * step and the run records a new build after any executor work (DR-021).
 */
async function executeSteps(
  steps: readonly PhaseStep[],
  pipeline: Pipeline,
  deps: SlcDeps,
  incr?: IncrementalRun,
  host: HostPlan = EMPTY_HOST_PLAN,
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
  // Declared-input closures resolve within the pin file's validated path
  // boundary — the vendored playbook pipeline records `../..` — falling back
  // to the pipeline directory without pins (DR-007, INCR-12).
  const boundary = pinFile?.pathBoundary.path ?? '.';
  const outputs: string[] = [];
  const diagnostics: string[] = [];

  // Declared closures derive once per definition; `null` marks a definition
  // whose closure cannot be derived, so its steps stay unidentifiable
  // rather than silently under-keyed (INCR-12).
  const closureByDefinition = new Map<string, string[] | null>();
  for (const step of steps) {
    const definition = step.request.definitionPath;
    if (closureByDefinition.has(definition)) continue;
    try {
      closureByDefinition.set(
        definition,
        await declaredInputs(pipeline, definition, boundary),
      );
    } catch {
      closureByDefinition.set(definition, null);
    }
  }
  // One plan-wide immutable union (PHEXEC-39): external operands, every
  // scheduled definition (the built-in normalize definition included), the
  // chain definitions, every derivable declared input, and every
  // pin-selected compiled artifact and bundle. Plan validation and every
  // phase's protection use the same set, so `-o` can no longer name a file
  // only a later closure — or a reviewed executable — would have needed.
  const pinnedInputs: string[] = [];
  for (const step of steps) {
    const record = pinFile?.pins[step.phase];
    if (record === undefined) continue;
    try {
      pinnedInputs.push(
        resolvePinPath(
          pipeline.dir,
          boundary,
          record.artifact.path,
          'artifact',
        ),
        resolvePinPath(
          pipeline.dir,
          boundary,
          record.artifactBundle.path,
          'artifactBundle',
        ),
      );
    } catch {
      // A malformed pin fails closed at selection; nothing to protect here.
    }
    // The pinned link target and runtime dependencies are read inputs too;
    // only the path-shaped kinds resolve to files (PHEXEC-39).
    for (const ref of [record.linkTarget, ...record.runtimeDependencies]) {
      if (ref.kind !== 'file' && ref.kind !== 'directory') continue;
      try {
        pinnedInputs.push(
          resolvePinPath(pipeline.dir, boundary, ref.locator, 'locator'),
        );
      } catch {
        // Same fail-closed family as above.
      }
    }
  }
  const immutable = [
    ...new Set([
      ...immutableInputs(steps),
      ...steps.map((step) => step.request.definitionPath),
      ...definitions,
      ...[...closureByDefinition.values()].flatMap((closure) => closure ?? []),
      ...pinnedInputs,
      // The pin index itself is a read input of every selection (PHEXEC-39).
      join(pipeline.dir, PINS_FILE),
    ]),
  ];
  const planConflict = await plannedOutputConflict(steps, immutable, host);
  if (planConflict !== null) {
    return { ok: false, outputs, diagnostics: [planConflict] };
  }
  // Only a validated plan may create directories: a refused `-o` must leave
  // no trace of its parent path (PHEXEC-39).
  for (const dir of host.ensureDirs) {
    await mkdir(dir, { recursive: true });
  }
  const allTargets = steps.map((step) =>
    step.request.kind === 'compile' ? step.request.target : step.request.linked,
  );

  const state =
    incr === undefined ? undefined : await loadIncremental(incr, diagnostics);
  // Recording is advisory and must never fail the run (INCR-3): every exit
  // from the loop funnels through here so a failed run still keeps completed
  // work (INCR-16).
  const finish = async (result: SlcResult): Promise<SlcResult> => {
    if (state !== undefined) {
      await recordIncremental(state, steps, result.diagnostics);
    }
    return result;
  };

  for (const step of steps) {
    const target =
      step.request.kind === 'compile'
        ? step.request.target
        : step.request.linked;

    // Reuse/update selection is tentative until the pin gate below confirms
    // the step may run at all: recorded output never makes a stale pin
    // runnable (INCR-13).
    const declared =
      closureByDefinition.get(step.request.definitionPath) ?? null;
    // Every other planned target is protected while this phase runs: a
    // write to an earlier product or a future destination is rejected, and
    // publication then omits it (INCR-16, PHEXEC-39).
    const protect = [
      ...immutable,
      ...allTargets.filter((planned) => planned !== target),
    ];
    const first = step === steps[0];
    const inputs =
      state === undefined || declared === null
        ? null
        : await stepInputs(step, { artDir: state.artDir, declared });
    const mode: StepMode =
      state === undefined || inputs === null
        ? { mode: 'ordinary' }
        : await selectStepMode(step, target, inputs, state, first);

    // In-run progress (DR-019, CLI-32): announce the phase, then report its
    // outcome with the elapsed time. A reused step never starts.
    const startedAt = Date.now();
    if (mode.mode !== 'reuse') {
      deps.progress?.({ kind: 'phase-start', phase: step.phase, target });
    }
    const fail = (): void =>
      deps.progress?.({
        kind: 'phase-fail',
        phase: step.phase,
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
      selection = await selectExecutor(step.phase, pipeline.dir, pinFile, deps);
    } catch (error) {
      selection = { kind: 'fail', reasons: [messageOf(error)] };
    }
    if (selection.kind === 'fail') {
      // A reuse-eligible step still fails closed here: the phase-start line
      // is emitted first so the failure keeps its pairing (CLI-32).
      if (mode.mode === 'reuse') {
        deps.progress?.({ kind: 'phase-start', phase: step.phase, target });
      }
      fail();
      diagnostics.push(
        formatFailureReport({
          phase: step.phase,
          target,
          reasons: selection.reasons,
        }),
      );
      return finish({ ok: false, outputs, diagnostics });
    }

    if (mode.mode === 'reuse' && inputs !== null) {
      deps.progress?.({
        kind: 'status',
        text: `reusing ${step.phase} → ${target}`,
      });
      // A reused target was not written, so it stays out of `outputs`:
      // CLI-3 reports the paths a run wrote, and reuse is reported through
      // the status line above. Its identity is captured through the safe
      // reader so publication can prove no later, rejected work changed it;
      // a target it cannot read stays uncaptured and unrecorded (INCR-16).
      if (state !== undefined) {
        const bytes = await readStoreFile(target);
        if (bytes !== null) {
          state.completed.push({
            step,
            inputs,
            target,
            output: hashBytes(bytes),
          });
        }
      }
      continue;
    }
    if (mode.mode === 'update') {
      deps.progress?.({
        kind: 'status',
        text: `updating ${step.phase} → ${target}`,
      });
    }
    // Durable invalidation by absence (INCR-30): before any executor may
    // write, `.slc/latest` is removed, so no interruption — failure, crash,
    // rebind, or recording failure — leaves an active record vouching for a
    // target this run may change. The loaded history keeps serving reuse and
    // update context from memory. An unremovable active marker fails closed:
    // proceeding could let a retry reuse rejected bytes.
    if (state !== undefined && !state.invalidated) {
      try {
        await invalidateBuildHistory(state.artDir);
        state.invalidated = true;
      } catch (error) {
        fail();
        diagnostics.push(
          formatFailureReport({
            phase: step.phase,
            target,
            reasons: [
              `build history could not be invalidated before execution: ${messageOf(error)}`,
            ],
          }),
        );
        return finish({ ok: false, outputs, diagnostics });
      }
    }
    state?.touched.add(step);

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
      protect,
      revalidate: () => revalidateChain(pipeline.dir),
      signal: deps.signal,
    });
    if (!result.ok) {
      for (const path of result.report.changedPaths ?? []) {
        state?.mutated.add(path);
      }
      fail();
      diagnostics.push(formatFailureReport(result.report));
      return finish({ ok: false, outputs, diagnostics });
    }
    diagnostics.push(...result.diagnostics);
    // A linked module that cannot resolve its own relative imports cannot
    // load under `playbook run`; fail the link rather than report success
    // for a dead artifact (VERIFY-18).
    if (
      step.phase === 'link' &&
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
        return finish({ ok: false, outputs, diagnostics });
      }
      if (missing.length > 0) {
        fail();
        diagnostics.push(
          `linked module ${target} has unresolvable relative imports: ` +
            `${missing.join(', ')} — an emitted module that cannot load ` +
            'fails the link (VERIFY-18)',
        );
        return finish({ ok: false, outputs, diagnostics });
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
      state.executed++;
      if (inputs !== null) {
        // Completion identity comes through the safe reader: a target that
        // is no longer a plain regular file is uncapturable, so the step
        // stays touched-without-completion and gets no record (INCR-16).
        const bytes = await readStoreFile(target);
        if (bytes !== null) {
          state.completed.push({
            step,
            inputs,
            target,
            output: hashBytes(bytes),
          });
        }
      }
    }
  }

  // Every step reused: the bundle is current — no agent ran, nothing is
  // written, and no new build is recorded (INCR-2).
  if (
    state !== undefined &&
    state.executed === 0 &&
    steps.length > 0 &&
    state.completed.length === steps.length
  ) {
    return { ok: true, outputs, diagnostics, outcome: 'up-to-date' };
  }
  return finish({ ok: true, outputs, diagnostics });
}

/**
 * Loads history for an eligible full run. A missing, malformed, or
 * other-pipeline store reads as absent (INCR-10); a store recorded for a
 * different source is diagnosed, ignored, and superseded (INCR-17).
 */
async function loadIncremental(
  incr: IncrementalRun,
  diagnostics: string[],
): Promise<IncrementalState> {
  let history: BuildHistory | null = null;
  if (!incr.rebuild) {
    history = await loadBuildHistory(incr.artDir);
    if (history !== null && history.manifest.pipeline !== incr.pipelineName) {
      history = null;
    }
    if (history !== null) {
      const locator = encodeLocator(incr.artDir, incr.source);
      if (history.manifest.source.path !== locator) {
        diagnostics.push(
          `slc: build history was recorded for "${history.manifest.source.path}"; ` +
            `rebinding to "${locator}" and compiling fresh`,
        );
        history = null;
      }
    }
  }
  return {
    ...incr,
    history,
    completed: [],
    executed: 0,
    touched: new Set(),
    mutated: new Set(),
    invalidated: false,
  };
}

/**
 * The step's current input identities in recording order (INCR-12): chained
 * input, definition, references, then declared semantic inputs for a compile
 * step; objects, link target, then options for a link step. `null` when an
 * input cannot be hashed — the step then executes ordinarily.
 */
async function stepInputs(
  step: PhaseStep,
  paths: {
    /** Artifact directory anchoring the link-target locator (INCR-12). */
    artDir: string;
    /** The definition's derived declared-input closure (INCR-12). */
    declared: readonly string[];
  },
): Promise<Hash[] | null> {
  const declared = paths.declared;
  try {
    if (step.request.kind === 'compile') {
      return [
        await hashFile(step.request.source),
        await hashFile(step.request.definitionPath),
        ...(await Promise.all((step.request.references ?? []).map(hashFile))),
        ...(await Promise.all(declared.map(hashFile))),
      ];
    }
    // The link target's identity is its locator plus its content: the same
    // bytes at a different path resolve imports differently, and the
    // artifact-directory-relative locator stays portable when the bundle and
    // target move together — the same encoding the manifest's source locator
    // uses (INCR-12, INCR-17).
    return [
      ...(await Promise.all(step.request.objects.map(hashFile))),
      await hashFile(step.request.definitionPath),
      ...(await Promise.all(declared.map(hashFile))),
      hashBytes(
        new TextEncoder().encode(
          encodeLocator(paths.artDir, step.request.linkTarget),
        ),
      ),
      await hashFileOrTree(step.request.linkTarget),
      hashBytes(
        new TextEncoder().encode(
          JSON.stringify(
            step.request.options.map((option) => [option.name, option.value]),
          ),
        ),
      ),
    ];
  } catch {
    return null;
  }
}

/** Content identity for a link target: file bytes, or a deterministic tree. */
async function hashFileOrTree(path: string): Promise<Hash> {
  try {
    return await hashFile(path);
  } catch (error) {
    if (errorCode(error) === 'EISDIR') return (await hashTree(path)) as Hash;
    throw error;
  }
}

/**
 * The definition's declared semantic inputs (`## Pin Inputs`), or none.
 * `deriveClosure` takes pipeline-relative locators; the built-in normalize
 * definition lives outside the pipeline directory and declares nothing.
 * A derivation error propagates so `stepInputs` reports the step
 * unidentifiable and it executes ordinarily — the identity never silently
 * shrinks (INCR-12).
 */
async function declaredInputs(
  pipeline: Pipeline,
  definitionPath: string,
  boundary: string,
): Promise<string[]> {
  const locator = relative(pipeline.dir, definitionPath);
  if (
    locator === '..' ||
    locator.startsWith(`..${sep}`) ||
    isAbsolute(locator)
  ) {
    return [];
  }
  const closure = await deriveClosure(pipeline.dir, boundary, locator);
  return [...closure].filter((path) => path !== definitionPath);
}

/**
 * Chooses reuse, update, or ordinary execution for one step (INCR-13): reuse
 * when every recorded input identity matches and the target exists; update for
 * a compile step whose record matches with an intact prior-input copy while
 * the target exists; ordinary otherwise. Link steps run in full.
 */
async function selectStepMode(
  step: PhaseStep,
  target: string,
  inputs: Hash[],
  state: IncrementalState,
  first: boolean,
): Promise<StepMode> {
  const history = state.history;
  if (history === null) return { mode: 'ordinary' };
  const rel = encodeLocator(state.artDir, target);
  const record = history.manifest.steps.find(
    (candidate) =>
      candidate.kind === step.kind &&
      candidate.name === step.phase &&
      candidate.target === rel,
  );
  if (record === undefined) return { mode: 'ordinary' };
  // Reuse and update both stand on the existing target being a safe regular
  // file — a symlink, directory, or FIFO never satisfies them (PHEXEC-39).
  if ((await regularFileState(target)) !== 'file') {
    return { mode: 'ordinary' };
  }
  if (
    record.inputs.length === inputs.length &&
    record.inputs.every((hash, index) => hash === inputs[index])
  ) {
    return { mode: 'reuse' };
  }
  if (step.request.kind !== 'compile') return { mode: 'ordinary' };

  // The prior input is the source copy for the first scheduled step — whose
  // chained input is the invocation source by construction, read at its
  // resolved location — otherwise the predecessor's recorded output copy;
  // both must still hash to the recorded chained-input identity (INCR-14).
  const chained = step.request.source;
  const copy = first
    ? SOURCE_COPY
    : `outputs/${encodeLocator(state.artDir, chained)}`;
  const prior = await verifiedCopy(history, copy, record.inputs[0]);
  if (prior === null) return { mode: 'ordinary' };

  let diff: string | null = '';
  if (record.inputs[0] !== inputs[0]) {
    try {
      diff = unifiedLineDiff(
        prior.bytes.toString('utf8'),
        await readFile(chained, 'utf8'),
      );
    } catch {
      diff = null;
    }
    // The bytes differ, so an empty rendering means the change is below
    // line resolution (an EOF newline, or bytes UTF-8 decoding collapses):
    // supply no diff rather than a false "byte-identical" claim (INCR-14).
    if (diff === '') diff = null;
  }
  return { mode: 'update', priorInput: prior.path, diff };
}

/**
 * Records the run when any executor ran (INCR-16): completed steps republish
 * their live bytes only under the identity accepted at completion, the rest
 * carry forward from intact prior records — unless a failed executor changed
 * their target (INCR-34). Recording failures degrade to diagnostics —
 * history is advisory.
 */
async function recordIncremental(
  state: IncrementalState,
  steps: readonly PhaseStep[],
  diagnostics: string[],
): Promise<void> {
  // A run that never invalidated changed nothing; the loaded history still
  // holds. After invalidation, `latest` is absent, so publishing is purely
  // additive: with nothing recordable, absence itself is the durable
  // statement that nothing is vouched for.
  if (!state.invalidated) return;
  const toRecord: StepToRecord[] = [];
  for (const step of steps) {
    const done = state.completed.find((candidate) => candidate.step === step);
    // A touched step without a recordable completion — failed, or
    // unidentifiable inputs — gets no record, so nothing can vouch for
    // whatever its executor left at the target (INCR-6).
    if (done === undefined && state.touched.has(step)) continue;
    if (done !== undefined) {
      // Publication rereads the live target through the safe reader and
      // publishes only bytes that still match the accepted identity: what a
      // later, failed executor left behind is never recorded (INCR-16).
      const bytes = await readStoreFile(done.target);
      if (bytes === null || hashBytes(bytes) !== done.output) continue;
      toRecord.push({
        kind: step.kind,
        name: step.phase,
        target: done.target,
        inputs: done.inputs,
        bytes,
      });
      continue;
    }
    const prior = priorRecordFor(state, step);
    if (prior === null) continue;
    const target = resolveLocator(state.artDir, prior.target);
    // An unreached step whose target a failed executor changed is not
    // "unreached" at all — its record must die with the failure (INCR-34).
    if (state.mutated.has(target)) continue;
    const copy = await verifiedCopy(
      state.history as BuildHistory,
      prior.copy,
      prior.output,
    );
    if (copy === null) continue;
    toRecord.push({
      kind: prior.kind,
      name: prior.name,
      target,
      inputs: prior.inputs,
      bytes: copy.bytes,
    });
  }
  if (toRecord.length === 0) return;
  const sourceBytes = await readSourceBytes(state.source);
  if (sourceBytes === null) {
    diagnostics.push(
      `slc: build history not recorded: source "${state.source}" is not a readable regular file`,
    );
    return;
  }
  try {
    await recordBuild({
      artDir: state.artDir,
      pipeline: state.pipelineName,
      sourcePath: state.source,
      sourceBytes,
      steps: toRecord,
    });
  } catch (error) {
    diagnostics.push(`slc: build history not recorded: ${messageOf(error)}`);
  }
}

function priorRecordFor(
  state: IncrementalState,
  step: PhaseStep,
): StepHistoryRecord | null {
  if (state.history === null) return null;
  const target =
    step.request.kind === 'compile' ? step.request.target : step.request.linked;
  const rel = encodeLocator(state.artDir, target);
  return (
    state.history.manifest.steps.find(
      (candidate) =>
        candidate.kind === step.kind &&
        candidate.name === step.phase &&
        candidate.target === rel,
    ) ?? null
  );
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

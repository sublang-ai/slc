// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compiled phase execution: load a `playbook` artifact and drive it host-side
 * (PHEXEC-23, PHEXEC-24, PHEXEC-25; DR-005).
 *
 * {@link loadPlaybookRuntime} imports a compiled `playbook` module and returns
 * its `createPlaybookRuntime` factory. {@link createCompiledExecutor} adapts it
 * to the DR-003 {@link PhaseExecutor} boundary: per run it builds the
 * Cligent-backed Playbook ports, constructs the runtime, drives one
 * non-interactive turn (`init` -> `handleBossInput` -> `dispose`), and derives
 * the result from the host-observable outcome. The runtime receives only
 * `PlaybookPorts` (DR-005); the host-only `drainDiagnostics` stays host-side.
 * Drained status and telemetry become diagnostics. Like interpreted execution,
 * a compiled phase writes through its agents (`callPlayer`) and relies on the
 * DR-003 generic checks, which defend the protected inputs (not the full write
 * scope); `slc` adds no host-side write-scope enforcement.
 *
 * The turn is seeded per the PHEXEC-29 contract ({@link seedPhaseTurn}); the
 * result is derived from the host-observable outcome in {@link drivePhase}.
 * See specs/dev/phase-execution.md.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
} from '@sublang/playbook/runtime';

import type {
  ExecuteRequest,
  ExecutorResult,
  LinkOptionPair,
  PhaseExecutor,
} from './execution.js';
import type { AgentClient } from './interpreter.js';
import { mapPhaseResult, seedPhaseTurn } from './phase-runner.js';
import type { PhaseInput, PhaseResult } from './phase-runner.js';
import { createPlaybookPorts, type PlayerTransport } from './playbook-ports.js';

/**
 * Imports a compiled `playbook` module and returns its runtime factory
 * (PHEXEC-23).
 *
 * @throws when the module has no callable `createPlaybookRuntime` default export.
 */
export async function loadPlaybookRuntime(
  artifactPath: string,
): Promise<PlaybookRuntimeFactory> {
  const module: { default?: unknown } = await import(
    pathToFileURL(resolve(artifactPath)).href
  );
  const create = module.default;
  if (typeof create !== 'function') {
    throw new Error(
      `compiled artifact "${artifactPath}" has no createPlaybookRuntime default export`,
    );
  }
  return create as PlaybookRuntimeFactory;
}

/**
 * Adapts a compiled `playbook` artifact to the {@link PhaseExecutor} boundary
 * (PHEXEC-24, PHEXEC-25): build the Cligent-backed Playbook ports, load and
 * construct the runtime, drive one non-interactive turn, and map the outcome,
 * appending the runtime's drained status and telemetry.
 */
export function createCompiledExecutor(opts: {
  /** Path to the compiled `playbook` module to load. */
  artifactPath: string;
  /** Run root for resolving the phase's workspace paths to absolute host paths. */
  runRoot: string;
  /** Agent transport(s) backing `callPlayer`; a factory yields one client per player id. */
  player: PlayerTransport;
  /** Agent transport backing `callJudge`. */
  judge: AgentClient;
  /** Per-player model binding, applied as configuration (PHEXEC-13). */
  models?: Readonly<Record<string, string>>;
  /** Model for players the `models` binding does not name (PHEXEC-13). */
  defaultModel?: string;
  /** Working directory handed to the agent transports. */
  cwd?: string;
  /** Loader seam; defaults to {@link loadPlaybookRuntime}. */
  loadFactory?: (artifactPath: string) => Promise<PlaybookRuntimeFactory>;
}): PhaseExecutor {
  const load = opts.loadFactory ?? loadPlaybookRuntime;

  return {
    async run(
      request: ExecuteRequest,
      signal: AbortSignal,
    ): Promise<ExecutorResult> {
      let lastFsmState: string | undefined;
      const adapter = createPlaybookPorts({
        player: opts.player,
        judge: opts.judge,
        models: opts.models,
        defaultModel: opts.defaultModel,
        cwd: opts.cwd,
      });
      // Hand the runtime only Playbook's ports — never the host-only
      // drainDiagnostics, nor a file capability (DR-005, PHEXEC-23).
      const ports: PlaybookPorts = {
        callPlayer: adapter.callPlayer,
        callJudge: adapter.callJudge,
        emitStatus: adapter.emitStatus,
        emitTelemetry: async (event) => {
          const state = fsmTransitionTarget(event);
          if (state !== undefined) lastFsmState = state;
          await adapter.emitTelemetry(event);
        },
      };

      const driven = await drivePhase(
        load,
        opts.artifactPath,
        ports,
        phaseInput(request, opts.runRoot),
        signal,
      );
      const result = mapFailedQuiescentState(driven, lastFsmState);
      const mapped = mapPhaseResult(result);
      return {
        status: mapped.status,
        diagnostics: [...mapped.diagnostics, ...adapter.drainDiagnostics()],
      };
    },
  };
}

/** Returns the destination carried by Playbook's standard FSM telemetry. */
function fsmTransitionTarget(event: {
  topic: string;
  payload: unknown;
}): string | undefined {
  if (
    event.topic !== 'playbook.fsm.state' ||
    typeof event.payload !== 'object' ||
    event.payload === null ||
    !('to' in event.payload) ||
    typeof event.payload.to !== 'string'
  ) {
    return undefined;
  }
  return event.payload.to;
}

/** DR-005 maps a quiescent `failed` FSM state to an executor error. */
function mapFailedQuiescentState(
  result: PhaseResult,
  lastFsmState: string | undefined,
): PhaseResult {
  if (result.status === 'error' || lastFsmState !== 'failed') return result;
  return {
    status: 'error',
    diagnostics: ['compiled runtime reached the failed quiescent state'],
  };
}

/**
 * Loads, constructs, and drives a runtime through one non-interactive turn, then
 * derives the result from the host-observable outcome (DR-005): a turn that
 * throws or aborts is `error`; a clean turn that creates or updates the declared
 * `target`/`linked` output is `ok`; a clean turn that leaves it untouched is
 * `blocked` — the FSM parked for Boss input a non-interactive run cannot supply.
 */
async function drivePhase(
  load: (artifactPath: string) => Promise<PlaybookRuntimeFactory>,
  artifactPath: string,
  ports: PlaybookPorts,
  input: PhaseInput,
  signal: AbortSignal,
): Promise<PhaseResult> {
  let runtime: PlaybookRuntime;
  try {
    const factory = await load(artifactPath);
    runtime = factory({});
  } catch (error) {
    return {
      status: 'error',
      diagnostics: [`compiled artifact failed to load: ${messageOf(error)}`],
    };
  }

  // Snapshot the output before the turn so a pre-existing stale artifact is not
  // mistaken for fresh output the turn produced.
  const outputPath = input.kind === 'compile' ? input.target : input.linked;
  const before = await outputState(outputPath);

  try {
    await runtime.init(ports);
    await runtime.handleBossInput({ text: seedPhaseTurn(input), signal });
  } catch (error) {
    await safeDispose(runtime);
    return {
      status: 'error',
      diagnostics: [
        signal.aborted
          ? 'compiled run aborted'
          : `compiled run failed: ${messageOf(error)}`,
      ],
    };
  }

  await safeDispose(runtime);
  if (signal.aborted) {
    return { status: 'error', diagnostics: ['compiled run aborted'] };
  }
  const after = await outputState(outputPath);
  const produced = outputWasProduced(before, after);
  return produced
    ? { status: 'ok', diagnostics: [] }
    : {
        status: 'blocked',
        diagnostics: [
          'compiled phase produced no output (parked for Boss input)',
        ],
      };
}

async function safeDispose(runtime: PlaybookRuntime): Promise<void> {
  try {
    await runtime.dispose();
  } catch {
    // A dispose failure must not mask the turn's outcome.
  }
}

type OutputState =
  | { kind: 'missing' }
  | {
      kind: 'file';
      digest: string;
      dev: number;
      ino: number;
      mode: number;
      size: number;
      mtimeMs: number;
      ctimeMs: number;
    }
  | {
      kind: 'other';
      dev: number;
      ino: number;
      mode: number;
      size: number;
      mtimeMs: number;
      ctimeMs: number;
    };

/**
 * A point-in-time output view. Content and file identity supplement timestamps,
 * so an atomic replacement or preserved mtime still counts as produced output.
 */
async function outputState(path: string): Promise<OutputState> {
  try {
    const info = await stat(path);
    const identity = {
      dev: info.dev,
      ino: info.ino,
      mode: info.mode,
      size: info.size,
      mtimeMs: info.mtimeMs,
      ctimeMs: info.ctimeMs,
    };
    if (!info.isFile()) return { kind: 'other', ...identity };
    const digest = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    return { kind: 'file', digest, ...identity };
  } catch {
    return { kind: 'missing' };
  }
}

function outputWasProduced(before: OutputState, after: OutputState): boolean {
  if (after.kind !== 'file') return false;
  if (before.kind !== 'file') return true;
  return (
    before.digest !== after.digest ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    before.ctimeMs !== after.ctimeMs
  );
}

/**
 * Maps an {@link ExecuteRequest} to the {@link PhaseInput} the seed carries,
 * resolving its workspace paths against the run root to absolute host paths the
 * runtime's agents can act on (DR-005).
 */
function phaseInput(request: ExecuteRequest, runRoot: string): PhaseInput {
  const abs = (path: string): string => resolve(runRoot, path);
  if (request.kind === 'compile') {
    return {
      kind: 'compile',
      source: abs(request.source),
      target: abs(request.target),
    };
  }
  return {
    kind: 'link',
    objects: request.objects.map(abs),
    linkTarget: abs(request.linkTarget),
    options: optionsRecord(request.options),
    linked: abs(request.linked),
  };
}

function optionsRecord(
  options: readonly LinkOptionPair[],
): Record<string, string> {
  return Object.fromEntries(
    options.map((option) => [option.name, option.value]),
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

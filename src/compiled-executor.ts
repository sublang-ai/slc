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
 * non-interactive turn (`init` -> `handleBossInput` -> `dispose`), and maps a
 * structured result when present or the bounded legacy host-observable outcome
 * otherwise. The pin-selected contract profile chooses the exact legacy,
 * traced-session, or composed-session init shape without a retry heuristic
 * (DR-010). The host-only `drainDiagnostics` stays host-side;
 * human status and non-trace operational telemetry become diagnostics. Like
 * interpreted execution, a compiled phase writes through its agents
 * (`callPlayer`) and relies on the DR-003 generic checks, which defend the
 * protected inputs (not the full write scope); `slc` adds no host-side
 * write-scope enforcement.
 *
 * The turn is seeded per the PHEXEC-29 contract ({@link seedPhaseTurn}); the
 * result is derived in {@link drivePhase} from the structured runtime boundary
 * or, for a void-result legacy runtime, the host-observable output delta.
 * See specs/dev/phase-execution.md.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { PlaybookPorts as LegacyPlaybookPorts } from '@sublang/playbook/runtime';

import type {
  ExecuteRequest,
  ExecutorResult,
  LinkOptionPair,
  PhaseExecutor,
} from './execution.js';
import type { AgentClient } from './interpreter.js';
import { mapPhaseResult, seedPhaseTurn } from './phase-runner.js';
import type { PhaseInput, PhaseResult } from './phase-runner.js';
import {
  isPlaybookRunResult,
  type CompatiblePlaybookPorts,
  type CompatiblePlaybookRuntime,
  type CompatiblePlaybookRuntimeFactory,
  type PlaybookSessionV1,
  type PlaybookRunResult,
  type PlaybookSession,
  type RuntimeContractProfile,
  type SessionV1PlaybookPorts,
} from './playbook-contract.js';
import { createPlaybookPorts, type PlayerTransport } from './playbook-ports.js';

/**
 * Imports a compiled `playbook` module and returns its runtime factory
 * (PHEXEC-23).
 *
 * @throws when the module has no callable `createPlaybookRuntime` default export.
 */
export async function loadPlaybookRuntime(
  artifactPath: string,
): Promise<CompatiblePlaybookRuntimeFactory> {
  const module: { default?: unknown } = await import(
    pathToFileURL(resolve(artifactPath)).href
  );
  const create = module.default;
  if (typeof create !== 'function') {
    throw new Error(
      `compiled artifact "${artifactPath}" has no createPlaybookRuntime default export`,
    );
  }
  return create as CompatiblePlaybookRuntimeFactory;
}

/**
 * Adapts a compiled `playbook` artifact to the {@link PhaseExecutor} boundary
 * (PHEXEC-24, PHEXEC-25): build the Cligent-backed Playbook ports, load and
 * construct the runtime, drive one non-interactive root-session turn, and map
 * the outcome, appending drained status and non-trace operational telemetry.
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
  /** Stable authored phase identity used as the Playbook session's playbook id. */
  playbookId?: string;
  /** Session-id seam for deterministic tests; defaults to {@link randomUUID}. */
  createSessionId?: () => string;
  /** Exact pinned runtime boundary; defaults to the current legacy contract. */
  runtimeContract?: RuntimeContractProfile;
  /** Loader seam; defaults to {@link loadPlaybookRuntime}. */
  loadFactory?: (
    artifactPath: string,
  ) => Promise<CompatiblePlaybookRuntimeFactory>;
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
      const ports: CompatiblePlaybookPorts = {
        callPlayer: adapter.callPlayer,
        callJudge: adapter.callJudge,
        callPlaybook: adapter.callPlaybook,
        emitStatus: adapter.emitStatus,
        emitTelemetry: async (event) => {
          const state = fsmTransitionTarget(event);
          if (state !== undefined) lastFsmState = state;
          await adapter.emitTelemetry(event);
        },
      };

      const runtimeContract = opts.runtimeContract ?? 'legacy';
      const identity = phaseSessionIdentity({
        sessionId: (opts.createSessionId ?? randomUUID)(),
        playbookId:
          opts.playbookId ?? playbookIdFromArtifact(opts.artifactPath),
      });
      const driven = await drivePhase(
        load,
        opts.artifactPath,
        ports,
        phaseInput(request, opts.runRoot),
        signal,
        identity,
        runtimeContract,
      );
      const result = mapVoidContractFailedState(
        driven,
        lastFsmState,
        runtimeContract !== 'composed-v2',
      );
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
function mapVoidContractFailedState(
  result: PhaseResult,
  lastFsmState: string | undefined,
  voidContract: boolean,
): PhaseResult {
  if (!voidContract || result.status === 'error' || lastFsmState !== 'failed') {
    return result;
  }
  return {
    status: 'error',
    diagnostics: ['compiled runtime reached the failed quiescent state'],
  };
}

/**
 * Loads, constructs, and drives one non-interactive turn. Structured results
 * are authoritative; a void legacy result retains DR-010's output-delta and
 * host-observed failed-state mapping.
 */
async function drivePhase(
  load: (artifactPath: string) => Promise<CompatiblePlaybookRuntimeFactory>,
  artifactPath: string,
  ports: CompatiblePlaybookPorts,
  input: PhaseInput,
  signal: AbortSignal,
  identity: { sessionId: string; playbookId: string },
  runtimeContract: RuntimeContractProfile,
): Promise<PhaseResult> {
  let runtime: CompatiblePlaybookRuntime;
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
  const initValue = runtimeInitValue(runtimeContract, identity, ports);
  let runResult: unknown;

  try {
    await callRuntimeInit(runtime, initValue);
    runResult = await callRuntimeTurn(runtime, seedPhaseTurn(input), signal);
  } catch (error) {
    const disposal = await disposeRuntime(runtime);
    return {
      status: 'error',
      diagnostics: [
        signal.aborted
          ? 'compiled run aborted'
          : `compiled run failed: ${messageOf(error)}`,
        ...(disposal === undefined
          ? []
          : [`compiled runtime disposal also failed: ${messageOf(disposal)}`]),
      ],
    };
  }

  const disposal = await disposeRuntime(runtime);
  if (disposal !== undefined) {
    return {
      status: 'error',
      diagnostics: [`compiled runtime disposal failed: ${messageOf(disposal)}`],
    };
  }
  if (signal.aborted) {
    return {
      status: 'error',
      diagnostics: ['compiled run aborted'],
    };
  }
  const after = await outputState(outputPath);
  const produced = outputWasProduced(before, after);
  return mapRuntimeOutcome(runResult, produced, runtimeContract);
}

async function disposeRuntime(
  runtime: CompatiblePlaybookRuntime,
): Promise<unknown | undefined> {
  try {
    await runtime.dispose();
    return undefined;
  } catch (error) {
    return error;
  }
}

function rootSession(
  identity: { sessionId: string; playbookId: string },
  ports: CompatiblePlaybookPorts,
): PlaybookSession {
  return {
    sessionId: identity.sessionId,
    playbookId: identity.playbookId,
    rootSessionId: identity.sessionId,
    depth: 0,
    ports,
  };
}

function legacyPorts(ports: CompatiblePlaybookPorts): LegacyPlaybookPorts {
  return {
    callPlayer: ports.callPlayer,
    callJudge: ports.callJudge,
    emitStatus: ports.emitStatus,
    emitTelemetry: ports.emitTelemetry,
  };
}

function sessionV1Ports(
  ports: CompatiblePlaybookPorts,
): SessionV1PlaybookPorts {
  return {
    callPlayer: (playerId, prompt, signal, options) =>
      ports.callPlayer(playerId, prompt, signal, options),
    callJudge: ports.callJudge,
    emitStatus: ports.emitStatus,
    emitTelemetry: ports.emitTelemetry,
  };
}

function runtimeInitValue(
  contract: RuntimeContractProfile,
  identity: { sessionId: string; playbookId: string },
  ports: CompatiblePlaybookPorts,
): LegacyPlaybookPorts | PlaybookSessionV1 | PlaybookSession {
  switch (contract) {
    case 'legacy':
      return legacyPorts(ports);
    case 'session-v1':
      return {
        sessionId: identity.sessionId,
        playbookId: identity.playbookId,
        ports: sessionV1Ports(ports),
      };
    case 'composed-v2':
      return rootSession(identity, ports);
  }
}

async function callRuntimeInit(
  runtime: CompatiblePlaybookRuntime,
  value: LegacyPlaybookPorts | PlaybookSessionV1 | PlaybookSession,
): Promise<void> {
  const init = runtime.init as (input: unknown) => Promise<void>;
  await init.call(runtime, value);
}

async function callRuntimeTurn(
  runtime: CompatiblePlaybookRuntime,
  text: string,
  signal: AbortSignal,
): Promise<unknown> {
  const handle = runtime.handleBossInput as (turn: {
    text: string;
    signal: AbortSignal;
  }) => Promise<unknown>;
  return handle.call(runtime, { text, signal });
}

function mapRuntimeOutcome(
  result: unknown,
  produced: boolean,
  contract: RuntimeContractProfile,
): PhaseResult {
  if (contract !== 'composed-v2') {
    return result === undefined
      ? legacyOutputResult(produced)
      : {
          status: 'error',
          diagnostics: [
            `compiled ${contract} runtime returned an unexpected structured result`,
          ],
        };
  }
  if (result === undefined) {
    return {
      status: 'error',
      diagnostics: ['compiled composed-v2 runtime returned no run result'],
    };
  }
  if (!isPlaybookRunResult(result)) {
    return {
      status: 'error',
      diagnostics: ['compiled runtime returned an invalid run result'],
    };
  }
  return structuredOutputResult(result, produced);
}

function phaseSessionIdentity(identity: {
  sessionId: string;
  playbookId: string;
}): { sessionId: string; playbookId: string } {
  if (identity.sessionId.trim().length === 0) {
    throw new Error('compiled runtime session id must be non-empty');
  }
  if (identity.playbookId.trim().length === 0) {
    throw new Error('compiled runtime playbook id must be non-empty');
  }
  return identity;
}

function legacyOutputResult(produced: boolean): PhaseResult {
  return produced
    ? { status: 'ok', diagnostics: [] }
    : {
        status: 'blocked',
        diagnostics: [
          'compiled phase produced no output (parked for Boss input)',
        ],
      };
}

function structuredOutputResult(
  result: PlaybookRunResult,
  produced: boolean,
): PhaseResult {
  switch (result.outcome) {
    case 'quiescent':
    case 'terminal':
      return produced
        ? { status: 'ok', diagnostics: [] }
        : {
            status: 'blocked',
            diagnostics: [
              `compiled runtime ${result.outcome} without producing output`,
            ],
          };
    case 'no-action':
      return {
        status: 'blocked',
        diagnostics: ['compiled runtime accepted no phase action'],
      };
    case 'failed':
    case 'aborted':
      return {
        status: 'error',
        diagnostics: [
          `compiled runtime ${result.outcome}${result.error ? `: ${result.error.message}` : ''}`,
        ],
      };
    case 'suspended':
      return {
        status: 'error',
        diagnostics: [
          `compiled runtime suspended for unsupported nested playbook call ${result.pendingCall.callId}`,
        ],
      };
  }
}

function playbookIdFromArtifact(artifactPath: string): string {
  const name = basename(artifactPath);
  return name.endsWith('.playbook.ts')
    ? name.slice(0, -'.playbook.ts'.length)
    : name.replace(/\.[^.]+$/, '');
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

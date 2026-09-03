// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compiled phase execution: load a `playbook` artifact and drive it host-side
 * (phase-execution-23, phase-execution-24, phase-execution-25,
 * phase-execution-49; DR-005, DR-024).
 *
 * {@link loadPlaybookRuntime} imports a compiled `playbook` module and returns
 * its `createPlaybookRuntime` factory. {@link createCompiledExecutor} adapts it
 * to the DR-003 {@link PhaseExecutor} boundary: per run it builds the
 * Cligent-backed Playbook ports, constructs the runtime, drives one
 * non-interactive turn (`init` -> `handleBossInput` -> `dispose`), and maps a
 * structured result when present or the bounded legacy host-observable outcome
 * otherwise. The pin-selected contract profile chooses the exact legacy,
 * traced-session, composed-session, or roleless schema-3 construction and init
 * shape without a retry heuristic (DR-010, DR-011, DR-024). The host-only
 * `drainDiagnostics` stays host-side; human status and non-trace operational
 * telemetry become diagnostics. Older compiled profiles may write through
 * `callPlayer`; roleless schema-3 rejects that port and uses direct Captain
 * work. Every profile relies on the DR-003 generic checks, which defend the
 * protected inputs (not the full write scope); `slc` adds no host-side
 * write-scope enforcement.
 *
 * The turn is seeded per the phase-execution-29 contract ({@link seedPhaseTurn}), and a
 * transformation-performing direct Captain call additionally carries the host
 * workspace contract ({@link composeWorkspaceContract}; phase-execution-34) so the
 * host-agnostic artifact's Captain learns the request's absolute paths; the
 * result is derived in {@link drivePhase} from the structured runtime boundary
 * or, for a void-result legacy runtime, the host-observable output delta.
 *
 * A schema-3 artifact whose options contract requires the single option
 * `definition` receives the exact text of the definition file the request
 * names through its configured options ({@link constructRuntime}; DR-028) —
 * the one channel that keeps the definition out of the seeded Boss turn a
 * classifier judge reads. The live capabilities beside those options are the
 * installed engine's own fail-closed host capabilities (DR-046), because the
 * roleless phase host runs no governed state. See
 * specs/packages/phase-execution.md.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createFailClosedHostCapabilities } from '@sublang/playbook/host-capabilities';

import { messageOf } from './errors.js';
import type { LegacyPlaybookPorts } from './playbook-contract.js';

import {
  updateContextLines,
  type ExecuteRequest,
  type ExecutorResult,
  type LinkOptionPair,
  type PhaseExecutor,
} from './execution.js';
import type { AgentClient } from './interpreter.js';
import {
  composeWorkspaceContract,
  mapPhaseResult,
  seedPhaseTurn,
} from './phase-runner.js';
import type { PhaseInput, PhaseResult } from './phase-runner.js';
import {
  type CompatiblePlaybookRunResult,
  isPlaybookRunResult,
  type ComposedPlaybookPorts,
  type ComposedV3ConfiguredOptions,
  type ComposedV3FactoryInput,
  type CompatiblePlaybookPorts,
  type CompatiblePlaybookRuntime,
  type CompatiblePlaybookRuntimeFactory,
  type PlaybookSessionV1,
  type PlaybookSession,
  type PlayerCallOptions,
  type RuntimeContractProfile,
  type SessionV1PlaybookPorts,
} from './playbook-contract.js';
import { createPlaybookPorts, type PlayerTransport } from './playbook-ports.js';

/**
 * Imports a compiled `playbook` module and returns its runtime factory
 * (phase-execution-23).
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

const COMPOSED_V3_COMPAT_ERROR =
  'compiled composed-v3 factory requires immutable compatibility { artifactSchema: 3, runtimeAbi: 1 }';

/**
 * Constructs exactly the profile the pin selected (DR-024, DR-028). Only the
 * roleless schema-3 profile takes configured options, and the host lets the
 * artifact's own options validation — the factory binds its options before it
 * builds any actor — decide between at most two constructions
 * (phase-execution-49):
 *
 * 1. exactly `{ definition }` holding the exact bytes of the definition file
 *    the request names — the one option a roleless meta-phase artifact may
 *    require, which every bundle compiled from a definition's compiled-execution
 *    section declares, so this is the single steady-state construction; then,
 *    only when the factory rejects it,
 * 2. the exact empty configured options, the roleless baseline a bundle
 *    declaring no option accepts.
 *
 * A factory rejecting both fails the phase with the rejections named; no
 * other option, profile, or initialization is tried.
 */
function constructRuntime(
  factory: CompatiblePlaybookRuntimeFactory,
  contract: RuntimeContractProfile,
  definition: string | undefined,
): CompatiblePlaybookRuntime {
  if (contract !== 'composed-v3') return factory({});
  requireComposedV3Compatibility(factory);
  if (definition === undefined) {
    throw new Error(
      'compiled composed-v3 phase host requires the definition text before construction',
    );
  }
  const construct = (
    configuredOptions: ComposedV3ConfiguredOptions,
  ): CompatiblePlaybookRuntime =>
    (factory as CompatiblePlaybookRuntimeFactory<ComposedV3FactoryInput>)(
      composedV3FactoryInput(configuredOptions),
    );
  let definitionRejection: unknown;
  try {
    return construct({ definition });
  } catch (error) {
    definitionRejection = error;
  }
  try {
    return construct({});
  } catch (error) {
    const offered = messageOf(definitionRejection);
    const empty = messageOf(error);
    throw new Error(
      offered === empty
        ? empty
        : `${offered}; with empty configured options: ${empty}`,
      { cause: error },
    );
  }
}

/** Fails closed without reading a compatibility accessor or invoking a factory. */
function requireComposedV3Compatibility(
  factory: CompatiblePlaybookRuntimeFactory,
): void {
  let valid = false;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(factory, 'compat');
    if (
      descriptor !== undefined &&
      Object.prototype.hasOwnProperty.call(descriptor, 'value') &&
      descriptor.enumerable === true &&
      descriptor.writable === false &&
      descriptor.configurable === false
    ) {
      const compat = descriptor.value;
      if (isPlainObject(compat) && Object.isFrozen(compat)) {
        const names = Object.getOwnPropertyNames(compat);
        const symbols = Object.getOwnPropertySymbols(compat);
        const artifactSchema = Object.getOwnPropertyDescriptor(
          compat,
          'artifactSchema',
        );
        const runtimeAbi = Object.getOwnPropertyDescriptor(
          compat,
          'runtimeAbi',
        );
        valid =
          names.length === 2 &&
          names.includes('artifactSchema') &&
          names.includes('runtimeAbi') &&
          symbols.length === 0 &&
          artifactSchema !== undefined &&
          artifactSchema.enumerable === true &&
          Object.prototype.hasOwnProperty.call(artifactSchema, 'value') &&
          artifactSchema.value === 3 &&
          runtimeAbi !== undefined &&
          runtimeAbi.enumerable === true &&
          Object.prototype.hasOwnProperty.call(runtimeAbi, 'value') &&
          runtimeAbi.value === 1;
      }
    }
  } catch {
    // A hostile proxy is an invalid declaration, not a control-plane error.
  }
  if (!valid) throw new TypeError(COMPOSED_V3_COMPAT_ERROR);
}

/**
 * The exact schema-3 factory input the compiled host supplies: the given
 * configured options — the single `definition` option (DR-028), or the exact
 * empty record — plus the installed engine's fresh fail-closed live host
 * capabilities, whose repository and effect-ledger write seams reject and
 * whose ledger snapshot is the canonical empty ledger (DR-024, DR-046).
 * Exported so verification drives the same construction the host performs
 * rather than a divergent copy.
 */
export function composedV3FactoryInput(
  configuredOptions: ComposedV3ConfiguredOptions = {},
): ComposedV3FactoryInput {
  return {
    configuredOptions,
    hostCapabilities: createFailClosedHostCapabilities(),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Adapts a compiled `playbook` artifact to the {@link PhaseExecutor} boundary
 * (phase-execution-24, phase-execution-25): build the Cligent-backed Playbook ports, load and
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
  /** Shared agent transport backing `callCaptain` and `callJudge`. */
  judge: AgentClient;
  /** Per-player model binding, applied as configuration (phase-execution-13). */
  models?: Readonly<Record<string, string>>;
  /** Model for players the `models` binding does not name (phase-execution-13). */
  defaultModel?: string;
  /** Working directory handed to the agent transports. */
  cwd?: string;
  /** Stable authored phase identity used as the Playbook session's playbook id. */
  playbookId?: string;
  /**
   * Live status sink (DR-019, phase-execution-25): streams the runtime's human status
   * and non-trace telemetry as it occurs; absent hosts keep the drained
   * end-of-run diagnostics.
   */
  onStatus?: (line: string) => void;
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
      // The final text of the latest successful performing call, so an
      // authored terminal that produced no output still carries the reason
      // that call gave — exactly as a failed review does (phase-execution-24).
      let latestPerformingText: string | undefined;
      const recordPerforming = (result: {
        status: string;
        finalText?: string;
      }): void => {
        if (result.status !== 'ok') return;
        const text = result.finalText;
        if (text !== undefined && text.trim().length > 0) {
          latestPerformingText = text;
        }
      };
      const input = phaseInput(request, opts.runRoot);
      const runtimeContract = opts.runtimeContract ?? 'legacy';
      // The roleless schema-3 host may have to supply the definition the
      // request names as the compiled phase's single configured option, so
      // its exact bytes are read — unnormalized — before the artifact loads
      // (phase-execution-49; DR-028).
      let definition: string | undefined;
      if (runtimeContract === 'composed-v3') {
        try {
          definition = await readFile(
            resolve(opts.runRoot, request.definitionPath),
            'utf8',
          );
        } catch (error) {
          return {
            status: 'error',
            diagnostics: [
              `compiled phase definition cannot be read: ${messageOf(error)}`,
            ],
          };
        }
      }
      const adapter = createPlaybookPorts({
        player: opts.player,
        judge: opts.judge,
        models: opts.models,
        defaultModel: opts.defaultModel,
        cwd: opts.cwd,
        // The host owns the workspace: a transformation-performing Captain's
        // transported prompt carries the request's absolute paths and
        // write-scope rules (phase-execution-34).
        captainWorkspace: composeWorkspaceContract(input),
        // The compiled artifact knows nothing about incremental updates, so
        // the host appends the update context to performing prompts
        // (DR-021, incremental-compilation-16).
        ...(request.kind === 'compile' && request.update !== undefined
          ? {
              updateContext: updateContextLines(
                request.update,
                request.target,
              ).join('\n'),
            }
          : {}),
        // The host's deterministic gate rides the performing Captain call, so
        // a reviewed transport relays its findings to the Coder in place of a
        // Reviewer call (DR-029, phase-execution-25, phase-execution-51).
        ...(request.kind === 'compile' && request.mechanicalReview !== undefined
          ? { mechanicalReview: request.mechanicalReview }
          : {}),
        onStatus: opts.onStatus,
      });
      // Hand the runtime only Playbook's ports — never the host-only
      // drainDiagnostics, nor a file capability (DR-005, phase-execution-23).
      const ports: CompatiblePlaybookPorts = {
        callPlayer: async (playerId, prompt, signal, options) => {
          const result = await adapter.callPlayer(
            playerId,
            prompt,
            signal,
            options,
          );
          recordPerforming(result);
          return result;
        },
        callCaptain: async (prompt, signal, options) => {
          const result = await adapter.callCaptain(prompt, signal, options);
          // Only a transformation-performing call does the phase's work; a
          // routing-only Captain carries an explicitly empty allowlist and
          // decides rather than performs (phase-execution-31).
          if (
            Object.getOwnPropertyDescriptor(options, 'allowedTools') ===
            undefined
          ) {
            recordPerforming(result);
          }
          return result;
        },
        callJudge: adapter.callJudge,
        callPlaybook: adapter.callPlaybook,
        emitStatus: adapter.emitStatus,
        emitTelemetry: async (event) => {
          const state = fsmTransitionTarget(event);
          if (state !== undefined) lastFsmState = state;
          await adapter.emitTelemetry(event);
        },
      };

      const identity = phaseSessionIdentity({
        sessionId: (opts.createSessionId ?? randomUUID)(),
        playbookId:
          opts.playbookId ?? playbookIdFromArtifact(opts.artifactPath),
      });
      const driven = await drivePhase(
        load,
        opts.artifactPath,
        ports,
        input,
        signal,
        identity,
        runtimeContract,
        definition,
        () => latestPerformingText,
      );
      const result = mapVoidContractFailedState(
        driven,
        lastFsmState,
        runtimeContract === 'legacy' || runtimeContract === 'session-v1',
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
  definition: string | undefined,
  latestPerformingText: () => string | undefined,
): Promise<PhaseResult> {
  let runtime: CompatiblePlaybookRuntime;
  try {
    const factory = await load(artifactPath);
    runtime = constructRuntime(factory, runtimeContract, definition);
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
  return mapRuntimeOutcome(
    runResult,
    produced,
    runtimeContract,
    latestPerformingText(),
  );
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
  contract: 'composed-v2' | 'composed-v3',
): PlaybookSession {
  return {
    sessionId: identity.sessionId,
    playbookId: identity.playbookId,
    rootSessionId: identity.sessionId,
    depth: 0,
    ports: composedPorts(ports, contract),
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
      ports.callPlayer(
        playerId,
        prompt,
        signal,
        requirePlayerCallOptions(options),
      ),
    callJudge: ports.callJudge,
    emitStatus: ports.emitStatus,
    emitTelemetry: ports.emitTelemetry,
  };
}

function composedPorts(
  ports: CompatiblePlaybookPorts,
  contract: 'composed-v2' | 'composed-v3',
): ComposedPlaybookPorts {
  return {
    callPlayer: (playerId, prompt, signal, options) => {
      if (contract === 'composed-v3') {
        return Promise.reject(
          new Error(
            'compiled composed-v3 phase host does not support delegated role calls',
          ),
        );
      }
      return preserveControlPlaneRejection(contract, 'callPlayer', signal, () =>
        ports.callPlayer(
          playerId,
          prompt,
          signal,
          requirePlayerCallOptions(options),
        ),
      );
    },
    callCaptain: (prompt, signal, options) =>
      preserveControlPlaneRejection(contract, 'callCaptain', signal, () =>
        ports.callCaptain(prompt, signal, options),
      ),
    callJudge: (prompt, signal) =>
      preserveControlPlaneRejection(contract, 'callJudge', signal, () =>
        ports.callJudge(prompt, signal),
      ),
    callPlaybook: (request, signal) =>
      preserveControlPlaneRejection(contract, 'callPlaybook', signal, () =>
        ports.callPlaybook(request, signal),
      ),
    emitStatus: (message, data) =>
      preserveControlPlaneRejection(contract, 'emitStatus', undefined, () =>
        ports.emitStatus(message, data),
      ),
    emitTelemetry: (event) =>
      preserveControlPlaneRejection(contract, 'emitTelemetry', undefined, () =>
        ports.emitTelemetry(event),
      ),
  };
}

/**
 * Keeps nullish host-port rejections visible to immutable composed runtimes.
 * Playbook 2.0.0 latches control-plane failures with nullish coalescing, so a
 * rejection without a value could otherwise be mistaken for an authored FSM
 * failure. Preserve a causally identical abort reason, but give every other
 * nullish rejection a stable Error identity before it crosses the boundary.
 */
async function preserveControlPlaneRejection<T>(
  contract: 'composed-v2' | 'composed-v3',
  port: keyof ComposedPlaybookPorts,
  signal: AbortSignal | undefined,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error !== undefined && error !== null) {
      throw error;
    }
    if (signal?.aborted === true && error === signal.reason) {
      throw error;
    }
    throw new Error(
      `compiled ${contract} ${port} port rejected without an error`,
      { cause: error },
    );
  }
}

function requirePlayerCallOptions(value: unknown): PlayerCallOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(
      'session runtime callPlayer requires explicit PlayerCallOptions',
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'resume');
  if (
    descriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
    (descriptor.value !== false && typeof descriptor.value !== 'string')
  ) {
    throw new TypeError(
      'session runtime callPlayer options.resume must be false or a string',
    );
  }
  return { resume: descriptor.value };
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
      return rootSession(identity, ports, contract);
    case 'composed-v3':
      return rootSession(identity, ports, contract);
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
  performingText: string | undefined,
): PhaseResult {
  if (contract === 'legacy' || contract === 'session-v1') {
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
      diagnostics: [`compiled ${contract} runtime returned no run result`],
    };
  }
  if (!isPlaybookRunResult(result, contract)) {
    return {
      status: 'error',
      diagnostics: ['compiled runtime returned an invalid run result'],
    };
  }
  return structuredOutputResult(result, produced, performingText);
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
  result: CompatiblePlaybookRunResult,
  produced: boolean,
  performingText: string | undefined,
): PhaseResult {
  switch (result.outcome) {
    case 'quiescent':
    case 'terminal':
      return produced
        ? { status: 'ok', diagnostics: [] }
        : {
            status: 'blocked',
            diagnostics: [
              `compiled runtime ${result.outcome} without producing output` +
                ` at state ${reachedState(result)}` +
                (performingText === undefined
                  ? ''
                  : `; latest Coder output: ${performingText}`),
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
    case 'unresolved-effect':
      return {
        status: 'error',
        diagnostics: ['compiled runtime stopped with an unresolved effect'],
      };
  }
}

/**
 * Names the state an outputless turn reached — its id, plus the authored
 * terminal meaning when the schema-3 result carries one — so a compiled phase
 * that stopped in an authored final state says which one (phase-execution-24).
 */
function reachedState(result: CompatiblePlaybookRunResult): string {
  const state = result.state;
  const id =
    state.stateId ??
    (typeof state.value === 'string'
      ? state.value
      : JSON.stringify(state.value));
  const description = (result as { stateDescription?: unknown })
    .stateDescription;
  return typeof description === 'string' && description.trim().length > 0
    ? `${id} (${description})`
    : id;
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
 * runtime's agents can act on (DR-005). The definition the request names is
 * not part of the seed (DR-028).
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

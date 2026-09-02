// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compatibility types for Playbook's evolving runtime contracts.
 *
 * The installed `@sublang/playbook` now supplies the composed six-port
 * contract, so the retired 0.9 profile is frozen here as local structural
 * types: legacy artifacts keep executing against the exact shapes they were
 * compiled for, independent of how the shared contract module evolves
 * (DR-010, DR-011).
 */

/** The frozen 0.9 player result (DR-010 legacy profile). */
export interface LegacyPlayerResult {
  status: 'ok' | 'aborted' | 'error';
  finalText?: string;
  error?: string;
}

/** The frozen 0.9 four-port boundary (DR-010 legacy profile). */
export interface LegacyPlaybookPorts {
  callPlayer(
    playerId: string,
    prompt: string,
    signal: AbortSignal,
  ): Promise<LegacyPlayerResult>;
  callJudge(prompt: string, signal: AbortSignal): Promise<string>;
  emitStatus(message: string, data?: unknown): Promise<void>;
  emitTelemetry(event: { topic: string; payload: unknown }): Promise<void>;
}

/** The frozen 0.9 runtime surface (DR-010 legacy profile). */
export interface LegacyPlaybookRuntime {
  init(ports: LegacyPlaybookPorts): Promise<void>;
  handleBossInput(turn: { text: string; signal: AbortSignal }): Promise<void>;
  dispose(): Promise<void>;
}

export interface PlayerCallOptions {
  resume: string | false;
}

export interface PlayerResult extends LegacyPlayerResult {
  resumeToken?: string;
}

export interface CaptainCallOptions {
  visibility: 'visible' | 'hidden';
  resume: false;
  /**
   * Source-owned tool restriction: an explicitly empty allowlist for
   * routing-only Captains; absent for transformation-performing Captains,
   * which work through the host Captain's tools (link.md §PlaybookPorts).
   */
  allowedTools?: readonly [];
}

export interface CaptainResult {
  status: 'ok' | 'aborted' | 'error';
  finalText?: string;
  error?: string;
}

export type RuntimeContractProfile =
  | 'legacy'
  | 'session-v1'
  | 'composed-v2'
  | 'composed-v3';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

export type PlaybookStateValue =
  | string
  | { readonly [key: string]: PlaybookStateValue };

export interface PlaybookState {
  value: PlaybookStateValue;
  activeStateIds: readonly string[];
  tags: readonly string[];
  status: 'active' | 'done' | 'error' | 'stopped';
  quiescent: boolean;
  stateId?: string;
}

export interface PlaybookPendingCall {
  callId: string;
  playbookId: string;
  childSessionId: string;
}

export interface PlaybookCallRequest {
  callId: string;
  playbookId: string;
  text: string;
}

export type PlaybookCallResult =
  | {
      status: 'ok';
      playbookId: string;
      childSessionId: string;
      state?: PlaybookState;
      output?: JsonValue;
    }
  | {
      status: 'aborted';
      playbookId: string;
      childSessionId?: string;
      state?: PlaybookState;
      error?: NormalizedError;
    }
  | {
      status: 'error';
      playbookId: string;
      childSessionId?: string;
      state?: PlaybookState;
      error: NormalizedError;
    };

export type PlaybookCallStart =
  | { state: 'settled'; result: PlaybookCallResult }
  | { state: 'suspended'; childSessionId: string };

export type PlaybookRunResult =
  | { outcome: 'quiescent' | 'no-action'; state: PlaybookState }
  | {
      outcome: 'failed' | 'aborted';
      state: PlaybookState;
      error?: NormalizedError;
    }
  | {
      outcome: 'terminal';
      state: PlaybookState;
      output?: JsonValue;
    }
  | {
      outcome: 'suspended';
      state: PlaybookState;
      pendingCall: PlaybookPendingCall;
    };

/** The schema-3 structured result extends v2 only at exact variant seams. */
export type Schema3PlaybookRunResult =
  | Exclude<PlaybookRunResult, { outcome: 'terminal' }>
  | {
      outcome: 'terminal';
      state: PlaybookState;
      stateDescription?: string;
      output?: JsonValue;
    }
  | { outcome: 'unresolved-effect'; state: PlaybookState };

export type CompatiblePlaybookRunResult =
  | PlaybookRunResult
  | Schema3PlaybookRunResult;

/** The six source-owned ports, additive over the locked four-port contract. */
export interface CompatiblePlaybookPorts extends LegacyPlaybookPorts {
  callPlayer(
    playerId: string,
    prompt: string,
    signal: AbortSignal,
    options?: PlayerCallOptions,
  ): Promise<PlayerResult>;
  callCaptain(
    prompt: string,
    signal: AbortSignal,
    options: CaptainCallOptions,
  ): Promise<CaptainResult>;
  callPlaybook(
    request: PlaybookCallRequest,
    signal: AbortSignal,
  ): Promise<PlaybookCallStart>;
}

/** The exact six-port composed-session boundary. */
export interface ComposedPlaybookPorts {
  callPlayer(
    playerId: string,
    prompt: string,
    signal: AbortSignal,
    options: PlayerCallOptions,
  ): Promise<PlayerResult>;
  callCaptain(
    prompt: string,
    signal: AbortSignal,
    options: CaptainCallOptions,
  ): Promise<CaptainResult>;
  callJudge(prompt: string, signal: AbortSignal): Promise<string>;
  callPlaybook(
    request: PlaybookCallRequest,
    signal: AbortSignal,
  ): Promise<PlaybookCallStart>;
  emitStatus(message: string, data?: unknown): Promise<void>;
  emitTelemetry(event: { topic: string; payload: unknown }): Promise<void>;
}

/** The committed traced-session contract: explicit resume but no child port. */
export interface SessionV1PlaybookPorts {
  callPlayer(
    playerId: string,
    prompt: string,
    signal: AbortSignal,
    options: PlayerCallOptions,
  ): Promise<PlayerResult>;
  callJudge(prompt: string, signal: AbortSignal): Promise<string>;
  emitStatus(message: string, data?: unknown): Promise<void>;
  emitTelemetry(event: { topic: string; payload: unknown }): Promise<void>;
}

export interface PlaybookSessionV1 {
  sessionId: string;
  playbookId: string;
  ports: SessionV1PlaybookPorts;
}

export interface PlaybookSession {
  sessionId: string;
  playbookId: string;
  rootSessionId: string;
  parentSessionId?: string;
  parentCallId?: string;
  depth: number;
  ports: ComposedPlaybookPorts;
}

export interface SessionPlaybookRuntime {
  init(session: PlaybookSession): Promise<void>;
  handleBossInput(turn: {
    text: string;
    signal: AbortSignal;
  }): Promise<CompatiblePlaybookRunResult | void>;
  resumePlaybookCall?(input: {
    callId: string;
    result: PlaybookCallResult;
    signal: AbortSignal;
  }): Promise<CompatiblePlaybookRunResult>;
  dispose(): Promise<void>;
}

export interface SessionV1PlaybookRuntime {
  init(session: PlaybookSessionV1): Promise<void>;
  handleBossInput(turn: { text: string; signal: AbortSignal }): Promise<void>;
  dispose(): Promise<void>;
}

export type CompatiblePlaybookRuntime =
  | LegacyPlaybookRuntime
  | SessionV1PlaybookRuntime
  | SessionPlaybookRuntime;

/** Exact shared-factory compatibility required by the schema-3 phase host. */
export interface ComposedV3FactoryCompat {
  readonly artifactSchema: 3;
  readonly runtimeAbi: 1;
}

export interface EmptyEffectLedgerSnapshot {
  schemaVersion: 1;
  revision: 0;
  boundaries: readonly [];
  logicalOperations: readonly [];
}

/** The deliberately narrow repository seam owned by SLC's roleless host. */
export interface PhaseHostRepository {
  runExclusive(...args: readonly unknown[]): Promise<never>;
  runDeferred(...args: readonly unknown[]): Promise<never>;
}

/** The immutable-empty/read-only effect seam owned by SLC's roleless host. */
export interface PhaseHostEffectLedger {
  snapshot(): EmptyEffectLedgerSnapshot;
  writeAhead(...args: readonly unknown[]): Promise<never>;
}

/** No authority capability enters SLC's root phase host (DR-024). */
export interface ComposedV3PhaseHostCapabilities {
  repository: PhaseHostRepository;
  effectLedger: PhaseHostEffectLedger;
}

/**
 * The configured options SLC's roleless host may supply: the exact empty
 * record, or the single option `definition` — the exact text of the
 * definition file the request names — for an artifact whose options contract
 * requires it (DR-028).
 */
export type ComposedV3ConfiguredOptions =
  | Record<string, never>
  | { readonly definition: string };

export interface ComposedV3FactoryInput {
  configuredOptions: ComposedV3ConfiguredOptions;
  hostCapabilities: ComposedV3PhaseHostCapabilities;
}

export type CompatiblePlaybookRuntimeFactory<Options = unknown> = ((
  options: Options,
) => CompatiblePlaybookRuntime) & {
  readonly compat?: unknown;
};

export function isPlaybookRunResult(value: unknown): value is PlaybookRunResult;
export function isPlaybookRunResult(
  value: unknown,
  profile: 'composed-v2',
): value is PlaybookRunResult;
export function isPlaybookRunResult(
  value: unknown,
  profile: 'composed-v3',
): value is Schema3PlaybookRunResult;
export function isPlaybookRunResult(
  value: unknown,
  profile: 'composed-v2' | 'composed-v3',
): value is CompatiblePlaybookRunResult;
export function isPlaybookRunResult(
  value: unknown,
  profile: 'composed-v2' | 'composed-v3' = 'composed-v2',
): value is CompatiblePlaybookRunResult {
  try {
    const fields = dataRecord(value);
    if (fields === null || typeof fields.outcome !== 'string') return false;
    if (!isPlaybookState(fields.state)) return false;
    switch (fields.outcome) {
      case 'quiescent':
      case 'no-action':
        return hasExactKeys(fields, ['outcome', 'state']);
      case 'failed':
      case 'aborted':
        return (
          hasExactKeys(fields, ['outcome', 'state', 'error']) &&
          (fields.error === undefined || isNormalizedError(fields.error))
        );
      case 'terminal':
        return (
          hasExactKeys(
            fields,
            profile === 'composed-v3'
              ? ['outcome', 'state', 'stateDescription', 'output']
              : ['outcome', 'state', 'output'],
          ) &&
          (profile !== 'composed-v3' ||
            fields.stateDescription === undefined ||
            typeof fields.stateDescription === 'string') &&
          (fields.output === undefined || isJsonValue(fields.output))
        );
      case 'suspended': {
        const pendingCall = dataRecord(fields.pendingCall);
        return (
          hasExactKeys(fields, ['outcome', 'state', 'pendingCall']) &&
          pendingCall !== null &&
          hasExactKeys(pendingCall, [
            'callId',
            'playbookId',
            'childSessionId',
          ]) &&
          nonEmptyString(pendingCall.callId) &&
          nonEmptyString(pendingCall.playbookId) &&
          nonEmptyString(pendingCall.childSessionId)
        );
      }
      case 'unresolved-effect':
        return (
          profile === 'composed-v3' &&
          hasExactKeys(fields, ['outcome', 'state'])
        );
      default:
        return false;
    }
  } catch {
    // Hostile accessors/proxies are invalid results, not control-plane errors.
    return false;
  }
}

function isPlaybookState(value: unknown): value is PlaybookState {
  const fields = dataRecord(value);
  if (
    fields === null ||
    !hasExactKeys(fields, [
      'value',
      'activeStateIds',
      'tags',
      'status',
      'quiescent',
      'stateId',
    ])
  ) {
    return false;
  }
  if (
    typeof fields.quiescent !== 'boolean' ||
    !isStringArray(fields.activeStateIds) ||
    !isStringArray(fields.tags) ||
    typeof fields.status !== 'string' ||
    !['active', 'done', 'error', 'stopped'].includes(fields.status) ||
    (fields.stateId !== undefined && !nonEmptyString(fields.stateId))
  ) {
    return false;
  }
  return isPlaybookStateValue(fields.value);
}

function isNormalizedError(value: unknown): value is NormalizedError {
  const fields = dataRecord(value);
  return (
    fields !== null &&
    hasExactKeys(fields, ['name', 'message', 'stack']) &&
    typeof fields.name === 'string' &&
    typeof fields.message === 'string' &&
    (fields.stack === undefined || typeof fields.stack === 'string')
  );
}

function dataRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || !isPlainRecord(value)) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return null;
    }
    out[key] = descriptor.value;
  }
  return out;
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    (keys.includes('outcome') || !allowed.includes('outcome')) &&
    keys.every((key) => allowed.includes(key))
  );
}

function isPlaybookStateValue(
  value: unknown,
  ancestors: Set<object> = new Set(),
): value is PlaybookStateValue {
  if (typeof value === 'string') return true;
  if (!isRecord(value) || !isPlainRecord(value)) return false;
  if (ancestors.has(value)) return false;
  const values = enumerableDataValues(value);
  if (values === null) return false;
  ancestors.add(value);
  const valid = values.every((item) => isPlaybookStateValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function isJsonValue(
  value: unknown,
  ancestors: Set<object> = new Set(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    valid = isJsonArray(value, ancestors);
  } else {
    const values = isPlainRecord(value) ? enumerableDataValues(value) : null;
    valid =
      values !== null && values.every((item) => isJsonValue(item, ancestors));
  }
  ancestors.delete(value);
  return valid;
}

function enumerableDataValues(value: object): readonly unknown[] | null {
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const values: unknown[] = [];
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return null;
    }
    if (!descriptor.enumerable) continue;
    values.push(descriptor.value);
  }
  return values;
}

function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  if (!hasOnlyOwnDataProperties(value)) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = inheritedPropertyDescriptor(value, String(index));
    if (descriptor === null) return false;
    if (descriptor === undefined) continue;
    if (
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      typeof descriptor.value !== 'string'
    ) {
      return false;
    }
  }
  return true;
}

function hasOnlyOwnDataProperties(value: object): boolean {
  return Reflect.ownKeys(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      Object.prototype.hasOwnProperty.call(descriptor, 'value')
    );
  });
}

function inheritedPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | null | undefined {
  let owner: object | null = value;
  const seen = new Set<object>();
  while (owner !== null) {
    if (seen.has(owner)) return null;
    seen.add(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return descriptor;
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

function isJsonArray(
  value: readonly unknown[],
  ancestors: Set<object>,
): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (
      descriptor === undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
      !isJsonValue(descriptor.value, ancestors)
    ) {
      return false;
    }
  }
  return Object.entries(descriptors).every(([key, descriptor]) => {
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return false;
    }
    if (!descriptor.enumerable) return true;
    const index = Number(key);
    return (
      Number.isSafeInteger(index) &&
      index >= 0 &&
      index < value.length &&
      String(index) === key
    );
  });
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

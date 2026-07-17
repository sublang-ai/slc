// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compatibility types for Playbook's evolving pre-1.0 runtime contract.
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

export type RuntimeContractProfile = 'legacy' | 'session-v1' | 'composed-v2';

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
  }): Promise<PlaybookRunResult | void>;
  resumePlaybookCall?(input: {
    callId: string;
    result: PlaybookCallResult;
    signal: AbortSignal;
  }): Promise<PlaybookRunResult>;
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

export type CompatiblePlaybookRuntimeFactory<Options = unknown> = (
  options: Options,
) => CompatiblePlaybookRuntime;

export function isPlaybookRunResult(
  value: unknown,
): value is PlaybookRunResult {
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
          hasExactKeys(fields, ['outcome', 'state', 'output']) &&
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
    !Array.isArray(fields.activeStateIds) ||
    !fields.activeStateIds.every((item) => typeof item === 'string') ||
    !Array.isArray(fields.tags) ||
    !fields.tags.every((item) => typeof item === 'string') ||
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
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) return null;
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

function enumerableDataValues(value: object): readonly unknown[] | null {
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const values: unknown[] = [];
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!descriptor.enumerable) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return null;
    }
    values.push(descriptor.value);
  }
  return values;
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

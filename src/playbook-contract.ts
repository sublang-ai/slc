// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compatibility types for Playbook's evolving pre-1.0 runtime contract.
 *
 * The lockfile still supplies the published 0.9 contract. Playbook's accepted
 * session/composition contract adds causal sessions, explicit player resume,
 * structured run results, and nested calls. Keep the additive compatibility
 * shape here until an immutable release lets SLC import the complete contract
 * directly (DR-010).
 */

import type {
  PlaybookPorts as LegacyPlaybookPorts,
  PlaybookRuntime as LegacyPlaybookRuntime,
  PlayerResult as LegacyPlayerResult,
} from '@sublang/playbook/runtime';

export interface PlayerCallOptions {
  resume: string | false;
}

export interface PlayerResult extends LegacyPlayerResult {
  resumeToken?: string;
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

/** The five source-owned ports, additive over the locked four-port contract. */
export interface CompatiblePlaybookPorts extends LegacyPlaybookPorts {
  callPlayer(
    playerId: string,
    prompt: string,
    signal: AbortSignal,
    options?: PlayerCallOptions,
  ): Promise<PlayerResult>;
  callPlaybook(
    request: PlaybookCallRequest,
    signal: AbortSignal,
  ): Promise<PlaybookCallStart>;
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
  ports: CompatiblePlaybookPorts;
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
  if (!isRecord(value) || typeof value.outcome !== 'string') return false;
  if (!isPlaybookState(value.state)) return false;
  switch (value.outcome) {
    case 'quiescent':
    case 'no-action':
    case 'failed':
    case 'aborted':
      return value.error === undefined || isNormalizedError(value.error);
    case 'terminal':
      return value.output === undefined || isJsonValue(value.output);
    case 'suspended':
      return (
        isRecord(value.pendingCall) &&
        nonEmptyString(value.pendingCall.callId) &&
        nonEmptyString(value.pendingCall.playbookId) &&
        nonEmptyString(value.pendingCall.childSessionId)
      );
    default:
      return false;
  }
}

function isPlaybookState(value: unknown): value is PlaybookState {
  if (!isRecord(value)) return false;
  if (
    typeof value.quiescent !== 'boolean' ||
    !Array.isArray(value.activeStateIds) ||
    !value.activeStateIds.every((item) => typeof item === 'string') ||
    !Array.isArray(value.tags) ||
    !value.tags.every((item) => typeof item === 'string') ||
    !['active', 'done', 'error', 'stopped'].includes(String(value.status)) ||
    (value.stateId !== undefined && !nonEmptyString(value.stateId))
  ) {
    return false;
  }
  return isPlaybookStateValue(value.value);
}

function isNormalizedError(value: unknown): value is NormalizedError {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.message === 'string' &&
    (value.stack === undefined || typeof value.stack === 'string')
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

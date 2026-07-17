// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// slc link artifact
// FSM path: ./gears2fsm.fsm.ts
// Player binding: none (no delegated-player states)
// Adjudication strategy: LLM-judge per Captain state
// Boss-event mapping: deterministic COMPILE entry from ready/failed/terminal;
//   LLM-judge classification from awaitBossReply
// Abort strategy: natural rejection (the captain invoke's onError lands the
//   machine quiescent in `failed`; the runtime latches control-plane failures
//   out of the machine and rethrows them at the boundary)

import PQueue from 'p-queue';
import { createActor, fromPromise, type ActorRefFrom } from 'xstate';

import {
  gears2fsmMachine,
  type CaptainInput,
  type CaptainOutput,
  type Gears2fsmEvent,
} from './gears2fsm.fsm.ts';

import type {
  CaptainCallOptions,
  CaptainResult,
  JsonValue,
  PlaybookCallResult,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
  PlaybookRunResult,
  PlaybookSession,
  PlaybookState,
  PlaybookTraceEvent,
} from '@sublang/playbook/runtime';

import {
  assertJsonSafe,
  combineAbortSignals,
  normalizeError,
  normalizePlaybookSnapshot,
  snapshotJsonValue,
  snapshotPlaybookSession,
  validateCaptainResult,
  waitForPlaybookQuiescence,
} from '@sublang/playbook/xstate-runtime';

export type {
  CaptainCallOptions,
  CaptainResult,
  JsonValue,
  NormalizedError,
  PlaybookCallRequest,
  PlaybookCallResult,
  PlaybookCallStart,
  PlaybookPorts,
  PlaybookRunResult,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
  PlaybookSession,
  PlaybookState,
  PlaybookStateValue,
  PlaybookTraceEvent,
  PlayerCallOptions,
  PlayerResult,
} from '@sublang/playbook/runtime';

// The single G2F-1 prompt establishes no runtime-value placeholders, declares
// no players, and the machine makes no dynamic playbook call, so the linked
// runtime needs no per-session options.
export type PlaybookRuntimeOptions = Record<string, never>;

type RootActor = ActorRefFrom<typeof gears2fsmMachine>;

type BossMapping = Gears2fsmEvent | { type: 'NO_ACTION' } | undefined;

type RuntimeSession = Omit<PlaybookSession, 'ports'> & {
  readonly ports: PlaybookPorts;
};

// The tool restriction is source-owned (link.md §PlaybookPorts contract):
// this transformation-performing Captain works through the host Captain's
// tools, so its calls carry no allowedTools restriction.
const CAPTAIN_OPTIONS: CaptainCallOptions = {
  visibility: 'visible',
  resume: false,
};

const CONTINUATION_PREAMBLE =
  'You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.';

/** Stable ids the FSM accepts as `BOSS_INTERRUPT` targets. */
const INTERRUPT_IDS = ['ready', 'compile', 'failed'] as const;

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): JsonValue {
  const copy: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      assertJsonSafe(entry, key);
      copy[key] = snapshotJsonValue(entry, key);
    }
  }
  return snapshotJsonValue(copy);
}

function stableJson(value: unknown): string {
  const json = snapshotJsonValue(value);
  return JSON.stringify(sortJson(json));
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => sortJson(entry)));
  }
  if (value && typeof value === 'object') {
    const record = value as { readonly [key: string]: JsonValue };
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortJson(record[key]);
    }
    return Object.freeze(sorted);
  }
  return value;
}

function continuationPrefix(input: {
  readonly pendingBossQuestion?: { readonly question: string };
  readonly bossReply?: string;
}): string {
  if (!input.pendingBossQuestion || !input.bossReply) return '';
  return [
    CONTINUATION_PREAMBLE,
    '',
    'Boss question:',
    input.pendingBossQuestion.question,
    '',
    'Boss reply:',
    input.bossReply,
    '',
    '',
  ].join('\n');
}

// The GEARS-derived `prompt` body carries no runtime-value placeholders for this
// playbook (Gears2fsmInput = Record<string, never>), so composition is the
// continuation preamble — present only on resume — followed by the verbatim
// prompt. Angle-bracketed metavariables inside the domain instructions are
// ordinary prompt text and are never substituted.
export function composeCaptainPrompt(input: CaptainInput): string {
  return `${continuationPrefix(input)}${input.prompt}`;
}

export function composePlayerPrompt(input: {
  readonly prompt: string;
  readonly pendingBossQuestion?: { readonly question: string };
  readonly bossReply?: string;
}): string {
  return `${continuationPrefix(input)}${input.prompt}`;
}

function parseJsonObjectLoose(
  text: string,
): Record<string, unknown> | undefined {
  const source = text;
  for (let start = 0; start < source.length; start += 1) {
    if (source[start] !== '{') continue;
    const bounded = boundedJsonCandidate(source, start);
    const candidates = bounded
      ? [bounded, bounded.replace(/,\s*([}\]])/g, '$1')]
      : [repairJsonSuffix(source.slice(start))];
    for (const candidate of candidates) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (isRecord(parsed)) return parsed;
      } catch {
        // Try the next candidate at the same object boundary.
      }
    }
  }
  return undefined;
}

function boundedJsonCandidate(
  source: string,
  start: number,
): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return undefined;
}

function repairJsonSuffix(source: string): string {
  let repaired = source.replace(/,\s*$/g, '');
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const char of repaired) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') stack.push('}');
    else if (char === '[') stack.push(']');
    else if (char === '}' || char === ']') stack.pop();
  }
  if (inString) repaired += '"';
  while (stack.length > 0) repaired += stack.pop();
  return repaired.replace(/,\s*([}\]])/g, '$1');
}

function requiredOutputFields(description: string): readonly string[] {
  const marker = description.match(/Output shall include\s+(.+)$/);
  if (!marker) return [];
  const fields: string[] = [];
  const seen = new Set<string>();
  const regex = /`([^`]+)`/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(marker[1])) !== null) {
    const name = match[1].split(':', 1)[0]?.trim();
    if (name && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !seen.has(name)) {
      seen.add(name);
      fields.push(name);
    }
  }
  return fields;
}

function makeJudgePrompt(input: CaptainInput, visibleText: string): string {
  return [
    'Adjudicate the direct Captain output for this FSM state.',
    `State id: ${input.stateId}`,
    `Source item: ${input.sourceItem}`,
    '',
    'Visible Captain output:',
    visibleText,
    '',
    'Result keys and descriptions:',
    ...Object.entries(input.result).map(
      ([key, description]) => `- ${key}: ${description}`,
    ),
    '',
    'Reply with one JSON object of the exact form {"guard": "<name>"} — a top-level "guard" property naming exactly one declared result key, plus any output fields that key requires.',
    'For the needsBossReply guard, do not include question; the runtime injects the visible text.',
  ].join('\n');
}

function adjudicateCaptainOutput(
  input: CaptainInput,
  visibleText: string,
  judgeText: string,
): CaptainOutput {
  const parsed = parseJsonObjectLoose(judgeText);
  if (!parsed)
    throw new Error('adjudicator reply did not contain a JSON object');
  const guard = parsed.guard;
  if (typeof guard !== 'string' || !(guard in input.result)) {
    throw new Error(`adjudicator selected undeclared guard ${String(guard)}`);
  }
  const allowed = new Set(['guard']);
  for (const field of requiredOutputFields(input.result[guard] ?? '')) {
    if (field !== 'question' && field !== 'response') allowed.add(field);
  }
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key)) {
      throw new Error(`adjudicator supplied undeclared field ${key}`);
    }
  }
  if (guard === 'needsBossReply') {
    return { guard: 'needsBossReply', question: visibleText };
  }
  if (guard === 'compiled') {
    return { guard: 'compiled' };
  }
  if (guard === 'rejected') {
    return { guard: 'rejected' };
  }
  throw new Error(`adjudicator selected unsupported guard ${guard}`);
}

function validateClassifier(
  text: string,
  bossText: string,
  pendingQuestionId: string | undefined,
): BossMapping {
  const parsed = parseJsonObjectLoose(text);
  if (!parsed) return undefined;
  const type = parsed.type;
  if (type === 'NO_ACTION') {
    if (Object.keys(parsed).length !== 1) return undefined;
    return { type: 'NO_ACTION' };
  }
  if (type === 'COMPILE') {
    if (Object.keys(parsed).length !== 1) return undefined;
    return { type: 'COMPILE' };
  }
  if (type === 'BOSS_INTERRUPT') {
    if (
      Object.keys(parsed).sort().join('\0') !== ['targetId', 'type'].join('\0')
    ) {
      return undefined;
    }
    const targetId = parsed.targetId;
    if (
      typeof targetId !== 'string' ||
      !(INTERRUPT_IDS as readonly string[]).includes(targetId)
    ) {
      return undefined;
    }
    return { type: 'BOSS_INTERRUPT', targetId };
  }
  if (type === 'BOSS_REPLY') {
    const keys = Object.keys(parsed).sort();
    if (
      keys.join('\0') !== ['questionId', 'type'].join('\0') &&
      keys.join('\0') !== 'type'
    ) {
      return undefined;
    }
    const questionId =
      parsed.questionId === undefined ? pendingQuestionId : parsed.questionId;
    if (questionId !== pendingQuestionId || typeof questionId !== 'string') {
      return undefined;
    }
    return { type: 'BOSS_REPLY', answer: bossText, questionId };
  }
  return undefined;
}

function classifierPrompt(
  text: string,
  state: PlaybookState,
  pending: unknown,
): string {
  return [
    'Classify this Boss message for the gears2fsm playbook FSM.',
    '',
    'Boss message:',
    text,
    '',
    'Current state:',
    stableJson(state),
    '',
    'Pending Boss question:',
    stableJson(pending ?? null),
    '',
    'Return JSON only. Allowed objects are {"type":"BOSS_REPLY","questionId":"compile"}, {"type":"COMPILE"}, {"type":"BOSS_INTERRUPT","targetId":"ready|compile|failed"}, or {"type":"NO_ACTION"}.',
  ].join('\n');
}

function stateFromSnapshot(actor: RootActor): PlaybookState {
  return normalizePlaybookSnapshot(actor.getSnapshot());
}

function resultFromState(
  state: PlaybookState,
  output: JsonValue | undefined,
  error?: unknown,
): PlaybookRunResult {
  if (state.status === 'done') {
    return output === undefined
      ? { outcome: 'terminal', state }
      : { outcome: 'terminal', state, output };
  }
  if (state.stateId === 'failed') {
    return error === undefined
      ? { outcome: 'failed', state }
      : { outcome: 'failed', state, error: normalizeError(error) };
  }
  return { outcome: 'quiescent', state };
}

function isAbortLikeError(error: unknown): boolean {
  return normalizeError(error).name === 'AbortError';
}

function isSignalAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted && error === signal.reason;
}

class Gears2fsmPlaybookRuntime implements PlaybookRuntime {
  private readonly emissionQueue = new PQueue({ concurrency: 1 });
  private readonly captainLane = new PQueue({ concurrency: 1 });
  private session: RuntimeSession | undefined;
  private actor: RootActor | undefined;
  private sequence = 0;
  private turnId = 0;
  private callId = 0;
  private boundaryTurnId: number | undefined;
  private activeBoundarySignal: AbortSignal | undefined;
  private activeTurn: Promise<PlaybookRunResult> | undefined;
  private disposing: Promise<void> | undefined;
  private disposed = false;
  private terminallyDisposedBeforeInit = false;
  private disposalTraceEmitted = false;
  private initializing = false;
  private initializationDone: Promise<void> | undefined;
  private resolveInitializationDone: (() => void) | undefined;
  private latchedControlError: unknown;
  private suppressInspection = false;
  private previousState: PlaybookState | undefined;

  constructor(_options: PlaybookRuntimeOptions) {}

  async init(session: PlaybookSession): Promise<void> {
    if (this.session || this.actor) {
      throw new Error('playbook runtime is already initialized');
    }
    if (this.disposed || this.terminallyDisposedBeforeInit || this.disposing) {
      throw new Error('playbook runtime is disposed');
    }
    this.initializing = true;
    this.initializationDone = new Promise((resolve) => {
      this.resolveInitializationDone = resolve;
    });
    this.disposalTraceEmitted = false;
    let actor: RootActor | undefined;
    let initialState: PlaybookState | undefined;
    try {
      const captured = snapshotPlaybookSession(session);
      this.session = captured;
      actor = this.createActor(captured);
      this.actor = actor;
      initialState = stateFromSnapshot(actor);
      this.previousState = initialState;
      await this.trace(
        'session.started',
        omitUndefined({ state: initialState, stateId: initialState.stateId }),
      );
      await this.drain();
      actor.start();
      await this.drain();
    } catch (error) {
      this.suppressInspection = true;
      actor?.stop();
      if (initialState && !this.disposalTraceEmitted) {
        await this.bestEffortDisposeTrace(initialState);
      }
      this.session = undefined;
      this.actor = undefined;
      this.sequence = 0;
      this.turnId = 0;
      this.callId = 0;
      this.latchedControlError = undefined;
      this.previousState = undefined;
      this.suppressInspection = false;
      throw error;
    } finally {
      this.initializing = false;
      this.resolveInitializationDone?.();
      this.resolveInitializationDone = undefined;
    }
  }

  async handleBossInput(turn: {
    text: string;
    signal: AbortSignal;
  }): Promise<PlaybookRunResult> {
    if (this.activeTurn) {
      throw new Error('playbook runtime already has an active boundary');
    }
    if (this.disposing || this.disposed) {
      throw new Error('playbook runtime is disposing');
    }
    const run = this.handleBossInputInner(turn);
    this.activeTurn = run;
    try {
      return await run;
    } catch (error) {
      if (isSignalAbort(error, turn.signal)) {
        const actor = this.actor;
        const snapshot = actor
          ? await waitForPlaybookQuiescence(actor)
          : undefined;
        const state = snapshot
          ? normalizePlaybookSnapshot(snapshot)
          : ({
              value: 'failed',
              activeStateIds: ['failed'],
              tags: ['playbook.parked'],
              status: 'active',
              quiescent: true,
              stateId: 'failed',
            } satisfies PlaybookState);
        try {
          await this.drain();
        } catch {
          // The signal-driven abort remains the public outcome.
        }
        return { outcome: 'aborted', state, error: normalizeError(error) };
      }
      throw error;
    } finally {
      this.activeTurn = undefined;
      const error = this.latchedControlError;
      this.latchedControlError = undefined;
      const aborted = this.activeBoundarySignal?.aborted === true;
      this.activeBoundarySignal = undefined;
      this.boundaryTurnId = undefined;
      if (error && (!aborted || !isAbortLikeError(error))) throw error;
    }
  }

  async resumePlaybookCall(input: {
    callId: string;
    result: PlaybookCallResult;
    signal: AbortSignal;
  }): Promise<PlaybookRunResult> {
    if (this.activeTurn) {
      throw new Error('playbook runtime already has an active boundary');
    }
    if (this.disposing || this.disposed) {
      throw new Error('playbook runtime is disposing');
    }
    const run = this.resumePlaybookCallInner(input);
    this.activeTurn = run;
    try {
      return await run;
    } finally {
      this.activeTurn = undefined;
      const error = this.latchedControlError;
      this.latchedControlError = undefined;
      const aborted = this.activeBoundarySignal?.aborted === true;
      this.activeBoundarySignal = undefined;
      this.boundaryTurnId = undefined;
      if (error && (!aborted || !isAbortLikeError(error))) throw error;
    }
  }

  dispose(): Promise<void> {
    if (this.activeTurn) {
      return Promise.reject(
        new Error('cannot dispose during an active boundary'),
      );
    }
    if (this.disposing) return this.disposing;
    if (!this.initializing && !this.session && !this.actor && !this.disposed) {
      this.terminallyDisposedBeforeInit = true;
      this.disposed = true;
      this.disposing = Promise.resolve();
      return this.disposing;
    }
    this.disposing = this.disposeInner();
    return this.disposing;
  }

  private async handleBossInputInner(turn: {
    text: string;
    signal: AbortSignal;
  }): Promise<PlaybookRunResult> {
    const actor = this.requireActor();
    const currentTurnId = this.nextTurnId();
    this.boundaryTurnId = currentTurnId;
    this.activeBoundarySignal = turn.signal;
    await this.trace('boss.input.received', { text: turn.text }, currentTurnId);
    const state = stateFromSnapshot(actor);
    let event: BossMapping;
    if (turn.text.trim().length === 0) {
      const result: PlaybookRunResult = { outcome: 'no-action', state };
      await this.traceSettled(result, currentTurnId);
      await this.drain();
      return result;
    }
    // A terminal machine, the idle hub, or the recoverable `failed` state all
    // accept exactly one ordinary entry event (COMPILE), which carries no
    // textual payload, so the entry is deterministic and needs no classifier.
    if (
      state.status === 'done' ||
      state.stateId === 'ready' ||
      state.stateId === 'failed'
    ) {
      event = { type: 'COMPILE' };
    } else {
      try {
        event = await this.classifyBossInput(turn.text, state, turn.signal);
      } catch (error) {
        if (isSignalAbort(error, turn.signal)) {
          const result: PlaybookRunResult = {
            outcome: 'aborted',
            state,
            error: normalizeError(error),
          };
          await this.traceSettled(result, currentTurnId);
          await this.drain();
          return result;
        }
        await this.trace(
          'boss.input.settled',
          omitUndefined({
            outcome: 'no-action',
            state,
            stateId: state.stateId,
            error: normalizeError(error),
          }),
          currentTurnId,
        );
        await this.drain();
        throw error;
      }
      if (!event) {
        await this.emitStatus(
          'classification was invalid; Boss input was not actionable.',
          { state },
        );
        const result: PlaybookRunResult = { outcome: 'no-action', state };
        await this.traceSettled(result, currentTurnId);
        await this.drain();
        return result;
      }
    }
    if (event?.type === 'NO_ACTION') {
      const result: PlaybookRunResult = { outcome: 'no-action', state };
      await this.traceSettled(result, currentTurnId);
      await this.drain();
      return result;
    }
    if (turn.signal.aborted) {
      const result: PlaybookRunResult = {
        outcome: 'aborted',
        state,
        error: normalizeError(turn.signal.reason),
      };
      await this.traceSettled(result, currentTurnId);
      await this.drain();
      return result;
    }
    if (actor.getSnapshot().status === 'done') {
      this.reconstructActor();
    }
    this.requireActor().send(event);
    const snapshot = await waitForPlaybookQuiescence(this.requireActor());
    const settledState = normalizePlaybookSnapshot(snapshot);
    const result = turn.signal.aborted
      ? ({
          outcome: 'aborted',
          state: settledState,
          error: normalizeError(turn.signal.reason),
        } satisfies PlaybookRunResult)
      : resultFromState(
          settledState,
          this.machineOutput(),
          this.latchedControlError,
        );
    await this.traceSettled(result, currentTurnId);
    await this.drain();
    return result;
  }

  private async resumePlaybookCallInner(input: {
    callId: string;
    result: PlaybookCallResult;
    signal: AbortSignal;
  }): Promise<PlaybookRunResult> {
    // This playbook invokes no nested `playbook` actor, so it never suspends on
    // a child call and never has a pending call to resume; any callId is stale.
    this.requireActor();
    this.activeBoundarySignal = input.signal;
    this.boundaryTurnId = undefined;
    throw new Error(
      `playbook runtime has no pending call to resume (callId: ${input.callId})`,
    );
  }

  private async disposeInner(): Promise<void> {
    if (this.disposed) return;
    if (this.initializing) {
      await this.initializationDone;
    }
    const actor = this.actor;
    const finalState = actor ? stateFromSnapshot(actor) : undefined;
    let cleanupError: unknown;
    this.suppressInspection = true;
    actor?.stop();
    try {
      await this.drain();
    } catch (error) {
      if (cleanupError === undefined) cleanupError = error;
    }
    this.latchedControlError = undefined;
    if (finalState && !this.disposalTraceEmitted) {
      this.disposalTraceEmitted = true;
      try {
        await this.trace(
          'session.disposed',
          omitUndefined({ state: finalState, stateId: finalState.stateId }),
        );
      } catch (error) {
        if (cleanupError === undefined) cleanupError = error;
      }
    }
    try {
      await this.drain();
    } catch (error) {
      if (cleanupError === undefined) cleanupError = error;
    }
    this.session = undefined;
    this.actor = undefined;
    this.disposed = true;
    if (cleanupError !== undefined) throw cleanupError;
  }

  private createActor(session: RuntimeSession): RootActor {
    const provided = gears2fsmMachine.provide({
      actors: {
        captain: fromPromise<CaptainOutput, CaptainInput>(
          async ({ input, signal }) => {
            await this.drain();
            const combined = combineAbortSignals(
              signal,
              this.activeBoundarySignal,
            );
            return await this.runCaptainActor(input, combined);
          },
        ),
      },
    });
    let rootActor: RootActor;
    rootActor = createActor(provided, {
      input: {},
      inspect: (inspectionEvent) => {
        if (this.suppressInspection) return;
        if (inspectionEvent.type !== '@xstate.snapshot') return;
        if (inspectionEvent.actorRef !== rootActor) return;
        try {
          this.enqueueTransition(inspectionEvent.event, rootActor);
        } catch (error) {
          this.latchControlError(error);
        }
      },
    });
    // The session is retained for trace identity; the machine itself takes no
    // per-session input (Gears2fsmInput = Record<string, never>).
    void session;
    return rootActor;
  }

  private async runCaptainActor(
    input: CaptainInput,
    signal: AbortSignal,
  ): Promise<CaptainOutput> {
    try {
      const prompt = composeCaptainPrompt(input);
      const result = await this.callCaptain(input, prompt, signal);
      if (signal.aborted) throw signal.reason;
      if (result.status !== 'ok') {
        throw new Error(result.error ?? `Captain returned ${result.status}`);
      }
      if (!result.finalText) {
        throw new Error('Captain returned ok without finalText');
      }
      const judgePrompt = makeJudgePrompt(input, result.finalText);
      const judgeText = await this.callJudge(
        'captain-output-adjudication',
        judgePrompt,
        signal,
        input.stateId,
      );
      return adjudicateCaptainOutput(input, result.finalText, judgeText);
    } catch (error) {
      if (!signal.aborted) this.latchControlError(error);
      throw error;
    }
  }

  private async callCaptain(
    input: CaptainInput,
    prompt: string,
    signal: AbortSignal,
  ): Promise<CaptainResult> {
    const callId = `captain-${this.nextCallId()}`;
    const startPayload = {
      stateId: input.stateId,
      sourceItem: input.sourceItem,
      prompt,
      visibility: 'visible',
      resume: false,
    };
    try {
      await this.trace(
        'captain.call.started',
        startPayload,
        this.currentTraceTurnId(),
        callId,
      );
    } catch (error) {
      await this.tracePreservingError(
        'captain.call.finished',
        {
          ...startPayload,
          status: 'error',
          error: normalizeError(error),
        },
        error,
        this.currentTraceTurnId(),
        callId,
      );
      throw error;
    }
    let result: CaptainResult | undefined;
    let failure: unknown;
    try {
      result = await this.captainLane.add(async () => {
        if (signal.aborted) throw signal.reason;
        const raw = await this.requireSession().ports.callCaptain(
          prompt,
          signal,
          CAPTAIN_OPTIONS,
        );
        if (signal.aborted) throw signal.reason;
        return validateCaptainResult(raw);
      });
      if (result.status !== 'ok') {
        failure = new Error(
          result.error ?? `Captain returned ${result.status}`,
        );
      } else if (!result.finalText) {
        failure = new Error('Captain returned ok without finalText');
      }
    } catch (error) {
      failure = error;
    }
    const normalized =
      failure === undefined ? undefined : normalizeError(failure);
    const abortedFailure =
      failure !== undefined && isSignalAbort(failure, signal);
    const finishPayload = {
      stateId: input.stateId,
      sourceItem: input.sourceItem,
      prompt,
      visibility: 'visible',
      resume: false,
      allowedTools: [],
      status: result?.status ?? (abortedFailure ? 'aborted' : 'error'),
      ...(result?.finalText === undefined
        ? {}
        : { finalText: result.finalText }),
      ...(result?.error === undefined ? {} : { error: result.error }),
      ...(normalized === undefined ? {} : { error: normalized }),
    };
    if (failure !== undefined) {
      if (isSignalAbort(failure, signal)) {
        await this.trace(
          'captain.call.finished',
          finishPayload,
          this.currentTraceTurnId(),
          callId,
        );
        throw failure;
      }
      await this.tracePreservingError(
        'captain.call.finished',
        finishPayload,
        failure,
        this.currentTraceTurnId(),
        callId,
      );
      throw failure;
    }
    await this.trace(
      'captain.call.finished',
      finishPayload,
      this.currentTraceTurnId(),
      callId,
    );
    if (!result) throw new Error('Captain returned no result');
    return result;
  }

  private async callJudge(
    purpose: string,
    prompt: string,
    signal: AbortSignal,
    stateId?: string,
  ): Promise<string> {
    const callId = `judge-${this.nextCallId()}`;
    const startPayload = omitUndefined({ purpose, prompt, stateId });
    try {
      await this.trace(
        'judge.call.started',
        startPayload,
        this.currentTraceTurnId(),
        callId,
      );
    } catch (error) {
      await this.tracePreservingError(
        'judge.call.finished',
        omitUndefined({
          purpose,
          prompt,
          stateId,
          status: 'error',
          error: normalizeError(error),
        }),
        error,
        this.currentTraceTurnId(),
        callId,
      );
      throw error;
    }
    let reply: string | undefined;
    let failure: unknown;
    try {
      reply = await this.captainLane.add(async () => {
        if (signal.aborted) throw signal.reason;
        const text = await this.requireSession().ports.callJudge(
          prompt,
          signal,
        );
        if (signal.aborted) throw signal.reason;
        if (typeof text !== 'string') {
          throw new TypeError('judge reply must be a string');
        }
        return text;
      });
    } catch (error) {
      failure = error;
    }
    if (failure !== undefined) {
      const aborted = isSignalAbort(failure, signal);
      const finishPayload = omitUndefined({
        purpose,
        prompt,
        stateId,
        status: aborted ? 'aborted' : 'error',
        error: normalizeError(failure),
      });
      if (aborted) {
        await this.trace(
          'judge.call.finished',
          finishPayload,
          this.currentTraceTurnId(),
          callId,
        );
      } else {
        await this.tracePreservingError(
          'judge.call.finished',
          finishPayload,
          failure,
          this.currentTraceTurnId(),
          callId,
        );
      }
      throw failure;
    }
    await this.trace(
      'judge.call.finished',
      omitUndefined({ purpose, prompt, stateId, status: 'ok', reply }),
      this.currentTraceTurnId(),
      callId,
    );
    if (reply === undefined) throw new Error('judge returned no reply');
    return reply;
  }

  private async classifyBossInput(
    text: string,
    state: PlaybookState,
    signal: AbortSignal,
  ): Promise<BossMapping> {
    const pending = this.pendingQuestion();
    const prompt = classifierPrompt(
      text,
      state,
      pending
        ? {
            questionId: pending.questionId,
            player: pending.player,
            question: pending.question,
          }
        : undefined,
    );
    const reply = await this.callJudge(
      'boss-input-classification',
      prompt,
      signal,
      state.stateId,
    );
    const event = validateClassifier(reply, text, pending?.questionId);
    if (!event) return undefined;
    return event;
  }

  private pendingQuestion():
    | {
        readonly questionId: string;
        readonly player: string;
        readonly question: string;
      }
    | undefined {
    const snapshot = this.actor?.getSnapshot();
    const context = snapshot?.context as unknown;
    if (!isRecord(context) || !isRecord(context.pendingBossQuestion)) {
      return undefined;
    }
    return {
      questionId: assertNonEmptyString(
        context.pendingBossQuestion.questionId,
        'pending question id',
      ),
      player: assertNonEmptyString(
        context.pendingBossQuestion.player,
        'pending question player',
      ),
      question: assertNonEmptyString(
        context.pendingBossQuestion.question,
        'pending question text',
      ),
    };
  }

  private enqueueTransition(event: unknown, actor: RootActor): void {
    const state = stateFromSnapshot(actor);
    const previousState = this.previousState ?? state;
    this.previousState = state;
    const transition = omitUndefined({
      event: this.describeEvent(event),
      from: previousState,
      to: state,
      previousState,
      state,
      stateId: state.stateId,
      pendingBossQuestion: this.pendingQuestion(),
      lastError: this.lastError(),
    });
    this.enqueue(async () => {
      await this.traceNow(
        'fsm.transition',
        transition,
        this.currentTraceTurnId(),
      );
      await this.requireSession().ports.emitTelemetry({
        topic: 'playbook.fsm.state',
        payload: transition,
      });
      if (state.stateId !== 'ready' && state.stateId !== 'done') {
        await this.traceNow(
          'status.emitted',
          omitUndefined({
            message: `Entered ${state.stateId ?? 'state'}`,
            state,
            stateId: state.stateId,
          }),
          this.currentTraceTurnId(),
        );
        await this.requireSession().ports.emitStatus(
          `Entered ${state.stateId ?? 'state'}`,
          transition,
        );
      }
    });
  }

  private describeEvent(event: unknown): JsonValue {
    if (!isRecord(event)) return { type: 'unknown' };
    const type = typeof event.type === 'string' ? event.type : 'unknown';
    const copy: Record<string, JsonValue> = { type };
    for (const key of ['targetId', 'answer', 'questionId', 'output']) {
      if (key in event && event[key] === undefined) continue;
      if (key in event)
        copy[key] = snapshotJsonValue(event[key], `event.${key}`);
    }
    if ('error' in event)
      copy.error = snapshotJsonValue(normalizeError(event.error));
    return snapshotJsonValue(copy);
  }

  private lastError(): JsonValue | undefined {
    const context = this.actor?.getSnapshot().context as unknown;
    if (!isRecord(context) || !('lastError' in context)) return undefined;
    const value = context.lastError;
    if (value === undefined) return undefined;
    try {
      return snapshotJsonValue(value, 'lastError');
    } catch {
      // The FSM keeps `lastError` as an inspection-only Error instance, which is
      // not JSON-safe; normalize it for the trace payload.
      return snapshotJsonValue(normalizeError(value));
    }
  }

  private machineOutput(): JsonValue | undefined {
    const snapshot = this.actor?.getSnapshot();
    if (!snapshot || snapshot.status !== 'done') return undefined;
    const output = snapshot.output as unknown;
    return output === undefined
      ? undefined
      : snapshotJsonValue(output, 'machine output');
  }

  private async emitStatus(message: string, data?: unknown): Promise<void> {
    const state = stateFromSnapshot(this.requireActor());
    const payload = omitUndefined({
      message,
      data,
      state,
      stateId: state.stateId,
    });
    await this.trace('status.emitted', payload, this.currentTraceTurnId());
    await this.requireSession().ports.emitStatus(message, data);
  }

  private async traceSettled(
    result: PlaybookRunResult,
    turnId: number,
  ): Promise<void> {
    await this.trace(
      'boss.input.settled',
      this.runResultPayload(result),
      turnId,
    );
  }

  private runResultPayload(result: PlaybookRunResult): JsonValue {
    return omitUndefined({
      outcome: result.outcome,
      state: result.state,
      stateId: result.state.stateId,
      pendingCall: 'pendingCall' in result ? result.pendingCall : undefined,
      output: 'output' in result ? result.output : undefined,
      error: 'error' in result ? result.error : undefined,
    });
  }

  private async trace(
    type: PlaybookTraceEvent['type'],
    payload: unknown,
    turnId?: number,
    callId?: string,
  ): Promise<void> {
    this.enqueue(async () => {
      await this.traceNow(type, payload, turnId, callId);
    });
    await this.drain();
  }

  private async tracePreservingError(
    type: PlaybookTraceEvent['type'],
    payload: unknown,
    preservedError: unknown,
    turnId?: number,
    callId?: string,
  ): Promise<void> {
    const previous = this.latchedControlError;
    this.latchedControlError = undefined;
    try {
      await this.trace(type, payload, turnId, callId);
    } catch {
      // Preserve the earlier boundary/control failure.
    } finally {
      this.latchedControlError = previous ?? preservedError;
    }
  }

  private async traceNow(
    type: PlaybookTraceEvent['type'],
    payload: unknown,
    turnId?: number,
    callId?: string,
  ): Promise<void> {
    const session = this.requireSession();
    const event: PlaybookTraceEvent = {
      schemaVersion: 2,
      sessionId: session.sessionId,
      playbookId: session.playbookId,
      rootSessionId: session.rootSessionId,
      ...(session.parentSessionId === undefined
        ? {}
        : { parentSessionId: session.parentSessionId }),
      ...(session.parentCallId === undefined
        ? {}
        : { parentCallId: session.parentCallId }),
      depth: session.depth,
      sequence: this.nextSequence(),
      timestamp: Date.now(),
      type,
      ...(turnId === undefined ? {} : { turnId }),
      ...(callId === undefined ? {} : { callId }),
      payload: snapshotJsonValue(payload, `trace ${type}`),
    };
    await session.ports.emitTelemetry({
      topic: 'playbook.trace',
      payload: event,
    });
  }

  private enqueue(task: () => Promise<void>): void {
    void this.emissionQueue
      .add(async () => {
        try {
          await task();
        } catch (error) {
          this.latchControlError(error);
          throw error;
        }
      })
      .catch(() => undefined);
  }

  private drain(): Promise<void> {
    return this.emissionQueue.onIdle().then(() => {
      if (this.latchedControlError) throw this.latchedControlError;
    });
  }

  private async bestEffortDisposeTrace(state: PlaybookState): Promise<void> {
    try {
      this.disposalTraceEmitted = true;
      await this.trace(
        'session.disposed',
        omitUndefined({ state, stateId: state.stateId }),
      );
      await this.drain();
    } catch {
      // Preserve the original initialization error.
    }
  }

  private reconstructActor(): void {
    this.actor?.stop();
    const session = this.requireSession();
    this.actor = this.createActor(session);
    this.actor.start();
  }

  private requireSession(): RuntimeSession {
    if (!this.session) throw new Error('playbook runtime is not initialized');
    return this.session;
  }

  private requireActor(): RootActor {
    if (!this.actor)
      throw new Error('playbook runtime actor is not initialized');
    return this.actor;
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private nextTurnId(): number {
    this.turnId += 1;
    return this.turnId;
  }

  private currentTraceTurnId(): number | undefined {
    return this.boundaryTurnId;
  }

  private nextCallId(): number {
    this.callId += 1;
    return this.callId;
  }

  private latchControlError(error: unknown): void {
    if (!this.latchedControlError) this.latchedControlError = error;
  }
}

export const _internal = {
  composeCaptainPrompt,
  composePlayerPrompt,
  parseJsonObjectLoose,
};

export function createPlaybookRuntime(
  options: PlaybookRuntimeOptions,
): PlaybookRuntime {
  return new Gears2fsmPlaybookRuntime(options);
}

const factory: PlaybookRuntimeFactory<PlaybookRuntimeOptions> =
  createPlaybookRuntime;

export default factory;

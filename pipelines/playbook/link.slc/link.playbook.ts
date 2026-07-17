// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// slc link artifact
// FSM path: ./link.fsm.ts
// Player binding: none (LINK-1 is a direct-Captain item; the FSM declares no
//   delegated-player, nested-playbook, or script actor, so no player id is
//   synthesized and no callPlayer/callPlaybook/child-process path is emitted)
// Adjudication strategy: LLM-judge per Captain state (purpose
//   `captain-output-adjudication`); the hidden judge selects the guard and the
//   runtime injects the visible CaptainResult.finalText as `question`
// Boss-event mapping: LLM-judge free-text classification into the FSM event
//   union (LINK_REQUEST / BOSS_REPLY / NO_ACTION); LINK_REQUEST is not a single
//   ordinary textual-entry event (it declares two structured routing fields,
//   fsmArtifact and target), so no deterministic exact-entry path applies and
//   every non-empty turn is classified
// Abort strategy: natural rejection — the captain invocation rejects and the
//   FSM routes it through onError to the quiescent `failed` sink
// Parked-session snapshot: not implemented (the optional exportSnapshot/restore
//   surface is implement-both-or-neither; this runtime implements neither)

import PQueue from 'p-queue';
import { createActor, fromPromise, type ActorRefFrom } from 'xstate';

import {
  linkMachine,
  type CaptainInput,
  type CaptainOutput,
} from './link.fsm.ts';

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

// ---------------------------------------------------------------------------
// Runtime options
// ---------------------------------------------------------------------------

// LINK-1 declares no required FSM input field: `LinkInput` carries only the
// optional `fsmArtifact` / `target` seeds for the machine context (a fresh
// LINK_REQUEST overrides both). They are exposed here as optional per-run knobs
// so a host can seed the initial context; there is no enabledPlaybooks catalog.
export interface PlaybookRuntimeOptions {
  readonly fsmArtifact?: string;
  readonly target?: string;
}

type RootActor = ActorRefFrom<typeof linkMachine>;

type BossEvent =
  | {
      readonly type: 'LINK_REQUEST';
      readonly fsmArtifact: string;
      readonly target: string;
    }
  | {
      readonly type: 'BOSS_REPLY';
      readonly answer: string;
      readonly questionId?: string;
    };

type BossMapping = BossEvent | { readonly type: 'NO_ACTION' } | undefined;

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

// ---------------------------------------------------------------------------
// Pure helpers (host-agnostic; exercised by _internal in compilation tests)
// ---------------------------------------------------------------------------

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
  if (Array.isArray(value))
    return Object.freeze(value.map((entry) => sortJson(entry)));
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

// One callback-based pass over the original template. Replacement strings are
// literal, so placeholder-looking text inside a substituted value and JS
// replacement tokens ($&, $$, dollar-backtick, $') are never reinterpreted.
function replacePlaceholders(
  template: string,
  replacements: ReadonlyMap<string, string>,
): string {
  return template.replace(
    /<[^>\n]+>/g,
    (placeholder) => replacements.get(placeholder) ?? placeholder,
  );
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

export function composeCaptainPrompt(input: CaptainInput): string {
  const replacements = new Map<string, string>();
  // Field presence alone drives the replacement table: LINK-1 supplies only
  // `fsmArtifact`, so `<fsm-artifact>` is the single live placeholder and every
  // other `<...>` in the verbatim GEARS body is left untouched.
  replacements.set('<fsm-artifact>', input.fsmArtifact);
  return `${continuationPrefix(input)}${replacePlaceholders(input.prompt, replacements)}`;
}

export function composePlayerPrompt(input: {
  readonly prompt: string;
  readonly pendingBossQuestion?: { readonly question: string };
  readonly bossReply?: string;
}): string {
  return `${continuationPrefix(input)}${input.prompt}`;
}

function snapshotLinkOptions(
  options: PlaybookRuntimeOptions,
): PlaybookRuntimeOptions {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('playbook runtime options must be an object');
  }
  const result: { fsmArtifact?: string; target?: string } = {};
  if (options.fsmArtifact !== undefined) {
    if (typeof options.fsmArtifact !== 'string') {
      throw new TypeError('options.fsmArtifact must be a string');
    }
    result.fsmArtifact = options.fsmArtifact;
  }
  if (options.target !== undefined) {
    if (typeof options.target !== 'string') {
      throw new TypeError('options.target must be a string');
    }
    result.target = options.target;
  }
  return Object.freeze(result);
}

// ---------------------------------------------------------------------------
// Tolerant document-order JSON recovery (shared by classifier and adjudicator)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Captain adjudication (LLM-judge; captain-output-adjudication)
// ---------------------------------------------------------------------------

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
    'For direct Captain question or response guards, do not include question or response; the runtime injects the visible text.',
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
  // `question` and `response` are runtime-owned presentation fields injected
  // from the visible CaptainResult; the judge may not supply them.
  const allowed = new Set(['guard']);
  for (const field of requiredOutputFields(input.result[guard] ?? '')) {
    if (field !== 'question' && field !== 'response') allowed.add(field);
  }
  for (const key of Object.keys(parsed)) {
    if (!allowed.has(key))
      throw new Error(`adjudicator supplied undeclared field ${key}`);
  }
  if (guard === 'needsBossReply') {
    return { guard: 'needsBossReply', question: visibleText };
  }
  if (guard === 'done') {
    return { guard: 'done' };
  }
  throw new Error(`adjudicator selected unsupported guard ${guard}`);
}

// ---------------------------------------------------------------------------
// Boss-event classification (LLM-judge; boss-input-classification)
// ---------------------------------------------------------------------------

function classifierPrompt(
  text: string,
  state: PlaybookState,
  pending:
    | {
        readonly questionId: string;
        readonly player: string;
        readonly question: string;
      }
    | undefined,
): string {
  return [
    'Classify this Boss message for the link playbook FSM.',
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
    'Return JSON only, choosing exactly one FSM event kind and its non-text routing fields.',
    'Allowed objects:',
    '- {"type":"LINK_REQUEST","fsmArtifact":"<source FSM artifact path>","target":"<PlaybookRuntime module path>"}',
    '  when Boss asks to link/compile an FSM; extract both paths from the message.',
    '- {"type":"BOSS_REPLY","questionId":"<pending question id>"} only when a Boss question is pending;',
    '  omit questionId when there is a single pending question. Do not copy the Boss text into any field.',
    '- {"type":"NO_ACTION"} when the message requires no FSM action.',
    'Do not add any other fields; the runtime owns the Boss answer text.',
  ].join('\n');
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
  if (type === 'LINK_REQUEST') {
    if (
      Object.keys(parsed).sort().join('\0') !==
      ['fsmArtifact', 'target', 'type'].join('\0')
    )
      return undefined;
    const fsmArtifact = parsed.fsmArtifact;
    const target = parsed.target;
    if (typeof fsmArtifact !== 'string' || fsmArtifact.trim().length === 0)
      return undefined;
    if (typeof target !== 'string' || target.trim().length === 0)
      return undefined;
    return { type: 'LINK_REQUEST', fsmArtifact, target };
  }
  if (type === 'BOSS_REPLY') {
    const keys = Object.keys(parsed).sort();
    if (
      keys.join('\0') !== ['questionId', 'type'].join('\0') &&
      keys.join('\0') !== 'type'
    )
      return undefined;
    const questionId =
      parsed.questionId === undefined ? pendingQuestionId : parsed.questionId;
    if (questionId !== pendingQuestionId || typeof questionId !== 'string')
      return undefined;
    return { type: 'BOSS_REPLY', answer: bossText, questionId };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Snapshot / run-result projection
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

class LinkPlaybookRuntime implements PlaybookRuntime {
  private readonly options: PlaybookRuntimeOptions;
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

  constructor(options: PlaybookRuntimeOptions) {
    this.options = snapshotLinkOptions(options);
  }

  async init(session: PlaybookSession): Promise<void> {
    if (this.session || this.actor)
      throw new Error('playbook runtime is already initialized');
    if (this.disposed || this.terminallyDisposedBeforeInit || this.disposing)
      throw new Error('playbook runtime is disposed');
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
      actor = this.createActor();
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
      if (initialState && !this.disposalTraceEmitted)
        await this.bestEffortDisposeTrace(initialState);
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
    if (this.activeTurn)
      throw new Error('playbook runtime already has an active boundary');
    if (this.disposing || this.disposed)
      throw new Error('playbook runtime is disposing');
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

  // The FSM declares no nested `playbook` actor, so no child call is ever
  // pending; every call id is unknown and rejects without changing actor state.
  async resumePlaybookCall(input: {
    callId: string;
    result: PlaybookCallResult;
    signal: AbortSignal;
  }): Promise<PlaybookRunResult> {
    if (this.activeTurn)
      throw new Error('playbook runtime already has an active boundary');
    if (this.disposing || this.disposed)
      throw new Error('playbook runtime is disposing');
    this.requireActor();
    throw new Error(
      `no pending playbook call to resume for call id ${input.callId}`,
    );
  }

  dispose(): Promise<void> {
    if (this.activeTurn)
      return Promise.reject(
        new Error('cannot dispose during an active boundary'),
      );
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
    if (turn.text.trim().length === 0) {
      const result: PlaybookRunResult = { outcome: 'no-action', state };
      await this.traceSettled(result, currentTurnId);
      await this.drain();
      return result;
    }
    // LINK_REQUEST is not a single ordinary textual-entry event, so every
    // non-empty turn is classified — no deterministic exact-entry path applies.
    let event: BossMapping;
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
    if (event.type === 'NO_ACTION') {
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

  private createActor(): RootActor {
    const provided = linkMachine.provide({
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
      input: {
        fsmArtifact: this.options.fsmArtifact,
        target: this.options.target,
      },
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
        if (typeof text !== 'string')
          throw new TypeError('judge reply must be a string');
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
    const prompt = classifierPrompt(text, state, pending);
    const reply = await this.callJudge(
      'boss-input-classification',
      prompt,
      signal,
      state.stateId,
    );
    return validateClassifier(reply, text, pending?.questionId);
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
    if (!isRecord(context) || !isRecord(context.pendingBossQuestion))
      return undefined;
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
    for (const key of [
      'fsmArtifact',
      'target',
      'answer',
      'questionId',
      'output',
    ]) {
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
    if (context.lastError === undefined) return undefined;
    try {
      return snapshotJsonValue(context.lastError, 'lastError');
    } catch {
      // The FSM keeps `lastError` as an inspection-only Error instance, which
      // is not JSON-safe; normalize it for the trace payload (LINK-1 §Status
      // and telemetry), matching the sibling artifacts.
      return snapshotJsonValue(normalizeError(context.lastError));
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
    this.requireSession();
    this.actor = this.createActor();
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
  return new LinkPlaybookRuntime(options);
}

const factory: PlaybookRuntimeFactory<PlaybookRuntimeOptions> =
  createPlaybookRuntime;

export default factory;

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// PlaybookRuntime for the gears2fsm playbook — a host-agnostic runner linked
// from the FSM artifact by the slc FSM-to-Runtime linking phase (link.md).
//
// Linker inputs (this module is reproducible from these):
//   FSM artifact:       ./gears2fsm.fsm.ts
//   Player binding:     Captain -> captain
//                       (default binding — no binding supplied; each GEARS
//                        player mapped to its lowercased name)
//   Composite players:  none — the GEARS source (text2gears) declares only
//                       Boss and Captain, with no aliases, so player
//                       resolution is the direct name -> playerId lookup
//                       below (no per-item alias resolution is needed).
//   Adjudication:       LLM-judge per state (default) — one callJudge per
//                       player result, keyed to the state's own result map.
//   Boss-event mapping: free-text judge classification (default) — each
//                       non-empty turn is classified via callJudge into one
//                       of the FSM's Boss events or no action.
//   Abort strategy:     natural rejection — the Captain fromPromise actor
//                       rejects on abort/player-failure and the FSM routes it
//                       through transform.onError to the quiescent `failed`
//                       state (every captain-invoking state's onError lands
//                       quiescent, so the FSM's own error wiring is the abort
//                       path).
//
// The module speaks only PlaybookPorts; it holds no host types and never
// talks to LLMs directly. It does not modify the FSM or re-derive Captain
// prompts, result keys, or guard semantics — those are fixed by the FSM.

import { createActor, fromPromise } from 'xstate';
import type { Actor, InspectionEvent, SnapshotFrom } from 'xstate';

import gears2fsmMachine, {
  type CaptainInput,
  type CaptainOutput,
  type TransformInput,
  type TransformEvent,
  type TransformRequest,
} from './gears2fsm.fsm.ts';

import type {
  PlayerResult,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
} from '@sublang/playbook/runtime';

// Single shared contract: re-export the names consumers import rather than
// redefining them, so every linked playbook shares one contract definition.
export type {
  PlayerResult,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
};

// ---------------------------------------------------------------------------
// Per-playbook options (based on the FSM's `TransformInput`)
// ---------------------------------------------------------------------------

/**
 * Host-agnostic, per-run knobs for this playbook.
 * Player binding is baked in by default (see DEFAULT_PLAYER_BINDING); it is
 * additionally exposed here for optional per-run remapping.
 */
export interface PlaybookRuntimeOptions {
  /** Optional per-run remapping of the linker-time player binding (GEARS player name -> opaque playerId). */
  playerBinding?: Record<string, string>;
  /** Optional per-run transformation request seeded into the FSM input; Boss may also supply it via a START directive. */
  request?: TransformRequest;
}

// ---------------------------------------------------------------------------
// Linker-time constants derived from the FSM
// ---------------------------------------------------------------------------

/** Deterministic, recorded player binding applied at every callPlayer site. */
const DEFAULT_PLAYER_BINDING: Readonly<Record<string, string>> = {
  Captain: 'captain',
};

/** States that invoke the Captain actor (non-quiescent — the drive loop keeps going while here). */
const CAPTAIN_STATES: readonly string[] = ['transform'];

/** Non-final states that accept a Boss event (quiescent — the drive loop stops here). */
const QUIESCENT_STATES: readonly string[] = [
  'ready',
  'awaitBossReply',
  'failed',
];

/** The FSM's Boss-originated events and their payload contracts (from the FSM `events` union). */
const BOSS_EVENTS: ReadonlyArray<{
  type: TransformEvent['type'];
  description: string;
  payload: Record<string, string>;
}> = [
  {
    type: 'START',
    description:
      'Begin, restart, or re-target the transformation from an idle or failed state (also resumes a fresh turn while waiting for a reply).',
    payload: {
      request:
        'optional { "source": string, "target": string } — the GEARS source and the FSM target the Boss names',
    },
  },
  {
    type: 'BOSS_INTERRUPT',
    description:
      'Pre-empt the active state and jump to a stable state id, restarting that state. Not an abort surface.',
    payload: { targetId: "required string — one of: 'ready', 'transform'" },
  },
  {
    type: 'BOSS_REPLY',
    description:
      'Answer the pending player question while the FSM waits in awaitBossReply.',
    payload: {
      answer: 'required string — the Boss answer to the pending question',
    },
  },
];

/** Telemetry topic for FSM transitions (observers consume it; the runtime never interprets it). */
const TELEMETRY_TOPIC = 'playbook.fsm.state';

/**
 * Continuation preamble prepended when a resumed state carries both a pending
 * Boss question and a Boss reply. Framework text supplied by the runtime — it
 * is not part of the GEARS blockquote and never appears in `invoke.input.prompt`.
 */
const CONTINUATION_PREAMBLE =
  'You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.';

// ---------------------------------------------------------------------------
// Pure helpers (exposed under `_internal` for compilation-correctness tests)
// ---------------------------------------------------------------------------

/**
 * Compose the actual player prompt from a state's CaptainInput.
 * `input.prompt` is the GEARS-derived domain body and is never mutated or
 * re-flowed; structured labelled blocks and (when resuming) the continuation
 * Q&A are prepended before it. No player-visible Boss-question instruction is
 * injected — Boss-question detection is adjudicator-facing.
 */
function composePlayerPrompt(input: CaptainInput): string {
  const blocks: string[] = [];

  // Continuation Q&A first, before ordinary structured blocks and the body.
  if (input.pendingBossQuestion && input.bossReply !== undefined) {
    blocks.push(
      [
        CONTINUATION_PREAMBLE,
        '',
        'Boss question:',
        input.pendingBossQuestion.question,
        '',
        'Boss reply:',
        input.bossReply,
      ].join('\n'),
    );
  }

  // Ordinary structured blocks from the typed CaptainInput fields the FSM exposes.
  if (input.source !== undefined) blocks.push(`Source:\n${input.source}`);
  if (input.target !== undefined) blocks.push(`Target:\n${input.target}`);

  // The GEARS-derived domain prompt body, verbatim and last.
  blocks.push(input.prompt);

  return blocks.join('\n\n');
}

/**
 * Resolve the opaque playerId for a state from its `invoke.input.player`.
 * The GEARS source declares no composite players, so this is the direct
 * binding lookup, falling back to the recorded default (lowercased name).
 */
function resolvePlayerId(
  input: CaptainInput,
  binding: Record<string, string>,
): string {
  return binding[input.player] ?? input.player.toLowerCase();
}

/**
 * Extract the payload field names a result description marks as required via
 * the load-bearing pattern ``Output shall include `<field>:` `` (e.g. the
 * `needsBossReply` description requires `question`).
 */
function requiredFieldsFor(description: string): string[] {
  const fields: string[] = [];
  const re = /Output shall include `([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(description)) !== null) fields.push(match[1]);
  return fields;
}

/** Best-effort JSON extraction from free-form judge text (direct, fenced, or first object). */
function extractJson(raw: string): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(trimmed);
  if (direct) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const v = tryParse(fenced[1].trim());
    if (v) return v;
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const v = tryParse(trimmed.slice(first, last + 1));
    if (v) return v;
  }
  return null;
}

/** Build the Boss-input classifier prompt (per-turn, host-agnostic). */
function buildClassifierPrompt(
  text: string,
  ctx: { state: string; pendingQuestion?: string },
): string {
  const lines: string[] = [];
  lines.push('You are the Boss-input classifier for a playbook state machine.');
  lines.push(
    "Classify the Boss message below into exactly one of the machine's Boss events, or into no event.",
  );
  lines.push('');
  lines.push(`Current FSM state: ${ctx.state}`);
  if (ctx.pendingQuestion) {
    lines.push(
      'A player has paused and is waiting for Boss to answer this question:',
    );
    lines.push(ctx.pendingQuestion);
    lines.push(
      'If the Boss message answers that question, classify it as BOSS_REPLY; if it is a fresh directive, classify it accordingly.',
    );
  }
  lines.push('');
  lines.push('Events and their payload fields:');
  for (const event of BOSS_EVENTS) {
    lines.push(`- ${event.type}: ${event.description}`);
    for (const [field, spec] of Object.entries(event.payload)) {
      lines.push(`    ${field}: ${spec}`);
    }
  }
  lines.push('');
  lines.push('Boss message:');
  lines.push(text);
  lines.push('');
  lines.push(
    'Reply with a single JSON object: { "event": "<EVENT_TYPE or null>", ...payload fields }.',
  );
  lines.push(
    'Use null (or omit "event") when no machine event applies. Include every required payload field for the chosen event.',
  );
  return lines.join('\n');
}

/** Parse the classifier reply into an FSM event, or null for no action. */
function parseClassification(raw: string): TransformEvent | null {
  const obj = extractJson(raw);
  if (!obj) return null;
  const type = (obj.event ?? obj.type) as unknown;
  if (type === 'START') {
    const req = obj.request as
      | { source?: unknown; target?: unknown }
      | undefined;
    if (
      req &&
      typeof req.source === 'string' &&
      typeof req.target === 'string'
    ) {
      return {
        type: 'START',
        request: { source: req.source, target: req.target },
      };
    }
    return { type: 'START' };
  }
  if (type === 'BOSS_INTERRUPT') {
    return typeof obj.targetId === 'string'
      ? { type: 'BOSS_INTERRUPT', targetId: obj.targetId }
      : null;
  }
  if (type === 'BOSS_REPLY') {
    return typeof obj.answer === 'string'
      ? { type: 'BOSS_REPLY', answer: obj.answer }
      : null;
  }
  return null;
}

/**
 * Build the LLM-judge adjudicator prompt for a player result. It names the
 * source item's player, carries the player's verbatim output, and lists the
 * state's result keys with their descriptions verbatim — it does not interpret,
 * paraphrase, or alter the FSM's result text.
 */
function buildAdjudicatorPrompt(
  input: CaptainInput,
  playerOutput: string,
): string {
  const lines: string[] = [];
  lines.push('You are the guard adjudicator for a playbook state machine.');
  lines.push(
    `The player "${input.player}" produced the output below for source item ${input.sourceItem}.`,
  );
  lines.push('Choose exactly one guard whose description matches that output.');
  lines.push('');
  lines.push('Player output (verbatim):');
  lines.push('"""');
  lines.push(playerOutput);
  lines.push('"""');
  lines.push('');
  lines.push(
    'Guards (choose exactly one; the descriptions are authoritative and must be applied as written):',
  );
  for (const [guard, description] of Object.entries(input.result)) {
    lines.push(`- ${guard}: ${description}`);
  }
  lines.push('');
  lines.push(
    'Reply with a single JSON object: { "guard": "<one of the guard names above>", ...any payload fields the chosen guard\'s description requires }.',
  );
  return lines.join('\n');
}

/**
 * Coerce the adjudicator reply into one of the state's declared guards plus any
 * required payload fields. Fails loudly on an undeclared guard, a missing
 * required field, or an empty/malformed response (control-plane errors).
 */
function parseAdjudication(raw: string, input: CaptainInput): CaptainOutput {
  const obj = extractJson(raw);
  if (!obj || typeof obj.guard !== 'string' || obj.guard.trim() === '') {
    throw new Error(
      `adjudicator returned an empty or malformed response (no "guard"): ${JSON.stringify(raw).slice(0, 200)}`,
    );
  }
  const guard = obj.guard;
  if (!Object.prototype.hasOwnProperty.call(input.result, guard)) {
    throw new Error(
      `adjudicator returned guard '${guard}' not declared by this state (declared: ${Object.keys(input.result).join(', ')})`,
    );
  }
  const output: CaptainOutput = { guard };
  for (const field of requiredFieldsFor(input.result[guard])) {
    const value = obj[field];
    if (
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      throw new Error(
        `adjudicator response for guard '${guard}' is missing required field '${field}'`,
      );
    }
    output[field] = value;
  }
  return output;
}

// ---------------------------------------------------------------------------
// Runtime factory
// ---------------------------------------------------------------------------

function combineSignals(
  a: AbortSignal | undefined,
  b: AbortSignal | undefined,
): AbortSignal {
  const signals = [a, b].filter(
    (s): s is AbortSignal => s instanceof AbortSignal,
  );
  if (signals.length === 0) return new AbortController().signal;
  if (signals.length === 1) return signals[0];
  return AbortSignal.any(signals);
}

/**
 * Factory for the gears2fsm PlaybookRuntime. The default export; conforms to
 * `PlaybookRuntimeFactory<PlaybookRuntimeOptions>`.
 */
export default function createPlaybookRuntime(
  options: PlaybookRuntimeOptions,
): PlaybookRuntime {
  const binding: Record<string, string> = {
    ...DEFAULT_PLAYER_BINDING,
    ...(options.playerBinding ?? {}),
  };
  const fsmInput: TransformInput = {
    players: binding,
    request: options.request,
  };

  let ports: PlaybookPorts | null = null;
  let actor: Actor<typeof gears2fsmMachine> | null = null;
  let currentSignal: AbortSignal | undefined;
  let adjudicatorError: unknown;
  let hasAdjudicatorError = false;
  let previousValue: string | undefined;

  // Ordered, awaited, never-dropped emissions: a serial promise chain.
  let emissionChain: Promise<void> = Promise.resolve();
  let emissionError: unknown;
  let hasEmissionError = false;
  const enqueue = (fn: () => Promise<void>): void => {
    emissionChain = emissionChain.then(async () => {
      try {
        await fn();
      } catch (error) {
        if (!hasEmissionError) emissionError = error;
        hasEmissionError = true;
      }
    });
  };
  const flush = async (): Promise<void> => {
    await emissionChain;
    if (hasEmissionError) {
      const error = emissionError;
      emissionError = undefined;
      hasEmissionError = false;
      throw error;
    }
  };

  const requirePorts = (): PlaybookPorts => {
    if (!ports)
      throw new Error(
        'gears2fsm runtime: init(ports) must be called before use',
      );
    return ports;
  };

  // The runtime-owned Captain actor: composes the prompt, calls the player,
  // and adjudicates the result into an FSM guard.
  const captain = fromPromise<CaptainOutput, CaptainInput>(
    async ({ input, signal }) => {
      const p = requirePorts();
      const combined = combineSignals(signal, currentSignal);
      combined.throwIfAborted();

      const playerId = resolvePlayerId(input, binding);
      const prompt = composePlayerPrompt(input);

      const result = await p.callPlayer(playerId, prompt, combined);
      // Player failure (including a cancelled call that resolves 'aborted'/'error'):
      // convert to a Captain-actor rejection so the FSM's onError path handles it.
      if (result.status !== 'ok') {
        throw new Error(
          `player '${playerId}' returned status '${result.status}'${result.error ? `: ${result.error}` : ''}`,
        );
      }
      combined.throwIfAborted();

      try {
        const raw = await p.callJudge(
          buildAdjudicatorPrompt(input, result.finalText ?? ''),
          combined,
        );
        combined.throwIfAborted();
        return parseAdjudication(raw, input);
      } catch (err) {
        // Abort during adjudication is a natural rejection (routes to `failed`),
        // not a control-plane adjudicator failure.
        if (!combined.aborted) {
          if (!hasAdjudicatorError) adjudicatorError = err;
          hasAdjudicatorError = true;
        }
        throw err;
      }
    },
  );

  const providedMachine = gears2fsmMachine.provide({ actors: { captain } });

  // Surface each root transition via status + telemetry, ordered before the
  // next event, using XState's inspection stream.
  const inspect = (event: InspectionEvent): void => {
    if (event.type !== '@xstate.snapshot') return;
    if (actor === null || event.actorRef !== actor) return;
    const snapshot = event.snapshot as SnapshotFrom<typeof gears2fsmMachine>;
    const to = String(snapshot.value);
    const from = previousValue;
    if (to === from) return;
    previousValue = to;
    const eventType = event.event?.type ?? 'unknown';
    const p = ports;
    if (!p) return;
    enqueue(() =>
      p.emitTelemetry({
        topic: TELEMETRY_TOPIC,
        payload: { from: from ?? null, to, event: eventType },
      }),
    );
    enqueue(() =>
      p.emitStatus(`FSM ${from ?? '(init)'} -> ${to} [${eventType}]`),
    );
    if (to === 'failed') {
      const lastError = snapshot.context.lastError;
      enqueue(() => p.emitStatus('Entered failed state', lastError));
    }
  };

  const startActor = (): void => {
    previousValue = undefined;
    actor = createActor(providedMachine, { input: fsmInput, inspect });
    actor.start();
  };

  const isQuiescent = (
    snapshot: SnapshotFrom<typeof gears2fsmMachine>,
  ): boolean =>
    snapshot.status === 'done' ||
    !CAPTAIN_STATES.includes(String(snapshot.value));

  // Drive the actor until it settles into a Boss-accepting or final state,
  // letting the runtime-owned Captain actor run each captain invocation.
  const driveToQuiescence = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const live = actor;
      if (!live) {
        resolve();
        return;
      }
      let settled = false;
      const subscription: {
        current?: { unsubscribe(): void };
      } = {};
      const finish = (): void => {
        if (settled) return;
        settled = true;
        subscription.current?.unsubscribe();
        resolve();
      };
      const check = (snapshot: SnapshotFrom<typeof gears2fsmMachine>): void => {
        if (isQuiescent(snapshot)) finish();
      };
      subscription.current = live.subscribe(check);
      check(live.getSnapshot());
      if (settled) subscription.current.unsubscribe();
    });

  const classify = async (
    text: string,
    signal: AbortSignal,
  ): Promise<TransformEvent | null> => {
    const snapshot = actor!.getSnapshot();
    const prompt = buildClassifierPrompt(text, {
      state: String(snapshot.value),
      pendingQuestion: snapshot.context.pendingBossQuestion?.question,
    });
    let raw: string;
    try {
      if (signal.aborted) return null;
      raw = await requirePorts().callJudge(prompt, signal);
      if (signal.aborted) return null;
    } catch (err) {
      if (signal.aborted) return null;
      throw err;
    }
    return parseClassification(raw);
  };

  return {
    async init(hostPorts: PlaybookPorts): Promise<void> {
      ports = hostPorts;
      startActor();
      await flush();
    },

    async handleBossInput(turn: {
      text: string;
      signal: AbortSignal;
    }): Promise<void> {
      requirePorts();
      if (!actor)
        throw new Error(
          'gears2fsm runtime: init(ports) must be called before handleBossInput',
        );

      currentSignal = turn.signal;
      adjudicatorError = undefined;
      hasAdjudicatorError = false;

      // Empty / whitespace-only text: no event and no port call.
      if (!turn.text || turn.text.trim().length === 0) {
        await flush();
        return;
      }

      // 1. Classify the turn into an FSM event (or no action).
      const event = await classify(turn.text, turn.signal);
      if (turn.signal.aborted || !event) {
        await flush();
        return;
      }

      // 2. A `final` state cannot accept events: dispose and reconstruct.
      if (actor.getSnapshot().status === 'done') {
        actor.stop();
        startActor();
      }

      // 3. Send the classified event, then 4. drive to quiescence.
      actor.send(event);
      await driveToQuiescence();
      await flush();

      // Adjudicator failures are control-plane errors: rethrow after cleanup.
      if (hasAdjudicatorError) {
        const err = adjudicatorError;
        adjudicatorError = undefined;
        hasAdjudicatorError = false;
        throw err;
      }
    },

    async dispose(): Promise<void> {
      if (actor) {
        actor.stop();
        actor = null;
      }
      await flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Pure helpers for compilation-correctness verification (no host required)
// ---------------------------------------------------------------------------

export const _internal = {
  composePlayerPrompt,
  resolvePlayerId,
  requiredFieldsFor,
  extractJson,
  buildClassifierPrompt,
  parseClassification,
  buildAdjudicatorPrompt,
  parseAdjudication,
  DEFAULT_PLAYER_BINDING,
  CAPTAIN_STATES,
  QUIESCENT_STATES,
  BOSS_EVENTS,
  CONTINUATION_PREAMBLE,
  TELEMETRY_TOPIC,
};

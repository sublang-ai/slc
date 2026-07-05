// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

//
// XState v5 finite state machine compiled from the GEARS package
// `gears2fsm.gears.md` (single Captain-acting item G2F-1).
//
// Object artifact only: it defines the machine, the typed Captain actor
// contract, and typed inputs. It binds no runner and supplies no concrete
// Captain implementation — the runner must provide the `captain` actor.
//

import { setup, assign, fromPromise, type DoneActorEvent } from 'xstate';

// ---------------------------------------------------------------------------
// Actor contract
// ---------------------------------------------------------------------------

/** The per-run transformation request the Boss names (a source and a target). */
export interface TransformRequest {
    source: string;
    target: string;
}

/** A clarifying question raised by a player that only Boss can answer. */
export interface PendingBossQuestion {
    resumeStateId: string;
    sourceItem: string;
    player: string;
    question: string;
}

/**
 * Input handed to the Captain actor for a captain-invoking state.
 * Guard names are specified and interpreted per state via `result`; they are
 * not a global union.
 */
export interface CaptainInput {
    /** The player Captain is to invoke. */
    player: string;
    /** The GEARS item ID this state realizes. */
    sourceItem: string;
    /** The source item's full final prompt, verbatim. */
    prompt: string;
    /** A record whose keys are the valid guard names this invocation may return. */
    result: Record<string, string>;
    /** Specific extracted fields the player needs to perform the transformation. */
    source?: string;
    target?: string;
    /** Present only when resuming after a Boss reply, for continuation-prompt composition. */
    pendingBossQuestion?: PendingBossQuestion;
    bossReply?: string;
}

/** Discriminated result Captain returns; `guard` is one of the state's `result` keys. */
export interface CaptainOutput {
    guard: string;
    /** Present when `guard` is `needsBossReply`. */
    question?: string;
    [extracted: string]: unknown;
}

// ---------------------------------------------------------------------------
// Machine types
// ---------------------------------------------------------------------------

export interface TransformContext {
    /** Player bindings, copied from `input` at start-up (consumed by the runner). */
    players: Record<string, string>;
    /** The transformation request, copied from `input` and/or set by a Boss entry event. */
    request?: TransformRequest;
    /** Last Captain result — inspection only; never branched on for routing. */
    lastResult?: CaptainOutput;
    /** Last Captain error — inspection only. */
    lastError?: unknown;
    /** Set while suspended in `awaitBossReply`. */
    pendingBossQuestion?: PendingBossQuestion;
    /** Boss's answer, set on the resume arm and read by the resumed state's input. */
    bossReply?: string;
}

export type TransformEvent =
    | { type: 'START'; request?: TransformRequest }
    | { type: 'BOSS_INTERRUPT'; targetId: string }
    | { type: 'BOSS_REPLY'; answer: string };

export interface TransformInput {
    players: Record<string, string>;
    request?: TransformRequest;
}

// ---------------------------------------------------------------------------
// Verbatim prompt for G2F-1 (the item's full final prompt; no duplicate lines)
// ---------------------------------------------------------------------------

const G2F_1_PROMPT: string = [
    "Transform the source's normative GEARS spec items into an XState v5 finite state machine written as a TypeScript object artifact.",
    "Produce an object artifact only: define the machine, actor contracts, and typed inputs; do not bind a runner or supply concrete runtime implementations.",
    "Build the machine with XState v5's `setup(...)` followed by `.createMachine(...)`.",
    "In the `types` block declare `context`, `events`, machine `input`, and a typed `Captain` actor contract.",
    "Do not import a runner or bake in a concrete Captain implementation; make any actor placeholder fail explicitly (e.g., throw `'captain actor must be provided by the runner'`).",
    "Type `CaptainInput` as an object with at least: `player` (the player Captain is to invoke), `sourceItem` (the GEARS item ID this state realizes), `prompt` (the source item's full final prompt, verbatim), and `result` (a record whose keys are the valid guard names this invocation may return).",
    "Type `CaptainOutput` as a discriminated object with `guard: string` plus any extracted fields downstream states need.",
    "Specify and interpret guard names per state, not as a global union (a global union encourages name reuse with divergent semantics and couples unrelated states); shared helpers may accept `string`, but each state's `invoke.input.result` is the authoritative local contract.",
    "Give each state a stable `id` (for `#id` targeting and Boss interrupts), an intuitive state key (the property name under `states: { ... }`), and a one-line `description` (for inspector tools and documentation).",
    "For a state that invokes Captain, give `invoke.input` the fields `player`, `sourceItem`, `prompt`, and `result`.",
    "Put the source item ID in `invoke.input.sourceItem`, not in a comment, so the GEARS-to-state mapping stays machine-readable.",
    "Set each state's `invoke.input.player` to match its source item's player.",
    "Make the machine's initial state a quiescent idle hub with no `invoke` — typically `ready` — that accepts the Boss entry events, so constructing and starting the machine performs no player call and Captain-invoking work begins only on a Boss-originated event.",
    "Have Captain return a discriminated result with `guard` set to one of `input.result`'s keys, and route `onDone` transitions with guards that inspect `event.output.guard`.",
    "Map each Source spec item to exactly one state, with that state's `invoke.input.sourceItem` set to the item's ID and `invoke.input.prompt` carrying the item's prompt verbatim.",
    "Rely on each spec item already carrying the full final prompt for one state behavior, with no duplicate lines (per text2gears composition); do not concatenate prompts across items, re-compose them, or silently dedupe them.",
    "Treat a spec item that still contains duplicate prompt lines as malformed: reject or flag it rather than silently propagate the duplication into `invoke.input.prompt`.",
    "Make context fields that drive guards or compose prompts typed and named; do not branch on untyped properties of `lastResult` (keep `lastResult` for inspection only) and put persistent routing decisions in typed context fields.",
    "Pass only the specific extracted fields a player needs; do not dump `JSON.stringify(lastResult)` or any opaque blob into a prompt (it leaks internal `guard` strings, wastes tokens, and confuses the LLM).",
    "Flow player bindings and per-run parameters in via the machine's `input` and copy them into context at start-up; do not bake in player bindings, model names, or per-run values.",
    "Fire transitions on an event — typically `onDone` (actor completed) — and, when multiple are possible, pick the path with a synchronous guard.",
    "Persist relevant typed fields from `event.output` to context via `assign` so downstream prompts can read them.",
    "Make transitions self-driving when source items define the next obligation; route to an idle hub only for recovery, unrecoverable Boss input, or one-shot entry events — not the happy path.",
    "Target the next workflow step from a review/approval state's success outcome rather than idling back to a hub; returning to Boss on success is a defect that forces manual stepping.",
    "Do not have a state following an approval enter a fresh approval of the same content (it adds latency and risks ping-pong loops); a state may route through approval once only when its input came from an unreviewed branch (e.g., a re-do without an intervening review).",
    "When the source has a feedback cycle, reuse one cycle across all phases that need feedback rather than duplicating it per phase; phases may set typed routing fields so terminal outcomes return to the originating branch.",
    "Admit Boss input through three surfaces: pre-emptive interrupts on active states, typed entry events on idle or recoverable states, and Boss replies to player questions that suspended the FSM in a dedicated wait state.",
    "Let Boss interrupt any active state at any time; give every jumpable state a stable `id`.",
    "Handle the runtime's `{ type: 'BOSS_INTERRUPT', targetId: '<id>' }` at the root machine with one guarded transition per jumpable state targeting `#<id>` with `reenter: true`, so invoked actors restart cleanly; XState automatically stops the current state's invoked actor on transition.",
    "Emit a `bossInterrupts(ids)` helper rather than hand-writing one transition per state.",
    "Use `BOSS_INTERRUPT` to jump into an active machine, pre-empting whichever state is running; use Boss entry events to start or resume from idle or recoverable states when Boss-supplied parameters cannot be inferred from machine state alone.",
    "Type entry events alongside `BOSS_INTERRUPT` and populate context via a dedicated action.",
    "Do not collapse the two surfaces: `BOSS_INTERRUPT` cannot carry payload, and a parameterless entry event may collapse to interrupt-style routing only when state-jump semantics are identical.",
    "Do not make entry events root-level transitions from every active state unless the workflow supports pre-emption; put them on idle and recoverable states (e.g., `failed`).",
    "When a Captain-invoking state needs a Boss decision the player cannot supply alone, suspend in a dedicated quiescent state and resume the same state with the Q+A in the next prompt; every Captain-invoking state supports this path.",
    "Expect no source-level opt-in annotation and no `needsBossReply` result metadata in GEARS output; preserve the GEARS blockquote as the state's domain `prompt` body and do not inject any Boss-question instruction into `invoke.input.prompt`.",
    "For every Captain-invoking state, add `needsBossReply` to the state's `invoke.input.result` map.",
    "Give `needsBossReply` the standard adjudicator-facing `description`, verbatim: \"The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.\"",
    "Keep the load-bearing substring `` Output shall include `question:` `` in that description so the runtime's adjudicator requires `question` in the JSON reply.",
    "Note that the linked runtime composes player prompts per link.md \"Player prompt composition\" without adding a player-visible Boss-question instruction.",
    "Declare an `awaitBossReply` state with stable `id: 'awaitBossReply'` and `description: 'Waiting for Boss to answer a player question.'`.",
    "Declare a `BOSS_REPLY` event carrying `{ answer: string }`.",
    "Declare context fields `pendingBossQuestion?: { resumeStateId, sourceItem, player, question }` and `bossReply?: string`.",
    "Source `resumeStateId`, `sourceItem`, and `player` from the suspended state's invocation metadata, and take only `question` from adjudicated player output.",
    "Emit a `resumableStates(ids)` helper that adds one `BOSS_REPLY` arm per registered state on `awaitBossReply.on.BOSS_REPLY`, each guarded on `context.pendingBossQuestion?.resumeStateId === '<id>'` and targeting `'#<id>'` with `reenter: true`; register every Captain-invoking state id with it (analogous to `bossInterrupts(ids)`).",
    "Emit a `setPendingBossQuestion` helper — `assign({ pendingBossQuestion: <new>, bossReply: undefined })` — and use it on every `needsBossReply` arm; clearing `bossReply` here prevents a follow-up question from inheriting the prior answer.",
    "Emit a `clearBossReplyContext` helper — `assign({ pendingBossQuestion: undefined, bossReply: undefined })` — and use it on every transition out of `awaitBossReply` other than the resume arm, and on every non-`needsBossReply` outcome of a Captain-invoking state.",
    "Treat `awaitBossReply` as a quiescent state for the runtime's drive loop.",
    "Give `awaitBossReply` the standard `bossInterrupts(ids)` handler with `actions: clearBossReplyContext`, so a Boss interrupt event abandons a pending question.",
    "Re-declare the machine's root-level Boss entry events on `awaitBossReply` with `actions: clearBossReplyContext`, so a fresh Boss directive while waiting starts a fresh turn and clears stale context.",
    "In a Captain-invoking state's `invoke.input` function, carry the `pendingBossQuestion` and `bossReply` fields when present so the linked runtime can compose the continuation prompt.",
    "When both `pendingBossQuestion` and `bossReply` are present, let the linked runtime compose the continuation preamble and labelled Q&A blocks per link.md \"Player prompt composition\".",
    "Do not bake the continuation preamble into the GEARS-derived `prompt` body.",
    "Route these malformed states to `failed`: Captain output has `guard: 'needsBossReply'` but no `question` field; Captain output declares `needsBossReply` from a state not registered with `resumableStates(ids)`; `BOSS_REPLY` fired with an empty or whitespace-only `answer`.",
    "Declare on every `invoke` an `onError` handler that routes to a dedicated `failed` state and captures the error in `context.lastError` for inspection; `failed` is not `final`, so Boss may interrupt out of it to recover.",
    "Declare at least one `type: 'final'` state (typically `done`) reachable on completion; a never-terminating machine is a defect because the runner has no completion signal.",
].join('\n');

/**
 * Standard adjudicator-facing description for the `needsBossReply` guard.
 * Carries the load-bearing substring ``Output shall include `question:`` so the
 * runtime's adjudicator requires `question` in the JSON reply.
 */
const NEEDS_BOSS_REPLY_DESCRIPTION: string =
    "The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.";

// ---------------------------------------------------------------------------
// Small typed accessors for actor-lifecycle events (kept local to this file)
// ---------------------------------------------------------------------------

function outputOf(event: unknown): CaptainOutput {
    return (event as DoneActorEvent<CaptainOutput>).output;
}

function errorOf(event: unknown): unknown {
    return (event as { error?: unknown }).error;
}

// ---------------------------------------------------------------------------
// Boss-surface helpers (emitted once, reused per registered id)
// ---------------------------------------------------------------------------

/** Every jumpable state id a BOSS_INTERRUPT may target. */
const INTERRUPT_TARGET_IDS = ['ready', 'transform'] as const;

/** Every captain-invoking state id registered for Boss-reply resume. */
const RESUMABLE_STATE_IDS = ['transform'] as const;

/**
 * One guarded BOSS_INTERRUPT arm per jumpable state, each targeting `#<id>`
 * with `reenter: true` so the invoked actor restarts cleanly.
 */
function bossInterrupts(ids: readonly string[], extraActions: readonly string[] = []) {
    return ids.map((id) => ({
        guard: { type: 'isInterruptTarget' as const, params: { id } },
        target: `#${id}`,
        reenter: true as const,
        ...(extraActions.length > 0 ? { actions: [...extraActions] } : {}),
    }));
}

/**
 * One BOSS_REPLY resume arm per registered captain-invoking state, guarded on
 * `context.pendingBossQuestion?.resumeStateId === '<id>'` and targeting `#<id>`
 * with `reenter: true`. Captures the Boss answer into `bossReply` and keeps
 * `pendingBossQuestion` so the resumed state can compose its continuation.
 */
function resumableStates(ids: readonly string[]) {
    return ids.map((id) => ({
        guard: { type: 'isResumeTarget' as const, params: { id } },
        target: `#${id}`,
        reenter: true as const,
        actions: ['applyBossReply'],
    }));
}

// ---------------------------------------------------------------------------
// Setup: types, the placeholder Captain actor, guards, and actions
// ---------------------------------------------------------------------------

/**
 * Placeholder Captain actor. It has the typed CaptainInput -> CaptainOutput
 * contract but no concrete implementation: it fails explicitly so a runner that
 * forgets to provide the real actor cannot silently no-op.
 */
const captainPlaceholder = fromPromise<CaptainOutput, CaptainInput>(async () => {
    throw new Error('captain actor must be provided by the runner');
});

const machineSetup = setup({
    types: {
        context: {} as TransformContext,
        events: {} as TransformEvent,
        input: {} as TransformInput,
    },
    actors: {
        captain: captainPlaceholder,
    },
    guards: {
        isInterruptTarget: ({ event }, params: { id: string }) =>
            event.type === 'BOSS_INTERRUPT' && event.targetId === params.id,
        isResumeTarget: ({ context }, params: { id: string }) =>
            context.pendingBossQuestion?.resumeStateId === params.id,
        isEmptyAnswer: ({ event }) =>
            event.type === 'BOSS_REPLY' && event.answer.trim().length === 0,
    },
    actions: {
        // Populate context from a Boss entry event (dedicated action).
        applyBossEntry: assign(({ event }) => {
            if (event.type !== 'START') return {};
            return event.request ? { request: event.request } : {};
        }),
        // Capture the Boss answer for the resumed state's continuation prompt.
        applyBossReply: assign(({ event }) => {
            if (event.type !== 'BOSS_REPLY') return {};
            return { bossReply: event.answer };
        }),
        // Persist the discriminated result for inspection only.
        rememberResult: assign({
            lastResult: ({ event }) => outputOf(event),
        }),
        rememberCaptainError: assign({
            lastError: ({ event }) => errorOf(event),
        }),
        // Suspend for a Boss reply: record the pending question and clear any prior answer.
        setPendingBossQuestion: assign(
            ({ event }, params: { resumeStateId: string; sourceItem: string; player: string }) => ({
                pendingBossQuestion: {
                    resumeStateId: params.resumeStateId,
                    sourceItem: params.sourceItem,
                    player: params.player,
                    question: String(outputOf(event).question ?? ''),
                },
                bossReply: undefined,
            }),
        ),
        // Abandon any pending Boss question.
        clearBossReplyContext: assign({
            pendingBossQuestion: () => undefined,
            bossReply: () => undefined,
        }),
    },
});

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const gears2fsmMachine = machineSetup.createMachine({
    id: 'gears2fsm',
    initial: 'ready',
    context: ({ input }) => ({
        players: input.players,
        request: input.request,
        lastResult: undefined,
        lastError: undefined,
        pendingBossQuestion: undefined,
        bossReply: undefined,
    }),
    // Boss interrupts pre-empt any active state and jump to a stable id.
    on: {
        BOSS_INTERRUPT: bossInterrupts(INTERRUPT_TARGET_IDS),
    },
    states: {
        // Quiescent idle hub — no invoke, so construction/start performs no player call.
        ready: {
            id: 'ready',
            description: 'Quiescent idle hub; waits for a Boss entry event before any player call.',
            on: {
                START: { target: '#transform', actions: 'applyBossEntry' },
            },
        },

        // The single captain-invoking state; realizes GEARS item G2F-1.
        transform: {
            id: 'transform',
            description: 'Captain carries out the GEARS-to-FSM transformation specified by G2F-1.',
            invoke: {
                src: 'captain',
                input: ({ context }): CaptainInput => ({
                    player: 'Captain',
                    sourceItem: 'G2F-1',
                    prompt: G2F_1_PROMPT,
                    result: {
                        transformed:
                            'Captain produced the XState v5 finite state machine object artifact as specified.',
                        needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
                    },
                    ...(context.request
                        ? { source: context.request.source, target: context.request.target }
                        : {}),
                    ...(context.pendingBossQuestion
                        ? { pendingBossQuestion: context.pendingBossQuestion }
                        : {}),
                    ...(context.bossReply !== undefined ? { bossReply: context.bossReply } : {}),
                }),
                onDone: [
                    // Valid Boss-reply suspension: needsBossReply carrying a question.
                    {
                        guard: ({ event }) =>
                            outputOf(event).guard === 'needsBossReply' &&
                            typeof outputOf(event).question === 'string' &&
                            (outputOf(event).question as string).trim().length > 0,
                        target: '#awaitBossReply',
                        actions: [
                            'rememberResult',
                            {
                                type: 'setPendingBossQuestion',
                                params: {
                                    resumeStateId: 'transform',
                                    sourceItem: 'G2F-1',
                                    player: 'Captain',
                                },
                            },
                        ],
                    },
                    // Malformed: needsBossReply without a question -> failed.
                    {
                        guard: ({ event }) => outputOf(event).guard === 'needsBossReply',
                        target: '#failed',
                        actions: ['rememberResult', 'clearBossReplyContext'],
                    },
                    // Success: transformation complete -> terminate.
                    {
                        guard: ({ event }) => outputOf(event).guard === 'transformed',
                        target: '#done',
                        actions: ['rememberResult', 'clearBossReplyContext'],
                    },
                    // Any other guard is out of contract (malformed) -> failed.
                    {
                        target: '#failed',
                        actions: ['rememberResult', 'clearBossReplyContext'],
                    },
                ],
                onError: {
                    target: '#failed',
                    actions: ['rememberCaptainError', 'clearBossReplyContext'],
                },
            },
        },

        // Third Boss surface: suspend here until Boss answers, then resume the same state.
        awaitBossReply: {
            id: 'awaitBossReply',
            description: 'Waiting for Boss to answer a player question.',
            on: {
                BOSS_REPLY: [
                    // Empty or whitespace-only answer is malformed -> failed.
                    {
                        guard: 'isEmptyAnswer',
                        target: '#failed',
                        actions: 'clearBossReplyContext',
                    },
                    // Resume the suspended captain-invoking state with the Q+A available.
                    ...resumableStates(RESUMABLE_STATE_IDS),
                ],
                // A Boss interrupt abandons the pending question.
                BOSS_INTERRUPT: bossInterrupts(INTERRUPT_TARGET_IDS, ['clearBossReplyContext']),
                // A fresh Boss directive starts a new turn and clears stale context.
                START: { target: '#transform', actions: ['clearBossReplyContext', 'applyBossEntry'] },
            },
        },

        // Recoverable error hub: not final; Boss may recover via entry event or interrupt.
        failed: {
            id: 'failed',
            description: 'A captain invocation or Boss reply failed; recoverable via a Boss directive.',
            on: {
                START: { target: '#transform', actions: 'applyBossEntry' },
            },
        },

        // Completion signal for the runner.
        done: {
            id: 'done',
            type: 'final',
            description: 'Transformation complete.',
        },
    },
});

export { bossInterrupts, resumableStates };
export default gears2fsmMachine;

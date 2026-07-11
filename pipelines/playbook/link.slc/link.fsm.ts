// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// FSM object artifact compiled from link.gears.md (GEARS-to-Finite-State-Machine phase).
// This module defines the machine, actor contracts, and typed inputs only.
// It binds no runner and supplies no concrete Captain implementation; the runner
// provides the `captain` actor via `.provide(...)`.

import { setup, assign, fromPromise } from 'xstate';

/**
 * Provenance record for a suspended captain-invoking state that surfaced a
 * clarifying question for Boss. `resumeStateId`, `sourceItem`, and `player`
 * come from the suspended state's invocation metadata; only `question` comes
 * from adjudicated player output.
 */
export interface PendingBossQuestion {
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

/** Persistent, typed machine context. */
export interface LinkContext {
  /** Per-run binding for the Captain player; copied from machine input, never baked in. */
  captainBinding?: string;
  /** The Boss transformation request that started the current turn. */
  bossRequest?: string;
  /** Last captain-invocation error, captured for inspection when routing to `failed`. */
  lastError?: unknown;
  /** Set while suspended in `awaitBossReply`; provenance per PendingBossQuestion. */
  pendingBossQuestion?: PendingBossQuestion;
  /** Boss's answer to a pending question; consumed by the resumed state's prompt. */
  bossReply?: string;
}

/** Boss-originated events. Entry events are typed alongside BOSS_INTERRUPT. */
export type LinkEvent =
  | { type: 'START_LINK'; request: string }
  | { type: 'BOSS_INTERRUPT'; targetId: string }
  | { type: 'BOSS_REPLY'; answer: string };

/** Per-run parameters supplied by the runner at actor construction. */
export interface LinkInput {
  /** Concrete binding for the Captain player; the artifact bakes in none. */
  captain?: string;
}

/** Typed input passed to the `captain` actor at each invocation. */
export interface CaptainInput {
  /** The player Captain is to invoke. */
  player: string;
  /** The GEARS item ID this state realizes. */
  sourceItem: string;
  /** The source item's full final prompt, verbatim. */
  prompt: string;
  /** Valid guard names this invocation may return, keyed to their descriptions. */
  result: Record<string, string>;
  /** The Boss transformation request, surfaced to the linked runtime's prompt composer. */
  bossRequest?: string;
  /** Present when resuming after a Boss reply, so the runtime can compose the continuation prompt. */
  pendingBossQuestion?: PendingBossQuestion;
  /** Present when resuming after a Boss reply. */
  bossReply?: string;
}

/** Discriminated result Captain returns; `guard` is one of the state's `result` keys. */
export interface CaptainOutput {
  guard: string;
  /** Verbatim question text, extracted when `guard === 'needsBossReply'`. */
  question?: string;
}

/**
 * Adjudicator-facing description for the `needsBossReply` outcome that every
 * captain-invoking state carries. Includes the load-bearing substring
 * ``Output shall include `question:`` so the runtime's adjudicator requires
 * `question` in the JSON reply.
 */
const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.";

/**
 * LINK-10's full final prompt, verbatim (the GEARS blockquote body, one line
 * per array element). Not mutated, re-flowed, concatenated, or deduped.
 */
const LINK_10_PROMPT: string[] = [
  "Compile the FSM artifact into a `PlaybookRuntime`: a host-agnostic runner that drives the FSM, classifies Boss input into typed events, runs the Captain-actor against the playbook's players, adjudicates player output into FSM guards, and surfaces transitions as status/telemetry.",
  'Do not modify the FSM artifact.',
  'Do not re-derive or define Captain/player prompts, result keys, or guard semantics — those are fixed by the FSM and belong to the GEARS source and the FSM artifact.',
  "Emit exactly one TypeScript module that runs unchanged under any host implementing `PlaybookPorts`; the host's identity does not enter compilation.",
  'The runtime holds no host-specific types and no host primitive calls, never speaks to LLMs directly, and never touches host types beyond `PlaybookPorts`.',
  'Default-export a factory `createPlaybookRuntime(options: PlaybookRuntimeOptions): PlaybookRuntime` conforming to `PlaybookRuntimeFactory<PlaybookRuntimeOptions>` (the generic factory type the shared contract module exposes), where `PlaybookRuntime` provides `init(ports: PlaybookPorts): Promise<void>`, `handleBossInput(turn: { text: string; signal: AbortSignal }): Promise<void>`, and `dispose(): Promise<void>`.',
  "In `init`, receive the host's ports, construct the XState actor with FSM `input` derived from `options`, and start the actor.",
  'The runtime owns the actor for its lifetime; `handleBossInput` runs one turn; `dispose` stops the actor and drains pending port emissions.',
  "Make `PlaybookRuntimeOptions` host-agnostic, carrying only per-run knobs such as identity strings (e.g. model names a playbook substitutes into prompt placeholders) and the strategy overrides the linker exposes; emit this typed options interface per playbook based on the FSM's `CodingInput` (or equivalent).",
  'Bake the player binding into the emitted runtime as a linker-time input by default; a linker may also expose it via `PlaybookRuntimeOptions` for per-run remapping, but the runtime must ship with a deterministic binding it applies at every `callPlayer` site.',
  "Drive the runtime solely through the `PlaybookPorts` contract: `callPlayer(playerId: string, prompt: string, signal: AbortSignal): Promise<PlayerResult>`, `callJudge(prompt: string, signal: AbortSignal): Promise<string>`, `emitStatus(message: string, data?: unknown): Promise<void>`, and `emitTelemetry(event: { topic: string; payload: unknown }): Promise<void>`, where `PlayerResult` is `{ status: 'ok' | 'aborted' | 'error'; finalText?: string; error?: string }`.",
  "Treat a `callPlayer` result with `status !== 'ok'` as a player failure and route it through the FSM's error path.",
  "`callJudge` returns free-form text; parse it per the state's adjudication strategy; one port serves both classifier and adjudicator, varying only in prompt.",
  '`emitStatus` is human-readable and `emitTelemetry` is structured; both are async, ordered, awaited, and never-dropped — await each emission before issuing the next.',
  'Accept as linker inputs: the FSM artifact (path to a `.fsm.ts`); a player binding mapping GEARS players (declared in the text2gears source) to opaque player-identifier strings; an adjudication strategy (default LLM-judge per state); and a Boss-event mapping (default free-text judge classification) — both strategies host-agnostic.',
  'Where no player binding is supplied, apply the default binding — each player to its lowercased name (e.g. `Coder` → `coder`) — and record the applied binding in the emitted header.',
  'Each GEARS state names exactly one player (`invoke.input.player`); map every named player to a `playerId` string used in `PlaybookPorts.callPlayer(playerId, …)`, which the host adapter routes to its concrete primitive.',
  "For composite players declared with aliases (e.g. `Committer = Coder | Reviewer`), resolve the alias per source item by inspecting the `CaptainInput` fields populated at that state: if only one `<playerName>Player` field is present, bind to that player; if multiple are present, prefer the first-listed alternative in alias declaration order; if none are present, fall back to the alias's first alternative.",
  'Make alias resolution deterministic and record it in the emitted module so future maintainers can audit it without re-running the linker.',
  "Do not invent player identifiers beyond the recorded default binding, and do not silently collapse aliases at the FSM level — composite players keep their `player: 'Committer'` value on `CaptainInput`; resolution decides only the `callPlayer` invocation.",
  "Compose the actual player prompt from the state's `CaptainInput`.",
  'Treat `input.prompt` as the GEARS-derived domain prompt body; do not mutate, re-flow, or use it to store framework control instructions.',
  'The composer may prepend structured labelled blocks from typed `CaptainInput` fields the FSM exposes (for example `Boss intent:`, `Review items:`, `Rebuttals:`, or `Task description:`); those blocks are outside the domain prompt body.',
  "Do not inject a player-visible Boss-question instruction; Boss-question detection is adjudicator-facing and comes from the state's `needsBossReply` result description, not from extra prompt text.",
  'When `CaptainInput` carries both `pendingBossQuestion` and `bossReply`, prepend — before ordinary structured blocks and before the domain prompt body — the continuation preamble `You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.` followed by labelled Q&A blocks: a `Boss question:` label with `<pendingBossQuestion.question>`, then a `Boss reply:` label with `<bossReply>`.',
  'Supply the continuation preamble as framework text from the runtime; it is not part of the GEARS blockquote and shall not appear in `invoke.input.prompt`.',
  "The FSM's `events` union enumerates every Boss-originated event; receive Boss input as a free-form string (`handleBossInput.text`) and classify each non-empty turn into one of the FSM's events plus its payload, or no FSM action, by invoking `callJudge`.",
  'Empty or whitespace-only text produces no event and no port call.',
  "The classifier prompt shall demand JSON against the FSM's typed event union and any state-specific Boss input contract, including the payload fields required for each event.",
  "Keep every field that the FSM's event union declares optional as optional in both the classifier contract and the reply parser; do not promote optional event fields to required.",
  'When the FSM supports a Boss-reply suspension state, include in the classifier prompt the current state and the pending Boss question so the judge can distinguish a reply from a fresh directive.',
  'Do not define slash-prefix commands for states or features inside the playbook; the `/command` namespace is reserved for host-level or playbook-selection UX before a turn reaches `handleBossInput`.',
  'If a host forwards text beginning with `/` to `handleBossInput`, treat it as ordinary Boss text and classify it through `callJudge`.',
  'The runtime assumes hosts resolve host-level (structured/control) concerns before choosing a playbook runtime; once `handleBossInput` is called it receives the Boss content as text, and the runtime does not rely on pre-classified in-playbook FSM events or on slash forms as a runtime protocol.',
  "Reach `BOSS_INTERRUPT` (or the FSM's equivalent explicit-state-jump event) only by the judge choosing it and supplying its required target payload; it is not an abort surface (aborts go through the abort signal and the abort strategies below), and hosts where the abort signal is terminal (e.g. SIGINT runs shutdown) do not route abort to `BOSS_INTERRUPT`.",
  "After a player call returns, coerce `result.finalText` into one of the per-state `invoke.input.result` keys, and extract any payload fields the state's `result` description names as required.",
  'The default adjudication strategy is LLM-judge for every state; the linker may select different strategies per state. Two default strategies, in selection order:',
  "- LLM-judge (default): construct a fresh `callJudge` prompt that names the source item's player, includes the player's verbatim output, lists the `result` keys with their descriptions, and demands a JSON `{ guard, …payloadFields }` answer keyed to exactly one of the declared guards; the judge prompt shall not interpret the player's output, paraphrase it, or alter the FSM's `result` text — carry the description verbatim.",
  '- Marker-parse (alternative): a deterministic parser that scans the player output for a terminal control line such as `FSM-RESULT: { "guard": "...", ... }`; useful when player adapters can be steered to emit structured trailers and the operator wants to avoid the extra LLM call.',
  "Make the adjudicator fail loudly on: a guard the state does not declare; a missing payload field the state's `result` description requires; or an empty / malformed response.",
  'Treat adjudicator failures as control-plane errors: propagate them by throwing out of `handleBossInput` after attempting cleanup; the host adapter surfaces the throw on its control-plane channel.',
  "Reserve the host's player-result channels (`player_finished` and equivalents) for failures the player itself produced; the host emits them when `callPlayer` resolves with `status !== 'ok'`.",
  'In `init`, construct the session-scoped (not turn-scoped) XState actor with FSM `input` derived from `options`, subscribe to actor snapshots so each transition can be surfaced via `emitStatus` and `emitTelemetry` before the next event fires, and start the actor.',
  "Per `handleBossInput`: (1) classify `turn.text` through the Boss-event mapping and, if it produces no event, return after draining any port emissions; (2) if the actor is in a `final` state, dispose and reconstruct it (final is terminal and cannot accept new events); (3) send the classified event to the actor; (4) drive to quiescence — each time the actor invokes its `captain` actor, await the invoke's input, build a player prompt, call `callPlayer`, adjudicate, and resolve the invoke — repeating until the actor's snapshot value is a state that takes a Boss event (typically `ready` or `failed`) or a `final` state.",
  'In `dispose`, stop the actor and drain pending port emissions.',
  "Surface the actor's `lastError` field via `emitStatus` when the machine enters its `failed` state.",
  '`handleBossInput.signal` is the abort surface; honor it at every `callPlayer`/`callJudge` and at every poll between transitions; on abort, drive the actor to a quiescent state before returning from the turn.',
  'Select per FSM one of three permitted abort strategies:',
  "- Natural rejection: the Captain actor (e.g. `fromPromise`) ends the invocation by rejecting and the FSM routes the rejection through `onError` to a quiescent sink; the cancelled port call may itself reject or may resolve with `PlayerResult { status: 'aborted' | 'error' }` that the runtime inspects and converts into a Captain-actor rejection (the contract is on the Captain-actor boundary, not the port's promise behavior); preferred when every Captain-invoking state's `onError` lands somewhere quiescent.",
  "- Synthetic pre-emption to a quiescent target: send the FSM's pre-emption event (e.g. `BOSS_INTERRUPT { targetId: <state> }`) with a target that is itself quiescent (typically `ready` or `failed`); do not pick the active state as the target, because gears2fsm prescribes `reenter: true` for `bossInterrupts`, so re-entering the active state restarts its `invoke` and spawns a fresh player call.",
  '- Programmatic stop: `actor.stop()` and report the turn as aborted via `emitStatus`; reserved for FSMs with neither `onError` wiring nor a pre-emption event.',
  "Whether the host's outer abort (e.g. SIGINT) is recoverable or terminal is the host's concern; exit `handleBossInput` cleanly in either case and let the host decide whether to call `dispose` afterward.",
  'Emit at minimum one `emitStatus` per Boss-relevant transition (entering a state whose semantics matter to Boss — e.g. `respondToReview`, `failed`); default to emitting on every transition and letting the host filter (hosts may bind a stricter rule).',
  'Emit at minimum one `emitTelemetry` per state transition under a namespaced topic (recommended `playbook.fsm.state`) with payload `{ from, to, event }`; the runtime never interprets the topic.',
  "Player prompts and adjudicator JSON ride the host's own record channels when the host has them; do not duplicate them into `emitTelemetry`.",
  'Import the FSM artifact by relative path with an extension-bearing specifier that resolves to a file sitting beside the emitted module (e.g. `./code.fsm.ts`, or `./code.fsm.js` where a compiled module ships), so the module loads without a build step.',
  'Restrict the emitted module to erasable TypeScript syntax — type annotations that strip cleanly, with no constructor parameter properties, `enum`s, or namespaces — so a host running under type stripping loads it directly.',
  "Import XState's actor primitives (`createActor`, `fromPromise`, and `setup`'s `.provide`).",
  'Export `createPlaybookRuntime` and the typed `PlaybookRuntimeOptions` interface for that playbook.',
  'Expose, under an `_internal` export, the pure helpers verification needs — at least the player-prompt composer (`composePlayerPrompt`) — so compilation-correctness tests can exercise composition without a host.',
  'Record the linker inputs (FSM path, player binding, strategies) in a top-of-file header comment so the file is reproducible from the same inputs.',
  'Source the contract types (`PlayerResult`, `PlaybookPorts`, `PlaybookRuntime`, `PlaybookRuntimeFactory`) from a single shared type-only module instead of redefining them, and re-export the names its consumers import, so every linked playbook shares one contract definition; the shared module imports no FSM or host types, so the dependency runs one way — from each linked module to the shared contract, never the reverse.',
  'The host adapter shall speak only `PlaybookPorts` to the runtime and shall not leak host types back into it.',
  'Keep out of scope: defining player prompts, result keys, or guard semantics (they belong to the GEARS source and FSM artifact); host adapter implementations, host configuration, or presentation layouts (this only constrains the `PlaybookPorts` contract they satisfy); and persisting FSM context across sessions, multi-Boss orchestration, or visualizer rendering — new behavior in any of these areas requires a separate slc spec.',
];

/** The verbatim LINK-10 prompt body, one blockquote line per row. */
const linkPrompt = LINK_10_PROMPT.join('\n');

/**
 * Every captain-invoking state id, registered for Boss-reply resumption.
 * Analogous to INTERRUPT_IDS; kept in sync with the states that invoke `captain`.
 */
const RESUMABLE_IDS = ['linking'] as const;

/** Jumpable state ids a `BOSS_INTERRUPT` may target (quiescent recovery hubs and active states). */
const INTERRUPT_IDS = ['ready', 'linking', 'failed'] as const;

/** Named actions declared in the machine setup. */
type LinkActionName =
  | 'startLink'
  | 'setPendingBossQuestion'
  | 'assignBossReply'
  | 'clearBossReplyContext'
  | 'rememberCaptainError';

/** One transition object produced by a Boss-control helper. */
interface GuardedArm {
  guard: (args: { context: LinkContext; event: LinkEvent }) => boolean;
  target: string;
  reenter: true;
  actions?: LinkActionName;
}

/**
 * Emit one guarded `BOSS_INTERRUPT` arm per jumpable state, each targeting
 * `#<id>` with `reenter: true` so the invoked actor restarts cleanly.
 * Declared at the root; re-declared on `awaitBossReply` with a clearing action.
 */
function bossInterrupts(
  ids: readonly string[],
  actions?: LinkActionName,
): GuardedArm[] {
  return ids.map((id) => ({
    guard: ({ event }) =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === id,
    target: `#${id}`,
    reenter: true,
    ...(actions ? { actions } : {}),
  }));
}

/**
 * Emit one guarded `BOSS_REPLY` arm per registered captain-invoking state,
 * each guarded on `context.pendingBossQuestion?.resumeStateId === '<id>'`
 * (and a non-empty answer) and targeting `#<id>` with `reenter: true`.
 * The matching arm records `bossReply` before resuming.
 */
function resumableStates(ids: readonly string[]): GuardedArm[] {
  return ids.map((id) => ({
    guard: ({ context, event }) =>
      event.type === 'BOSS_REPLY' &&
      event.answer.trim() !== '' &&
      context.pendingBossQuestion?.resumeStateId === id,
    target: `#${id}`,
    reenter: true,
    actions: 'assignBossReply',
  }));
}

export const linkMachine = setup({
  types: {
    context: {} as LinkContext,
    events: {} as LinkEvent,
    input: {} as LinkInput,
  },
  actors: {
    // Typed Captain actor contract. The placeholder fails explicitly; the
    // runner supplies the concrete implementation via `.provide(...)`.
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  actions: {
    /** Start/restart a turn from a Boss entry event: record the request, clear stale Q&A. */
    startLink: assign({
      bossRequest: ({ event }) =>
        event.type === 'START_LINK' ? event.request : undefined,
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
    /** Suspend for a Boss reply: provenance from the suspended state, question from output. */
    setPendingBossQuestion: assign({
      pendingBossQuestion: ({ event }) => {
        const output = (event as { output?: CaptainOutput }).output;
        return {
          resumeStateId: 'linking',
          sourceItem: 'LINK-10',
          player: 'Captain',
          question: output?.question ?? '',
        };
      },
      bossReply: undefined,
    }),
    /** Record the Boss answer so the resumed state's prompt can read it. */
    assignBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
    }),
    /** Clear pending Q&A on any non-resume exit from a wait, and on non-needsBossReply outcomes. */
    clearBossReplyContext: assign({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
    /** Capture a captain-invocation error for inspection. */
    rememberCaptainError: assign({
      lastError: ({ event }) => (event as { error?: unknown }).error,
    }),
  },
}).createMachine({
  id: 'link',
  initial: 'ready',
  context: ({ input }) => ({ captainBinding: input.captain }),
  states: {
    ready: {
      id: 'ready',
      description: 'Idle hub awaiting a Boss transformation request.',
      on: {
        START_LINK: { target: 'linking', actions: 'startLink' },
      },
    },

    linking: {
      id: 'linking',
      description:
        'Captain carries out the FSM-to-Runtime link transformation specified by LINK-10.',
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          player: 'Captain',
          sourceItem: 'LINK-10',
          prompt: linkPrompt,
          result: {
            completed:
              'Captain has carried out the transformation and emitted the PlaybookRuntime module.',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          bossRequest: context.bossRequest,
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
        }),
        onDone: [
          {
            // Player surfaced a clarifying question with verbatim text: suspend.
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              typeof event.output.question === 'string' &&
              event.output.question.trim() !== '',
            target: 'awaitBossReply',
            actions: 'setPendingBossQuestion',
          },
          {
            // Malformed: guard is needsBossReply but no usable question.
            guard: ({ event }) => event.output.guard === 'needsBossReply',
            target: 'failed',
            actions: 'clearBossReplyContext',
          },
          {
            // Transformation complete: terminate.
            guard: ({ event }) => event.output.guard === 'completed',
            target: 'done',
            actions: 'clearBossReplyContext',
          },
        ],
        onError: { target: 'failed', actions: 'rememberCaptainError' },
      },
    },

    awaitBossReply: {
      id: 'awaitBossReply',
      description: 'Waiting for Boss to answer a player question.',
      on: {
        BOSS_REPLY: [
          {
            // Malformed: empty / whitespace-only answer.
            guard: ({ event }) =>
              event.type === 'BOSS_REPLY' && event.answer.trim() === '',
            target: 'failed',
            actions: 'clearBossReplyContext',
          },
          ...resumableStates(RESUMABLE_IDS),
        ],
        // A Boss interrupt while waiting abandons the pending question.
        BOSS_INTERRUPT: bossInterrupts(INTERRUPT_IDS, 'clearBossReplyContext'),
        // A fresh Boss directive while waiting starts a new turn and clears stale context.
        START_LINK: { target: 'linking', actions: 'startLink' },
      },
    },

    failed: {
      id: 'failed',
      description:
        'A captain invocation failed; recoverable via a Boss interrupt or a fresh request.',
      on: {
        START_LINK: { target: 'linking', actions: 'startLink' },
      },
    },

    done: {
      id: 'done',
      type: 'final',
      description:
        'The link transformation completed and the PlaybookRuntime module was emitted.',
    },
  },
  on: {
    // Boss may pre-empt any active state; one guarded, reentering arm per jumpable id.
    BOSS_INTERRUPT: bossInterrupts(INTERRUPT_IDS),
  },
});

export default linkMachine;

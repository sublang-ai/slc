// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// GEARS-to-FSM artifact for the `text2gears` playbook.
// Compiled from text2gears.gears.md (T2G-1).
// Object artifact only: it defines the machine, the typed Captain actor
// contract, and typed inputs. It binds no runner and supplies no concrete
// Captain implementation; the runner provides `captain` via `.provide(...)`.

import { assign, fromPromise, setup } from 'xstate';

// ---------------------------------------------------------------------------
// Actor contract
// ---------------------------------------------------------------------------

/**
 * A clarifying question the acting agent raised that only Boss can answer.
 * `questionId` and `resumeStateId` both equal the suspended working leaf's
 * stable `stateId`; `player` is the literal `Captain` for a direct-Captain
 * state.
 */
export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

/**
 * Input handed to the Captain actor for one invocation.
 * `result` keys are the valid guard names this invocation may return; they are
 * authoritative *per state*, not a global union. There is no `player` field: a
 * direct-Captain state never carries an invented `Captain` player binding.
 */
export interface CaptainInput {
  stateId: string;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  /** Present on resume so the runtime can compose the continuation prompt. */
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

/**
 * Discriminated Captain result: one literal `guard` member per authored result
 * key plus the universal `needsBossReply`, each carrying exactly the payload its
 * guard requires. A catch-all `guard: string` shape would be malformed.
 */
export type CaptainOutput =
  | { guard: 'compiled' }
  | { guard: 'unrepresentable' }
  | { guard: 'needsBossReply'; question: string };

// ---------------------------------------------------------------------------
// Machine context / events / input
// ---------------------------------------------------------------------------

export interface Text2gearsContext {
  /** Inspection-only snapshot of the last Captain result. Never branched on. */
  lastResult?: CaptainOutput;
  /** Inspection-only capture of the last error that routed to `failed`. */
  lastError?: unknown;
  /** Set while suspended in `awaitBossReply`. */
  pendingBossQuestion?: PendingBossQuestion;
  /** Boss's answer, carried into the resumed state's continuation prompt. */
  bossReply?: string;
}

/**
 * Boss surfaces:
 * - `COMPILE` — typed entry event on idle/recoverable states that starts a
 *   fresh transformation; the source declares no per-run parameters, so it
 *   carries no payload.
 * - `BOSS_INTERRUPT` — pre-emptive jump into an active state by stable id.
 * - `BOSS_REPLY` — Boss's answer to a suspended acting-agent question; the
 *   scalar form fills the sole pending id when `questionId` is omitted.
 */
export type Text2gearsEvent =
  | { type: 'COMPILE' }
  | { type: 'BOSS_INTERRUPT'; targetId: string }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

/**
 * Per-run parameters copied into context at start-up. The single T2G-1 prompt
 * establishes no runtime-value placeholders, declares no players, and the
 * machine makes no dynamic playbook call, so no fields are required here.
 */
export type Text2gearsInput = Record<string, never>;

// ---------------------------------------------------------------------------
// Standard adjudicator-facing description for the Boss-reply suspension path.
// Carries the load-bearing substring `Output shall include \`question:` so the
// runtime's adjudicator requires `question` in the JSON reply.
// ---------------------------------------------------------------------------

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// ---------------------------------------------------------------------------
// State-id registries for the Boss-control helpers.
// ---------------------------------------------------------------------------

/** Jumpable targets for `BOSS_INTERRUPT` (active work + quiescent sinks). */
const INTERRUPT_IDS = ['ready', 'compile', 'failed'] as const;

/** Every captain-invoking state can suspend for a Boss reply and resume. */
const RESUMABLE_IDS = ['compile'] as const;

// ---------------------------------------------------------------------------
// Boss-control transition helpers (emitted, not hand-written per state).
// ---------------------------------------------------------------------------

/**
 * Parameterless registered action names, usable as bare-string references; kept
 * as literals so helpers never widen to `string`. (`setPendingBossQuestion`
 * takes params and is referenced only via the `{ type, params }` object form.)
 */
type SimpleActionName =
  | 'startTransform'
  | 'captureBossReply'
  | 'clearBossReplyContext'
  | 'recordEmptyReply';

/**
 * One guarded `BOSS_INTERRUPT` arm per jumpable state, targeting `#<id>` with
 * `reenter: true` so the invoked actor restarts cleanly. Optional `extraActions`
 * run before the jump (used on `awaitBossReply` to clear pending context).
 */
function bossInterrupts(
  ids: readonly string[],
  extraActions: readonly SimpleActionName[] = [],
) {
  return {
    BOSS_INTERRUPT: ids.map((id) => ({
      guard: { type: 'isInterruptTarget' as const, params: { id } },
      target: `#${id}`,
      reenter: true,
      actions: [...extraActions],
    })),
  };
}

/**
 * One `BOSS_REPLY` arm per registered captain-invoking state, guarded on the
 * pending question's `resumeStateId` and targeting `#<id>` with `reenter: true`.
 * `captureBossReply` records the answer so the resumed state's `invoke.input`
 * carries it; pending context is intentionally NOT cleared on the resume arm.
 */
function resumableStates(ids: readonly string[]) {
  return {
    BOSS_REPLY: ids.map((id) => ({
      guard: { type: 'isResumeTarget' as const, params: { id } },
      target: `#${id}`,
      reenter: true,
      actions: ['captureBossReply' as const],
    })),
  };
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const text2gearsMachine = setup({
  types: {
    context: {} as Text2gearsContext,
    events: {} as Text2gearsEvent,
    input: {} as Text2gearsInput,
  },
  actors: {
    // Typed placeholder: the runner must supply the real Captain via `.provide`.
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    isInterruptTarget: ({ event }, params: { id: string }) =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === params.id,
    isResumeTarget: ({ context, event }, params: { id: string }) =>
      event.type === 'BOSS_REPLY' &&
      event.answer.trim().length > 0 &&
      context.pendingBossQuestion?.resumeStateId === params.id,
    isEmptyBossReply: ({ event }) =>
      event.type === 'BOSS_REPLY' && event.answer.trim().length === 0,
  },
  actions: {
    /** Start a fresh Boss-initiated turn: reset inspection scratch. */
    startTransform: assign({
      lastResult: () => undefined,
      lastError: () => undefined,
    }),
    /** Suspend: record the pending question; clear any stale Boss answer. */
    setPendingBossQuestion: assign((_args, params: PendingBossQuestion) => ({
      pendingBossQuestion: params,
      bossReply: undefined,
    })),
    /** Capture Boss's answer for the continuation prompt on resume. */
    captureBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
    }),
    /** Drop pending-question context on any non-resume exit / normal outcome. */
    clearBossReplyContext: assign({
      pendingBossQuestion: () => undefined,
      bossReply: () => undefined,
    }),
    /** Record a malformed empty Boss reply for inspection in `failed`. */
    recordEmptyReply: assign({
      lastError: () =>
        new Error('BOSS_REPLY received an empty or whitespace-only answer.'),
    }),
  },
}).createMachine({
  id: 'text2gears',
  initial: 'ready',
  context: (): Text2gearsContext => ({
    lastResult: undefined,
    lastError: undefined,
    pendingBossQuestion: undefined,
    bossReply: undefined,
  }),
  // Root-level Boss interrupts: reachable from any active state.
  on: {
    ...bossInterrupts(INTERRUPT_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Idle; waiting for Boss to request a text-to-GEARS transformation.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Idle; waiting for Boss to request a text-to-GEARS transformation.',
        },
      },
      on: {
        COMPILE: {
          target: '#compile',
          actions: ['startTransform', 'clearBossReplyContext'],
        },
      },
    },

    compile: {
      id: 'compile',
      description:
        'Captain transforms the source procedure description into a package of normative GEARS spec items.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'compile',
          description:
            'Captain transforms the source procedure description into a package of normative GEARS spec items.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          stateId: 'compile',
          sourceItem: 'T2G-1',
          prompt: [
            "Transform the source's free-form natural-language procedure description into a package of normative GEARS spec items.",
            'Produce only GEARS spec items; the second phase that turns spec items into a state machine is out of scope.',
            'Write the target in the same language as the source.',
            'Follow GEARS item syntax for every emitted item: build each condition from GEARS clauses (optional `Where` static preconditions, optional `While` stateful preconditions, at most one `When` trigger) preceding the `shall` behavior.',
            'Deduplicate identical prompt lines when composing overlapping or duplicated source snippets.',
            "Make each spec item address one state behavior and carry its full final static prompt, so a human can simulate a run by copying any single item's prompt verbatim with no cross-item composition; cross-item duplication is acceptable because spec items are compiled artifacts while the source is what users maintain.",
            'Recognize two default players: Boss, the human user; and Captain, the coordinating agent.',
            'Read any additional players the source declares in an opening `Players:` section.',
            'Allow a player to alias other players with `=` and `|`, where Boss picks one at runtime (e.g., `Committer = Coder | Reviewer`).',
            'Capitalize English player names (e.g., `Writer`), and quote non-English player names (e.g., `作者`) when needed to distinguish them from prose.',
            'Give each spec item a condition, exactly one behavior kind, and the complete prompt for that behavior.',
            "Write every emitted item's heading in the exact Markdown form `### <ITEM-ID>`; a heading at `##`, `####`, or any other level is not GEARS item syntax and stays invisible to downstream compilers and verification.",
            'Use exactly one of these behavior kinds per item: direct Captain work written `Captain shall <behavior>:` without naming a delegated player; delegated player work written `Captain shall prompt <Player>:` or the existing `Captain shall relay ... to <Player> ...:` form; or a literal or dynamic nested playbook call.',
            'Treat direct Captain work as the coordinating Captain performing the behavior itself, and never rewrite it as `Captain shall prompt Captain`, because Captain is a distinct runtime actor rather than a player binding.',
            'For delegated work, name the declared player that receives the prompt.',
            'Blockquote every prompt, one point per line.',
            "Where the source already supplies the complete blockquoted acting prompt for a behavior, preserve those prompt lines exactly apart from resolving Markdown escapes, and do not promote surrounding conditions, invariants, result fields, or continuation mechanics into that blockquote; keep those requirements in the item's condition or `Results:` metadata.",
            'Do not add control-oriented prompt lines merely to restate conditions, invariants, or results, because that changes the Boss-visible contract and is nonconformant.',
            'Treat source statements that assign active-leaf routing, call identity, suspension, or return matching to the host as execution preconditions rather than behaviors for Captain to perform; use such a statement only as a condition on an actual behavior when needed, and never emit a standalone direct-Captain item that asks Captain to implement host stack bookkeeping.',
            "Treat a host-owned input catalog's immutability as a condition or invariant on the behaviors that consume the catalog, never as an LLM action that replaces or mutates host configuration.",
            'Keep opening source invariants that later behaviors consume explicit in the emitted conditions or prompts rather than summarizing them away.',
            "Preserve a structured host catalog's declared exact entry shape, and preserve any progress invariant that makes a decide-call-observe plan finite, such as `remainingPlan` containing only the calls after the selected call and strictly shrinking on continuation.",
            'Treat a source invariant that restricts a nested-call target to a non-empty member of an input catalog as a condition on that call item, not a separate Captain rejection behavior, unless the source requires an observable response distinct from taking or skipping the call.',
            'When a source behavior has more than one possible outcome, emit its machine-facing result contract immediately after the complete blockquote and outside the acting prompt, as a plain `Results:` label — not a heading — followed by bullets.',
            'Give each result exactly one bullet containing a backtick-delimited guard name, a colon, and a non-empty description.',
            'Match every guard name to the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`, keep guard names unique within the item, treat the bullet order as authoritative, and make each description name every required output property with its exact case-sensitive identifier.',
            "Where any later item's blockquote reads a produced value through a `<placeholder>`, make the item whose behavior produces that value declare a `Results:` contract whose relevant description names the produced output property using the placeholder's exact identifier, so the FSM can thread the value through typed context.",
            'For a single-outcome producer whose output a later item consumes, declare exactly one `Results:` bullet naming that property; this consumed-output case is the sole case in which a single-outcome behavior carries a `Results:` label.',
            'For a single-outcome behavior whose output no later item consumes, emit no `Results:` label and do not invent a one-bullet block, because gears2fsm gives its state the default single-outcome contract.',
            "Treat result metadata as compiler control data rather than part of the acting agent's prompt.",
            "Do not put guard names, result-property schema, JSON control instructions, or adjudicator instructions inside a blockquote unless the source explicitly requires the acting agent to show that machine syntax to the user; move the source's outcome contract into `Results:` while preserving the human domain instructions in the blockquote.",
            'Never emit the framework-owned `needsBossReply` result; gears2fsm adds that universal result for every Captain- or player-invoking state.',
            'Where the source restricts an initial Captain to routing, preserve only the authored question and delegation outcomes, and do not infer a direct-answer or terminal result merely because Captain is the acting agent.',
            "Where a direct-Captain or delegated-player behavior may ask Boss a question and wait, keep the question result, the wait, and the answer-dependent continuation on that same originating item even when Boss's answer changes its complete runtime prompt, because Boss's answer resumes that same behavior rather than starting a distinct one.",
            'Do not emit a second item solely for "Boss answers," "after the question," or clearing the consumed question or reply; the FSM and linker own the same-leaf suspension, continuation blocks, and consumed-context cleanup.',
            "Treat this Boss-reply consolidation as an exception to splitting by accumulated prompt content, and split only when the source requires a genuinely different acting behavior after the reply, not when the same decision or task continues with Boss's answer.",
            'Apply the same consolidation when a fresh directive interrupts parked work and restarts the same behavior with cleared context: when the acting prompt and result contract are identical, keep the interrupt as an entry condition on the originating item, and split only when the fresh directive invokes genuinely different acting work or a different prompt or result contract.',
            'Where two or more delegated-player items share one trigger and the source requires them to run independently before later work uses all their results, place `Parallel group: <stable-kebab-case-id>` immediately below each of those item headings.',
            "Give every item in one parallel group the same completed-prior-group inputs, and let no item's prompt depend on another current-group member's result.",
            'Require every parallel-group member to delegate to a named player, and require the source to permit those members to resolve to distinct players.',
            'Never give parallel-group metadata to direct-Captain work, which shares one Captain session, or to nested calls, which share one pending-child stack slot.',
            'If the source explicitly requires direct-Captain work or a nested call to run concurrently, report that the source cannot be represented rather than silently serializing it or emitting metadata the next phase cannot compile.',
            'Where the source requires calling a statically known playbook, emit an item whose behavior is `Captain shall call playbook <playbook-id>:` and whose blockquote is the complete JSON-safe input-text template for that call, using a stable configured playbook id rather than a slash command or module specifier.',
            'Where the source selects the target playbook at runtime, emit the dynamic form ``Captain shall call playbook selected by `<playbook-id-context>`:``, where the backtick-delimited name identifies a typed FSM context field whose runtime value is the target playbook id and is not itself a target id, and make the blockquote exactly one placeholder naming the typed context field whose runtime string is the complete child input text.',
            'Never let the dynamic call form use a slash command, module specifier, opaque expression, or prose from which a downstream compiler would have to infer either the target-id field or the input field.',
            'Never emit script behaviors written `Captain shall run:` with a POSIX-shell blockquote; such items enter a GEARS package only through the separate optimize pass, whose fixed item-syntax contract — a static shell blockquote containing no `<placeholder>`, and a two-bullet `Results:` label whose first guard reports the script exiting with status zero and whose second reports a nonzero exit status, with no other result and no `needsBossReply` — exists only so every GEARS consumer shares one item-syntax contract.',
            'Use `<placeholder>` only for dynamic values in blockquoted prompts, and treat everything else inside a blockquote as static text rather than an example; put examples in surrounding prose.',
            'Resolve Markdown escaping as source syntax rather than content, so `\\<placeholder\\>` becomes `<placeholder>` and compiled artifacts carry plain text.',
            'Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.',
            "Drop disjunctive branches incompatible with the rest of an item's condition or prompt, because dead branches mislead readers and downstream phases.",
            "When the source is itself the normative specification of a transformation and declares no players and prompts none, treat its implied procedure as Captain performing the specified transformation on request, and compose Captain-acting spec items whose prompts carry the specification's normative requirements — deduplicated, one point per line — without inventing players, triggers, or requirements the specification does not state.",
          ].join('\n'),
          result: {
            compiled:
              'Captain emitted the target package of GEARS spec items as specified.',
            unrepresentable:
              'Captain reported that the source cannot be represented rather than emitting a package or metadata the next phase cannot compile.',
            needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
          },
          pendingBossQuestion: context.pendingBossQuestion,
          bossReply: context.bossReply,
        }),
        onDone: [
          {
            guard: ({ event }) =>
              event.output.guard === 'needsBossReply' &&
              typeof event.output.question === 'string' &&
              event.output.question.trim().length > 0,
            target: '#awaitBossReply',
            actions: {
              type: 'setPendingBossQuestion',
              params: ({ event }): PendingBossQuestion => ({
                questionId: 'compile',
                resumeStateId: 'compile',
                sourceItem: 'T2G-1',
                player: 'Captain',
                question:
                  event.output.guard === 'needsBossReply'
                    ? event.output.question
                    : '',
              }),
            },
          },
          {
            guard: ({ event }) => event.output.guard === 'needsBossReply',
            target: '#failed',
            actions: [
              assign({
                lastResult: ({ event }) => event.output,
                lastError: () =>
                  new Error(
                    'Captain returned needsBossReply without a question.',
                  ),
              }),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'compiled',
            target: '#done',
            actions: [
              assign({ lastResult: ({ event }) => event.output }),
              'clearBossReplyContext',
            ],
          },
          {
            guard: ({ event }) => event.output.guard === 'unrepresentable',
            target: '#done',
            actions: [
              assign({ lastResult: ({ event }) => event.output }),
              'clearBossReplyContext',
            ],
          },
          {
            target: '#failed',
            actions: [
              assign({
                lastResult: ({ event }) => event.output,
                lastError: ({ event }) =>
                  new Error(
                    `Captain returned an undeclared guard: ${event.output.guard}`,
                  ),
              }),
              'clearBossReplyContext',
            ],
          },
        ],
        onError: {
          target: '#failed',
          actions: assign({ lastError: ({ event }) => event.error }),
        },
      },
    },

    awaitBossReply: {
      id: 'awaitBossReply',
      description: "Waiting for Boss to answer the acting agent's question.",
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'awaitBossReply',
          description:
            "Waiting for Boss to answer the acting agent's question.",
        },
      },
      on: {
        BOSS_REPLY: [
          {
            guard: 'isEmptyBossReply',
            target: '#failed',
            actions: ['recordEmptyReply', 'clearBossReplyContext'],
          },
          ...resumableStates(RESUMABLE_IDS).BOSS_REPLY,
        ],
        // A Boss interrupt while waiting abandons the pending question.
        ...bossInterrupts(INTERRUPT_IDS, ['clearBossReplyContext']),
        // A fresh Boss directive while waiting starts a fresh turn.
        COMPILE: {
          target: '#compile',
          actions: ['startTransform', 'clearBossReplyContext'],
        },
      },
    },

    failed: {
      id: 'failed',
      description:
        'The Captain call errored or produced malformed output; Boss may recover.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'The Captain call errored or produced malformed output; Boss may recover.',
        },
      },
      // Recoverable: Boss may restart here, or interrupt out via root handler.
      on: {
        COMPILE: {
          target: '#compile',
          actions: ['startTransform', 'clearBossReplyContext'],
        },
      },
    },

    done: {
      id: 'done',
      type: 'final',
      description:
        'The text-to-GEARS transformation concluded: the GEARS package was emitted, or the source was reported unrepresentable.',
      meta: {
        playbook: {
          stateId: 'done',
          description:
            'The text-to-GEARS transformation concluded: the GEARS package was emitted, or the source was reported unrepresentable.',
        },
      },
    },
  },
});

export default text2gearsMachine;

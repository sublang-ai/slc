import { assign, fromPromise, setup } from 'xstate';

// This machine realizes the single GEARS item `TEXT2GEARS-1`: a direct-Captain
// behavior that transforms a free-form text description into a GEARS spec-item
// package. The item carries no `Results:` label, so its state receives the
// default single-outcome contract (`done`) plus the universal `needsBossReply`.
// Only the `captain` actor kind is used, so no player, playbook, or script
// actor contract is declared.

// The machine takes no per-run parameters: the item's prompt establishes no
// runtime-value placeholder, so there is nothing for Boss or the runner to seed
// into context beyond the (empty) input.
export type Text2GearsInput = Record<string, never>;

// The sole jumpable working leaf; a fresh Boss directive re-enters it.
export const BOSS_INTERRUPT_TARGETS = ['transform'] as const;
export type WorkingStateId = (typeof BOSS_INTERRUPT_TARGETS)[number];

// The captain-invoking working leaf is resumable after a Boss reply.
export const RESUMABLE_STATE_IDS = ['transform'] as const;
export type ResumableStateId = (typeof RESUMABLE_STATE_IDS)[number];

export interface PendingBossQuestion {
  questionId: string;
  resumeStateId: string;
  sourceItem: string;
  player: string;
  question: string;
}

// Typed input for the direct `captain` actor. `pendingBossQuestion` and
// `bossReply` are the singular per-leaf continuation fields the linker reads to
// compose the Boss-reply preamble; they are omitted when absent.
export interface CaptainInput {
  stateId: string;
  sourceItem: string;
  prompt: string;
  result: Record<string, string>;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

// Discriminated result contract: `done` (default single outcome) and the
// universal `needsBossReply`, which additionally requires `question`.
export type CaptainOutput =
  | { guard: 'done' }
  | { guard: 'needsBossReply'; question: string };

export type Text2GearsEvent =
  | { type: 'BOSS_REQUEST' }
  | { type: 'BOSS_INTERRUPT'; targetId: WorkingStateId }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

interface NormalizedError {
  name: string;
  message: string;
}

interface Text2GearsContext {
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: NormalizedError;
}

const TRANSFORM_STATE_ID = 'transform';
const SOURCE_ITEM = 'TEXT2GEARS-1';

const DONE_RESULT_DESCRIPTION = 'The acting agent completed the behavior.';

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.";

// The GEARS item's full final prompt, carried verbatim into invoke.input.prompt.
const TRANSFORM_PROMPT = [
  'Transform the free-form natural-language procedure description (source) into a package of normative GEARS spec items (target), written as GEARS-format Markdown.',
  'Do not produce the second phase (spec items to state machine); it is out of scope.',
  'Default players are Boss (the human user) and Captain (the coordinating agent).',
  'If the source opens with a `Players:` section, carry its additional players; a player may alias others with `=` and `|`, and Boss picks one at runtime.',
  'Capitalize English player names; quote non-English player names when needed to distinguish them from prose.',
  'Give each spec item a condition, exactly one behavior kind, and the complete static prompt for that behavior.',
  'Head every emitted item with the exact Markdown heading form `### <ITEM-ID>`; never use `##`, `####`, or any other level, which is not GEARS item syntax and stays invisible to downstream compilers and verification.',
  'Make each behavior kind one of: direct Captain work `Captain shall <behavior>:` with no delegated player; delegated player work `Captain shall prompt <Player>:` or `Captain shall relay ... to <Player> ...:`; or a literal or dynamic nested playbook call.',
  'For direct Captain work, keep Captain acting itself; never rewrite it as `Captain shall prompt Captain`, since Captain is a distinct runtime actor, not a player binding.',
  'For delegated work, name the declared player that receives the prompt.',
  'Blockquote every prompt, one point per line.',
  "When the source already supplies the complete blockquoted acting prompt, preserve those lines exactly apart from resolving Markdown escapes, and do not promote surrounding conditions, invariants, result fields, or continuation mechanics into the blockquote; keep those in the item's condition or `Results:` metadata.",
  'Do not add control-oriented prompt lines merely to restate conditions or results; doing so changes the Boss-visible contract and is nonconformant.',
  'Treat source statements that assign active-leaf routing, call identity, suspension, or return matching to the host as execution preconditions, not Captain behaviors; use them only as a condition on an actual behavior when needed, and never emit a standalone direct-Captain item that asks Captain to implement host stack bookkeeping.',
  "Keep a host-owned input catalog's immutability as a condition or invariant on the behaviors that consume the catalog, never as an LLM action that can replace or mutate host configuration.",
  'Keep opening source invariants consumed by later behaviors explicit in the emitted conditions or prompts rather than summarizing them away.',
  'Preserve the declared exact entry shape of a structured host catalog and any progress invariant that makes a decide-call-observe plan finite, such as `remainingPlan` containing only the calls after the selected call and strictly shrinking on continuation.',
  'Treat a source invariant that restricts a nested-call target to a non-empty member of an input catalog as a condition on that call item, not a separate Captain rejection behavior, unless the source requires an observable response distinct from taking or skipping the call.',
  'When a source acting behavior has more than one possible outcome, emit its machine-facing result contract immediately after the complete blockquote, outside the acting prompt, as a `Results:` block.',
  'Write `Results:` as a plain label, not a heading.',
  'Make every result one bullet with exactly a backtick-delimited guard name, a colon, and a non-empty description.',
  'Match each guard name to the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`.',
  'Keep the bullet order authoritative, guard names unique within the item, and each description naming every required output property with its exact case-sensitive identifier.',
  "Where any later item's blockquote reads a produced value through a `<placeholder>`, have the producing item declare a `Results:` contract whose relevant description names that produced output property using the placeholder's exact identifier.",
  'For a single-outcome producer whose output a later item consumes, declare exactly one `Results:` bullet naming that property; this consumed-output case is the sole case in which a single-outcome behavior carries a `Results:` label.',
  "Treat result metadata as compiler control data, not part of the acting agent's prompt.",
  'Do not put guard names, result-property schema, JSON control instructions, or adjudicator instructions inside the blockquote unless the source explicitly requires the acting agent to show that machine syntax to the user.',
  "Move the source's outcome contract into `Results:` while preserving the human domain instructions in the blockquote.",
  'Never emit the framework-owned `needsBossReply` result; gears2fsm adds that universal result for every Captain- or player-invoking state.',
  'Where the source restricts an initial Captain to routing, preserve only the authored question and delegation outcomes, and do not infer a direct-answer or terminal result merely because Captain is the acting agent.',
  'For a single-outcome behavior whose output no later item consumes, emit no `Results:` label and do not invent a one-bullet `Results:` block, since gears2fsm gives its state the default single-outcome contract.',
  'Where a direct-Captain or delegated-player behavior may ask Boss a question and wait, keep the question result, the wait, and the answer-dependent continuation on that same originating item, even when the answer changes its complete runtime prompt.',
  'Do not emit a second item solely for "Boss answers," "after the question," or clearing the consumed question or reply; the FSM and linker own same-leaf suspension, continuation blocks, and consumed-context cleanup.',
  "Split after a reply only when the source requires a genuinely different acting behavior, not when the same decision or task continues with Boss's answer.",
  'When a fresh directive interrupts parked work and restarts the same behavior with cleared context under an identical acting prompt and result contract, keep the interrupt as an entry condition on the originating item; split only when the fresh directive invokes genuinely different acting work or a different prompt or result contract.',
  "Where two or more delegated-player items share one trigger and must run independently before later work uses all results, place `Parallel group: <stable-kebab-case-id>` immediately below each such item's heading.",
  "Give every item in one parallel group the same completed-prior-group inputs, and let no item prompt depend on another current-group member's result.",
  'Require every parallel-group member to delegate to a named player that the source permits to resolve to a distinct player; never give parallel-group metadata to direct-Captain work or nested calls, which share one Captain session and one pending-child stack slot respectively.',
  'If the source explicitly requires direct-Captain work or a nested call to run concurrently, report that the source cannot be represented rather than silently serializing it or emitting metadata the next phase cannot compile.',
  'Where the source requires calling a statically known playbook, emit an item whose behavior is `Captain shall call playbook <playbook-id>:` and whose blockquote is the complete JSON-safe input-text template for that call, using a stable configured playbook id as the literal target rather than a slash command or module specifier.',
  'Where the source selects the target at runtime, instead emit `Captain shall call playbook selected by <playbook-id-context>:`, where the backtick-delimited name identifies a typed FSM context field whose runtime value is the target playbook id, not itself a target id.',
  'Make that dynamic blockquote exactly one placeholder naming the typed context field whose runtime string is the complete child input text.',
  'Never let the dynamic call form use a slash command, module specifier, opaque expression, or prose from which a downstream compiler would have to infer either field.',
  'Never emit script behaviors (`Captain shall run:`); script items enter a GEARS package only through the separate optimize pass.',
  'Write the target in the same language as the source, with item condition prose, acting prompts, and result descriptions following the source language, read per the matching localization of the GEARS definition.',
  'Keep the four `Captain shall` acting-clause forms (direct, delegated, nested playbook call, and script), guard names, and the `Players:` and `Results:` labels in their fixed English form regardless of source language.',
  "If the source is itself the normative specification of a transformation, declaring no players and prompting none, compose Captain-acting spec items whose trigger is a request naming the specification's source and target and whose behavior is Captain carrying out the transformation as specified, carrying the specification's normative requirements into the prompt as deduplicated one-point-per-line instructions to Captain, without inventing players, triggers, or requirements the specification does not state.",
  'Deduplicate identical prompt lines when composing overlapping or duplicated source snippets.',
  "Give each item its full final static prompt so a human can simulate a run by copying any single item's prompt verbatim with no cross-item composition; cross-item duplication is acceptable because spec items are compiled artifacts.",
  'Use `<placeholder>` for dynamic values in blockquoted prompts, and treat everything else inside a blockquote as static text rather than an example, keeping examples in surrounding prose.',
  'Resolve Markdown escapes on extraction (e.g., `\\<placeholder\\>` becomes `<placeholder>`) so compiled artifacts carry plain text.',
  'Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.',
  "Drop disjunctive branches incompatible with the rest of an item's condition or prompt.",
].join('\n');

// Resumable-state registry helper (scalar Boss-reply form).
export function resumableStates(
  ids: readonly ResumableStateId[],
): ReadonlySet<ResumableStateId> {
  return new Set(ids);
}

export const resumableStateIds = resumableStates(RESUMABLE_STATE_IDS);

// Structurally narrow a possibly-unknown done event's `output` to the captain
// guard discriminant rather than relying on unchecked `event.output` inference.
function readCaptainGuard(event: unknown): CaptainOutput['guard'] | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const output = (event as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) {
    return undefined;
  }
  const guard = (output as { guard?: unknown }).guard;
  if (guard === 'done' || guard === 'needsBossReply') {
    return guard;
  }
  return undefined;
}

// Structurally read the `question` payload from a possibly-unknown done event.
function readCaptainQuestion(event: unknown): string | undefined {
  if (typeof event !== 'object' || event === null) {
    return undefined;
  }
  const output = (event as { output?: unknown }).output;
  if (typeof output !== 'object' || output === null) {
    return undefined;
  }
  const question = (output as { question?: unknown }).question;
  return typeof question === 'string' && question.length > 0
    ? question
    : undefined;
}

// Normalize an unknown invoke error into a compact JSON-safe record.
function toNormalizedError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === 'object' && error !== null) {
    const name = (error as { name?: unknown }).name;
    const message = (error as { message?: unknown }).message;
    return {
      name: typeof name === 'string' ? name : 'Error',
      message: typeof message === 'string' ? message : String(error),
    };
  }
  return { name: 'Error', message: String(error) };
}

// Emit one guarded, reentering root transition per jumpable state id rather
// than hand-writing them. Literals are preserved with `as const` so registered
// guard/action names and targets are not widened to plain `string`.
function bossInterrupts(ids: readonly WorkingStateId[]) {
  return ids.map((id) => ({
    guard: { type: 'bossInterruptTarget', params: { targetId: id } } as const,
    target: `#${id}` as const,
    reenter: true as const,
    actions: 'clearBossReplyContext' as const,
  }));
}

export const text2gearsMachine = setup({
  types: {
    context: {} as Text2GearsContext,
    events: {} as Text2GearsEvent,
    input: {} as Text2GearsInput,
  },
  actors: {
    // Object-only artifact: the runner must supply the real implementation.
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    bossInterruptTarget: (
      { event },
      params: { targetId: WorkingStateId },
    ): boolean =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === params.targetId,
    bossReplyPresent: ({ event }): boolean =>
      event.type === 'BOSS_REPLY' && event.answer.trim().length > 0,
  },
  actions: {
    setPendingBossQuestion: assign(({ event }) => {
      const pending: PendingBossQuestion = {
        questionId: TRANSFORM_STATE_ID,
        resumeStateId: TRANSFORM_STATE_ID,
        sourceItem: SOURCE_ITEM,
        player: 'Captain',
        question: readCaptainQuestion(event) ?? '',
      };
      return { pendingBossQuestion: pending, bossReply: undefined };
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
    recordBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
    }),
    rememberCaptainError: assign({
      lastError: ({ event }) =>
        toNormalizedError((event as { error?: unknown }).error),
    }),
    rememberMalformedOutput: assign({
      lastError: (): NormalizedError => ({
        name: 'MalformedCaptainOutput',
        message:
          'The captain actor returned output matching no declared guard, or declared needsBossReply without a question.',
      }),
    }),
    rememberMalformedReply: assign({
      lastError: (): NormalizedError => ({
        name: 'MalformedBossReply',
        message: 'BOSS_REPLY arrived with an empty or whitespace-only answer.',
      }),
    }),
  },
}).createMachine({
  id: 'text2gears',
  initial: 'ready',
  context: {},
  on: {
    BOSS_INTERRUPT: bossInterrupts(BOSS_INTERRUPT_TARGETS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Quiescent idle hub that waits for Boss to request the Text-to-GEARS transformation.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Quiescent idle hub that waits for Boss to request the Text-to-GEARS transformation.',
        },
      },
      on: {
        BOSS_REQUEST: { target: 'transform' },
      },
    },
    transform: {
      id: 'transform',
      description:
        'Captain transforms the source text into a package of GEARS spec items.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'transform',
          description:
            'Captain transforms the source text into a package of GEARS spec items.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => {
          const input: CaptainInput = {
            stateId: TRANSFORM_STATE_ID,
            sourceItem: SOURCE_ITEM,
            prompt: TRANSFORM_PROMPT,
            result: {
              done: DONE_RESULT_DESCRIPTION,
              needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
            },
          };
          if (context.pendingBossQuestion !== undefined) {
            input.pendingBossQuestion = context.pendingBossQuestion;
          }
          if (context.bossReply !== undefined) {
            input.bossReply = context.bossReply;
          }
          return input;
        },
        onDone: [
          {
            guard: ({ event }) => readCaptainGuard(event) === 'done',
            target: '#done',
            actions: 'clearBossReplyContext',
          },
          {
            guard: ({ event }) =>
              readCaptainGuard(event) === 'needsBossReply' &&
              readCaptainQuestion(event) !== undefined,
            target: 'awaitBossReply',
            actions: 'setPendingBossQuestion',
          },
          { target: 'failed', actions: 'rememberMalformedOutput' },
        ],
        onError: { target: 'failed', actions: 'rememberCaptainError' },
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
            guard: 'bossReplyPresent',
            target: '#transform',
            reenter: true,
            actions: 'recordBossReply',
          },
          { target: 'failed', actions: 'rememberMalformedReply' },
        ],
      },
    },
    failed: {
      id: 'failed',
      description:
        'Recoverable failure state that retains context for Boss recovery.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'Recoverable failure state that retains context for Boss recovery.',
        },
      },
      on: {
        BOSS_REQUEST: { target: 'transform', actions: 'clearBossReplyContext' },
      },
    },
    done: {
      id: 'done',
      type: 'final',
      description:
        'Terminal state reached once the GEARS spec-item package is produced.',
      meta: {
        playbook: {
          stateId: 'done',
          description:
            'Terminal state reached once the GEARS spec-item package is produced.',
        },
      },
    },
  },
});

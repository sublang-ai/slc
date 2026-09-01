// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

/* ------------------------------------------------------------------ *
 * Source item identity
 * ------------------------------------------------------------------ */

/** GEARS item this machine realizes. */
const T2G_1_SOURCE_ITEM = 'T2G-1';

/** Stable id of the working leaf that invokes Captain for T2G-1. */
const T2G_1_STATE_ID = 'transformSource';

/** T2G-1's full final prompt, verbatim from the GEARS blockquote. */
const T2G_1_PROMPT: string = [
  'Transform the named Source into the named Target: read the Source procedure description and compose a package of normative GEARS spec items.',
  'Follow the GEARS definition shipped by the installed `@sublang/spex` package: `@sublang/spex/scaffold/specs/meta.md` (English) and `@sublang/spex/scaffold/i18n/zh/specs/meta.md` (Chinese).',
  'The second phase, spec items to state machine, is out of scope.',
  'Roles name playbook-local delegated work functions.',
  'Boss, the human user, and Captain, the coordinating agent, are fixed actors that remain outside the role list.',
  "Take delegated roles from Source's opening `Roles:` section when Source declares one.",
  'Each role shall be unique and shall not alias another role; concrete player selection and sharing belong to explicit host configuration.',
  'Role names shall also be unique after canonical lowercase-id derivation, so declarations such as `Coder` and `coder` reject rather than collapse to one manifest role.',
  'Capitalize English role names, for example `Writer`, and quote non-English names, for example `作者`, when needed to distinguish them from prose.',
  'Each spec item names a condition, one behavior kind, and the complete prompt for that behavior.',
  'Every emitted item shall use the exact Markdown heading form `### <ITEM-ID>`.',
  'An item heading at `##`, `####`, or another level is not GEARS item syntax and will not be visible to downstream compilers or verification.',
  'The behavior kind shall be one of: direct Captain work, delegated-role work, or a literal or dynamic nested playbook call.',
  'Direct Captain work is written `Captain shall <behavior>:` without naming a delegated role.',
  'Delegated-role work is written `Captain shall prompt <Role>:` or the existing `Captain shall relay ... to <Role> ...:` form.',
  'Direct Captain work means the coordinating Captain performs the behavior itself, and shall not be rewritten as `Captain shall prompt Captain`, because Captain is a distinct runtime actor rather than a role binding.',
  'Delegated work shall name the declared role that receives the prompt.',
  'Prompts shall be blockquoted, one point per line.',
  'When Source already supplies the complete blockquoted acting prompt for a behavior, preserve those prompt lines exactly, apart from the documented Markdown unescaping.',
  "Do not promote surrounding conditions, invariants, result fields, or continuation mechanics into that blockquote; those requirements remain in the item's condition or `Results:` metadata.",
  'Adding control-oriented prompt lines merely to restate them changes the Boss-visible contract and is nonconformant.',
  'Source may compose one acting prompt from authored Markdown instruction blocks and runtime context that it explicitly says to relay in quotes (`>`).',
  'A fenced `markdown` block introduced as an instruction or prompt is an authored static prompt fragment: its fence delimiters are Source syntax, while every interior line and blank line is prompt content preserved after documented Markdown unescaping.',
  'An instruction fence and a relayed-context fragment that apply to one behavior shall appear in the target blockquote in their Source order.',
  'Distinct non-empty fragments shall be separated by one blank prompt line unless Source explicitly supplies a different boundary.',
  'Do not move a shared instruction ahead of behavior-specific context, do not move quoted evidence after an instruction that Source says follows the evidence, and do not otherwise regroup fragments for convenience.',
  'Where Source says that a runtime value is relayed in quotes, the leading `>` is prompt content rather than Source-only blockquote syntax.',
  'If Source supplies a blockquoted template for that relay, keep one literal leading `>` on every quoted line, so the target GEARS line uses its outer blockquote marker followed by the literal marker, such as `> > Coder output: <coder-output>`.',
  'If Source names the relayed value but supplies no template, emit its canonical typed placeholder on a line beginning with literal `> `, and do not summarize, paraphrase, or invent a value in its place.',
  'An ordinary Source blockquote that specifies a complete acting prompt without requiring quoted relay retains the preservation rule above: its one leading marker is Source syntax and is not prompt content.',
  'Source statements that assign active-leaf routing, call identity, suspension, or return matching to the host describe execution preconditions rather than behaviors for Captain to perform.',
  'Use such a statement only as a condition on an actual behavior when needed, and do not emit a standalone direct-Captain item that asks Captain to implement host stack bookkeeping.',
  "Retain a host-owned input catalog's immutability as a condition or invariant on the behaviors that consume the catalog, never as an LLM action that can replace or mutate host configuration.",
  'Opening source invariants consumed by later behaviors shall remain explicit in the emitted conditions or prompts rather than being summarized away.',
  'In particular, preserve the declared exact entry shape of a structured host catalog and any progress invariant that makes a decide-call-observe plan finite, such as `remainingPlan` containing only calls after the selected call and strictly shrinking on continuation.',
  'A source invariant that restricts a nested-call target to a non-empty member of an input catalog is a condition on that call item, not a separate Captain rejection behavior, unless Source requires an observable response distinct from taking or skipping the call.',
  'When Source gives an acting behavior more than one possible outcome, emit its machine-facing result contract immediately after the complete blockquote, outside the acting prompt, as a `Results:` label followed by one bullet per result.',
  '`Results:` shall be a plain label rather than a heading.',
  'Every result shall occupy one bullet with exactly a backtick-delimited guard name, a colon, and a non-empty description.',
  'The guard name shall match the ASCII identifier pattern `[A-Za-z_$][A-Za-z0-9_$]*`.',
  'The bullet order is authoritative, guard names are unique within the item, and the description shall name every required output property with its exact case-sensitive identifier.',
  "A produced value consumed later shall have a declared producer: where any later item's blockquote reads a value through a `<placeholder>`, the item whose behavior produces that value shall declare the `Results:` contract whose relevant description names the produced output property, using the placeholder's exact identifier, which is what lets the FSM thread the value through typed context.",
  'A single-outcome producer then declares exactly one bullet naming the property; this consumed-output case is the sole one in which a single-outcome behavior carries a `Results:` label.',
  "Where a later prompt relays a delegated player's whole final response as quoted context, the producer shall declare that property in the exact annotated form `` `<field>: <verbatim final text>` ``.",
  "The annotation makes the field runtime-owned: the adjudicator selects the result guard, while the linked runtime carries the player's canonical final text into that field instead of asking a judge to reproduce it.",
  "A distinct typed field extracted from that response remains judge-authored even when a later prompt quotes its exact value; quoting a field does not turn it into the player's whole final response.",
  'One property name shall not be annotated as verbatim in one result contract and judge-authored in another; choose distinct properties or report that the Source cannot be represented by the current contract.',
  "Result metadata is compiler control data, not part of the acting agent's prompt.",
  'Do not put guard names, result-property schema, JSON control instructions, or adjudicator instructions inside the blockquote unless Source explicitly requires the acting agent to show that machine syntax to the user.',
  "Move Source's outcome contract into `Results:` while preserving the human domain instructions in the blockquote.",
  'Do not emit the framework-owned `needsBossReply` result; gears2fsm adds that universal result for every Captain- or player-invoking state.',
  'Where Source restricts an initial Captain to routing, preserve only the authored question and delegation outcomes, and do not infer a direct-answer or terminal result merely because Captain is the acting agent.',
  'A single-outcome behavior whose output no later item consumes carries no `Results:` label, because gears2fsm gives its state the default single-outcome contract, so do not invent a one-bullet `Results:` block for it.',
  'When a later item does consume its output, apply the produced-value rule above instead.',
  "Where a direct-Captain or delegated-player behavior may ask Boss a question and wait, Boss's answer resumes that same behavior with continuation context; it is not a distinct behavior item.",
  'Keep the question result, the wait, and the answer-dependent continuation on the originating item even when the answer changes its complete runtime prompt.',
  'Do not emit a second item solely for "Boss answers," "after the question," or clearing the consumed question or reply; the FSM and linker own the same-leaf suspension, continuation blocks, and consumed-context cleanup.',
  "This rule is an exception to splitting by accumulated prompt content: split only when Source requires a genuinely different acting behavior after the reply, not when the same decision or task continues with Boss's answer.",
  'Apply the same consolidation when Source says a fresh directive interrupts parked work and restarts the same behavior with cleared context.',
  'When the acting prompt and result contract are identical, retain the interrupt as an entry condition on the originating item, and do not duplicate that item solely to describe the restart.',
  'Split only when the fresh directive invokes genuinely different acting work or a different prompt or result contract.',
  'Where two or more delegated-player items share one trigger and Source requires them to run independently before later work uses all results, place `Parallel group: <stable-kebab-case-id>` immediately below each item heading.',
  "Every item in one parallel group shall receive the same completed-prior-group inputs; no item prompt may depend on another member's result from the current group.",
  'Every member shall delegate to a distinct named role; a group that repeats one canonical role is malformed because one role resolves to one player.',
  'Direct-Captain work shares one Captain session and nested calls share one pending-child stack slot, so neither kind may receive parallel-group metadata.',
  'If Source explicitly requires either unsupported kind to run concurrently, report that the source cannot be represented rather than silently serializing it or emitting metadata the next phase cannot compile.',
  'Where Source requires one playbook to call a statically known playbook, emit an item whose behavior uses `Captain shall call playbook <playbook-id>:` and whose blockquote is the complete JSON-safe input-text template for that call.',
  'The literal target id shall be a stable configured playbook id, not a slash command or module specifier.',
  'Where Source selects the target at runtime, emit instead the first-class dynamic form ``Captain shall call playbook selected by `<playbook-id-context>`:``.',
  'The backtick-delimited name identifies a typed FSM context field whose runtime value is the target playbook id; it is not itself a target id.',
  'For the dynamic form, the blockquote shall be exactly one placeholder naming the typed context field whose runtime string is the complete child input text.',
  'The dynamic form shall not use a slash command, module specifier, opaque expression, or prose from which a downstream compiler would have to infer either field.',
  'A GEARS package may also contain deterministic script behaviors, written `Captain shall run:` followed by a blockquote whose lines are the exact POSIX shell script to execute.',
  'Never emit this script kind: script items enter a GEARS package only through the separate optimize pass, which rewrites eligible compiled items.',
  "A script item's blockquote is static shell text: it shall contain no `<placeholder>`, and Markdown escapes resolve exactly as in acting prompts.",
  'A script item shall carry a `Results:` label with exactly two bullets in this fixed interpretation: the first guard reports the script exiting with status zero, the second reports a nonzero exit status.',
  'No other result, and no `needsBossReply`, applies to a script item, because a script has no agent to surface questions.',
  "Write Target in the same language as Source: an item's condition prose, acting prompts, and result descriptions follow the Source language, read per the matching localization of the GEARS definition.",
  'The four `Captain shall` acting-clause forms above, namely direct, delegated, nested playbook call, and script, along with guard names and the `Roles:` and `Results:` labels, are fixed machine syntax and stay in this exact English form regardless of Source language.',
  'A Source may itself be the normative specification of a transformation, for example a compiler phase definition, as when a meta pipeline compiles such a file.',
  'Such a Source declares no roles and prompts none; its implied procedure is that Captain performs the specified transformation on request.',
  "Compose Captain-acting spec items for it: when a transformation request names the specification's source and target, Captain shall carry out the transformation as specified.",
  "Its prompts shall carry the specification's normative requirements as instructions to Captain, deduplicated, one point per line, without inventing roles, triggers, or requirements the specification does not state.",
  'Source snippets may overlap or duplicate; when composing them into a spec item, deduplicate identical prompt lines.',
  'Do not deduplicate across distinct authored fragments when doing so would erase a fragment boundary or change the Source-ordered prompt.',
  'Each spec item addresses one state behavior and carries its full final prompt, that is, the static part.',
  'Cross-item duplication is acceptable: spec items are compiled artifacts, and Source is what users maintain.',
  "A human shall be able to simulate a run by copying any single item's prompt verbatim, with no cross-item composition needed.",
  'Use `<placeholder>` for dynamic values in blockquoted prompts.',
  'Everything else inside a blockquote is static text, not an example; examples belong in surrounding prose.',
  'Markdown escaping is Source syntax, not content: resolve escapes during extraction, so that `\\<placeholder\\>` becomes `<placeholder>` and compiled artifacts carry plain text.',
  'Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.',
  "Drop disjunctive branches incompatible with the rest of an item's condition or prompt, because dead branches mislead readers and downstream phases.",
].join('\n');

/* ------------------------------------------------------------------ *
 * Actor contracts
 * ------------------------------------------------------------------ */

/** Terminal outcomes T2G-1 declares. */
export type TransformationOutcome = 'transformed' | 'unrepresentable';

/** Guard names valid for the T2G-1 Captain invocation. */
export type CaptainGuard = TransformationOutcome | 'needsBossReply';

/** Stable ids of working leaves a Boss reply may resume. */
export type ResumableStateId = 'transformSource';

/** Stable ids Boss may pre-empt with `BOSS_INTERRUPT`. */
export type BossInterruptTargetId = 'transformSource';

/** JSON-safe normalized error retained for Boss recovery. */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Asker of a pending Boss question. T2G-1 has no delegated role. */
export interface BossQuestionAsker {
  readonly kind: 'captain';
}

/** Question a working leaf surfaced for Boss, plus its resume route. */
export interface PendingBossQuestion {
  readonly questionId: string;
  readonly resumeStateId: ResumableStateId;
  readonly sourceItem: string;
  readonly asker: BossQuestionAsker;
  readonly question: string;
}

/** Typed input the runner's `captain` actor receives. */
export interface CaptainInput {
  readonly stateId: string;
  readonly sourceItem: string;
  readonly prompt: string;
  readonly result: Readonly<Record<CaptainGuard, string>>;
  readonly pendingBossQuestion?: PendingBossQuestion;
  readonly bossReply?: string;
}

/** Discriminated result the `captain` actor returns. */
export type CaptainOutput =
  | { readonly guard: 'transformed' }
  | { readonly guard: 'unrepresentable' }
  | { readonly guard: 'needsBossReply'; readonly question: string };

/** Immutable machine input seeding the transformation request. */
export interface TransformationMachineInput {
  readonly sourcePath?: string;
  readonly targetPath?: string;
}

/** JSON-safe terminal output naming which declared outcome was reached. */
export interface TransformationMachineOutput {
  readonly status: TransformationOutcome;
}

/** Transformation request naming a `text` source and a `gears` target. */
interface TransformationRequest {
  readonly sourcePath?: string;
  readonly targetPath?: string;
}

interface TransformationContext {
  sourcePath?: string;
  targetPath?: string;
  outcome?: TransformationOutcome;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastError?: SerializedError;
}

export type TransformationEvent =
  | { type: 'TRANSFORMATION_REQUEST'; sourcePath?: string; targetPath?: string }
  | {
      type: 'BOSS_INTERRUPT';
      targetId: BossInterruptTargetId;
      sourcePath?: string;
      targetPath?: string;
    }
  | { type: 'BOSS_REPLY'; answer: string; questionId?: string };

/**
 * T2G-1's local result contract: the authored guard names, order, and
 * descriptions verbatim, plus the universal `needsBossReply` result.
 */
const T2G_1_RESULT: Readonly<Record<CaptainGuard, string>> = {
  transformed:
    'Captain composed the Target package of GEARS spec items from the Source as specified.',
  unrepresentable:
    'Captain reported that the Source cannot be represented, rather than silently serializing a concurrency requirement the parallel-group metadata cannot carry, emitting metadata the next phase cannot compile, or annotating one property name as both verbatim and judge-authored.',
  needsBossReply:
    "The acting agent's prose surfaces a clarifying question for Boss that the agent cannot answer alone. Output shall include `question: <verbatim question text from the acting agent's prose>`.",
};

/** One role-id array per parallel group; T2G-1 declares none. */
export const concurrentRoleSets: readonly (readonly string[])[] = [];

/* ------------------------------------------------------------------ *
 * Structural narrowing helpers
 *
 * XState may surface invoked-actor output as `unknown` in shared guards
 * and actions, so every helper accepts `unknown` and narrows structurally
 * before reading fields.
 * ------------------------------------------------------------------ */

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Narrow to a non-blank string; never applies `trim()` to a non-string. */
const readText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const describeUnknown = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return String(value);
  }
  return 'Unknown error';
};

const normalizeError = (value: unknown): SerializedError => {
  if (value instanceof Error) {
    const stack = readText(value.stack);
    return {
      name: readText(value.name) ?? 'Error',
      message: value.message,
      ...(stack !== undefined ? { stack } : {}),
    };
  }
  if (isPlainRecord(value)) {
    const name = readText(value.name);
    const message = value.message;
    if (name !== undefined && typeof message === 'string') {
      const stack = readText(value.stack);
      return { name, message, ...(stack !== undefined ? { stack } : {}) };
    }
  }
  return { name: 'Error', message: describeUnknown(value) };
};

const readErrorFromEvent = (event: unknown): SerializedError =>
  isPlainRecord(event) ? normalizeError(event.error) : normalizeError(event);

const readCaptainOutput = (event: unknown): CaptainOutput | undefined => {
  if (!isPlainRecord(event)) return undefined;
  const output: unknown = event.output;
  if (!isPlainRecord(output)) return undefined;
  const guard: unknown = output.guard;
  if (guard === 'transformed') return { guard: 'transformed' };
  if (guard === 'unrepresentable') return { guard: 'unrepresentable' };
  if (guard === 'needsBossReply') {
    const question = readText(output.question);
    if (question !== undefined) return { guard: 'needsBossReply', question };
  }
  return undefined;
};

const readRequestFromEvent = (event: unknown): TransformationRequest => {
  if (!isPlainRecord(event)) return {};
  const sourcePath = readText(event.sourcePath);
  const targetPath = readText(event.targetPath);
  return {
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...(targetPath !== undefined ? { targetPath } : {}),
  };
};

/**
 * Resolve the request an event carries, falling back to the existing
 * (input-seeded) context value for each field the event omits.
 */
const resolveRequest = (
  context: TransformationContext,
  event: unknown,
): TransformationRequest => {
  const requested = readRequestFromEvent(event);
  const sourcePath = requested.sourcePath ?? readText(context.sourcePath);
  const targetPath = requested.targetPath ?? readText(context.targetPath);
  return {
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    ...(targetPath !== undefined ? { targetPath } : {}),
  };
};

const namesSourceAndTarget = (request: TransformationRequest): boolean =>
  request.sourcePath !== undefined && request.targetPath !== undefined;

const readTargetId = (event: unknown): string | undefined =>
  isPlainRecord(event) ? readText(event.targetId) : undefined;

const readBossReply = (
  event: unknown,
): { readonly answer: string; readonly questionId?: string } | undefined => {
  if (!isPlainRecord(event)) return undefined;
  const answer = readText(event.answer);
  if (answer === undefined) return undefined;
  const questionId = readText(event.questionId);
  return { answer, ...(questionId !== undefined ? { questionId } : {}) };
};

/* ------------------------------------------------------------------ *
 * Transition-array helpers
 *
 * Guard, action, and target literals are preserved rather than widened.
 * ------------------------------------------------------------------ */

const RESUMABLE_STATE_IDS = [
  'transformSource',
] as const satisfies readonly ResumableStateId[];

const BOSS_INTERRUPT_TARGET_IDS = [
  'transformSource',
] as const satisfies readonly BossInterruptTargetId[];

const resumableStates = (ids: readonly ResumableStateId[]) =>
  ids.map((id) => ({
    guard: { type: 'canResumeInto' as const, params: { stateId: id } },
    actions: 'storeBossReply' as const,
    target: `#${id}` as `#${ResumableStateId}`,
    reenter: true as const,
  }));

const bossInterrupts = (ids: readonly BossInterruptTargetId[]) =>
  ids.map((id) => ({
    guard: { type: 'isInterruptTarget' as const, params: { stateId: id } },
    actions: 'copyTransformationRequest' as const,
    target: `#${id}` as `#${BossInterruptTargetId}`,
    reenter: true as const,
  }));

/* ------------------------------------------------------------------ *
 * Machine
 * ------------------------------------------------------------------ */

export const text2gearsMachine = setup({
  types: {
    context: {} as TransformationContext,
    events: {} as TransformationEvent,
    input: {} as TransformationMachineInput,
    output: {} as TransformationMachineOutput,
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  guards: {
    namesSourceAndTarget: ({ context, event }) =>
      namesSourceAndTarget(resolveRequest(context, event)),
    isInterruptTarget: (
      { context, event },
      params: { stateId: BossInterruptTargetId },
    ) => {
      if (readTargetId(event) !== params.stateId) return false;
      return namesSourceAndTarget(resolveRequest(context, event));
    },
    canResumeInto: (
      { context, event },
      params: { stateId: ResumableStateId },
    ) => {
      const pending = context.pendingBossQuestion;
      if (pending === undefined || pending.resumeStateId !== params.stateId) {
        return false;
      }
      const reply = readBossReply(event);
      if (reply === undefined) return false;
      return (
        reply.questionId === undefined ||
        reply.questionId === pending.questionId
      );
    },
    isTransformed: ({ event }) =>
      readCaptainOutput(event)?.guard === 'transformed',
    isUnrepresentable: ({ event }) =>
      readCaptainOutput(event)?.guard === 'unrepresentable',
    needsBossReply: ({ event }) =>
      readCaptainOutput(event)?.guard === 'needsBossReply',
  },
  actions: {
    copyTransformationRequest: assign(
      ({ context, event }): Partial<TransformationContext> => {
        const request = resolveRequest(context, event);
        return {
          ...(request.sourcePath !== undefined
            ? { sourcePath: request.sourcePath }
            : {}),
          ...(request.targetPath !== undefined
            ? { targetPath: request.targetPath }
            : {}),
          outcome: undefined,
          lastError: undefined,
          pendingBossQuestion: undefined,
          bossReply: undefined,
        };
      },
    ),
    setPendingBossQuestion: assign(
      ({ event }): Partial<TransformationContext> => {
        const output = readCaptainOutput(event);
        if (output === undefined || output.guard !== 'needsBossReply')
          return {};
        return {
          pendingBossQuestion: {
            questionId: T2G_1_STATE_ID,
            resumeStateId: T2G_1_STATE_ID,
            sourceItem: T2G_1_SOURCE_ITEM,
            asker: { kind: 'captain' },
            question: output.question,
          },
          bossReply: undefined,
        };
      },
    ),
    storeBossReply: assign(({ event }): Partial<TransformationContext> => {
      const reply = readBossReply(event);
      if (reply === undefined) return {};
      return { bossReply: reply.answer };
    }),
    clearBossReplyContext: assign(
      (): Partial<TransformationContext> => ({
        pendingBossQuestion: undefined,
        bossReply: undefined,
      }),
    ),
    recordTransformed: assign(
      (): Partial<TransformationContext> => ({ outcome: 'transformed' }),
    ),
    recordUnrepresentable: assign(
      (): Partial<TransformationContext> => ({ outcome: 'unrepresentable' }),
    ),
    rememberCaptainError: assign(
      ({ event }): Partial<TransformationContext> => ({
        lastError: readErrorFromEvent(event),
      }),
    ),
    rememberInvalidCaptainResult: assign(
      (): Partial<TransformationContext> => ({
        lastError: {
          name: 'MalformedCaptainResult',
          message:
            'Captain returned no result matching a guard declared by GEARS item T2G-1.',
        },
      }),
    ),
    rememberInvalidBossReply: assign(
      (): Partial<TransformationContext> => ({
        lastError: {
          name: 'MalformedBossReply',
          message:
            'BOSS_REPLY carried no usable answer for the pending question.',
        },
      }),
    ),
  },
}).createMachine({
  id: 'text2gears',
  context: ({ input }): TransformationContext => {
    const seed = input ?? {};
    const sourcePath = readText(seed.sourcePath);
    const targetPath = readText(seed.targetPath);
    return {
      ...(sourcePath !== undefined ? { sourcePath } : {}),
      ...(targetPath !== undefined ? { targetPath } : {}),
    };
  },
  initial: 'ready',
  on: {
    BOSS_INTERRUPT: bossInterrupts(BOSS_INTERRUPT_TARGET_IDS),
  },
  states: {
    ready: {
      id: 'ready',
      description:
        'Idle hub awaiting a transformation request that names a text source and a gears target.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'ready',
          description:
            'Idle hub awaiting a transformation request that names a text source and a gears target.',
        },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'namesSourceAndTarget',
          actions: 'copyTransformationRequest',
          target: 'transformSource',
        },
      },
    },
    transformSource: {
      id: 'transformSource',
      description:
        'Captain carries out the text-to-GEARS transformation as specified by item T2G-1.',
      tags: ['playbook.busy'],
      meta: {
        playbook: {
          stateId: 'transformSource',
          description:
            'Captain carries out the text-to-GEARS transformation as specified by item T2G-1.',
        },
      },
      invoke: {
        src: 'captain',
        input: ({ context }): CaptainInput => {
          const pending =
            context.pendingBossQuestion !== undefined &&
            context.pendingBossQuestion.resumeStateId === T2G_1_STATE_ID
              ? context.pendingBossQuestion
              : undefined;
          const bossReply =
            pending !== undefined ? readText(context.bossReply) : undefined;
          return {
            stateId: T2G_1_STATE_ID,
            sourceItem: T2G_1_SOURCE_ITEM,
            prompt: T2G_1_PROMPT,
            result: T2G_1_RESULT,
            ...(pending !== undefined ? { pendingBossQuestion: pending } : {}),
            ...(bossReply !== undefined ? { bossReply } : {}),
          };
        },
        onDone: [
          {
            guard: 'needsBossReply',
            actions: 'setPendingBossQuestion',
            target: 'awaitBossReply',
          },
          {
            guard: 'isTransformed',
            actions: ['recordTransformed', 'clearBossReplyContext'],
            target: 'transformed',
          },
          {
            guard: 'isUnrepresentable',
            actions: ['recordUnrepresentable', 'clearBossReplyContext'],
            target: 'unrepresentable',
          },
          {
            actions: ['rememberInvalidCaptainResult', 'clearBossReplyContext'],
            target: 'failed',
          },
        ],
        onError: {
          actions: ['rememberCaptainError', 'clearBossReplyContext'],
          target: 'failed',
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
          ...resumableStates(RESUMABLE_STATE_IDS),
          {
            actions: ['rememberInvalidBossReply', 'clearBossReplyContext'],
            target: 'failed',
          },
        ],
      },
    },
    failed: {
      id: 'failed',
      description:
        'The transformation stopped on an actor or control error and awaits Boss recovery.',
      tags: ['playbook.parked'],
      meta: {
        playbook: {
          stateId: 'failed',
          description:
            'The transformation stopped on an actor or control error and awaits Boss recovery.',
        },
      },
      on: {
        TRANSFORMATION_REQUEST: {
          guard: 'namesSourceAndTarget',
          actions: 'copyTransformationRequest',
          target: 'transformSource',
        },
      },
    },
    transformed: {
      id: 'transformed',
      type: 'final',
      description:
        'Captain composed the target package of GEARS spec items from the source as specified.',
      meta: {
        playbook: {
          stateId: 'transformed',
          description:
            'Captain composed the target package of GEARS spec items from the source as specified.',
        },
      },
    },
    unrepresentable: {
      id: 'unrepresentable',
      type: 'final',
      description:
        'Captain reported that the source cannot be represented by the current GEARS contract.',
      meta: {
        playbook: {
          stateId: 'unrepresentable',
          description:
            'Captain reported that the source cannot be represented by the current GEARS contract.',
        },
      },
    },
  },
  // Both reachable final states are entered only by an arm that first records
  // the adjudicated outcome, so the status always reflects typed context.
  output: ({ context }): TransformationMachineOutput => ({
    status:
      context.outcome === 'transformed' ? 'transformed' : 'unrepresentable',
  }),
});

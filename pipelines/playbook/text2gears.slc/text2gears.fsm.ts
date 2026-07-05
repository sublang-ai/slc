// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { assign, fromPromise, setup } from 'xstate';

type Player = 'Captain';

export interface PendingBossQuestion {
  resumeStateId: string;
  sourceItem: string;
  player: Player;
  question: string;
}

export interface Text2GearsContext {
  source?: string;
  target?: string;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
  lastResult?: CaptainOutput;
  lastError?: unknown;
}

export interface Text2GearsMachineInput {}

export type Text2GearsEvent =
  | { type: 'START_TEXT_TO_GEARS'; source: string; target: string }
  | { type: 'BOSS_INTERRUPT'; targetId: string }
  | { type: 'BOSS_REPLY'; answer: string };

export interface CaptainInput {
  player: Player;
  sourceItem: 'TEXT2GEARS-10';
  prompt: string;
  result: Record<string, string>;
  source?: string;
  target?: string;
  pendingBossQuestion?: PendingBossQuestion;
  bossReply?: string;
}

export interface CaptainOutput {
  guard: string;
  question?: string;
  [key: string]: unknown;
}

interface CaptainDoneEvent {
  type: string;
  output: CaptainOutput;
}

interface CaptainErrorEvent {
  type: string;
  error: unknown;
}

const TEXT2GEARS_10_PROMPT = [
  'Read the free-form natural-language source from <source>.',
  'Write the package of GEARS spec items to <target>.',
  'Treat the source format as text with extension .md.',
  'Treat the target format as gears with extension .md.',
  'Do not perform the second phase that transforms spec items into a state machine.',
  'Treat players as names for AI agents and the user.',
  'Treat Boss as the human user.',
  'Treat Captain as the coordinating agent.',
  'If the source declares additional players in an opening Players: section, include those players.',
  'Allow a declared player to alias other players with = and |.',
  'Treat Boss as choosing one aliased player at runtime.',
  'Capitalize English player names.',
  'Quote non-English player names when needed to distinguish them from prose.',
  'For each spec item, name a condition, the player to prompt, and the prompt itself.',
  'Write prompts as blockquotes with one point per line.',
  'Write the target in the same language as the source.',
  'If the source is itself the normative specification of a transformation, treat it as declaring no players and prompting none.',
  'If the source is itself the normative specification of a transformation, treat its implied procedure as Captain performing the specified transformation on request.',
  'For a transformation-spec source, compose Captain-acting spec items.',
  "For a transformation-spec source, when a transformation request names the specification's source and target, Captain shall carry out the transformation as specified.",
  "For a transformation-spec source, make prompts carry the specification's normative requirements as instructions to Captain.",
  'Deduplicate identical prompt lines when composing source snippets into a spec item.',
  'Do not invent players, triggers, or requirements for a transformation-spec source.',
  'Make each spec item address one state behavior.',
  'Give each spec item its full final prompt as the static part.',
  'Do not require cross-item composition to simulate a run.',
  "Ensure a human can simulate a run by copying any single item's prompt verbatim.",
  'Use <placeholder> for dynamic values in blockquoted prompts.',
  'Treat everything else inside a blockquote as static text.',
  'Put examples in surrounding prose, not inside blockquoted prompt content.',
  'Resolve Markdown escapes during extraction so compiled artifacts carry plain text.',
  'Partition items by every variable that determines prompt content, including accumulated state when the trigger alone does not.',
  "Drop disjunctive branches incompatible with the rest of an item's condition or prompt.",
  'Do not retain dead branches that would mislead readers or downstream phases.',
].join('\n');

const NEEDS_BOSS_REPLY_DESCRIPTION =
  "The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.";

const captainResult = {
  completed: 'Captain completed the transformation and wrote the target artifact.',
  needsBossReply: NEEDS_BOSS_REPLY_DESCRIPTION,
} satisfies Record<string, string>;

type JumpableStateId =
  | 'ready'
  | 'transformTextToGears'
  | 'awaitBossReply'
  | 'failed';

const jumpableStateIds = [
  'ready',
  'transformTextToGears',
  'awaitBossReply',
  'failed',
] as const satisfies readonly JumpableStateId[];

const resumableStateIds = ['transformTextToGears'] as const;

const bossInterrupts = (ids: readonly string[]) =>
  ids.map((id) => ({
    guard: ({ event }: { event: Text2GearsEvent }) =>
      event.type === 'BOSS_INTERRUPT' && event.targetId === id,
    target: `#${id}`,
    reenter: true,
  }));

const resumableStates = (ids: readonly string[]) =>
  ids.map((id) => ({
    guard: ({ context }: { context: Text2GearsContext }) =>
      context.pendingBossQuestion?.resumeStateId === id,
    target: `#${id}`,
    reenter: true,
    actions: 'rememberBossReply',
  }));

export const text2GearsMachine = setup({
  types: {} as {
    context: Text2GearsContext;
    events: Text2GearsEvent;
    input: Text2GearsMachineInput;
  },
  actors: {
    captain: fromPromise<CaptainOutput, CaptainInput>(async () => {
      throw new Error('captain actor must be provided by the runner');
    }),
  },
  actions: {
    copyStartParameters: assign({
      source: ({ event }) =>
        event.type === 'START_TEXT_TO_GEARS' ? event.source : undefined,
      target: ({ event }) =>
        event.type === 'START_TEXT_TO_GEARS' ? event.target : undefined,
      pendingBossQuestion: undefined,
      bossReply: undefined,
      lastResult: undefined,
      lastError: undefined,
    }),
    rememberCaptainResult: assign({
      lastResult: ({ event }) => (event as CaptainDoneEvent).output,
      lastError: undefined,
    }),
    rememberCaptainError: assign({
      lastError: ({ event }) => (event as CaptainErrorEvent).error,
    }),
    rememberMalformedCaptainOutput: assign({
      lastError: ({ event }) => (event as CaptainDoneEvent).output,
    }),
    rememberMalformedBossReply: assign({
      lastError: ({ event }) => event,
    }),
    setPendingBossQuestion: assign({
      pendingBossQuestion: ({ event }) => {
        const output = (event as CaptainDoneEvent).output;

        return output.guard === 'needsBossReply' && typeof output.question === 'string'
          ? {
              resumeStateId: 'transformTextToGears',
              sourceItem: 'TEXT2GEARS-10',
              player: 'Captain',
              question: output.question,
            }
          : undefined;
      },
      bossReply: undefined,
      lastResult: ({ event }) => (event as CaptainDoneEvent).output,
      lastError: undefined,
    }),
    rememberBossReply: assign({
      bossReply: ({ event }) =>
        event.type === 'BOSS_REPLY' ? event.answer : undefined,
      lastError: undefined,
    }),
    clearBossReplyContext: assign({
      pendingBossQuestion: undefined,
      bossReply: undefined,
    }),
  },
  guards: {
    isCompleted: ({ event }) =>
      (event as CaptainDoneEvent).type ===
        'xstate.done.actor.transformTextToGearsCaptain' &&
      (event as CaptainDoneEvent).output.guard === 'completed',
    needsBossReplyWithQuestion: ({ event }) => {
      const doneEvent = event as CaptainDoneEvent;

      return (
        doneEvent.type === 'xstate.done.actor.transformTextToGearsCaptain' &&
        doneEvent.output.guard === 'needsBossReply' &&
        typeof doneEvent.output.question === 'string' &&
        doneEvent.output.question.trim().length > 0
      );
    },
    needsBossReplyWithoutQuestion: ({ event }) => {
      const doneEvent = event as CaptainDoneEvent;

      return (
        doneEvent.type === 'xstate.done.actor.transformTextToGearsCaptain' &&
        doneEvent.output.guard === 'needsBossReply' &&
        (typeof doneEvent.output.question !== 'string' ||
          doneEvent.output.question.trim().length === 0)
      );
    },
    emptyBossReply: ({ event }) =>
      event.type === 'BOSS_REPLY' && event.answer.trim().length === 0,
  },
}).createMachine({
  id: 'text2Gears',
  context: (): Text2GearsContext => ({}),
  initial: 'ready',
  on: {
    BOSS_INTERRUPT: bossInterrupts(jumpableStateIds),
  },
  states: {
    ready: {
      id: 'ready',
      description: 'Ready to start a Text-to-GEARS transformation.',
      on: {
        START_TEXT_TO_GEARS: {
          target: 'transformTextToGears',
          actions: 'copyStartParameters',
        },
      },
    },
    transformTextToGears: {
      id: 'transformTextToGears',
      description: 'Captain transforms a text source into GEARS spec items.',
      invoke: {
        id: 'transformTextToGearsCaptain',
        src: 'captain',
        input: ({ context }): CaptainInput => ({
          player: 'Captain',
          sourceItem: 'TEXT2GEARS-10',
          prompt: TEXT2GEARS_10_PROMPT,
          result: captainResult,
          source: context.source,
          target: context.target,
          ...(context.pendingBossQuestion
            ? { pendingBossQuestion: context.pendingBossQuestion }
            : {}),
          ...(context.bossReply ? { bossReply: context.bossReply } : {}),
        }),
        onDone: [
          {
            guard: 'needsBossReplyWithQuestion',
            target: 'awaitBossReply',
            actions: 'setPendingBossQuestion',
          },
          {
            guard: 'needsBossReplyWithoutQuestion',
            target: 'failed',
            actions: 'rememberMalformedCaptainOutput',
          },
          {
            guard: 'isCompleted',
            target: 'done',
            actions: ['rememberCaptainResult', 'clearBossReplyContext'],
          },
          {
            target: 'failed',
            actions: ['rememberMalformedCaptainOutput', 'clearBossReplyContext'],
          },
        ],
        onError: {
          target: 'failed',
          actions: ['rememberCaptainError', 'clearBossReplyContext'],
        },
      },
    },
    awaitBossReply: {
      id: 'awaitBossReply',
      description: 'Waiting for Boss to answer a player question.',
      on: {
        BOSS_REPLY: [
          {
            guard: 'emptyBossReply',
            target: 'failed',
            actions: ['rememberMalformedBossReply', 'clearBossReplyContext'],
          },
          ...resumableStates(resumableStateIds),
          {
            target: 'failed',
            actions: ['rememberMalformedBossReply', 'clearBossReplyContext'],
          },
        ],
        START_TEXT_TO_GEARS: {
          target: 'transformTextToGears',
          actions: ['clearBossReplyContext', 'copyStartParameters'],
        },
        BOSS_INTERRUPT: bossInterrupts(jumpableStateIds).map((transition) => ({
          ...transition,
          actions: 'clearBossReplyContext',
        })),
      },
    },
    failed: {
      id: 'failed',
      description: 'The transformation failed and is waiting for Boss recovery.',
      on: {
        START_TEXT_TO_GEARS: {
          target: 'transformTextToGears',
          actions: 'copyStartParameters',
        },
      },
    },
    done: {
      id: 'done',
      description: 'The Text-to-GEARS transformation is complete.',
      type: 'final',
    },
  },
});

export default text2GearsMachine;

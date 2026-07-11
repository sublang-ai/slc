// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// slc link inputs:
// - FSM path: ./text2gears.fsm.ts
// - Player binding: { "Captain": "captain" }
// - Adjudication strategy: LLM-judge for every state
// - Boss-event mapping: free-text judge classification

import { createActor, fromPromise } from 'xstate';
import {
  text2GearsMachine,
  type CaptainInput,
  type CaptainOutput,
  type PendingBossQuestion,
  type Text2GearsEvent,
  type Text2GearsMachineInput,
} from './text2gears.fsm.ts';
import type {
  PlayerResult,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
} from '../../../../node_modules/@sublang/playbook/src/runtime.ts';

export type {
  PlayerResult,
  PlaybookPorts,
  PlaybookRuntime,
  PlaybookRuntimeFactory,
} from '../../../../node_modules/@sublang/playbook/src/runtime.ts';

export type PlaybookRuntimeOptions = Record<string, never>;

type Actor = ReturnType<typeof createActor>;
type Snapshot = ReturnType<Actor['getSnapshot']>;
type StateValue = Snapshot['value'];
type BossEvent = Text2GearsEvent | { type: 'NO_EVENT' };

const playerBinding = {
  Captain: 'captain',
} as const;

const fsmInput: Text2GearsMachineInput = {};

class AdjudicationError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'AdjudicationError';
    this.cause = cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stateValueToString(value: StateValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function isFinalSnapshot(snapshot: Snapshot): boolean {
  return snapshot.status === 'done';
}

function isQuiescentSnapshot(snapshot: Snapshot): boolean {
  const state = stateValueToString(snapshot.value);

  return (
    state === 'ready' ||
    state === 'failed' ||
    state === 'awaitBossReply' ||
    isFinalSnapshot(snapshot)
  );
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('judge returned empty response');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);

    if (!match) {
      throw new Error('judge returned malformed JSON');
    }

    return JSON.parse(match[0]);
  }
}

function assertAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('The operation was aborted.');

    error.name = 'AbortError';
    throw error;
  }
}

function combineSignals(
  actorSignal: AbortSignal,
  turnSignal: AbortSignal | undefined,
): AbortSignal {
  return turnSignal === undefined
    ? actorSignal
    : AbortSignal.any([actorSignal, turnSignal]);
}

function composeStructuredBlocks(input: CaptainInput): string[] {
  const blocks: string[] = [];

  if (input.source) {
    blocks.push(`Source:\n${input.source}`);
  }

  if (input.target) {
    blocks.push(`Target:\n${input.target}`);
  }

  return blocks;
}

export function composePlayerPrompt(input: CaptainInput): string {
  const blocks: string[] = [];

  if (input.pendingBossQuestion && input.bossReply) {
    blocks.push(
      [
        'You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.',
        '',
        'Boss question:',
        input.pendingBossQuestion.question,
        '',
        'Boss reply:',
        input.bossReply,
      ].join('\n'),
    );
  }

  blocks.push(...composeStructuredBlocks(input));
  blocks.push(input.prompt);

  return blocks.join('\n\n');
}

function composeClassifierPrompt(snapshot: Snapshot, text: string): string {
  const context = snapshot.context;
  const pending = context.pendingBossQuestion;
  const pendingBlock = pending
    ? [
        'Pending Boss question:',
        pending.question,
        '',
        'If Boss is answering that question, return BOSS_REPLY with answer.',
      ].join('\n')
    : 'No pending Boss question.';

  return [
    'Classify the Boss input into exactly one JSON object for this FSM.',
    'Return only JSON.',
    '',
    `Current state: ${stateValueToString(snapshot.value)}`,
    pendingBlock,
    '',
    'Valid outputs:',
    '- {"type":"START_TEXT_TO_GEARS","source":"<source path>","target":"<target path>"}',
    '- {"type":"BOSS_INTERRUPT","targetId":"ready|transformTextToGears|awaitBossReply|failed"}',
    '- {"type":"BOSS_REPLY","answer":"<non-empty answer>"}',
    '- {"type":"NO_EVENT"}',
    '',
    'Rules:',
    '- Use START_TEXT_TO_GEARS when Boss asks to run the transformation and supplies or implies source and target paths.',
    '- Use BOSS_INTERRUPT only when Boss asks to jump to a specific active state id.',
    '- Use BOSS_REPLY only when answering the pending Boss question.',
    '- Use NO_EVENT when the input cannot be mapped to a valid event.',
    '',
    'Boss input:',
    text,
  ].join('\n');
}

function parseBossEvent(text: string): BossEvent {
  const parsed = extractJson(text);

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new Error('classifier JSON must include a string type');
  }

  switch (parsed.type) {
    case 'START_TEXT_TO_GEARS':
      if (
        typeof parsed.source !== 'string' ||
        typeof parsed.target !== 'string'
      ) {
        throw new Error('START_TEXT_TO_GEARS requires source and target');
      }

      return {
        type: 'START_TEXT_TO_GEARS',
        source: parsed.source,
        target: parsed.target,
      };
    case 'BOSS_INTERRUPT':
      if (typeof parsed.targetId !== 'string') {
        throw new Error('BOSS_INTERRUPT requires targetId');
      }

      return { type: 'BOSS_INTERRUPT', targetId: parsed.targetId };
    case 'BOSS_REPLY':
      if (typeof parsed.answer !== 'string') {
        throw new Error('BOSS_REPLY requires answer');
      }

      return { type: 'BOSS_REPLY', answer: parsed.answer };
    case 'NO_EVENT':
      return { type: 'NO_EVENT' };
    default:
      throw new Error(`classifier returned unknown event type ${parsed.type}`);
  }
}

function composeAdjudicatorPrompt(
  input: CaptainInput,
  finalText: string,
): string {
  const results = Object.entries(input.result)
    .map(([guard, description]) => `- ${guard}: ${description}`)
    .join('\n');

  return [
    'Adjudicate the player output for one FSM state.',
    'Return only JSON.',
    '',
    `Player: ${input.player}`,
    `Source item: ${input.sourceItem}`,
    '',
    'Valid guard results:',
    results,
    '',
    'Return a JSON object with exactly one declared guard, for example {"guard":"completed"}.',
    'If a result description requires payload fields, include those fields.',
    'Do not interpret, paraphrase, or alter the result descriptions.',
    '',
    'Player output:',
    finalText,
  ].join('\n');
}

function parseAdjudication(text: string, input: CaptainInput): CaptainOutput {
  const parsed = extractJson(text);

  if (!isRecord(parsed) || typeof parsed.guard !== 'string') {
    throw new Error('adjudicator JSON must include a string guard');
  }

  if (!Object.prototype.hasOwnProperty.call(input.result, parsed.guard)) {
    throw new Error(`adjudicator returned undeclared guard ${parsed.guard}`);
  }

  const description = input.result[parsed.guard] ?? '';

  if (
    description.includes('Output shall include `question:') &&
    (typeof parsed.question !== 'string' || parsed.question.trim().length === 0)
  ) {
    throw new Error(`adjudicator guard ${parsed.guard} requires question`);
  }

  return parsed as CaptainOutput;
}

async function adjudicateCaptainOutput(
  ports: PlaybookPorts,
  input: CaptainInput,
  result: PlayerResult,
  signal: AbortSignal,
): Promise<CaptainOutput> {
  if (result.status !== 'ok') {
    throw new Error(result.error ?? `player returned ${result.status}`);
  }

  const finalText = result.finalText ?? '';
  const prompt = composeAdjudicatorPrompt(input, finalText);

  try {
    const judged = await ports.callJudge(prompt, signal);

    assertAbort(signal);

    return parseAdjudication(judged, input);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    throw new AdjudicationError(error);
  }
}

function createCaptainActor(
  ports: PlaybookPorts,
  activeTurnSignal: () => AbortSignal | undefined,
  rememberControlPlaneError: (error: unknown) => void,
) {
  return fromPromise<CaptainOutput, CaptainInput>(async ({ input, signal }) => {
    const activeSignal = combineSignals(signal, activeTurnSignal());
    const playerId = playerBinding[input.player];
    const prompt = composePlayerPrompt(input);
    const playerResult = await ports.callPlayer(playerId, prompt, activeSignal);

    assertAbort(activeSignal);

    try {
      return await adjudicateCaptainOutput(
        ports,
        input,
        playerResult,
        activeSignal,
      );
    } catch (error) {
      if (error instanceof AdjudicationError) {
        rememberControlPlaneError(error);
      }

      throw error;
    }
  });
}

function contextPendingQuestion(
  snapshot: Snapshot,
): PendingBossQuestion | undefined {
  return snapshot.context.pendingBossQuestion;
}

class Text2GearsPlaybookRuntime implements PlaybookRuntime {
  private ports?: PlaybookPorts;
  private actor?: Actor;
  private previousState?: string;
  private emissions: Promise<void> = Promise.resolve();
  private emissionError?: unknown;
  private hasEmissionError = false;
  private controlPlaneError?: unknown;
  private activeTurnSignal?: AbortSignal;

  constructor(_options: PlaybookRuntimeOptions) {
    void _options;
  }

  async init(ports: PlaybookPorts): Promise<void> {
    this.ports = ports;
    this.startActor();
    await this.drainEmissions();
  }

  async handleBossInput(turn: {
    text: string;
    signal: AbortSignal;
  }): Promise<void> {
    const ports = this.requirePorts();
    // A host emission failure may have masked a same-turn adjudicator failure.
    // Never let that saved control-plane fault escape from a later Boss turn.
    this.controlPlaneError = undefined;
    const text = turn.text.trim();

    if (!text) {
      return;
    }

    if (turn.signal.aborted) {
      await this.drainEmissions();
      return;
    }

    if (!this.actor || isFinalSnapshot(this.actor.getSnapshot())) {
      this.stopActor();
      this.startActor();
    }

    const actor = this.requireActor();
    const classifyPrompt = composeClassifierPrompt(
      actor.getSnapshot(),
      turn.text,
    );
    let event: BossEvent;

    try {
      event = parseBossEvent(
        await ports.callJudge(classifyPrompt, turn.signal),
      );
    } catch (error) {
      if (turn.signal.aborted) {
        await this.drainEmissions();
        return;
      }

      throw error;
    }

    if (turn.signal.aborted) {
      await this.drainEmissions();
      return;
    }

    if (event.type === 'NO_EVENT') {
      await this.drainEmissions();
      return;
    }

    this.activeTurnSignal = turn.signal;
    try {
      actor.send(event);
      await this.driveToQuiescence();
      await this.drainEmissions();
      this.throwControlPlaneError();
    } finally {
      this.activeTurnSignal = undefined;
    }
  }

  async dispose(): Promise<void> {
    this.stopActor();
    await this.drainEmissions();
  }

  private startActor(): void {
    const ports = this.requirePorts();
    const machine = text2GearsMachine.provide({
      actors: {
        captain: createCaptainActor(
          ports,
          () => this.activeTurnSignal,
          (error) => {
            this.controlPlaneError = error;
          },
        ),
      },
    });

    this.actor = createActor(machine, {
      input: fsmInput,
    });
    this.previousState = undefined;
    this.actor.subscribe((snapshot) => {
      this.queueSnapshotEmission(snapshot);
    });
    this.actor.start();
  }

  private stopActor(): void {
    this.actor?.stop();
    this.actor = undefined;
    this.previousState = undefined;
  }

  private requirePorts(): PlaybookPorts {
    if (!this.ports) {
      throw new Error('playbook runtime has not been initialized');
    }

    return this.ports;
  }

  private requireActor(): Actor {
    if (!this.actor) {
      throw new Error('playbook actor has not been initialized');
    }

    return this.actor;
  }

  private queueSnapshotEmission(snapshot: Snapshot): void {
    const ports = this.requirePorts();
    const to = stateValueToString(snapshot.value);
    const from = this.previousState;

    if (from === to) {
      return;
    }

    this.previousState = to;
    this.queueEmission(() =>
      ports.emitTelemetry({
        topic: 'playbook.fsm.state',
        payload: {
          from,
          to,
          event: (snapshot as { event?: unknown }).event,
        },
      }),
    );
    this.queueEmission(() =>
      ports.emitStatus(`Entered ${to}.`, {
        from,
        to,
        lastError: to === 'failed' ? snapshot.context.lastError : undefined,
        pendingBossQuestion:
          to === 'awaitBossReply'
            ? contextPendingQuestion(snapshot)
            : undefined,
      }),
    );
  }

  private queueEmission(emit: () => Promise<void>): void {
    this.emissions = this.emissions.then(async () => {
      try {
        await emit();
      } catch (error) {
        if (!this.hasEmissionError) this.emissionError = error;
        this.hasEmissionError = true;
      }
    });
  }

  private async drainEmissions(): Promise<void> {
    await this.emissions;
    if (this.hasEmissionError) {
      const error = this.emissionError;
      this.emissionError = undefined;
      this.hasEmissionError = false;
      throw error;
    }
  }

  private throwControlPlaneError(): void {
    if (!this.controlPlaneError) {
      return;
    }

    const error = this.controlPlaneError;

    this.controlPlaneError = undefined;
    throw error;
  }

  private async driveToQuiescence(): Promise<void> {
    const actor = this.requireActor();

    if (isQuiescentSnapshot(actor.getSnapshot())) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const subscription = actor.subscribe((snapshot) => {
        if (settled || !isQuiescentSnapshot(snapshot)) {
          return;
        }

        settled = true;
        subscription.unsubscribe();
        resolve();
      });
    });
  }
}

export const _internal = {
  composePlayerPrompt,
  composeClassifierPrompt,
  composeAdjudicatorPrompt,
  parseBossEvent,
  parseAdjudication,
};

export const createPlaybookRuntime: PlaybookRuntimeFactory<
  PlaybookRuntimeOptions
> = (options: PlaybookRuntimeOptions = {}) =>
  new Text2GearsPlaybookRuntime(options);

export default createPlaybookRuntime;

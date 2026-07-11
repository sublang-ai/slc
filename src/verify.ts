// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compilation-correctness verification for a compiled `playbook` artifact
 * (IR-007 Task 8; DR-009).
 *
 * A compiled artifact is a judgment-produced program, so `slc` re-checks it
 * against its source. The GEARS↔FSM conformance check verifies that every GEARS
 * item the `text2gears` phase produced maps to exactly one FSM state carrying
 * that item's player binding and its prompt body verbatim, and that no FSM state
 * references an unknown item — so a `gears2fsm` result cannot silently drift from
 * its GEARS source (the [DR-005](../decisions/005-slc-self-hosting-meta-pipeline.md)
 * auditable GEARS-to-FSM mapping).
 *
 * {@link checkGearsFsmConformance} is the deterministic checker over parsed
 * inputs; {@link generateGearsFsmConformanceTest} emits a per-artifact test that
 * runs it beside the artifacts. The checker reads the `text2gears` item format
 * and the `gears2fsm` `invoke.input` contract, not any one artifact, so it holds
 * for every compiled `playbook`. See specs/dev/verification.md.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hashFile } from './hash.js';

/** A GEARS spec item: its id, the player it prompts, and its verbatim prompt body. */
export interface GearsItem {
  id: string;
  player: string;
  prompt: string;
  /** Target id when this item invokes another playbook rather than a player. */
  playbookId?: string;
}

/** A captain-invoking FSM state's introspected binding (`gears2fsm` `invoke.input`). */
export interface CaptainState {
  stateId: string;
  sourceItem: string;
  player: string;
  prompt: string;
  /** The state's per-state guard contract: result key to description. */
  result: Record<string, string>;
  /** Dot-separated config path, present only for a nested state node. */
  statePath?: string;
  /** Malformed binding details retained for fail-closed conformance reporting. */
  bindingFindings?: string[];
}

/** A playbook-actor invocation recovered from an FSM state. */
export interface PlaybookInvocationState {
  stateId: string;
  playbookId: string;
  text: string;
  /** Optional source item emitted by linkers that retain the GEARS identity. */
  sourceItem?: string;
  /** Dot-separated config path, present only for a nested state node. */
  statePath?: string;
  /** Malformed binding details retained for fail-closed conformance reporting. */
  bindingFindings?: string[];
}

/**
 * The Boss-reply result key `gears2fsm` adds to every captain-invoking state's
 * `result` map, and the load-bearing substring its adjudicator-facing
 * description must carry so the runtime's judge requires a `question` payload
 * (gears2fsm.md "Boss-reply suspension"; DR-009).
 */
export const NEEDS_BOSS_REPLY = 'needsBossReply';
export const BOSS_QUESTION_MARKER = 'Output shall include `question:';

/** The minimal XState machine-config shape the introspector walks (`machine.config`). */
export interface MachineConfigLike {
  initial?: string;
  states?: Record<string, StateLike>;
  on?: Record<string, unknown>;
}

interface InvokeLike {
  src?: unknown;
  input?: (arg: { context: Record<string, unknown> }) => unknown;
  onDone?: unknown;
  onError?: unknown;
}

// Optional object fields keep ordinary arrays assignable while letting legacy
// consumers read `state.invoke?.onDone` without first normalizing the shape.
interface InvokeArrayLike extends ReadonlyArray<InvokeLike> {
  src?: unknown;
  input?: (arg: { context: Record<string, unknown> }) => unknown;
  onDone?: unknown;
  onError?: unknown;
}

interface StateLike {
  id?: string;
  initial?: string;
  type?: string;
  meta?: unknown;
  tags?: string | readonly string[];
  states?: Record<string, StateLike>;
  invoke?: InvokeLike | InvokeArrayLike;
  on?: Record<string, unknown>;
  onDone?: unknown;
  onError?: unknown;
}

const ITEM_HEADING = /^###\s+([A-Za-z][\w-]*)\s*$/;
// The `text2gears` item form names a delegated player as "Captain shall prompt
// <Player>" (or a "relay ... to <Player>" variant); English players are
// capitalized, non-English names may be quoted (text2gears.md).
const ITEM_PLAYER =
  /Captain shall (?:prompt|relay\b[^.]*?\bto)\s+(?:"([^"]+)"|“([^”]+)”|([A-Z][\w]*))/;
const ITEM_PLAYBOOK =
  /Captain shall call playbook\s+(?:`([^`]+)`|"([^"]+)"|“([^”]+)”|([A-Za-z0-9][\w.-]*))\s*:/;
// Some items have Captain act directly ("Captain shall <verb> ...") with no
// delegated player; their player is Captain itself.
const CAPTAIN_ACTS = /\bCaptain shall\b/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const SECTION_HEADING = /^##\s/;

/**
 * Parses the GEARS items from a `gears` artifact: each `### <ID>` item's player
 * and its blockquoted prompt body, in document order.
 */
export function parseGearsItems(gears: string): GearsItem[] {
  const items: GearsItem[] = [];
  let current: {
    id: string;
    player: string;
    captainActs: boolean;
    playbookId: string;
    prompt: string[];
  } | null = null;
  const flush = (): void => {
    if (current !== null) {
      const player =
        current.player !== ''
          ? current.player
          : current.captainActs
            ? 'Captain'
            : '';
      items.push({
        id: current.id,
        player,
        prompt: current.prompt.join('\n'),
        ...(current.playbookId !== ''
          ? { playbookId: current.playbookId }
          : {}),
      });
    }
    current = null;
  };
  for (const line of gears.split('\n')) {
    const heading = ITEM_HEADING.exec(line);
    if (heading !== null) {
      flush();
      current = {
        id: heading[1],
        player: '',
        captainActs: false,
        playbookId: '',
        prompt: [],
      };
      continue;
    }
    if (SECTION_HEADING.test(line)) {
      flush();
      continue;
    }
    if (current === null) continue;
    const player = ITEM_PLAYER.exec(line);
    if (player !== null && current.player === '') {
      current.player = player[1] ?? player[2] ?? player[3];
    }
    const playbook = ITEM_PLAYBOOK.exec(line);
    if (playbook !== null && current.playbookId === '') {
      current.playbookId =
        playbook[1] ?? playbook[2] ?? playbook[3] ?? playbook[4];
    }
    if (CAPTAIN_ACTS.test(line)) current.captainActs = true;
    const quote = BLOCKQUOTE.exec(line);
    if (quote !== null) current.prompt.push(quote[1]);
  }
  flush();
  return items;
}

interface StateNodeRef {
  key: string;
  path: readonly string[];
  statePath: string;
  state: StateLike;
}

interface CaptainBinding {
  state: CaptainState;
  node: StateNodeRef;
  invoke: InvokeLike;
  inputFn?: InvokeLike['input'];
}

interface PlaybookBinding {
  state: PlaybookInvocationState;
  node: StateNodeRef;
  invoke: InvokeLike;
}

/** Walks every state node depth-first in declaration order. */
function walkStateNodes(config: MachineConfigLike): StateNodeRef[] {
  const out: StateNodeRef[] = [];
  const visit = (
    states: Record<string, StateLike> | undefined,
    parent: readonly string[],
  ): void => {
    for (const [key, state] of Object.entries(states ?? {})) {
      const path = [...parent, key];
      out.push({ key, path, statePath: path.join('.'), state });
      visit(state.states, path);
    }
  };
  visit(config.states, []);
  return out;
}

/** Normalizes XState's one-or-many invoke declaration to declaration order. */
function normalizeInvokes(invoke: StateLike['invoke']): readonly InvokeLike[] {
  if (invoke === undefined) return [];
  if (Array.isArray(invoke)) {
    return invoke.filter(
      (candidate): candidate is InvokeLike =>
        typeof candidate === 'object' && candidate !== null,
    );
  }
  return typeof invoke === 'object' && invoke !== null ? [invoke] : [];
}

function invocationInput(
  invoke: InvokeLike,
): { value: Record<string, unknown> } | { error: string } | { invalid: true } {
  if (typeof invoke.input !== 'function') return { invalid: true };
  let value: unknown;
  try {
    value = invoke.input({ context: {} });
  } catch (error) {
    return { error: messageOf(error) };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { invalid: true };
  }
  return { value: value as Record<string, unknown> };
}

function publicStateId(
  node: StateNodeRef,
  input: Record<string, unknown> | undefined,
): string {
  if (isNonEmptyString(input?.stateId)) return input.stateId;
  if (isNonEmptyString(node.state.id)) return node.state.id;
  return node.path.length === 1 ? node.key : node.statePath;
}

function nestedStatePath(node: StateNodeRef): { statePath: string } | object {
  return node.path.length > 1 ? { statePath: node.statePath } : {};
}

function metadataStateId(state: StateLike): string | undefined {
  if (typeof state.meta !== 'object' || state.meta === null) return undefined;
  const playbook = (state.meta as { playbook?: unknown }).playbook;
  if (typeof playbook !== 'object' || playbook === null) return undefined;
  const stateId = (playbook as { stateId?: unknown }).stateId;
  return isNonEmptyString(stateId) ? stateId : undefined;
}

function stateIdConsistencyFindings(
  node: StateNodeRef,
  inputStateId: unknown,
): string[] {
  if (!isNonEmptyString(inputStateId)) return [];
  const findings: string[] = [];
  if (isNonEmptyString(node.state.id) && node.state.id !== inputStateId) {
    findings.push(
      `invoke.input.stateId "${inputStateId}" does not match state.id "${node.state.id}"`,
    );
  }
  const metaStateId = metadataStateId(node.state);
  if (metaStateId !== undefined && metaStateId !== inputStateId) {
    findings.push(
      `invoke.input.stateId "${inputStateId}" does not match state.meta.playbook.stateId "${metaStateId}"`,
    );
  }
  return findings;
}

function enumerateCaptainBindings(config: MachineConfigLike): CaptainBinding[] {
  const out: CaptainBinding[] = [];
  for (const node of walkStateNodes(config)) {
    for (const invoke of normalizeInvokes(node.state.invoke)) {
      const source = invokeSource(invoke.src);
      const explicitlyCaptain = source === 'captain';
      if (!explicitlyCaptain && invoke.src !== undefined) continue;
      const inspected = invocationInput(invoke);
      if ('error' in inspected) {
        if (explicitlyCaptain) {
          out.push({
            state: malformedCaptainState(
              publicStateId(node, undefined),
              `invoke.input threw during introspection: ${inspected.error}`,
              node,
            ),
            node,
            invoke,
            inputFn: invoke.input,
          });
        }
        continue;
      }
      if ('invalid' in inspected) {
        if (explicitlyCaptain) {
          out.push({
            state: malformedCaptainState(
              publicStateId(node, undefined),
              typeof invoke.input === 'function'
                ? 'invoke.input returned a non-object'
                : 'invoke.input is not a function',
              node,
            ),
            node,
            invoke,
            inputFn: invoke.input,
          });
        }
        continue;
      }
      const fields = inspected.value;
      // Preserve the legacy sourceItem-recognition path only when no explicit
      // actor is named. A playbook actor carrying source metadata is not a
      // player invocation.
      if (
        !explicitlyCaptain &&
        (invoke.src !== undefined || !isNonEmptyString(fields.sourceItem))
      ) {
        continue;
      }

      const bindingFindings: string[] = [];
      if (!isNonEmptyString(fields.sourceItem)) {
        bindingFindings.push(
          'invoke.input.sourceItem is not a non-empty string',
        );
      }
      if (typeof fields.player !== 'string') {
        bindingFindings.push('invoke.input.player is not a string');
      }
      if (typeof fields.prompt !== 'string') {
        bindingFindings.push('invoke.input.prompt is not a string');
      }
      if (!isStringMap(fields.result)) {
        bindingFindings.push(
          'invoke.input.result is not a string-valued object',
        );
      }
      if (node.path.length > 1 && !isNonEmptyString(fields.stateId)) {
        bindingFindings.push(
          'nested invoke.input.stateId is not a non-empty string',
        );
      }
      bindingFindings.push(...stateIdConsistencyFindings(node, fields.stateId));
      if (Object.keys(node.state.states ?? {}).length > 0) {
        bindingFindings.push(
          'captain invocation is declared on a compound state instead of a leaf',
        );
      }
      out.push({
        state: {
          stateId: publicStateId(node, fields),
          sourceItem: isNonEmptyString(fields.sourceItem)
            ? fields.sourceItem
            : '',
          player: typeof fields.player === 'string' ? fields.player : '',
          prompt: typeof fields.prompt === 'string' ? fields.prompt : '',
          result: resultMap(fields.result),
          ...nestedStatePath(node),
          ...(bindingFindings.length > 0 ? { bindingFindings } : {}),
        },
        node,
        invoke,
        inputFn: invoke.input,
      });
    }
  }
  return out;
}

/**
 * Enumerates a machine's captain-invoking states from its config, reading each
 * state's `invoke.input` under a stub context to recover the static `sourceItem`,
 * `player`, and `prompt` the `gears2fsm` contract carries.
 */
export function enumerateCaptainStates(
  config: MachineConfigLike,
): CaptainState[] {
  return enumerateCaptainBindings(config).map(({ state }) => state);
}

function enumeratePlaybookBindings(
  config: MachineConfigLike,
): PlaybookBinding[] {
  const out: PlaybookBinding[] = [];
  for (const node of walkStateNodes(config)) {
    for (const invoke of normalizeInvokes(node.state.invoke)) {
      if (invokeSource(invoke.src) !== 'playbook') continue;
      const inspected = invocationInput(invoke);
      if ('error' in inspected) {
        out.push({
          state: malformedPlaybookState(
            publicStateId(node, undefined),
            `invoke.input threw during introspection: ${inspected.error}`,
            node,
          ),
          node,
          invoke,
        });
        continue;
      }
      if ('invalid' in inspected) {
        out.push({
          state: malformedPlaybookState(
            publicStateId(node, undefined),
            typeof invoke.input === 'function'
              ? 'invoke.input returned a non-object'
              : 'invoke.input is not a function',
            node,
          ),
          node,
          invoke,
        });
        continue;
      }
      const fields = inspected.value;
      const bindingFindings: string[] = [];
      if (!isNonEmptyString(fields.stateId)) {
        bindingFindings.push('invoke.input.stateId is not a non-empty string');
      }
      if (!isNonEmptyString(fields.playbookId)) {
        bindingFindings.push(
          'invoke.input.playbookId is not a non-empty string',
        );
      }
      if (typeof fields.text !== 'string') {
        bindingFindings.push('invoke.input.text is not a string');
      }
      bindingFindings.push(...stateIdConsistencyFindings(node, fields.stateId));
      if (Object.keys(node.state.states ?? {}).length > 0) {
        bindingFindings.push(
          'playbook invocation is declared on a compound state instead of a leaf',
        );
      }
      out.push({
        state: {
          stateId: publicStateId(node, fields),
          playbookId: isNonEmptyString(fields.playbookId)
            ? fields.playbookId
            : '',
          text: typeof fields.text === 'string' ? fields.text : '',
          ...(isNonEmptyString(fields.sourceItem)
            ? { sourceItem: fields.sourceItem }
            : {}),
          ...nestedStatePath(node),
          ...(bindingFindings.length > 0 ? { bindingFindings } : {}),
        },
        node,
        invoke,
      });
    }
  }
  return out;
}

/** Enumerates typed `playbook` actor calls across the complete state tree. */
export function enumeratePlaybookStates(
  config: MachineConfigLike,
): PlaybookInvocationState[] {
  return enumeratePlaybookBindings(config).map(({ state }) => state);
}

function malformedCaptainState(
  stateId: string,
  finding: string,
  node?: StateNodeRef,
): CaptainState {
  return {
    stateId,
    sourceItem: '',
    player: '',
    prompt: '',
    result: {},
    ...(node === undefined ? {} : nestedStatePath(node)),
    bindingFindings: [finding],
  };
}

function malformedPlaybookState(
  stateId: string,
  finding: string,
  node: StateNodeRef,
): PlaybookInvocationState {
  return {
    stateId,
    playbookId: '',
    text: '',
    ...nestedStatePath(node),
    bindingFindings: [finding],
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/** Narrows a state's `invoke.input.result` to its string-described guard keys. */
function resultMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [key, description] of Object.entries(value)) {
    if (typeof description === 'string') out[key] = description;
  }
  return out;
}

/**
 * Checks GEARS↔FSM conformance and returns human-readable findings (empty when
 * conformant): every GEARS item maps to one state with the same player and the
 * prompt verbatim, every captain state references a known item, and every
 * captain state's `result` map declares the Boss-reply suspension key with its
 * adjudicator contract (VERIFY-1, VERIFY-3; DR-009).
 */
export function checkGearsFsmConformance(
  gears: string,
  config: MachineConfigLike,
): string[] {
  const items = parseGearsItems(gears);
  const states = enumerateCaptainStates(config);
  const playbookStates = enumeratePlaybookStates(config);
  const findings: string[] = [];

  for (const state of states) {
    findings.push(
      ...(state.bindingFindings ?? []).map(
        (finding) => `FSM state ${state.stateId}: ${finding}`,
      ),
    );
  }
  for (const state of playbookStates) {
    findings.push(
      ...(state.bindingFindings ?? []).map(
        (finding) => `FSM playbook state ${state.stateId}: ${finding}`,
      ),
    );
  }

  const statesByItem = new Map<string, CaptainState[]>();
  for (const state of states) {
    if (state.sourceItem === '') continue;
    const matched = statesByItem.get(state.sourceItem);
    if (matched === undefined) statesByItem.set(state.sourceItem, [state]);
    else matched.push(state);
  }

  const playbookItems = items.filter(
    (item): item is GearsItem & { playbookId: string } =>
      item.playbookId !== undefined,
  );
  const matchedPlaybookStates = new Set<PlaybookInvocationState>();
  const playbookMatchesByItem = new Map<GearsItem, PlaybookInvocationState[]>();
  const playbookItemsByState = new Map<PlaybookInvocationState, string[]>();
  const addPlaybookMatch = (
    item: GearsItem,
    state: PlaybookInvocationState,
  ): void => {
    const matchedStates = playbookMatchesByItem.get(item);
    if (matchedStates === undefined) {
      playbookMatchesByItem.set(item, [state]);
    } else {
      matchedStates.push(state);
    }
    const matchedItems = playbookItemsByState.get(state);
    if (matchedItems === undefined) {
      playbookItemsByState.set(state, [item.id]);
    } else {
      matchedItems.push(item.id);
    }
    matchedPlaybookStates.add(state);
  };

  // An explicit sourceItem is authoritative, including when its target or text
  // drifted; retaining that pairing lets conformance report the precise drift.
  for (const state of playbookStates) {
    if (state.sourceItem === undefined) continue;
    for (const item of playbookItems) {
      if (item.id === state.sourceItem) addPlaybookMatch(item, state);
    }
  }

  // The PlaybookInput contract does not require sourceItem. Pair otherwise
  // indistinguishable calls by signature and declaration order, comparing each
  // signature as a multiset. Equal duplicate cardinalities are conformant;
  // surplus items or states remain unmatched and are reported below.
  const signature = (playbookId: string, text: string): string =>
    JSON.stringify([playbookId, text]);
  const itemsBySignature = new Map<
    string,
    Array<GearsItem & { playbookId: string }>
  >();
  for (const item of playbookItems) {
    if ((playbookMatchesByItem.get(item)?.length ?? 0) > 0) continue;
    const key = signature(item.playbookId, item.prompt);
    const grouped = itemsBySignature.get(key);
    if (grouped === undefined) itemsBySignature.set(key, [item]);
    else grouped.push(item);
  }
  const statesBySignature = new Map<string, PlaybookInvocationState[]>();
  for (const state of playbookStates) {
    if (state.sourceItem !== undefined) continue;
    const key = signature(state.playbookId, state.text);
    const grouped = statesBySignature.get(key);
    if (grouped === undefined) statesBySignature.set(key, [state]);
    else grouped.push(state);
  }
  for (const [key, groupedItems] of itemsBySignature) {
    const groupedStates = statesBySignature.get(key) ?? [];
    const pairs = Math.min(groupedItems.length, groupedStates.length);
    for (let index = 0; index < pairs; index += 1) {
      addPlaybookMatch(groupedItems[index], groupedStates[index]);
    }
  }

  for (const item of items) {
    if (item.playbookId !== undefined) {
      const matched = playbookMatchesByItem.get(item) ?? [];
      if (matched.length === 0) {
        findings.push(`GEARS item ${item.id} maps to no FSM playbook state`);
        continue;
      }
      if (matched.length > 1) {
        findings.push(
          `GEARS item ${item.id} maps to ${matched.length} FSM playbook states (expected exactly one: ${matched.map((state) => state.stateId).join(', ')})`,
        );
      }
      const state = matched[0];
      if (state.playbookId !== item.playbookId) {
        findings.push(
          `${item.id}: FSM playbook "${state.playbookId}" is not GEARS playbook "${item.playbookId}"`,
        );
      }
      if (state.text !== item.prompt) {
        findings.push(
          `${item.id}: FSM playbook text is not the GEARS prompt verbatim`,
        );
      }
      continue;
    }
    const matched = statesByItem.get(item.id) ?? [];
    if (matched.length === 0) {
      findings.push(`GEARS item ${item.id} maps to no FSM state`);
      continue;
    }
    if (matched.length > 1) {
      findings.push(
        `GEARS item ${item.id} maps to ${matched.length} FSM states (expected exactly one: ${matched.map((s) => s.stateId).join(', ')})`,
      );
    }
    const state = matched[0];
    if (state.player !== item.player) {
      findings.push(
        `${item.id}: FSM player "${state.player}" is not GEARS player "${item.player}"`,
      );
    }
    if (state.prompt !== item.prompt) {
      findings.push(`${item.id}: FSM prompt is not the GEARS prompt verbatim`);
    }
  }
  const itemIds = new Set(items.map((item) => item.id));
  const playbookItemIds = new Set(playbookItems.map((item) => item.id));
  for (const state of states) {
    if (state.sourceItem !== '' && !itemIds.has(state.sourceItem)) {
      findings.push(
        `FSM state ${state.stateId} references unknown GEARS item ${state.sourceItem}`,
      );
    }
    // Every captain-invoking state supports Boss-reply suspension: its result
    // map carries `needsBossReply` with the adjudicator-facing contract text
    // (gears2fsm.md; VERIFY-3).
    const bossReply = state.result[NEEDS_BOSS_REPLY];
    if (bossReply === undefined) {
      findings.push(
        `FSM state ${state.stateId} declares no ${NEEDS_BOSS_REPLY} result`,
      );
    } else if (!bossReply.includes(BOSS_QUESTION_MARKER)) {
      findings.push(
        `FSM state ${state.stateId}: ${NEEDS_BOSS_REPLY} description lacks the ${BOSS_QUESTION_MARKER}\` contract`,
      );
    }
  }
  for (const state of playbookStates) {
    const matchedItems = playbookItemsByState.get(state) ?? [];
    if (matchedItems.length > 1) {
      findings.push(
        `FSM playbook state ${state.stateId} maps to ${matchedItems.length} GEARS playbook-call items (expected exactly one: ${matchedItems.join(', ')})`,
      );
    }
    if (
      state.sourceItem !== undefined &&
      !playbookItemIds.has(state.sourceItem)
    ) {
      findings.push(
        `FSM playbook state ${state.stateId} references unknown GEARS playbook item ${state.sourceItem}`,
      );
    } else if (!matchedPlaybookStates.has(state)) {
      findings.push(
        `FSM playbook state ${state.stateId} maps to no GEARS playbook-call item`,
      );
    }
  }
  return findings;
}

/*
 * Machine introspection (VERIFY-4).
 *
 * `pinIntrospection` reduces a machine config to its structural facts — the
 * captain-state bindings, every transition arm, the root and quiescent event
 * surfaces, and the `BOSS_INTERRUPT` jumpable set — computed once at build time
 * and baked into the emitted introspection test, so any unintended topology
 * change to the artifact fails the test (DR-009).
 */

/** The `gears2fsm`-mandated root pre-emption event name. */
export const INTERRUPT_EVENT = 'BOSS_INTERRUPT';
/** The `gears2fsm`-mandated Boss-reply event and wait-state names. */
export const BOSS_REPLY_EVENT = 'BOSS_REPLY';
export const AWAIT_BOSS_REPLY_STATE = 'awaitBossReply';

/** One normalized transition arm of an `onDone`/`onError`/`on` declaration. */
export interface TransitionArm {
  index: number;
  /** Target state key/id with any leading `#` stripped; null for a target-less arm. */
  target: string | null;
  guarded: boolean;
}

/** Event name to its normalized transition arms. */
export type EventArms = Record<string, TransitionArm[]>;

/** One state node in the optional recursive topology for compound machines. */
export interface StructuredStatePin {
  path: string;
  parent: string | null;
  id: string | null;
  type: string | null;
  initial: string | null;
  tags: string[];
  children: string[];
  invokes: string[];
  onDone: TransitionArm[];
  onError: TransitionArm[];
  on: EventArms;
}

/** The structural facts {@link pinIntrospection} pins for a machine (VERIFY-4). */
export interface IntrospectionPins {
  initial: string | null;
  /** Captain-invoking states, in declaration order. */
  captain: {
    state: string;
    path?: string;
    sourceItem: string;
    player: string;
    resultKeys: string[];
    onDone: TransitionArm[];
    onError: TransitionArm[];
    on: EventArms;
  }[];
  /** Non-captain states: finality and event surface. */
  quiescent: { state: string; final: boolean; on: EventArms }[];
  /** Root-level event surface. */
  rootOn: EventArms;
  /** Root `BOSS_INTERRUPT` targets in arm order — the jumpable set. */
  interruptTargets: string[];
  /** Playbook-actor bindings, omitted when a machine declares none. */
  playbook?: {
    state: string;
    path?: string;
    playbookId: string;
    sourceItem?: string;
    onDone: TransitionArm[];
    onError: TransitionArm[];
    on: EventArms;
  }[];
  /** Recursive topology, omitted to preserve flat-machine pin bytes. */
  structured?: { states: StructuredStatePin[] };
}

/**
 * Normalizes an XState transition declaration — a string target, a
 * target/guard/actions object, or an array of either — into ordered
 * {@link TransitionArm}s.
 */
export function normalizeArms(raw: unknown): TransitionArm[] {
  const arms = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return arms.map((arm, index) => {
    if (typeof arm === 'string') {
      return { index, target: stripHash(arm), guarded: false };
    }
    if (typeof arm === 'object' && arm !== null) {
      const record = arm as { target?: unknown; guard?: unknown };
      return {
        index,
        target:
          typeof record.target === 'string' ? stripHash(record.target) : null,
        guarded: record.guard !== undefined,
      };
    }
    return { index, target: null, guarded: false };
  });
}

function stripHash(target: string): string {
  return target.startsWith('#') ? target.slice(1) : target;
}

function eventArms(on: Record<string, unknown> | undefined): EventArms {
  const out: EventArms = {};
  for (const [event, raw] of Object.entries(on ?? {})) {
    out[event] = normalizeArms(raw);
  }
  return out;
}

function normalizedTags(tags: StateLike['tags']): string[] {
  if (typeof tags === 'string') return [tags];
  return Array.isArray(tags)
    ? tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
}

function invokeSource(src: unknown): string | null {
  if (typeof src === 'string') return src;
  if (
    typeof src === 'object' &&
    src !== null &&
    'type' in src &&
    typeof src.type === 'string'
  ) {
    return src.type;
  }
  return null;
}

/**
 * Reduces a machine config to the structural facts the emitted introspection
 * test pins (VERIFY-4): captain bindings with result keys and every transition
 * arm, the quiescent states' event surfaces, the root event surface, and the
 * `BOSS_INTERRUPT` jumpable set.
 */
export function pinIntrospection(config: MachineConfigLike): IntrospectionPins {
  const nodes = walkStateNodes(config);
  const captainBindings = enumerateCaptainBindings(config);
  const playbookBindings = enumeratePlaybookBindings(config);
  const invokingPaths = new Set([
    ...captainBindings.map(({ node }) => node.statePath),
    ...playbookBindings.map(({ node }) => node.statePath),
  ]);
  const captain: IntrospectionPins['captain'] = [];
  const quiescent: IntrospectionPins['quiescent'] = [];
  for (const binding of captainBindings) {
    captain.push({
      state: binding.state.stateId,
      ...(binding.state.statePath !== undefined
        ? { path: binding.state.statePath }
        : {}),
      sourceItem: binding.state.sourceItem,
      player: binding.state.player,
      resultKeys: Object.keys(binding.state.result).sort(),
      onDone: normalizeArms(binding.invoke.onDone),
      onError: normalizeArms(binding.invoke.onError),
      on: eventArms(binding.node.state.on),
    });
  }
  for (const [stateId, state] of Object.entries(config.states ?? {})) {
    if (!invokingPaths.has(stateId)) {
      quiescent.push({
        state: stateId,
        final: state.type === 'final',
        on: eventArms(state.on),
      });
    }
  }
  const rootOn = eventArms(config.on);
  const interruptTargets = (rootOn[INTERRUPT_EVENT] ?? [])
    .map((arm) => arm.target)
    .filter((target): target is string => target !== null);
  const playbook: NonNullable<IntrospectionPins['playbook']> =
    playbookBindings.map((binding) => ({
      state: binding.state.stateId,
      ...(binding.state.statePath !== undefined
        ? { path: binding.state.statePath }
        : {}),
      playbookId: binding.state.playbookId,
      ...(binding.state.sourceItem !== undefined
        ? { sourceItem: binding.state.sourceItem }
        : {}),
      onDone: normalizeArms(binding.invoke.onDone),
      onError: normalizeArms(binding.invoke.onError),
      on: eventArms(binding.node.state.on),
    }));
  const hasStructuredTopology = nodes.some(
    ({ path, state }) =>
      path.length > 1 ||
      state.type === 'parallel' ||
      Object.keys(state.states ?? {}).length > 0,
  );
  const structured = hasStructuredTopology
    ? {
        states: nodes.map(({ path, state, statePath }) => ({
          path: statePath,
          parent: path.length > 1 ? path.slice(0, -1).join('.') : null,
          id: typeof state.id === 'string' ? state.id : null,
          type: typeof state.type === 'string' ? state.type : null,
          initial: typeof state.initial === 'string' ? state.initial : null,
          tags: normalizedTags(state.tags),
          children: Object.keys(state.states ?? {}),
          invokes: normalizeInvokes(state.invoke)
            .map(({ src }) => invokeSource(src))
            .filter((source): source is string => source !== null),
          onDone: normalizeArms(state.onDone),
          onError: normalizeArms(state.onError),
          on: eventArms(state.on),
        })),
      }
    : undefined;
  return {
    initial: typeof config.initial === 'string' ? config.initial : null,
    captain,
    quiescent,
    rootOn,
    interruptTargets,
    ...(playbook.length > 0 ? { playbook } : {}),
    ...(structured !== undefined ? { structured } : {}),
  };
}

/*
 * Prompt-contract capture and composition checks (VERIFY-5).
 *
 * The contract is derived from the artifacts, never hand-authored: context
 * reads are traced through each state's `invoke.input` thunk with a recording
 * proxy, wiring by sentinel values, placeholders by scanning the prompt body,
 * and substitution by composing with sentinels and observing which tokens the
 * linked composer replaces. The derived facts are pinned into the emitted test
 * so contract drift fails it (DR-009).
 */

/** The exact continuation preamble the link contract mandates (link.md). */
export const CONTINUATION_PREAMBLE =
  'You previously paused this task to ask Boss a question; Boss has now replied. Continue the same task using the reply below.';
export const BOSS_QUESTION_LABEL = 'Boss question:';
export const BOSS_REPLY_LABEL = 'Boss reply:';

/** One captain state's derived prompt contract (VERIFY-5). */
export interface PromptContractRow {
  state: string;
  sourceItem: string;
  player: string;
  /** Context fields the state's input thunk reads. */
  reads: string[];
  /** Input fields carrying a read context field's value, by sentinel tracing. */
  wires: Record<string, string[]>;
  /** `<...>` placeholder tokens in the prompt body, first-appearance order. */
  placeholders: string[];
}

const PLACEHOLDER = /<[^\s<>`]{1,60}>/g;

/** Lists the distinct `<...>` placeholder tokens in a prompt body, in order. */
export function placeholdersIn(prompt: string): string[] {
  const seen: string[] = [];
  for (const token of prompt.match(PLACEHOLDER) ?? []) {
    if (!seen.includes(token)) seen.push(token);
  }
  return seen;
}

const sentinelFor = (field: string): string => `«${field}»`;

/**
 * Traces which context fields an `invoke.input` thunk reads, via a recording
 * proxy context; reads collected up to a throw are kept.
 */
export function probeContextReads(
  inputFn: (arg: { context: Record<string, unknown> }) => unknown,
): string[] {
  const reads = new Set<string>();
  const context = new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (typeof prop === 'string') reads.add(prop);
      return undefined;
    },
    has() {
      return true;
    },
  });
  try {
    inputFn({ context });
  } catch {
    // Reads observed before the throw still pin the contract.
  }
  return [...reads].sort();
}

function sentinelContext(reads: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(reads.map((field) => [field, sentinelFor(field)]));
}

// The gears2fsm-normative Boss-reply context fields: present only on a
// continuation turn, so an ordinary-turn probe must leave them unset.
const BOSS_CONTEXT_FIELDS = ['pendingBossQuestion', 'bossReply'];

function ordinaryContext(reads: readonly string[]): Record<string, unknown> {
  return sentinelContext(
    reads.filter((field) => !BOSS_CONTEXT_FIELDS.includes(field)),
  );
}

function carriesSentinel(value: unknown, sentinel: string): boolean {
  try {
    return (JSON.stringify(value) ?? '').includes(sentinel);
  } catch {
    return false;
  }
}

/**
 * Derives every captain state's prompt contract from the machine config
 * (VERIFY-5): traced context reads, sentinel-traced input wiring, and the
 * prompt body's placeholder tokens.
 */
export function capturePromptContract(
  config: MachineConfigLike,
): PromptContractRow[] {
  const rows: PromptContractRow[] = [];
  for (const binding of enumerateCaptainBindings(config)) {
    const { state, inputFn } = binding;
    if (typeof inputFn !== 'function') continue;
    const reads = probeContextReads(inputFn);
    const wires: Record<string, string[]> = {};
    try {
      const input = inputFn({ context: sentinelContext(reads) });
      if (typeof input === 'object' && input !== null) {
        for (const [key, value] of Object.entries(input)) {
          const carried = reads.filter((field) =>
            carriesSentinel(value, sentinelFor(field)),
          );
          if (carried.length > 0) wires[key] = carried;
        }
      }
    } catch {
      // Wiring stays empty; the traced reads alone still pin the contract.
    }
    rows.push({
      state: state.stateId,
      sourceItem: state.sourceItem,
      player: state.player,
      reads,
      wires,
      placeholders: placeholdersIn(state.prompt),
    });
  }
  return rows;
}

/**
 * Derives, per captain state, which of its prompt's placeholder tokens the
 * linked composer substitutes when the wired context is present — pinned into
 * the emitted test so a token that later leaks unsubstituted fails it
 * (VERIFY-5).
 */
export function deriveSubstitutions(
  config: MachineConfigLike,
  compose: (input: unknown) => string,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const binding of enumerateCaptainBindings(config)) {
    const { state, inputFn } = binding;
    if (typeof inputFn !== 'function') continue;
    try {
      const reads = probeContextReads(inputFn);
      const composed = compose(inputFn({ context: ordinaryContext(reads) }));
      if (typeof composed !== 'string') {
        out[state.stateId] = [];
        continue;
      }
      // A placeholder counts as substituted only when the exact body survives
      // on its source line and that token's position carries one of the context
      // sentinels. Derive line-by-line so an unrelated mutated line does not
      // hide valid evidence, while merely deleting a token still cannot
      // masquerade as substitution.
      const evidenced = new Set<string>();
      for (const line of state.prompt.split('\n')) {
        for (const token of matchPromptBody(line, composed, reads)
          ?.substitutions ?? []) {
          evidenced.add(token);
        }
      }
      out[state.stateId] = placeholdersIn(state.prompt).filter((token) =>
        evidenced.has(token),
      );
    } catch {
      out[state.stateId] = [];
    }
  }
  return out;
}

/**
 * Checks the linked composer against the link contract for every captain state
 * (VERIFY-5), returning findings (empty when conformant): the prompt body is
 * preserved modulo substituted placeholders, the adjudicator-facing Boss-reply
 * contract never leaks into a player prompt, no continuation appears on an
 * ordinary turn, and a Boss-reply continuation turn opens with the exact
 * preamble and labelled Q&A blocks before the body.
 */
export function checkPromptComposition(opts: {
  config: MachineConfigLike;
  compose: (input: unknown) => string;
}): string[] {
  const findings: string[] = [];
  const substitutions = deriveSubstitutions(opts.config, opts.compose);
  for (const binding of enumerateCaptainBindings(opts.config)) {
    const { state, inputFn } = binding;
    if (typeof inputFn !== 'function') continue;
    const reads = probeContextReads(inputFn);
    const substituted = substitutions[state.stateId] ?? [];

    let ordinary: string;
    try {
      ordinary = opts.compose(inputFn({ context: ordinaryContext(reads) }));
      if (typeof ordinary !== 'string') {
        throw new Error('composePlayerPrompt returned a non-string value');
      }
    } catch (error) {
      findings.push(
        `${state.stateId}: composePlayerPrompt threw on an ordinary turn: ${messageOf(error)}`,
      );
      continue;
    }
    findings.push(
      ...bodyFindings(state, ordinary, substituted, reads, 'ordinary'),
    );
    // A self-hosted playbook's domain body may legitimately quote the
    // adjudicator contract or the continuation texts (it instructs a compiler
    // about them); only occurrences the composer ADDS beyond the body's own
    // are leaks.
    if (
      occurrences(ordinary, BOSS_QUESTION_MARKER) >
      occurrences(state.prompt, BOSS_QUESTION_MARKER)
    ) {
      findings.push(
        `${state.stateId}: the adjudicator-facing ${NEEDS_BOSS_REPLY} contract leaks into the player prompt`,
      );
    }
    if (
      [CONTINUATION_PREAMBLE, BOSS_QUESTION_LABEL, BOSS_REPLY_LABEL].some(
        (needle) =>
          occurrences(ordinary, needle) > occurrences(state.prompt, needle),
      )
    ) {
      findings.push(
        `${state.stateId}: continuation blocks appear on an ordinary turn`,
      );
    }

    // A Boss-reply continuation turn: the thunk carries the pending question
    // and reply, and the composer opens with the exact preamble and labelled
    // Q&A blocks before the domain body (gears2fsm.md, link.md).
    const question = sentinelFor('question');
    const reply = sentinelFor('bossReply');
    let continuation: string;
    let input: unknown;
    try {
      input = inputFn({
        context: {
          ...ordinaryContext(reads),
          pendingBossQuestion: {
            resumeStateId: state.stateId,
            sourceItem: state.sourceItem,
            player: state.player,
            question,
          },
          bossReply: reply,
        },
      });
      continuation = opts.compose(input);
      if (typeof continuation !== 'string') {
        throw new Error('composePlayerPrompt returned a non-string value');
      }
    } catch (error) {
      findings.push(
        `${state.stateId}: composePlayerPrompt threw on a continuation turn: ${messageOf(error)}`,
      );
      continue;
    }
    if (!carriesSentinel(input, question) || !carriesSentinel(input, reply)) {
      findings.push(
        `${state.stateId}: invoke.input does not carry pendingBossQuestion/bossReply for a continuation turn`,
      );
      continue;
    }
    if (!continuation.startsWith(`${CONTINUATION_PREAMBLE}\n\n`)) {
      findings.push(
        `${state.stateId}: a continuation turn does not open with the exact preamble`,
      );
    }
    const bodyStart = bodyIndex(state, continuation, substituted, reads);
    const questionBlock = `${BOSS_QUESTION_LABEL}\n${question}`;
    const replyBlock = `${BOSS_REPLY_LABEL}\n${reply}`;
    for (const [label, value] of [
      [BOSS_QUESTION_LABEL, questionBlock],
      [BOSS_REPLY_LABEL, replyBlock],
    ] as const) {
      // The composer must ADD the labelled block (beyond any body-carried
      // occurrence), with its sentinel value immediately below the label and
      // before the body.
      const at = continuation.indexOf(value);
      if (
        occurrences(continuation, value) <= occurrences(state.prompt, value)
      ) {
        findings.push(
          `${state.stateId}: a continuation turn lacks the "${label}" block`,
        );
      } else if (bodyStart !== -1 && at > bodyStart) {
        findings.push(
          `${state.stateId}: the "${label}" block appears after the domain prompt body`,
        );
      }
    }
    const exactContinuationPrefix = `${CONTINUATION_PREAMBLE}\n\n${questionBlock}\n\n${replyBlock}\n\n`;
    if (!continuation.startsWith(exactContinuationPrefix)) {
      findings.push(
        `${state.stateId}: a continuation turn does not preserve the exact ordered Boss question/reply blocks`,
      );
    }
    findings.push(
      ...bodyFindings(state, continuation, substituted, reads, 'continuation'),
    );
  }
  return findings;
}

/** Counts non-overlapping occurrences of `needle` in `hay`. */
function occurrences(hay: string, needle: string): number {
  return needle === '' ? 0 : hay.split(needle).length - 1;
}

/** Escapes a literal for use inside a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface PromptBodyMatch {
  index: number;
  substitutions: string[];
}

/**
 * Finds the prompt body as one exact, line-bounded block inside a composed
 * prompt. In derivation mode, a placeholder may remain literal or be replaced
 * by one exact non-empty context sentinel; mixed replacement of repeated
 * tokens is rejected. With `expectedSubstitutions`, substituted positions must
 * carry a sentinel and every other placeholder must remain literal.
 */
function matchPromptBody(
  prompt: string,
  composed: string,
  reads: readonly string[],
  expectedSubstitutions?: readonly string[],
): PromptBodyMatch | null {
  const sentinels = reads.map(sentinelFor);
  const sentinelPattern =
    sentinels.length > 0 ? sentinels.map(escapeRegExp).join('|') : '(?!)';
  const captures: string[] = [];
  let pattern = '';
  let offset = 0;
  for (const match of prompt.matchAll(PLACEHOLDER)) {
    const index = match.index;
    const token = match[0];
    pattern += escapeRegExp(prompt.slice(offset, index));
    if (expectedSubstitutions === undefined) {
      pattern += `(${escapeRegExp(token)}|${sentinelPattern})`;
      captures.push(token);
    } else if (expectedSubstitutions.includes(token)) {
      pattern += `(?:${sentinelPattern})`;
    } else {
      pattern += escapeRegExp(token);
    }
    offset = index + token.length;
  }
  pattern += escapeRegExp(prompt.slice(offset));

  const matched = new RegExp(`(?:^|\\n)${pattern}(?=\\n|$)`).exec(composed);
  if (matched === null) return null;

  const index = matched.index + (matched[0].startsWith('\n') ? 1 : 0);
  if (expectedSubstitutions !== undefined) {
    return { index, substitutions: [...expectedSubstitutions] };
  }

  const modes = new Map<string, Set<'literal' | 'sentinel'>>();
  for (let capture = 0; capture < captures.length; capture++) {
    const token = captures[capture];
    const value = matched[capture + 1];
    const tokenModes = modes.get(token) ?? new Set();
    tokenModes.add(value === token ? 'literal' : 'sentinel');
    modes.set(token, tokenModes);
  }
  if ([...modes.values()].some((tokenModes) => tokenModes.size > 1)) {
    return null;
  }
  const substitutions = placeholdersIn(prompt).filter(
    (token) => modes.get(token)?.has('sentinel') === true,
  );
  return { index, substitutions };
}

/** Findings when a composed prompt does not preserve the domain body (VERIFY-5). */
function bodyFindings(
  state: CaptainState,
  composed: string,
  substituted: readonly string[],
  reads: readonly string[],
  turn: string,
): string[] {
  if (matchPromptBody(state.prompt, composed, reads, substituted) !== null) {
    return [];
  }

  // Preserve the established line-specific diagnostic where possible, while
  // the whole-body match above additionally catches reordering, inserted
  // lines, and prefixes/suffixes around otherwise present lines.
  for (const line of state.prompt.split('\n')) {
    if (line.trim() === '') continue;
    if (matchPromptBody(line, composed, reads, substituted) === null) {
      return [
        `${state.stateId}: a ${turn} turn does not preserve the body line "${line}"`,
      ];
    }
  }
  return [
    `${state.stateId}: a ${turn} turn does not preserve the prompt body verbatim and in order`,
  ];
}

/** The index of the body's first preserved line in a composed prompt, or -1. */
function bodyIndex(
  state: CaptainState,
  composed: string,
  substituted: readonly string[],
  reads: readonly string[],
): number {
  return (
    matchPromptBody(state.prompt, composed, reads, substituted)?.index ?? -1
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serializes an arbitrary string as a safe JavaScript/TypeScript literal. */
function sourceString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The default checker import specifier the emitted test uses (package export). */
export const VERIFY_MODULE = '@sublang/slc/verify';

/**
 * Finds the XState machine an `fsm` module exports — the export whose value has a
 * `.config.states` — so callers need not know its export name, and returns that
 * machine's config for {@link checkGearsFsmConformance}.
 *
 * @throws when the module exports no such machine.
 */
export function findMachineConfig(fsmModule: unknown): MachineConfigLike {
  if (typeof fsmModule === 'object' && fsmModule !== null) {
    for (const value of Object.values(fsmModule)) {
      if (typeof value === 'object' && value !== null && 'config' in value) {
        const config = (value as { config?: unknown }).config;
        if (
          typeof config === 'object' &&
          config !== null &&
          'states' in config
        ) {
          return config as MachineConfigLike;
        }
      }
    }
  }
  throw new Error(
    'fsm module exports no XState machine with a `.config.states`',
  );
}

/**
 * Builds a per-artifact vitest module that fails when the compiled FSM drifts
 * from its GEARS source: it reads the artifact's `gears` file and the machine its
 * `fsm` module exports (via {@link findMachineConfig}, so no export name is
 * needed), then asserts {@link checkGearsFsmConformance} finds nothing.
 */
export function generateGearsFsmConformanceTest(opts: {
  /** Basename shared by the artifacts (e.g. `code`). */
  basename: string;
  /** Import specifier for the compiled `fsm` module, relative to the test. */
  fsmModule: string;
  /** Path to the `gears` artifact, relative to the test. */
  gearsFile: string;
  /** Import specifier for this checker, relative to the test. */
  verifyModule: string;
}): string {
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Generated by slc (IR-007 Task 8): GEARS↔FSM conformance.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkGearsFsmConformance, findMachineConfig } from ${sourceString(opts.verifyModule)};
import * as fsm from ${sourceString(opts.fsmModule)};

describe(${sourceString(`${opts.basename}: GEARS↔FSM conformance`)}, () => {
  it('maps every GEARS item to a state with its player and verbatim prompt', () => {
    const gears = readFileSync(
      fileURLToPath(new URL(${sourceString(opts.gearsFile)}, import.meta.url)),
      'utf8',
    );
    expect(checkGearsFsmConformance(gears, findMachineConfig(fsm))).toEqual([]);
  });
});
`;
}

/**
 * Emits the GEARS↔FSM conformance test as `slc` output beside a compiled
 * `playbook` artifact: writes `<basename>.gears-fsm.test.ts` into the artifact
 * directory (`<basename>.playbook/`), wiring the artifact's `gears` file and its
 * `fsm` module's machine to the checker, and returns the written path (VERIFY-2;
 * [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).
 */
export async function emitGearsFsmConformanceTest(opts: {
  /** The artifact directory (`<basename>.playbook/`) to emit the test into. */
  artifactDir: string;
  /** Basename shared by the artifacts (e.g. `code`). */
  basename: string;
  /** Checker import specifier; defaults to {@link VERIFY_MODULE}. */
  verifyModule?: string;
}): Promise<string> {
  const content = generateGearsFsmConformanceTest({
    basename: opts.basename,
    // Import the `.fsm.ts` artifact the run wrote; the test runs under a
    // TypeScript-transforming runner (vitest) or Node's type stripping.
    fsmModule: `./${opts.basename}.fsm.ts`,
    gearsFile: `./${opts.basename}.gears.md`,
    verifyModule: opts.verifyModule ?? VERIFY_MODULE,
  });
  await mkdir(opts.artifactDir, { recursive: true });
  const path = join(opts.artifactDir, `${opts.basename}.gears-fsm.test.ts`);
  await writeFile(path, content);
  return path;
}

/**
 * Imports a produced `fsm` artifact module for emission-time derivation. The
 * artifact is TypeScript; under Node's type stripping (erasable-syntax-only)
 * the direct import works, and a failure is reported to the caller so emission
 * degrades to a diagnostic rather than failing the run. The URL carries the
 * content hash so a rebuilt artifact at the same path is never served from the
 * module cache.
 */
export async function loadFsmModule(fsmPath: string): Promise<unknown> {
  const resolved = resolve(fsmPath);
  const url = pathToFileURL(resolved);
  url.searchParams.set('v', await hashFile(resolved));
  return import(url.href);
}

/**
 * Builds a per-artifact vitest module that fails when the machine's structure
 * drifts from the topology pinned at build time (VERIFY-4).
 */
export function generateFsmIntrospectionTest(opts: {
  basename: string;
  fsmModule: string;
  verifyModule: string;
  pins: IntrospectionPins;
}): string {
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Generated by slc (DR-009): FSM introspection pins.
// The PINNED topology was derived from the artifact at build time; any
// unintended structural change to the machine fails this test.
import { describe, expect, it } from 'vitest';

import { findMachineConfig, pinIntrospection } from ${sourceString(opts.verifyModule)};
import * as fsm from ${sourceString(opts.fsmModule)};

const PINNED = ${JSON.stringify(opts.pins, null, 2)};

describe(${sourceString(`${opts.basename}: FSM introspection`)}, () => {
  it('matches the machine topology pinned at build time', () => {
    expect(pinIntrospection(findMachineConfig(fsm))).toEqual(PINNED);
  });
});
`;
}

/**
 * Builds a per-artifact vitest module pinning the prompt contract derived from
 * the artifacts at build time (VERIFY-5): the per-state context reads, input
 * wiring, and placeholders always; and, when the linked module exposes its
 * composer under `_internal.composePlayerPrompt`, the composition checks and
 * the pinned substitution map.
 */
export function generatePromptContractTest(opts: {
  basename: string;
  fsmModule: string;
  verifyModule: string;
  rows: PromptContractRow[];
  /** Present when the linked module beside the artifacts exposes its composer. */
  composer?: {
    playbookModule: string;
    substituted: Record<string, string[]>;
  };
}): string {
  const composerImports = opts.composer
    ? `import * as playbook from ${sourceString(opts.composer.playbookModule)};\n`
    : '';
  const composerBlock = opts.composer
    ? `
const SUBSTITUTED = ${JSON.stringify(opts.composer.substituted, null, 2)};

const compose = (
  playbook as unknown as {
    _internal: { composePlayerPrompt: (input: unknown) => string };
  }
)._internal.composePlayerPrompt;

  it('composes player prompts per the link contract', () => {
    expect(
      checkPromptComposition({ config: findMachineConfig(fsm), compose }),
    ).toEqual([]);
  });

  it('substitutes the placeholders pinned at build time', () => {
    expect(deriveSubstitutions(findMachineConfig(fsm), compose)).toEqual(
      SUBSTITUTED,
    );
  });
`
    : '';
  const checkerImports = opts.composer
    ? 'capturePromptContract,\n  checkPromptComposition,\n  deriveSubstitutions,\n  findMachineConfig,'
    : 'capturePromptContract,\n  findMachineConfig,';
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Generated by slc (DR-009): prompt contract.
// The pinned rows were derived from the artifacts at build time; wiring,
// placeholder, or composition drift fails this test.
import { describe, expect, it } from 'vitest';

import {
  ${checkerImports}
} from ${sourceString(opts.verifyModule)};
import * as fsm from ${sourceString(opts.fsmModule)};
${composerImports}
const CONTRACT = ${JSON.stringify(opts.rows, null, 2)};

describe(${sourceString(`${opts.basename}: prompt contract`)}, () => {
  it('matches the prompt contract pinned at build time', () => {
    expect(capturePromptContract(findMachineConfig(fsm))).toEqual(CONTRACT);
  });
${composerBlock}});
`;
}

/**
 * Emits the prompt-contract test beside a compiled `playbook` artifact
 * (VERIFY-5): imports `<basename>.fsm.ts`, derives and pins the per-state
 * contract, and — when a linked `<basename>.playbook.ts` sits beside the
 * artifacts and exposes `_internal.composePlayerPrompt` — pins the substitution
 * map and wires the composition checks. Returns the written path and any
 * diagnostics (a linked module that cannot be imported or exposes no composer
 * degrades to the FSM-only test).
 *
 * @throws when the `fsm` artifact cannot be imported or exports no machine.
 */
export async function emitPromptContractTest(opts: {
  artifactDir: string;
  basename: string;
  verifyModule?: string;
}): Promise<{ path: string; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const fsmPath = join(opts.artifactDir, `${opts.basename}.fsm.ts`);
  const config = findMachineConfig(await loadFsmModule(fsmPath));
  const rows = capturePromptContract(config);

  let composer:
    | { playbookModule: string; substituted: Record<string, string[]> }
    | undefined;
  const linkedPath = join(opts.artifactDir, `${opts.basename}.playbook.ts`);
  if (existsSync(linkedPath)) {
    try {
      const linked = (await loadFsmModule(linkedPath)) as {
        _internal?: { composePlayerPrompt?: unknown };
      };
      const compose = linked._internal?.composePlayerPrompt;
      if (typeof compose === 'function') {
        composer = {
          playbookModule: `./${opts.basename}.playbook.ts`,
          substituted: deriveSubstitutions(
            config,
            compose as (input: unknown) => string,
          ),
        };
        const findings = checkPromptComposition({
          config,
          compose: compose as (input: unknown) => string,
        });
        diagnostics.push(
          ...findings.map((finding) => `prompt contract: ${finding}`),
        );
      } else {
        diagnostics.push(
          `prompt contract: linked module exposes no _internal.composePlayerPrompt; composition checks not emitted`,
        );
      }
    } catch (error) {
      diagnostics.push(
        `prompt contract: linked module could not be imported (${messageOf(error)}); composition checks not emitted`,
      );
    }
  }

  const content = generatePromptContractTest({
    basename: opts.basename,
    fsmModule: `./${opts.basename}.fsm.ts`,
    verifyModule: opts.verifyModule ?? VERIFY_MODULE,
    rows,
    composer,
  });
  await mkdir(opts.artifactDir, { recursive: true });
  const path = join(
    opts.artifactDir,
    `${opts.basename}.prompt-contract.test.ts`,
  );
  await writeFile(path, content);
  return { path, diagnostics };
}

/**
 * Emits the introspection test beside a compiled `playbook` artifact
 * (VERIFY-4): imports `<basename>.fsm.ts`, derives its topology pins, and
 * writes `<basename>.fsm.introspect.test.ts` into the artifact directory.
 *
 * @throws when the `fsm` artifact cannot be imported or exports no machine.
 */
export async function emitFsmIntrospectionTest(opts: {
  artifactDir: string;
  basename: string;
  verifyModule?: string;
}): Promise<string> {
  const fsmPath = join(opts.artifactDir, `${opts.basename}.fsm.ts`);
  const pins = pinIntrospection(
    findMachineConfig(await loadFsmModule(fsmPath)),
  );
  const content = generateFsmIntrospectionTest({
    basename: opts.basename,
    fsmModule: `./${opts.basename}.fsm.ts`,
    verifyModule: opts.verifyModule ?? VERIFY_MODULE,
    pins,
  });
  await mkdir(opts.artifactDir, { recursive: true });
  const path = join(
    opts.artifactDir,
    `${opts.basename}.fsm.introspect.test.ts`,
  );
  await writeFile(path, content);
  return path;
}

// Transition-coverage verification (VERIFY-6) lives in its own module — it
// depends on `xstate` to drive the machine — and is re-exported here so every
// generated test imports one checker module (`@sublang/slc/verify`).
export * from './verify-coverage.js';

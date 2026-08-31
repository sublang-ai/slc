// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Compilation-correctness verification for a compiled `playbook` artifact
 * (DR-009).
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
 * for every compiled `playbook`. See specs/packages/verification.md.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hashFile } from './hash.js';

/** A GEARS spec item with its acting prompt and optional source-owned results. */
export interface GearsItem {
  id: string;
  /** Source-spelled delegated participant; schema 3 canonicalizes it as a role. */
  player: string;
  prompt: string;
  /**
   * Direct Captain work, delegated player work, or an optimizer-introduced
   * script item (`Captain shall run:`); absent for playbook calls.
   */
  actor?: 'captain' | 'player' | 'script';
  /** Target id when this item invokes another playbook rather than a player. */
  playbookId?: string;
  /** Context field selecting a dynamic nested-playbook target. */
  playbookIdContext?: string;
  /** Context field supplying a dynamic nested-playbook input. */
  textContext?: string;
  /** Source-declared parallel group, when this item is a concurrent member. */
  parallelGroup?: string;
  /** Ordered source-owned domain guard contract, when explicitly declared. */
  result?: Record<string, string>;
  /** Malformed result-metadata details retained for fail-closed reporting. */
  resultFindings?: string[];
}

/** A Captain/player-invoking state's introspected `gears2fsm` binding. */
export interface CaptainState {
  stateId: string;
  sourceItem: string;
  /**
   * Semantic actor kind after preserving legacy `captain` + player bindings.
   * `script` appears only in coverage-driving views built from script states,
   * never in captain-binding enumeration or pins.
   */
  actor: 'captain' | 'player' | 'script';
  /** Immutable schema-1 delegated-player binding. */
  player: string;
  /** Canonical schema-3 local-role binding. */
  role?: string;
  prompt: string;
  /** The state's per-state guard contract: result key to description. */
  result: Record<string, string>;
  /** Dot-separated config path, present only for a nested state node. */
  statePath?: string;
  /** Malformed binding details retained for fail-closed conformance reporting. */
  bindingFindings?: string[];
}

/** A script-actor invocation recovered from an FSM state (DR-013). */
export interface ScriptInvocationState {
  stateId: string;
  sourceItem: string;
  /** The item's blockquoted shell script, verbatim. */
  command: string;
  /** The two declared exit-status guards, zero-exit first. */
  result: Record<string, string>;
  /** Dot-separated config path, present only for a nested state node. */
  statePath?: string;
  /** Malformed binding details retained for fail-closed conformance reporting. */
  bindingFindings?: string[];
}

/** A playbook-actor invocation recovered from an FSM state. */
export interface PlaybookInvocationState {
  stateId: string;
  /** Literal values are empty during static introspection of a dynamic call. */
  playbookId: string;
  text: string;
  /** Explicit dynamic-call metadata naming the runtime context fields. */
  playbookIdContext?: string;
  textContext?: string;
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

/** Artifact schema selected only by a complete reviewed Playbook provenance. */
export function artifactSchemaForPlaybookProvenance(
  provenance: unknown,
): 1 | 3 | undefined {
  switch (provenance) {
    case '@sublang/playbook@0.10.0':
    case '@sublang/playbook@1.0.0':
    case '@sublang/playbook@2.0.0':
    case '@sublang/playbook@3.1.0':
    case '@sublang/playbook@4.0.0':
      return 1;
    case '@sublang/playbook@10.0.0':
      return 3;
    default:
      return undefined;
  }
}

/**
 * Returns the Playbook package provenance that owns an invocation's concrete
 * link target. The first package manifest above the target owns the file; a
 * parent workspace manifest must not lend its identity to a nested local file.
 */
export async function playbookProvenanceForLinkTarget(
  linkTarget: string,
): Promise<string | undefined> {
  let cursor = dirname(resolve(linkTarget));
  for (;;) {
    const manifestPath = join(cursor, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        return manifest.name === '@sublang/playbook' &&
          typeof manifest.version === 'string' &&
          manifest.version.length > 0
          ? `${manifest.name}@${manifest.version}`
          : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

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
// capitalized, non-English names are quoted only "when needed to distinguish
// from prose" (text2gears.md), so backtick/straight/CJK-quoted forms and bare
// non-ASCII names are all accepted.
const ITEM_PLAYER =
  /Captain shall (?:prompt|relay\b[^.]*?\bto)\s+(?:`([^`]+)`|"([^"]+)"|“([^”]+)”|([A-Z][\w]*)|([^\p{ASCII}][^\s:：，,。;；]*))/u;
const ITEM_PLAYBOOK =
  /Captain shall call playbook\s+(?:`([^`]+)`|"([^"]+)"|“([^”]+)”|([A-Za-z0-9][\w.-]*))\s*:/;
const ITEM_DYNAMIC_PLAYBOOK =
  /Captain shall call playbook selected by\s+`([^`]+)`\s*:/;
const PARALLEL_GROUP = /^Parallel group:\s*(\S(?:.*\S)?)\s*$/;
const DYNAMIC_TEXT = /^<([A-Za-z_$][A-Za-z0-9_$]*)>$/;
// An optimizer-introduced script item runs a shell command without any agent
// (text2gears.md "Script behaviors"; DR-013). The clause is fixed machine
// syntax, so it is matched literally ahead of the generic Captain form.
const SCRIPT_CLAUSE = /\bCaptain shall run\s*:/;
// Some items have Captain act directly ("Captain shall <verb> ...") with no
// delegated player; their player is Captain itself.
const CAPTAIN_ACTS = /\bCaptain shall\b/;
const BLOCKQUOTE = /^>\s?(.*)$/;
const SECTION_HEADING = /^##\s/;
const RESULTS_LABEL = /^Results:\s*$/;
const RESULTS_LABEL_NEAR_MISS = /^Results\s*:?[ \t]*$/;
const RESULT_BULLET = /^-\s+`([A-Za-z_$][A-Za-z0-9_$]*)`:\s+(\S(?:.*\S)?)\s*$/;

/**
 * Parses the GEARS items from a `gears` artifact: each `### <ID>` item's player,
 * blockquoted acting prompt, and optional ordered `Results:` metadata.
 */
export function parseGearsItems(gears: string): GearsItem[] {
  const items: GearsItem[] = [];
  let current: {
    id: string;
    player: string;
    captainActs: boolean;
    script: boolean;
    playbookId: string;
    playbookIdContext: string;
    parallelGroup: string;
    prompt: string[];
    resultsEligible: boolean;
    resultDeclared: boolean;
    inResults: boolean;
    results: Array<[string, string]>;
    resultFindings: string[];
  } | null = null;
  const flush = (): void => {
    if (current !== null) {
      const player =
        current.player !== ''
          ? current.player
          : current.captainActs
            ? 'Captain'
            : '';
      const prompt = current.prompt.join('\n');
      const dynamicText = DYNAMIC_TEXT.exec(prompt);
      const playbookCall =
        current.playbookId !== '' || current.playbookIdContext !== '';
      if (current.resultDeclared && current.results.length === 0) {
        current.resultFindings.push('Results block declares no valid entries');
      }
      if (playbookCall && current.resultDeclared) {
        current.resultFindings.push(
          'nested-playbook call item shall not declare Results metadata',
        );
      }
      if (current.script && !playbookCall) {
        // A script item carries exactly two exit-status guards, zero-exit
        // first (text2gears.md "Script behaviors").
        if (!current.resultDeclared) {
          current.resultFindings.push(
            'script item shall declare a two-guard Results contract',
          );
        } else if (current.results.length !== 2) {
          current.resultFindings.push(
            `script item declares ${current.results.length} Results guards (expected exactly 2)`,
          );
        }
      }
      items.push({
        id: current.id,
        player: current.script && !playbookCall ? '' : player,
        prompt,
        ...(!playbookCall && current.script
          ? { actor: 'script' as const }
          : {}),
        ...(!playbookCall && !current.script && current.player !== ''
          ? { actor: 'player' as const }
          : {}),
        ...(!playbookCall &&
        !current.script &&
        current.player === '' &&
        current.captainActs
          ? { actor: 'captain' as const }
          : {}),
        ...(current.playbookId !== ''
          ? { playbookId: current.playbookId }
          : {}),
        ...(current.playbookIdContext !== ''
          ? {
              playbookIdContext: current.playbookIdContext,
              ...(dynamicText === null ? {} : { textContext: dynamicText[1] }),
            }
          : {}),
        ...(current.parallelGroup !== ''
          ? { parallelGroup: current.parallelGroup }
          : {}),
        ...(current.resultDeclared
          ? { result: Object.fromEntries(current.results) }
          : {}),
        ...(current.resultFindings.length > 0
          ? { resultFindings: current.resultFindings }
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
        script: false,
        playbookId: '',
        playbookIdContext: '',
        parallelGroup: '',
        prompt: [],
        resultsEligible: false,
        resultDeclared: false,
        inResults: false,
        results: [],
        resultFindings: [],
      };
      continue;
    }
    if (SECTION_HEADING.test(line)) {
      flush();
      continue;
    }
    if (current === null) continue;
    if (RESULTS_LABEL.test(line)) {
      if (current.resultDeclared) {
        current.resultFindings.push('duplicate Results label');
      }
      if (current.prompt.length === 0) {
        current.resultFindings.push(
          'Results block shall follow a non-empty acting blockquote',
        );
      } else if (!current.resultsEligible) {
        current.resultFindings.push(
          'Results block shall immediately follow the acting blockquote',
        );
      }
      current.resultDeclared = true;
      current.inResults = true;
      continue;
    }
    if (current.resultsEligible && RESULTS_LABEL_NEAR_MISS.test(line)) {
      current.resultFindings.push(
        `malformed Results label ${JSON.stringify(line)}`,
      );
      current.resultDeclared = true;
      current.inResults = true;
      continue;
    }
    if (current.inResults) {
      if (line.trim() === '') continue;
      const result = RESULT_BULLET.exec(line);
      if (result === null) {
        current.resultFindings.push(
          `malformed Results entry ${JSON.stringify(line)}`,
        );
        continue;
      }
      const [, guard, description] = result;
      if (current.results.some(([existing]) => existing === guard)) {
        current.resultFindings.push(`duplicate Results guard ${guard}`);
        continue;
      }
      if (guard === NEEDS_BOSS_REPLY) {
        current.resultFindings.push(
          `${NEEDS_BOSS_REPLY} is compiler-owned and shall not be source metadata`,
        );
      }
      current.results.push([guard, description]);
      continue;
    }
    const quote = BLOCKQUOTE.exec(line);
    if (quote !== null) {
      current.prompt.push(quote[1]);
      current.resultsEligible = true;
      continue;
    }
    if (line.trim() !== '') current.resultsEligible = false;
    const parallelGroup = PARALLEL_GROUP.exec(line.trim());
    if (parallelGroup !== null && current.parallelGroup === '') {
      current.parallelGroup = parallelGroup[1];
    }
    const player = ITEM_PLAYER.exec(line);
    if (player !== null && current.player === '') {
      current.player =
        player[1] ?? player[2] ?? player[3] ?? player[4] ?? player[5];
    }
    const dynamicPlaybook = ITEM_DYNAMIC_PLAYBOOK.exec(line);
    if (
      dynamicPlaybook !== null &&
      current.playbookIdContext === '' &&
      current.playbookId === ''
    ) {
      current.playbookIdContext = dynamicPlaybook[1];
    }
    const playbook = ITEM_PLAYBOOK.exec(line);
    if (
      playbook !== null &&
      current.playbookId === '' &&
      current.playbookIdContext === ''
    ) {
      current.playbookId =
        playbook[1] ?? playbook[2] ?? playbook[3] ?? playbook[4];
    }
    if (SCRIPT_CLAUSE.test(line)) current.script = true;
    if (CAPTAIN_ACTS.test(line)) current.captainActs = true;
  }
  flush();
  return items;
}

/** The source generation and canonical role/cohort declaration of one GEARS artifact. */
export interface GearsRoleContract {
  generation: 'schema-1' | 'schema-3' | 'unspecified';
  names: string[];
  roleIds: string[];
  concurrentRoleSets: string[][];
  findings: string[];
}

const ROLE_DECLARATION = /^(?:#{1,6}\s+(Roles|Players)|(Roles|Players):)\s*$/;

/** Canonical lowercase local-role id used by schema-3 artifacts. */
export function canonicalRoleId(name: string): string {
  return name.toLowerCase();
}

function declarationName(value: string): string | undefined {
  const match = /^[`"“]?([^`"”]+?)[`"”]?\s*$/.exec(value.trim());
  return match?.[1].trim() || undefined;
}

/** Parses Roles/Players plus source-derived concurrent role sets without host bindings. */
export function inspectGearsRoleContract(gears: string): GearsRoleContract {
  const findings: string[] = [];
  const declarations: Array<{ kind: 'Roles' | 'Players'; names: string[] }> =
    [];
  let active: { kind: 'Roles' | 'Players'; names: string[] } | undefined;
  for (const line of gears.split('\n')) {
    const heading = ROLE_DECLARATION.exec(line.trim());
    if (heading !== null) {
      active = {
        kind: (heading[1] ?? heading[2]) as 'Roles' | 'Players',
        names: [],
      };
      declarations.push(active);
      continue;
    }
    if (active === undefined) continue;
    if (line.trim() === '') continue;
    const bullet = /^-\s+(.*)$/.exec(line.trim());
    if (bullet === null) {
      active = undefined;
      continue;
    }
    const declaration = bullet[1].trim();
    if (active.kind === 'Roles' && /[=|]/.test(declaration)) {
      findings.push(
        `Roles declaration ${JSON.stringify(declaration)} uses removed alias syntax`,
      );
      continue;
    }
    // Historical schema-1 Players may declare a composite launcher choice
    // (`Committer = Coder | Reviewer`). It is not one concrete player binding
    // and therefore does not enter the source-order player list, including
    // when every name is backtick- or quote-delimited.
    if (active.kind === 'Players' && declaration.includes('=')) continue;
    const name = declarationName(declaration);
    if (name === undefined) {
      findings.push(
        `malformed ${active.kind} declaration ${JSON.stringify(declaration)}`,
      );
      continue;
    }
    active.names.push(name);
  }

  const kinds = new Set(declarations.map(({ kind }) => kind));
  if (declarations.length > 1) {
    findings.push('GEARS declares more than one Roles/Players section');
  }
  if (kinds.size > 1) {
    findings.push('GEARS mixes Roles and Players declarations');
  }
  const selected = declarations[0];
  const generation =
    selected?.kind === 'Roles'
      ? 'schema-3'
      : selected?.kind === 'Players'
        ? 'schema-1'
        : 'unspecified';
  const names = selected?.names ?? [];
  const roleIds = names.map(canonicalRoleId);
  if (generation === 'schema-3') {
    const byCanonical = new Map<string, string>();
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const roleId = roleIds[index];
      const existing = byCanonical.get(roleId);
      if (existing !== undefined) {
        findings.push(
          existing === name
            ? `Roles declaration repeats ${JSON.stringify(name)}`
            : `Roles declarations ${JSON.stringify(existing)} and ${JSON.stringify(name)} collide as canonical role ${JSON.stringify(roleId)}`,
        );
      } else {
        byCanonical.set(roleId, name);
      }
      if (!/^[a-z][a-z0-9_-]*$/.test(roleId)) {
        findings.push(
          `Roles declaration ${JSON.stringify(name)} derives noncanonical local role ${JSON.stringify(roleId)}`,
        );
      } else if (roleId === 'captain') {
        findings.push('Roles declaration uses reserved local role "captain"');
      }
    }
  }

  const groups = new Map<string, string[]>();
  if (generation === 'schema-3') {
    const declared = new Set(roleIds);
    for (const item of parseGearsItems(gears)) {
      if (item.actor === 'player') {
        const roleId = canonicalRoleId(item.player);
        if (!declared.has(roleId)) {
          findings.push(
            `GEARS item ${item.id} delegates to undeclared role ${JSON.stringify(item.player)}`,
          );
        }
      }
      if (item.parallelGroup === undefined) continue;
      if (item.actor !== 'player') {
        findings.push(
          `parallel group ${JSON.stringify(item.parallelGroup)} contains non-role item ${item.id}`,
        );
        continue;
      }
      const roleId = canonicalRoleId(item.player);
      const members = groups.get(item.parallelGroup) ?? [];
      if (members.includes(roleId)) {
        findings.push(
          `parallel group ${JSON.stringify(item.parallelGroup)} repeats canonical role ${JSON.stringify(roleId)}`,
        );
      }
      members.push(roleId);
      groups.set(item.parallelGroup, members);
    }
    const groupByMembers = new Map<string, string>();
    for (const [group, members] of groups) {
      if (members.length < 2) {
        findings.push(
          `parallel group ${JSON.stringify(group)} contains fewer than two roles`,
        );
      }
      // A concurrent role set is unordered for duplicate detection even
      // though its source member order remains significant in the FSM export.
      const signature = JSON.stringify([...members].sort());
      const existing = groupByMembers.get(signature);
      if (existing !== undefined) {
        findings.push(
          `parallel groups ${JSON.stringify(existing)} and ${JSON.stringify(group)} duplicate concurrent role set ${signature}`,
        );
      } else {
        groupByMembers.set(signature, group);
      }
    }
  }

  return {
    generation,
    names,
    roleIds,
    concurrentRoleSets: [...groups.values()],
    findings,
  };
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
  /** Pins only the new explicit actor model, preserving legacy pin bytes. */
  pinActor: boolean;
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
  context: Record<string, unknown> = {},
): { value: Record<string, unknown> } | { error: string } | { invalid: true } {
  if (typeof invoke.input !== 'function') return { invalid: true };
  let value: unknown;
  try {
    value = invoke.input({ context });
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

function metadataRole(state: StateLike): unknown {
  if (typeof state.meta !== 'object' || state.meta === null) return undefined;
  const playbook = (state.meta as { playbook?: unknown }).playbook;
  if (typeof playbook !== 'object' || playbook === null) return undefined;
  return (playbook as { role?: unknown }).role;
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

function hasStructuredTopology(nodes: readonly StateNodeRef[]): boolean {
  return nodes.some(
    ({ path, state }) =>
      path.length > 1 ||
      state.type === 'parallel' ||
      Object.keys(state.states ?? {}).length > 0,
  );
}

function structuredStateIdentityFindings(
  nodes: readonly StateNodeRef[],
): string[] {
  if (!hasStructuredTopology(nodes)) return [];
  const findings: string[] = [];
  for (const node of nodes) {
    const configId = node.state.id;
    const metaId = metadataStateId(node.state);
    if (!isNonEmptyString(configId)) {
      findings.push(
        `FSM structured state ${node.statePath}: state.id is not a non-empty string`,
      );
    }
    if (metaId === undefined) {
      findings.push(
        `FSM structured state ${node.statePath}: state.meta.playbook.stateId is not a non-empty string`,
      );
    } else if (isNonEmptyString(configId) && metaId !== configId) {
      findings.push(
        `FSM structured state ${node.statePath}: state.meta.playbook.stateId "${metaId}" does not match state.id "${configId}"`,
      );
    }
  }
  return findings;
}

function enumerateCaptainBindings(config: MachineConfigLike): CaptainBinding[] {
  const out: CaptainBinding[] = [];
  for (const node of walkStateNodes(config)) {
    for (const invoke of normalizeInvokes(node.state.invoke)) {
      const source = invokeSource(invoke.src);
      const explicitlyWorkActor = source === 'captain' || source === 'player';
      if (!explicitlyWorkActor && invoke.src !== undefined) continue;
      const inspected = invocationInput(invoke);
      if ('error' in inspected) {
        if (explicitlyWorkActor) {
          const actor = source === 'player' ? 'player' : 'captain';
          out.push({
            state: malformedCaptainState(
              publicStateId(node, undefined),
              `invoke.input threw during introspection: ${inspected.error}`,
              actor,
              node,
            ),
            node,
            invoke,
            inputFn: invoke.input,
            pinActor: true,
          });
        }
        continue;
      }
      if ('invalid' in inspected) {
        if (explicitlyWorkActor) {
          const actor = source === 'player' ? 'player' : 'captain';
          out.push({
            state: malformedCaptainState(
              publicStateId(node, undefined),
              typeof invoke.input === 'function'
                ? 'invoke.input returned a non-object'
                : 'invoke.input is not a function',
              actor,
              node,
            ),
            node,
            invoke,
            inputFn: invoke.input,
            pinActor: true,
          });
        }
        continue;
      }
      const fields = inspected.value;
      // Preserve the legacy sourceItem-recognition path only when no explicit
      // actor is named. A playbook actor carrying source metadata is not a
      // player invocation.
      if (
        !explicitlyWorkActor &&
        (invoke.src !== undefined || !isNonEmptyString(fields.sourceItem))
      ) {
        continue;
      }

      // Published schema-1 artifacts carried a concrete player field. Schema 3
      // carries only its canonical local role and repeats it in public metadata.
      const actor =
        source === 'player' ||
        Object.hasOwn(fields, 'player') ||
        Object.hasOwn(fields, 'role')
          ? 'player'
          : 'captain';
      const pinActor =
        source === 'player' || (source === 'captain' && actor === 'captain');

      const bindingFindings: string[] = [];
      if (!isNonEmptyString(fields.sourceItem)) {
        bindingFindings.push(
          'invoke.input.sourceItem is not a non-empty string',
        );
      }
      if (actor === 'player') {
        const hasPlayer = Object.hasOwn(fields, 'player');
        const hasRole = Object.hasOwn(fields, 'role');
        if (hasPlayer && hasRole) {
          bindingFindings.push(
            'invoke.input carries both historical player and schema-3 role',
          );
        }
        if (hasRole && typeof fields.role !== 'string') {
          bindingFindings.push('invoke.input.role is not a string');
        }
        if (hasRole && source !== 'player') {
          bindingFindings.push(
            'schema-3 delegated work does not invoke the player actor',
          );
        }
        if (!hasRole && typeof fields.player !== 'string') {
          bindingFindings.push('invoke.input.player is not a string');
        }
        const publicRole = metadataRole(node.state);
        if (hasRole) {
          if (typeof publicRole !== 'string') {
            bindingFindings.push(
              'state.meta.playbook.role is not a string for schema-3 delegated work',
            );
          } else if (publicRole !== fields.role) {
            bindingFindings.push(
              `state.meta.playbook.role ${JSON.stringify(publicRole)} does not match invoke.input.role ${JSON.stringify(fields.role)}`,
            );
          }
        } else if (publicRole !== undefined) {
          bindingFindings.push(
            'historical delegated-player state unexpectedly declares state.meta.playbook.role',
          );
        }
      } else if (
        Object.hasOwn(fields, 'role') ||
        metadataRole(node.state) !== undefined
      ) {
        bindingFindings.push(
          'direct-Captain state unexpectedly declares a role binding',
        );
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
          `${source === 'player' ? 'player' : 'captain'} invocation is declared on a compound state instead of a leaf`,
        );
      }
      out.push({
        state: {
          stateId: publicStateId(node, fields),
          sourceItem: isNonEmptyString(fields.sourceItem)
            ? fields.sourceItem
            : '',
          actor,
          player: typeof fields.player === 'string' ? fields.player : '',
          ...(typeof fields.role === 'string' ? { role: fields.role } : {}),
          prompt: typeof fields.prompt === 'string' ? fields.prompt : '',
          result: resultMap(fields.result),
          ...nestedStatePath(node),
          ...(bindingFindings.length > 0 ? { bindingFindings } : {}),
        },
        node,
        invoke,
        inputFn: invoke.input,
        pinActor,
      });
    }
  }
  return out;
}

/**
 * Enumerates a machine's direct-Captain and delegated-player states, reading
 * `invoke.input` under a stub context to recover the static source binding.
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
      const dynamic =
        Object.hasOwn(fields, 'playbookIdContext') ||
        Object.hasOwn(fields, 'textContext');
      if (dynamic) {
        if (!isNonEmptyString(fields.playbookIdContext)) {
          bindingFindings.push(
            'invoke.input.playbookIdContext is not a non-empty string',
          );
        }
        if (!isNonEmptyString(fields.textContext)) {
          bindingFindings.push(
            'invoke.input.textContext is not a non-empty string',
          );
        }
        if (
          isNonEmptyString(fields.playbookIdContext) &&
          isNonEmptyString(fields.textContext)
        ) {
          const playbookIdSentinel = sentinelFor(fields.playbookIdContext);
          const textSentinel = sentinelFor(fields.textContext);
          const wired = invocationInput(invoke, {
            [fields.playbookIdContext]: playbookIdSentinel,
            [fields.textContext]: textSentinel,
          });
          if ('error' in wired) {
            bindingFindings.push(
              `invoke.input threw during dynamic context introspection: ${wired.error}`,
            );
          } else if ('invalid' in wired) {
            bindingFindings.push(
              'invoke.input returned a non-object during dynamic context introspection',
            );
          } else {
            if (wired.value.playbookId !== playbookIdSentinel) {
              bindingFindings.push(
                `invoke.input.playbookId is not wired from context.${fields.playbookIdContext}`,
              );
            }
            if (wired.value.text !== textSentinel) {
              bindingFindings.push(
                `invoke.input.text is not wired from context.${fields.textContext}`,
              );
            }
          }
        }
      } else {
        if (!isNonEmptyString(fields.playbookId)) {
          bindingFindings.push(
            'invoke.input.playbookId is not a non-empty string',
          );
        }
        if (typeof fields.text !== 'string') {
          bindingFindings.push('invoke.input.text is not a string');
        }
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
          playbookId:
            !dynamic && isNonEmptyString(fields.playbookId)
              ? fields.playbookId
              : '',
          text: !dynamic && typeof fields.text === 'string' ? fields.text : '',
          ...(isNonEmptyString(fields.playbookIdContext)
            ? { playbookIdContext: fields.playbookIdContext }
            : {}),
          ...(isNonEmptyString(fields.textContext)
            ? { textContext: fields.textContext }
            : {}),
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

/**
 * Enumerates typed `script` actor calls across the complete state tree
 * (gears2fsm.md "Setup"; DR-013). A script state carries `stateId`,
 * `sourceItem`, the verbatim `command`, and exactly two exit-status guards; it
 * is not agent-invoking, so `needsBossReply` in its result map is malformed.
 */
export function enumerateScriptStates(
  config: MachineConfigLike,
): ScriptInvocationState[] {
  const out: ScriptInvocationState[] = [];
  for (const node of walkStateNodes(config)) {
    for (const invoke of normalizeInvokes(node.state.invoke)) {
      if (invokeSource(invoke.src) !== 'script') continue;
      const malformed = (finding: string): ScriptInvocationState => ({
        stateId: publicStateId(node, undefined),
        sourceItem: '',
        command: '',
        result: {},
        ...nestedStatePath(node),
        bindingFindings: [finding],
      });
      const inspected = invocationInput(invoke);
      if ('error' in inspected) {
        out.push(
          malformed(
            `invoke.input threw during introspection: ${inspected.error}`,
          ),
        );
        continue;
      }
      if ('invalid' in inspected) {
        out.push(
          malformed(
            typeof invoke.input === 'function'
              ? 'invoke.input returned a non-object'
              : 'invoke.input is not a function',
          ),
        );
        continue;
      }
      const fields = inspected.value;
      const bindingFindings: string[] = [];
      if (!isNonEmptyString(fields.stateId)) {
        bindingFindings.push('invoke.input.stateId is not a non-empty string');
      }
      if (!isNonEmptyString(fields.sourceItem)) {
        bindingFindings.push(
          'invoke.input.sourceItem is not a non-empty string',
        );
      }
      if (!isNonEmptyString(fields.command)) {
        bindingFindings.push('invoke.input.command is not a non-empty string');
      }
      if (!isStringMap(fields.result)) {
        bindingFindings.push(
          'invoke.input.result is not a string-valued object',
        );
      } else {
        const guards = Object.keys(fields.result);
        if (guards.length !== 2) {
          bindingFindings.push(
            `script invoke.input.result declares ${guards.length} guards (expected exactly 2)`,
          );
        }
        if (guards.includes(NEEDS_BOSS_REPLY)) {
          bindingFindings.push(
            `script state shall not declare ${NEEDS_BOSS_REPLY}`,
          );
        }
      }
      bindingFindings.push(...stateIdConsistencyFindings(node, fields.stateId));
      if (Object.keys(node.state.states ?? {}).length > 0) {
        bindingFindings.push(
          'script invocation is declared on a compound state instead of a leaf',
        );
      }
      out.push({
        stateId: publicStateId(node, fields),
        sourceItem: isNonEmptyString(fields.sourceItem)
          ? fields.sourceItem
          : '',
        command: isNonEmptyString(fields.command) ? fields.command : '',
        result: resultMap(fields.result),
        ...nestedStatePath(node),
        ...(bindingFindings.length > 0 ? { bindingFindings } : {}),
      });
    }
  }
  return out;
}

function malformedCaptainState(
  stateId: string,
  finding: string,
  actor: 'captain' | 'player',
  node?: StateNodeRef,
): CaptainState {
  return {
    stateId,
    sourceItem: '',
    actor,
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

function isPlaybookItem(item: GearsItem): boolean {
  return item.playbookId !== undefined || item.playbookIdContext !== undefined;
}

function gearsPlaybookSignature(item: GearsItem): string {
  return item.playbookIdContext === undefined
    ? JSON.stringify(['static', item.playbookId, item.prompt])
    : JSON.stringify([
        'dynamic',
        item.playbookIdContext,
        item.textContext ?? null,
      ]);
}

function statePlaybookSignature(state: PlaybookInvocationState): string {
  return state.playbookIdContext === undefined
    ? JSON.stringify(['static', state.playbookId, state.text])
    : JSON.stringify([
        'dynamic',
        state.playbookIdContext,
        state.textContext ?? null,
      ]);
}

/** Module-level schema-3 declarations needed beside the machine config. */
export interface GearsFsmConformanceOptions {
  concurrentRoleSets?: unknown;
  /** Reviewed artifact schema for roleless non-controller machines. */
  artifactSchema?: 1 | 3;
}

/** Exact action guards of Playbook 10's controller decision result. */
export const CONTROLLER_ACTION_GUARDS = [
  'respond',
  'resume',
  'start',
  'switch',
  'dismiss',
  'deliver',
  'runtime',
] as const;

/** Whether a result map has the exact Playbook 10 controller domain union. */
export function isControllerDecisionResult(result: unknown): boolean {
  if (!isStringMap(result)) return false;
  const keys = Object.keys(result).filter((key) => key !== NEEDS_BOSS_REPLY);
  return (
    keys.length === CONTROLLER_ACTION_GUARDS.length &&
    CONTROLLER_ACTION_GUARDS.every((guard) => Object.hasOwn(result, guard))
  );
}

/** A single missing or extra key against Playbook 10's controller domain. */
export function controllerDecisionNearMiss(
  result: unknown,
): { missing: string[]; extra: string[] } | undefined {
  if (!isStringMap(result)) return undefined;
  const actual = Object.keys(result).filter((key) => key !== NEEDS_BOSS_REPLY);
  const expected = new Set<string>(CONTROLLER_ACTION_GUARDS);
  const present = new Set(actual);
  const missing = CONTROLLER_ACTION_GUARDS.filter((key) => !present.has(key));
  const extra = actual.filter((key) => !expected.has(key));
  return missing.length + extra.length === 1 ? { missing, extra } : undefined;
}

/** Whether a machine contains Playbook 10's grounded controller decision state. */
export function isControllerMachine(config: MachineConfigLike): boolean {
  return enumerateCaptainBindings(config).some(({ state, pinActor }) => {
    if (!pinActor || state.actor !== 'captain') return false;
    if (
      state.bindingFindings?.includes(
        'invoke.input.result is not a string-valued object',
      )
    ) {
      return false;
    }
    return isControllerDecisionResult(state.result);
  });
}

/** Whether an explicit direct-Captain result is one key from the controller domain. */
export function hasControllerDecisionNearMiss(
  config: MachineConfigLike,
): boolean {
  return enumerateCaptainBindings(config).some(
    ({ state, pinActor }) =>
      pinActor &&
      state.actor === 'captain' &&
      state.result[NEEDS_BOSS_REPLY] === undefined &&
      controllerDecisionNearMiss(state.result) !== undefined,
  );
}

function concurrentRoleSets(value: unknown): string[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sets: string[][] = [];
  for (const candidate of value) {
    if (
      !Array.isArray(candidate) ||
      candidate.some((role) => typeof role !== 'string')
    ) {
      return undefined;
    }
    sets.push([...candidate] as string[]);
  }
  return sets;
}

/**
 * Checks GEARS↔FSM conformance and returns human-readable findings (empty when
 * conformant): every GEARS item maps to one state with the same player and the
 * prompt verbatim, every captain state references a known item, and every
 * captain state's `result` map declares the Boss-reply suspension key with its
 * adjudicator contract (verification-1, verification-3; DR-009).
 */
export function checkGearsFsmConformance(
  gears: string,
  config: MachineConfigLike,
  options: GearsFsmConformanceOptions = {},
): string[] {
  const items = parseGearsItems(gears);
  const roleContract = inspectGearsRoleContract(gears);
  const controller = isControllerMachine(config);
  const captainBindings = enumerateCaptainBindings(config);
  const states = captainBindings.map(({ state }) => state);
  const controllerNearMisses = captainBindings.flatMap(
    ({ state, pinActor }) => {
      if (
        !pinActor ||
        state.actor !== 'captain' ||
        state.result[NEEDS_BOSS_REPLY] !== undefined
      ) {
        return [];
      }
      const nearMiss = controllerDecisionNearMiss(state.result);
      return nearMiss === undefined ? [] : [{ state, nearMiss }];
    },
  );
  const controllerContractCandidate =
    controller || controllerNearMisses.length > 0;
  const explicitActorStates = new Set(
    captainBindings
      .filter(({ pinActor }) => pinActor)
      .map(({ state }) => state),
  );
  const playbookStates = enumeratePlaybookStates(config);
  const scriptStates = enumerateScriptStates(config);
  const findings: string[] = [];

  for (const { state, nearMiss } of controllerNearMisses) {
    const detail =
      nearMiss.missing.length > 0
        ? `missing ${JSON.stringify(nearMiss.missing[0])}`
        : `extra ${JSON.stringify(nearMiss.extra[0])}`;
    findings.push(
      `FSM state ${state.stateId}: controller decision contract near-miss (${detail}); the controller domain requires exactly ${CONTROLLER_ACTION_GUARDS.join(', ')}`,
    );
  }

  findings.push(...structuredStateIdentityFindings(walkStateNodes(config)));
  findings.push(...roleContract.findings);
  const requiresConcurrentRoleSets =
    roleContract.generation === 'schema-3' ||
    controller ||
    options.artifactSchema === 3;
  if (requiresConcurrentRoleSets) {
    const actual = concurrentRoleSets(options.concurrentRoleSets);
    if (actual === undefined) {
      findings.push('schema-3 FSM exports no valid concurrentRoleSets array');
    } else if (
      JSON.stringify(actual) !== JSON.stringify(roleContract.concurrentRoleSets)
    ) {
      findings.push(
        `schema-3 FSM concurrentRoleSets ${JSON.stringify(actual)} do not match GEARS groups ${JSON.stringify(roleContract.concurrentRoleSets)}`,
      );
    }
  }

  for (const item of items) {
    findings.push(
      ...(item.resultFindings ?? []).map(
        (finding) => `GEARS item ${item.id}: ${finding}`,
      ),
    );
  }

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
  for (const state of scriptStates) {
    findings.push(
      ...(state.bindingFindings ?? []).map(
        (finding) => `FSM script state ${state.stateId}: ${finding}`,
      ),
    );
  }

  const scriptStatesByItem = new Map<string, ScriptInvocationState[]>();
  for (const state of scriptStates) {
    if (state.sourceItem === '') continue;
    const matched = scriptStatesByItem.get(state.sourceItem);
    if (matched === undefined)
      scriptStatesByItem.set(state.sourceItem, [state]);
    else matched.push(state);
  }

  const statesByItem = new Map<string, CaptainState[]>();
  for (const state of states) {
    if (state.sourceItem === '') continue;
    const matched = statesByItem.get(state.sourceItem);
    if (matched === undefined) statesByItem.set(state.sourceItem, [state]);
    else matched.push(state);
  }

  const playbookItems = items.filter(isPlaybookItem);
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
  const itemsBySignature = new Map<string, GearsItem[]>();
  for (const item of playbookItems) {
    if ((playbookMatchesByItem.get(item)?.length ?? 0) > 0) continue;
    const key = gearsPlaybookSignature(item);
    const grouped = itemsBySignature.get(key);
    if (grouped === undefined) itemsBySignature.set(key, [item]);
    else grouped.push(item);
  }
  const statesBySignature = new Map<string, PlaybookInvocationState[]>();
  for (const state of playbookStates) {
    if (state.sourceItem !== undefined) continue;
    const key = statePlaybookSignature(state);
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
    if (isPlaybookItem(item)) {
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
      if (item.playbookIdContext !== undefined) {
        if (item.textContext === undefined) {
          findings.push(
            `${item.id}: GEARS dynamic playbook text is not a single <contextField> placeholder`,
          );
        }
        if (state.playbookIdContext !== item.playbookIdContext) {
          findings.push(
            `${item.id}: FSM playbookIdContext "${state.playbookIdContext ?? ''}" is not GEARS context "${item.playbookIdContext}"`,
          );
        }
        if (state.textContext !== item.textContext) {
          findings.push(
            `${item.id}: FSM textContext "${state.textContext ?? ''}" is not GEARS context "${item.textContext ?? ''}"`,
          );
        }
      } else {
        if (state.playbookId !== item.playbookId) {
          findings.push(
            `${item.id}: FSM playbook "${state.playbookId ?? ''}" is not GEARS playbook "${item.playbookId ?? ''}"`,
          );
        }
        if (state.text !== item.prompt) {
          findings.push(
            `${item.id}: FSM playbook text is not the GEARS prompt verbatim`,
          );
        }
      }
      continue;
    }
    if (item.actor === 'script') {
      const matchedScripts = scriptStatesByItem.get(item.id) ?? [];
      if (matchedScripts.length === 0) {
        const drifted = statesByItem.get(item.id) ?? [];
        findings.push(
          drifted.length > 0
            ? `${item.id}: FSM actor "${drifted[0].actor}" is not GEARS actor "script"`
            : `GEARS item ${item.id} maps to no FSM script state`,
        );
        continue;
      }
      if (matchedScripts.length > 1) {
        findings.push(
          `GEARS item ${item.id} maps to ${matchedScripts.length} FSM script states (expected exactly one: ${matchedScripts.map((s) => s.stateId).join(', ')})`,
        );
      }
      const scriptState = matchedScripts[0];
      if (scriptState.command !== item.prompt) {
        findings.push(
          `${item.id}: FSM script command is not the GEARS blockquote verbatim`,
        );
      }
      if (item.result !== undefined) {
        const expected = Object.entries(item.result);
        const actual = Object.entries(scriptState.result);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          findings.push(
            `${item.id}: FSM script result contract ${JSON.stringify(actual)} is not GEARS Results ${JSON.stringify(expected)}`,
          );
        }
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
    if (
      item.actor !== undefined &&
      explicitActorStates.has(state) &&
      state.actor !== item.actor
    ) {
      findings.push(
        `${item.id}: FSM actor "${state.actor}" is not GEARS actor "${item.actor}"`,
      );
    }
    if (item.actor === 'player') {
      if (roleContract.generation === 'schema-3') {
        const expectedRole = canonicalRoleId(item.player);
        if (state.role !== expectedRole) {
          findings.push(
            `${item.id}: FSM role ${JSON.stringify(state.role ?? '')} is not GEARS canonical role ${JSON.stringify(expectedRole)}`,
          );
        }
        if (state.player !== '') {
          findings.push(
            `${item.id}: schema-3 delegated role carries removed invoke.input.player ${JSON.stringify(state.player)}`,
          );
        }
      } else {
        if (state.player !== item.player) {
          findings.push(
            `${item.id}: FSM player "${state.player}" is not GEARS player "${item.player}"`,
          );
        }
        if (state.role !== undefined) {
          findings.push(
            `${item.id}: historical delegated player unexpectedly carries invoke.input.role ${JSON.stringify(state.role)}`,
          );
        }
      }
    }
    if (state.prompt !== item.prompt) {
      findings.push(`${item.id}: FSM prompt is not the GEARS prompt verbatim`);
    }
    if (item.result !== undefined) {
      const expected = Object.entries(item.result);
      const actual = Object.entries(state.result).filter(
        ([guard]) => guard !== NEEDS_BOSS_REPLY,
      );
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        findings.push(
          `${item.id}: FSM domain result contract ${JSON.stringify(actual)} is not GEARS Results ${JSON.stringify(expected)}`,
        );
      }
    }
  }
  const itemIds = new Set(items.map((item) => item.id));
  const playbookItemIds = new Set(playbookItems.map((item) => item.id));
  const scriptItemIds = new Set(
    items.filter((item) => item.actor === 'script').map((item) => item.id),
  );
  for (const state of scriptStates) {
    if (state.sourceItem === '') continue;
    if (!itemIds.has(state.sourceItem)) {
      findings.push(
        `FSM script state ${state.stateId} references unknown GEARS item ${state.sourceItem}`,
      );
    } else if (!scriptItemIds.has(state.sourceItem)) {
      findings.push(
        `FSM script state ${state.stateId} realizes non-script GEARS item ${state.sourceItem}`,
      );
    }
  }
  for (const state of states) {
    if (state.sourceItem !== '' && !itemIds.has(state.sourceItem)) {
      findings.push(
        `FSM state ${state.stateId} references unknown GEARS item ${state.sourceItem}`,
      );
    }
    const bossReply = state.result[NEEDS_BOSS_REPLY];
    if (controller) {
      if (bossReply !== undefined) {
        findings.push(
          `FSM controller state ${state.stateId} unexpectedly declares ${NEEDS_BOSS_REPLY}`,
        );
      }
    } else if (controllerContractCandidate) {
      // The precise controller-domain diagnostic above owns a malformed
      // near-controller artifact; do not suggest adding the ordinary wait key.
      continue;
    } else if (bossReply === undefined) {
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
 * Machine introspection (verification-4).
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
  publicStateId: string | null;
  type: string | null;
  initial: string | null;
  tags: string[];
  children: string[];
  invokes: string[];
  onDone: TransitionArm[];
  onError: TransitionArm[];
  on: EventArms;
}

/** The structural facts {@link pinIntrospection} pins for a machine (verification-4). */
export interface IntrospectionPins {
  initial: string | null;
  /** Captain-invoking states, in declaration order. */
  captain: {
    state: string;
    path?: string;
    actor?: 'captain' | 'player';
    sourceItem: string;
    player: string;
    /** Canonical schema-3 role; absent for historical schema-1 pins. */
    role?: string;
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
    playbookId?: string;
    playbookIdContext?: string;
    textContext?: string;
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
 * test pins (verification-4): captain bindings with result keys and every transition
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
      // Captain-binding enumeration never yields `script`; the widened
      // CaptainState union exists only for coverage-driving views.
      ...(binding.pinActor && binding.state.actor !== 'script'
        ? { actor: binding.state.actor }
        : {}),
      sourceItem: binding.state.sourceItem,
      player: binding.state.player,
      ...(binding.state.role !== undefined ? { role: binding.state.role } : {}),
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
      ...(binding.state.playbookIdContext === undefined
        ? { playbookId: binding.state.playbookId }
        : {}),
      ...(binding.state.playbookIdContext !== undefined
        ? { playbookIdContext: binding.state.playbookIdContext }
        : {}),
      ...(binding.state.textContext !== undefined
        ? { textContext: binding.state.textContext }
        : {}),
      ...(binding.state.sourceItem !== undefined
        ? { sourceItem: binding.state.sourceItem }
        : {}),
      onDone: normalizeArms(binding.invoke.onDone),
      onError: normalizeArms(binding.invoke.onError),
      on: eventArms(binding.node.state.on),
    }));
  const structured = hasStructuredTopology(nodes)
    ? {
        states: nodes.map(({ path, state, statePath }) => ({
          path: statePath,
          parent: path.length > 1 ? path.slice(0, -1).join('.') : null,
          id: typeof state.id === 'string' ? state.id : null,
          publicStateId: metadataStateId(state) ?? null,
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
 * Prompt-contract capture and composition checks (verification-5).
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

// Direct Captain prompts cross the callCaptain boundary and therefore must
// not acquire player-only routing or session-control text. Match the stable
// labelled form as well as natural-language variants; occurrence deltas below
// keep self-hosting prompt bodies free to quote either marker verbatim.
const PLAYER_BINDING_MARKER =
  /\bplayer\s+binding\b|(?:^|\n)[ \t]*player[ \t]*:[ \t]*(?=\S)/gi;
const ROLE_BINDING_MARKER =
  /\brole\s+binding\b|(?:^|\n)[ \t]*role[ \t]*:[ \t]*(?=\S)/gi;
const PLAYER_RESUME_MARKER =
  /\b(?:resume|resuming)\b[^\n]{0,120}\bplayer(?:'s)?\b|\bplayer(?:'s)?\b[^\n]{0,120}\b(?:resume|resuming)\b/gi;

/** One captain state's derived prompt contract (verification-5). */
export interface PromptContractRow {
  state: string;
  sourceItem: string;
  player: string;
  /** Canonical schema-3 role; absent for historical schema-1 rows. */
  role?: string;
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
const BOSS_CONTEXT_FIELDS = [
  'pendingBossQuestion',
  'bossReply',
  'pendingBossQuestions',
  'bossReplies',
];

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
 * (verification-5): traced context reads, sentinel-traced input wiring, and the
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
      ...(state.role !== undefined ? { role: state.role } : {}),
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
 * (verification-5).
 */
export function deriveSubstitutions(
  config: MachineConfigLike,
  compose: PromptComposer,
  actor?: CaptainState['actor'],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const binding of enumerateCaptainBindings(config)) {
    const { state, inputFn } = binding;
    if (actor !== undefined && state.actor !== actor) continue;
    if (typeof inputFn !== 'function') continue;
    try {
      const reads = probeContextReads(inputFn);
      const composed = composeForState(
        compose,
        state,
        inputFn({ context: ordinaryContext(reads) }),
      );
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
      const promptReads = promptSentinelFields(state, reads);
      for (const line of state.prompt.split('\n')) {
        for (const token of matchPromptBody(line, composed, promptReads)
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
 * (verification-5), returning findings (empty when conformant): the prompt body is
 * preserved modulo substituted placeholders, the adjudicator-facing Boss-reply
 * contract never leaks into a player prompt, no continuation appears on an
 * ordinary turn, and a Boss-reply continuation turn opens with the exact
 * preamble and labelled Q&A blocks before the body.
 */
export function checkPromptComposition(opts: {
  config: MachineConfigLike;
  compose: PromptComposer;
  /** Restricts the check to the states served by the matching composer. */
  actor?: CaptainState['actor'];
  /** Grounded linked-artifact schema for otherwise ambiguous direct Captain states. */
  artifactSchema?: 1 | 3;
}): string[] {
  const findings: string[] = [];
  const controller = isControllerMachine(opts.config);
  const schemaResolution = resolveArtifactSchemaForVerification({
    config: opts.config,
    ...(opts.artifactSchema === undefined
      ? {}
      : { artifactSchema: opts.artifactSchema }),
  });
  findings.push(...schemaResolution.findings);
  const inferredArtifactSchema = schemaResolution.artifactSchema;
  const substitutions = deriveSubstitutions(
    opts.config,
    opts.compose,
    opts.actor,
  );
  const composerName =
    opts.actor === 'captain' ? 'composeCaptainPrompt' : 'composePlayerPrompt';
  const bindings = enumerateCaptainBindings(opts.config);
  for (const binding of bindings) {
    const { state, inputFn } = binding;
    if (opts.actor !== undefined && state.actor !== opts.actor) continue;
    if (typeof inputFn !== 'function') continue;
    const reads = probeContextReads(inputFn);
    const promptReads = promptSentinelFields(state, reads);
    const substituted = substitutions[state.stateId] ?? [];

    let ordinary: string;
    try {
      ordinary = composeForState(
        opts.compose,
        state,
        inputFn({ context: ordinaryContext(reads) }),
      );
      if (typeof ordinary !== 'string') {
        throw new Error(`${composerName} returned a non-string value`);
      }
    } catch (error) {
      findings.push(
        `${state.stateId}: ${composerName} threw on an ordinary turn: ${messageOf(error)}`,
      );
      continue;
    }
    findings.push(
      ...bodyFindings(state, ordinary, substituted, promptReads, 'ordinary'),
    );
    pushUnique(findings, ...promptControlFindings(state, ordinary));
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
    // Controllers own no Boss-reply wait. A missing ordinary result is already
    // diagnosed by conformance, so do not fabricate a continuation contract.
    if (controller || !Object.hasOwn(state.result, NEEDS_BOSS_REPLY)) continue;

    const artifactSchema =
      schemaResolution.findings.length > 0
        ? undefined
        : (inferredArtifactSchema ??
          (state.role !== undefined ? 3 : state.player !== '' ? 1 : undefined));
    if (artifactSchema === undefined) {
      findings.push(
        `${state.stateId}: prompt composition requires artifactSchema 1 or 3 to probe this direct-Captain continuation`,
      );
      continue;
    }

    // A Boss-reply continuation turn: the thunk carries the pending question
    // and reply, and the composer opens with the exact preamble and labelled
    // Q&A blocks before the domain body (gears2fsm.md, link.md).
    const question = sentinelFor('question');
    const reply = sentinelFor('bossReply');
    const pendingBossQuestion = {
      ...(artifactSchema === 3
        ? state.actor === 'captain'
          ? { asker: { kind: 'captain' as const } }
          : { asker: { kind: 'role' as const, roleId: state.role ?? '' } }
        : {
            player: state.actor === 'captain' ? 'Captain' : state.player,
          }),
      questionId: state.stateId,
      resumeStateId: state.stateId,
      sourceItem: state.sourceItem,
      question,
    };
    let continuation: string;
    let input: unknown;
    try {
      input = inputFn({
        context: {
          ...ordinaryContext(reads),
          pendingBossQuestion,
          bossReply: reply,
          pendingBossQuestions: {
            [state.stateId]: pendingBossQuestion,
          },
          bossReplies: { [state.stateId]: reply },
        },
      });
      continuation = composeForState(opts.compose, state, input);
      if (typeof continuation !== 'string') {
        throw new Error(`${composerName} returned a non-string value`);
      }
    } catch (error) {
      findings.push(
        `${state.stateId}: ${composerName} threw on a continuation turn: ${messageOf(error)}`,
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
    const bodyStart = bodyIndex(state, continuation, substituted, promptReads);
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
      ...bodyFindings(
        state,
        continuation,
        substituted,
        promptReads,
        'continuation',
      ),
    );
    pushUnique(findings, ...promptControlFindings(state, continuation));
  }
  return findings;
}

type PromptIdentity = (roleId: string) => string;
type PromptComposer = (
  input: unknown,
  promptIdentity: PromptIdentity,
) => string;

function promptSentinelFields(
  state: CaptainState,
  reads: readonly string[],
): string[] {
  return state.role === undefined
    ? [...reads]
    : [...reads, `promptIdentity:${state.role}`];
}

function composeForState(
  compose: PromptComposer,
  state: CaptainState,
  input: unknown,
): string {
  // Schema-1 composers and the shared default composer use their second
  // positional argument as a placeholder-field map. A callable proxy with a
  // property-clean view is therefore both an invocation-scoped schema-3 lookup
  // and an empty map to historical/default composition, without Function.name,
  // Function.length, or Function.prototype token collisions.
  const lookup: PromptIdentity = (roleId) => {
    if (state.role === undefined) {
      throw new Error(
        `prompt identity lookup used role ${JSON.stringify(roleId)} for a direct-Captain or historical state`,
      );
    }
    if (roleId !== state.role) {
      throw new Error(
        `prompt identity lookup used role ${JSON.stringify(roleId)} instead of canonical local role ${JSON.stringify(state.role)}`,
      );
    }
    return sentinelFor(`promptIdentity:${roleId}`);
  };
  const promptIdentity = new Proxy(lookup, {
    get: () => undefined,
    has: () => false,
    ownKeys: () => [],
    getOwnPropertyDescriptor: () => undefined,
  });
  return state.actor === 'player' && state.role !== undefined
    ? compose(input, promptIdentity)
    : (compose as (value: unknown) => string)(input);
}

function promptControlFindings(
  state: CaptainState,
  composed: string,
): string[] {
  const findings: string[] = [];
  const introducesPlayerBinding =
    patternOccurrences(composed, PLAYER_BINDING_MARKER) >
    patternOccurrences(state.prompt, PLAYER_BINDING_MARKER);
  if (state.actor === 'captain' && introducesPlayerBinding) {
    findings.push(
      `${state.stateId}: composeCaptainPrompt introduces a player binding into a direct-Captain prompt`,
    );
  } else if (state.role !== undefined && introducesPlayerBinding) {
    findings.push(
      `${state.stateId}: composePlayerPrompt exposes a concrete player binding in a schema-3 delegated-role prompt`,
    );
  }
  if (
    state.actor === 'captain' &&
    patternOccurrences(composed, ROLE_BINDING_MARKER) >
      patternOccurrences(state.prompt, ROLE_BINDING_MARKER)
  ) {
    findings.push(
      `${state.stateId}: composeCaptainPrompt introduces a role binding into a direct-Captain prompt`,
    );
  }
  if (
    state.actor === 'captain' &&
    patternOccurrences(composed, PLAYER_RESUME_MARKER) >
      patternOccurrences(state.prompt, PLAYER_RESUME_MARKER)
  ) {
    findings.push(
      `${state.stateId}: composeCaptainPrompt introduces a player resume instruction into a direct-Captain prompt`,
    );
  }
  return findings;
}

function patternOccurrences(hay: string, pattern: RegExp): number {
  return [...hay.matchAll(new RegExp(pattern.source, pattern.flags))].length;
}

function pushUnique(target: string[], ...values: string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

/** Counts non-overlapping occurrences of `needle` in `hay`. */
function occurrences(hay: string, needle: string): number {
  return needle === '' ? 0 : hay.split(needle).length - 1;
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
  const placeholderMatches = [...prompt.matchAll(PLACEHOLDER)];
  const sentinels = reads.map(sentinelFor);
  const sentinelForms = sentinels.flatMap((sentinel) => [
    sentinel,
    JSON.stringify(sentinel),
  ]);

  // Decompose the prompt into literal segments separated by placeholders, then
  // scan the composed text segment by segment. A monolithic escaped regex over
  // a meta-scale prompt exceeds the engine's pattern-size limit, so matching
  // is plain string comparison over a finite candidate set at each gap.
  const segments: string[] = [];
  const tokens: string[] = [];
  let offset = 0;
  for (const match of placeholderMatches) {
    segments.push(prompt.slice(offset, match.index));
    tokens.push(match[0]);
    offset = match.index + match[0].length;
  }
  segments.push(prompt.slice(offset));

  const tryFrom = (start: number): { end: number; values: string[] } | null => {
    if (!composed.startsWith(segments[0], start)) return null;
    let pos = start + segments[0].length;
    const values: string[] = [];
    for (let gap = 0; gap < tokens.length; gap++) {
      const token = tokens[gap];
      const candidates =
        expectedSubstitutions === undefined
          ? [token, ...sentinelForms]
          : expectedSubstitutions.includes(token)
            ? sentinelForms
            : [token];
      const next = segments[gap + 1];
      const chosen = candidates.find(
        (candidate) =>
          composed.startsWith(candidate, pos) &&
          composed.startsWith(next, pos + candidate.length),
      );
      if (chosen === undefined) return null;
      values.push(chosen);
      pos += chosen.length + next.length;
    }
    if (pos !== composed.length && composed[pos] !== '\n') return null;
    return { end: pos, values };
  };

  for (let start = 0; start <= composed.length; start++) {
    if (start !== 0 && composed[start - 1] !== '\n') continue;
    const attempt = tryFrom(start);
    if (attempt === null) continue;

    if (expectedSubstitutions !== undefined) {
      return { index: start, substitutions: [...expectedSubstitutions] };
    }
    const modes = new Map<string, Set<'literal' | 'sentinel'>>();
    for (let gap = 0; gap < tokens.length; gap++) {
      const token = tokens[gap];
      const tokenModes = modes.get(token) ?? new Set();
      tokenModes.add(attempt.values[gap] === token ? 'literal' : 'sentinel');
      modes.set(token, tokenModes);
    }
    if ([...modes.values()].some((tokenModes) => tokenModes.size > 1)) {
      continue;
    }
    const substitutions = placeholdersIn(prompt).filter(
      (token) => modes.get(token)?.has('sentinel') === true,
    );
    return { index: start, substitutions };
  }
  return null;
}

/** Findings when a composed prompt does not preserve the domain body (verification-5). */
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

// Local copy: this module is copied verbatim beside the artifact (verification-12),
// so it may not import a sibling module.
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serializes an arbitrary string as a safe JavaScript/TypeScript literal. */
function sourceString(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Package-export default for direct emitter callers. Full reserved-pipeline
 * runs override it with the artifact-local verifier support module.
 */
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

/** Reads the schema-3 cohort declaration from an imported FSM module. */
export function findConcurrentRoleSets(fsmModule: unknown): unknown {
  if (typeof fsmModule !== 'object' || fsmModule === null) return undefined;
  return (fsmModule as { concurrentRoleSets?: unknown }).concurrentRoleSets;
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
  /** Reviewed schema baked into roleless artifact checks when available. */
  artifactSchema?: 1 | 3;
}): string {
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Generated by slc (DR-009): GEARS↔FSM conformance.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkGearsFsmConformance, findConcurrentRoleSets, findMachineConfig } from ${sourceString(opts.verifyModule)};
import * as fsm from ${sourceString(opts.fsmModule)};

describe(${sourceString(`${opts.basename}: GEARS↔FSM conformance`)}, () => {
  it('maps every GEARS item to a state with its player and verbatim prompt', () => {
    const gears = readFileSync(
      fileURLToPath(new URL(${sourceString(opts.gearsFile)}, import.meta.url)),
      'utf8',
    );
    expect(
      checkGearsFsmConformance(gears, findMachineConfig(fsm), {
        concurrentRoleSets: findConcurrentRoleSets(fsm),
        ${
          opts.artifactSchema === undefined
            ? ''
            : `artifactSchema: ${opts.artifactSchema},`
        }
      }),
    ).toEqual([]);
  });
});
`;
}

/**
 * Emits the GEARS↔FSM conformance test as `slc` output beside a compiled
 * `playbook` artifact: writes `<basename>.gears-fsm.test.ts` into the artifact
 * directory (`<basename>.playbook/`), wiring the artifact's `gears` file and its
 * `fsm` module's machine to the checker, and returns the written path (verification-2;
 * [DR-009](../decisions/009-slc-playbook-pipeline-compilation.md)).
 */
export async function emitGearsFsmConformanceTest(opts: {
  /** The artifact directory (`<basename>.playbook/`) to emit the test into. */
  artifactDir: string;
  /** Basename shared by the artifacts (e.g. `code`). */
  basename: string;
  /** Checker import specifier; defaults to {@link VERIFY_MODULE}. */
  verifyModule?: string;
  /** Reviewed schema baked into roleless artifact checks when available. */
  artifactSchema?: 1 | 3;
}): Promise<string> {
  const content = generateGearsFsmConformanceTest({
    basename: opts.basename,
    // NodeNext source imports the TypeScript artifact through its runtime
    // `.js` specifier; Vitest resolves that edge to the sibling source.
    fsmModule: `./${opts.basename}.fsm.js`,
    gearsFile: `./${opts.basename}.gears.md`,
    verifyModule: opts.verifyModule ?? VERIFY_MODULE,
    ...(opts.artifactSchema === undefined
      ? {}
      : { artifactSchema: opts.artifactSchema }),
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
 * Imports generated linked TypeScript for emission-time, standalone, or
 * equivalence review before its sibling FSM has been built to JavaScript.
 * NodeNext source correctly names the runtime-safe `./<basename>.fsm.js` edge,
 * but review may run while only `./<basename>.fsm.ts` exists. Stage a
 * same-directory copy whose one generated module specifier points at the
 * hashed TypeScript artifact, import that copy, and remove it without changing
 * the linked source or its production import.
 */
export async function loadLinkedModuleForVerification(opts: {
  linkedPath: string;
  fsmPath: string;
}): Promise<unknown> {
  const linkedSource = await readFile(opts.linkedPath, 'utf8');
  const fsmStem = basename(opts.fsmPath, '.ts');
  const runtimeSpecifier = `./${fsmStem}.js`;
  const verificationSpecifier = `./${fsmStem}.ts?v=${await hashFile(
    opts.fsmPath,
  )}`;
  const stagedSource = linkedSource
    .replaceAll(
      sourceString(runtimeSpecifier),
      sourceString(verificationSpecifier),
    )
    .replaceAll(`'${runtimeSpecifier}'`, `'${verificationSpecifier}'`);

  // Linked fixtures that do not import their FSM need no staging and retain
  // the established direct-loading behavior.
  if (stagedSource === linkedSource) {
    return loadFsmModule(opts.linkedPath);
  }

  const linkedStem = basename(opts.linkedPath, '.ts');
  const stagedPath = join(
    dirname(opts.linkedPath),
    `.${linkedStem}.slc-verify-${randomUUID()}.ts`,
  );
  await writeFile(stagedPath, stagedSource, { flag: 'wx' });
  try {
    return await loadFsmModule(stagedPath);
  } finally {
    await unlink(stagedPath);
  }
}

/**
 * Builds a per-artifact vitest module that fails when the machine's structure
 * drifts from the topology pinned at build time (verification-4).
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
 * the artifacts at build time (verification-5): the per-state context reads, input
 * wiring, and placeholders always; and, when the linked module exposes its
 * matching Captain/player composers, the composition checks and pinned
 * substitution maps.
 */
export function generatePromptContractTest(opts: {
  basename: string;
  fsmModule: string;
  verifyModule: string;
  rows: PromptContractRow[];
  /** Grounded artifact schema baked into continuation probes when available. */
  artifactSchema?: 1 | 3;
  /** Emission-time schema evidence that must remain empty for a valid artifact. */
  schemaFindings?: readonly string[];
  /** Present when the linked module beside the artifacts exposes its composer. */
  composer?: {
    playbookModule: string;
    captain?: Record<string, string[]>;
    player?: Record<string, string[]>;
  };
}): string {
  const composerImports = opts.composer
    ? `import * as playbook from ${sourceString(opts.composer.playbookModule)};\n`
    : '';
  const composerBlock = (
    [
      ['captain', 'Captain', 'composeCaptainPrompt'],
      ['player', 'player', 'composePlayerPrompt'],
    ] as const
  )
    .flatMap(([actor, label, exportName]) => {
      const substituted = opts.composer?.[actor];
      if (substituted === undefined) return [];
      const constant = `${actor.toUpperCase()}_SUBSTITUTED`;
      const compose = `compose${label === 'Captain' ? 'Captain' : 'Player'}`;
      return [
        `
const ${constant} = ${JSON.stringify(substituted, null, 2)};

const ${compose} = (
  playbook as unknown as {
    _internal: { ${exportName}: (input: unknown) => string };
  }
)._internal.${exportName};

  it('composes ${label} prompts per the link contract', () => {
    expect(
      checkPromptComposition({
        config: findMachineConfig(fsm),
        compose: ${compose},
        actor: '${actor}',
        ${
          opts.artifactSchema === undefined
            ? ''
            : `artifactSchema: ${opts.artifactSchema},`
        }
      }),
    ).toEqual([]);
  });

  it('substitutes the ${label} placeholders pinned at build time', () => {
    expect(
      deriveSubstitutions(
        findMachineConfig(fsm),
        ${compose},
        '${actor}',
      ),
    ).toEqual(${constant});
  });
`,
      ];
    })
    .join('');
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
const SCHEMA_FINDINGS = ${JSON.stringify(opts.schemaFindings ?? [], null, 2)};

describe(${sourceString(`${opts.basename}: prompt contract`)}, () => {
  it('uses consistent artifact-schema evidence', () => {
    expect(SCHEMA_FINDINGS).toEqual([]);
  });

  it('matches the prompt contract pinned at build time', () => {
    expect(capturePromptContract(findMachineConfig(fsm))).toEqual(CONTRACT);
  });
${composerBlock}});
`;
}

function promptArtifactSchemaSignalsFromConfig(config: MachineConfigLike): {
  schema1: boolean;
  schema3: boolean;
} {
  const states = enumerateCaptainStates(config);
  return {
    schema1: states.some(({ player }) => player !== ''),
    schema3:
      isControllerMachine(config) ||
      states.some(({ role }) => role !== undefined),
  };
}

interface LinkedArtifactSchemaSignal {
  /** Exact immutable shared-factory compatibility is a schema-3 witness. */
  schema?: 3;
  /** A callable compat-less factory is the historical schema-1 fallback. */
  historicalFallback: boolean;
  /** An own `compat` exists but is not the exact immutable schema-3 record. */
  invalidCompatibility: boolean;
}

function linkedArtifactSchemaSignal(linked: {
  default?: unknown;
}): LinkedArtifactSchemaSignal {
  const factory = linked.default;
  if (typeof factory !== 'function') {
    return { historicalFallback: false, invalidCompatibility: false };
  }
  if (!Object.hasOwn(factory, 'compat')) {
    return { historicalFallback: true, invalidCompatibility: false };
  }
  const descriptor = Object.getOwnPropertyDescriptor(factory, 'compat');
  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true ||
    descriptor.writable !== false ||
    descriptor.configurable !== false
  ) {
    return { historicalFallback: false, invalidCompatibility: true };
  }
  const compat = descriptor.value;
  if (
    typeof compat !== 'object' ||
    compat === null ||
    Array.isArray(compat) ||
    Object.getPrototypeOf(compat) !== Object.prototype ||
    !Object.isFrozen(compat) ||
    Object.getOwnPropertySymbols(compat).length !== 0
  ) {
    return { historicalFallback: false, invalidCompatibility: true };
  }
  const names = Object.getOwnPropertyNames(compat);
  const artifactSchema = Object.getOwnPropertyDescriptor(
    compat,
    'artifactSchema',
  );
  const runtimeAbi = Object.getOwnPropertyDescriptor(compat, 'runtimeAbi');
  const exact =
    names.length === 2 &&
    names.includes('artifactSchema') &&
    names.includes('runtimeAbi') &&
    artifactSchema?.enumerable === true &&
    Object.hasOwn(artifactSchema, 'value') &&
    artifactSchema.value === 3 &&
    runtimeAbi?.enumerable === true &&
    Object.hasOwn(runtimeAbi, 'value') &&
    runtimeAbi.value === 1;
  return exact
    ? { schema: 3, historicalFallback: false, invalidCompatibility: false }
    : { historicalFallback: false, invalidCompatibility: true };
}

/** Schema decision shared by generated and standalone artifact verification. */
export function resolveArtifactSchemaForVerification(opts: {
  artifactSchema?: 1 | 3;
  provenance?: unknown;
  config?: MachineConfigLike;
  linked?: { default?: unknown };
}): { artifactSchema?: 1 | 3; findings: string[] } {
  const candidates: { source: string; schema: 1 | 3 }[] = [];
  if (opts.artifactSchema !== undefined) {
    candidates.push({
      source: 'review-supplied artifact schema',
      schema: opts.artifactSchema,
    });
  }
  const provenanceSchema = artifactSchemaForPlaybookProvenance(opts.provenance);
  if (opts.provenance !== undefined && provenanceSchema === undefined) {
    return {
      findings: [
        `artifact schema has unsupported link-target provenance ${JSON.stringify(opts.provenance)}`,
      ],
    };
  }
  if (provenanceSchema !== undefined) {
    candidates.push({
      source: 'reviewed link-target provenance',
      schema: provenanceSchema,
    });
  }
  if (opts.config !== undefined) {
    const configSignals = promptArtifactSchemaSignalsFromConfig(opts.config);
    if (configSignals.schema1)
      candidates.push({ source: 'FSM historical-player structure', schema: 1 });
    if (configSignals.schema3)
      candidates.push({ source: 'FSM role/controller structure', schema: 3 });
  }
  const linkedSignal =
    opts.linked === undefined
      ? undefined
      : linkedArtifactSchemaSignal(opts.linked);
  if (linkedSignal?.schema !== undefined) {
    candidates.push({
      source: 'linked factory compatibility',
      schema: linkedSignal.schema,
    });
  }

  const schemas = new Set(candidates.map(({ schema }) => schema));
  if (schemas.size > 1) {
    return {
      findings: [
        `artifact schema signals disagree (${candidates
          .map(({ source, schema }) => `${source}: ${schema}`)
          .join(', ')})`,
      ],
    };
  }
  if (linkedSignal?.invalidCompatibility) {
    return {
      findings: [
        'linked factory has an own compatibility declaration that is not exact immutable schema 3/runtime ABI 1',
      ],
    };
  }
  const [artifactSchema] = schemas;
  if (artifactSchema !== undefined) {
    return { artifactSchema, findings: [] };
  }
  if (linkedSignal?.historicalFallback) {
    return { artifactSchema: 1, findings: [] };
  }
  const hasAmbiguousCaptainContinuation =
    opts.config !== undefined &&
    enumerateCaptainStates(opts.config).some(
      (state) =>
        state.actor === 'captain' &&
        Object.hasOwn(state.result, NEEDS_BOSS_REPLY),
    );
  return hasAmbiguousCaptainContinuation
    ? {
        findings: [
          'artifact schema has no reviewed provenance, generation-specific actor structure, or callable linked factory for a direct-Captain continuation',
        ],
      }
    : { findings: [] };
}

/**
 * Emits the prompt-contract test beside a compiled `playbook` artifact
 * (verification-5): derives and pins the per-state contract from the physical
 * `<basename>.fsm.ts` artifact, then emits NodeNext `.js` imports for that FSM
 * and any linked `<basename>.playbook.ts` module. When the linked module
 * exposes the `_internal` composer matching each state actor —
 * `composeCaptainPrompt` for direct Captain work and `composePlayerPrompt` for
 * delegated work — the test pins substitution maps and composition checks.
 * Returns the written path and any diagnostics (a linked module that cannot be
 * imported or exposes no matching composer degrades independently to the
 * artifact-only checks).
 *
 * @throws when the `fsm` artifact cannot be imported or exports no machine.
 */
export async function emitPromptContractTest(opts: {
  artifactDir: string;
  basename: string;
  verifyModule?: string;
  /** Reviewed schema when the FSM shape alone cannot distinguish generations. */
  artifactSchema?: 1 | 3;
  /** Actual reviewed full-link target provenance, when the caller has it. */
  provenance?: unknown;
}): Promise<{ path: string; diagnostics: string[] }> {
  const diagnostics: string[] = [];
  const fsmPath = join(opts.artifactDir, `${opts.basename}.fsm.ts`);
  const config = findMachineConfig(await loadFsmModule(fsmPath));
  const rows = capturePromptContract(config);
  let schemaResolution = resolveArtifactSchemaForVerification({
    config,
    ...(opts.provenance === undefined ? {} : { provenance: opts.provenance }),
    ...(opts.artifactSchema === undefined
      ? {}
      : { artifactSchema: opts.artifactSchema }),
  });
  let artifactSchema = schemaResolution.artifactSchema;

  let composer:
    | {
        playbookModule: string;
        captain?: Record<string, string[]>;
        player?: Record<string, string[]>;
      }
    | undefined;
  const linkedPath = join(opts.artifactDir, `${opts.basename}.playbook.ts`);
  if (existsSync(linkedPath)) {
    try {
      const linked = (await loadLinkedModuleForVerification({
        linkedPath,
        fsmPath,
      })) as {
        default?: unknown;
        _internal?: {
          composeCaptainPrompt?: unknown;
          composePlayerPrompt?: unknown;
        };
      };
      schemaResolution = resolveArtifactSchemaForVerification({
        config,
        linked,
        ...(opts.provenance === undefined
          ? {}
          : { provenance: opts.provenance }),
        ...(opts.artifactSchema === undefined
          ? {}
          : { artifactSchema: opts.artifactSchema }),
      });
      artifactSchema = schemaResolution.artifactSchema;
      const actors = new Set(
        enumerateCaptainStates(config).map(({ actor }) => actor),
      );
      const substitutions: {
        captain?: Record<string, string[]>;
        player?: Record<string, string[]>;
      } = {};
      for (const actor of ['captain', 'player'] as const) {
        if (!actors.has(actor)) continue;
        const exportName =
          actor === 'captain' ? 'composeCaptainPrompt' : 'composePlayerPrompt';
        const compose = linked._internal?.[exportName];
        if (typeof compose !== 'function') {
          diagnostics.push(
            `prompt contract: linked module exposes no _internal.${exportName}; ${actor} composition checks not emitted`,
          );
          continue;
        }
        const typedCompose = compose as (input: unknown) => string;
        substitutions[actor] = deriveSubstitutions(config, typedCompose, actor);
        const findings = checkPromptComposition({
          config,
          compose: typedCompose,
          actor,
          ...(artifactSchema === undefined ? {} : { artifactSchema }),
        });
        diagnostics.push(
          ...findings.map((finding) => `prompt contract: ${finding}`),
        );
      }
      if (
        substitutions.captain !== undefined ||
        substitutions.player !== undefined
      ) {
        composer = {
          playbookModule: `./${opts.basename}.playbook.js`,
          ...substitutions,
        };
      }
    } catch (error) {
      diagnostics.push(
        `prompt contract: linked module could not be imported (${messageOf(error)}); composition checks not emitted`,
      );
    }
  }

  diagnostics.unshift(
    ...schemaResolution.findings.map(
      (finding) => `prompt contract: ${finding}`,
    ),
  );

  const content = generatePromptContractTest({
    basename: opts.basename,
    fsmModule: `./${opts.basename}.fsm.js`,
    verifyModule: opts.verifyModule ?? VERIFY_MODULE,
    rows,
    ...(artifactSchema === undefined ? {} : { artifactSchema }),
    schemaFindings: schemaResolution.findings,
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
 * (verification-4): derives topology pins from the physical `<basename>.fsm.ts`,
 * emits a NodeNext `.js` import for that sibling source, and writes
 * `<basename>.fsm.introspect.test.ts` into the artifact directory.
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
    fsmModule: `./${opts.basename}.fsm.js`,
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

// Transition-coverage verification (verification-6) lives in its own module — it
// depends on `xstate` to drive the machine — and is re-exported here so every
// generated test imports one checker module (`@sublang/slc/verify`).
export * from './verify-coverage.js';

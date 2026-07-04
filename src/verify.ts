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

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A GEARS spec item: its id, the player it prompts, and its verbatim prompt body. */
export interface GearsItem {
  id: string;
  player: string;
  prompt: string;
}

/** A captain-invoking FSM state's introspected binding (`gears2fsm` `invoke.input`). */
export interface CaptainState {
  stateId: string;
  sourceItem: string;
  player: string;
  prompt: string;
  /** The state's per-state guard contract: result key to description. */
  result: Record<string, string>;
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
  states?: Record<string, StateLike>;
}

interface StateLike {
  invoke?: {
    input?: (arg: { context: Record<string, unknown> }) => unknown;
  };
}

const ITEM_HEADING = /^###\s+([A-Za-z][\w-]*)\s*$/;
// The `text2gears` item form names a delegated player as "Captain shall prompt
// <Player>" (or a "relay ... to <Player>" variant); players are capitalized
// (text2gears.md).
const ITEM_PLAYER = /Captain shall (?:prompt|relay\b[^.]*?\bto)\s+([A-Z][\w]*)/;
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
      items.push({ id: current.id, player, prompt: current.prompt.join('\n') });
    }
    current = null;
  };
  for (const line of gears.split('\n')) {
    const heading = ITEM_HEADING.exec(line);
    if (heading !== null) {
      flush();
      current = { id: heading[1], player: '', captainActs: false, prompt: [] };
      continue;
    }
    if (SECTION_HEADING.test(line)) {
      flush();
      continue;
    }
    if (current === null) continue;
    const player = ITEM_PLAYER.exec(line);
    if (player !== null && current.player === '') current.player = player[1];
    else if (CAPTAIN_ACTS.test(line)) current.captainActs = true;
    const quote = BLOCKQUOTE.exec(line);
    if (quote !== null) current.prompt.push(quote[1]);
  }
  flush();
  return items;
}

/**
 * Enumerates a machine's captain-invoking states from its config, reading each
 * state's `invoke.input` under a stub context to recover the static `sourceItem`,
 * `player`, and `prompt` the `gears2fsm` contract carries.
 */
export function enumerateCaptainStates(
  config: MachineConfigLike,
): CaptainState[] {
  const out: CaptainState[] = [];
  for (const [stateId, state] of Object.entries(config.states ?? {})) {
    const inputFn = state.invoke?.input;
    if (typeof inputFn !== 'function') continue;
    let input: unknown;
    try {
      input = inputFn({ context: {} });
    } catch {
      continue;
    }
    if (typeof input !== 'object' || input === null) continue;
    const fields = input as {
      player?: unknown;
      sourceItem?: unknown;
      prompt?: unknown;
      result?: unknown;
    };
    if (typeof fields.sourceItem !== 'string') continue;
    out.push({
      stateId,
      sourceItem: fields.sourceItem,
      player: typeof fields.player === 'string' ? fields.player : '',
      prompt: typeof fields.prompt === 'string' ? fields.prompt : '',
      result: resultMap(fields.result),
    });
  }
  return out;
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
  const findings: string[] = [];

  const statesByItem = new Map<string, CaptainState[]>();
  for (const state of states) {
    const matched = statesByItem.get(state.sourceItem);
    if (matched === undefined) statesByItem.set(state.sourceItem, [state]);
    else matched.push(state);
  }
  for (const item of items) {
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
  for (const state of states) {
    if (!itemIds.has(state.sourceItem)) {
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
  return findings;
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

// Generated by slc (IR-007 Task 8): GEARS↔FSM conformance for ${opts.basename}.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkGearsFsmConformance, findMachineConfig } from '${opts.verifyModule}';
import * as fsm from '${opts.fsmModule}';

describe('${opts.basename}: GEARS↔FSM conformance', () => {
  it('maps every GEARS item to a state with its player and verbatim prompt', () => {
    const gears = readFileSync(
      fileURLToPath(new URL('${opts.gearsFile}', import.meta.url)),
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

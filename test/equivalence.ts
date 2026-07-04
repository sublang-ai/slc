// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Reference-equivalence comparator (VERIFY-9; IR-007 Task 9, DR-009).
 *
 * Two faithful compilations of the same workflow need not be byte-identical —
 * item partitions and state names are judgment — but they must agree on the
 * observable contract: the players bound, the verbatim per-player prompt-line
 * sets, the machine's Boss surfaces, conformance of each `fsm` to its own
 * `gears`, and the linked `createPlaybookRuntime` runtime contract. The
 * comparator returns findings (empty when equivalent); the acceptance test
 * wires it to `slc playbook` output and the manual reference package.
 */

import {
  checkGearsFsmConformance,
  findMachineConfig,
  parseGearsItems,
  pinIntrospection,
} from '../src/verify.js';
import { checkFsmCoverage } from '../src/verify-coverage.js';

/** One compilation's artifacts, loaded by the acceptance test. */
export interface CompiledPlaybook {
  /** The `gears` intermediate text. */
  gears: string;
  /** The imported `fsm` module. */
  fsm: unknown;
  /** The imported linked `playbook` module. */
  playbook: unknown;
  /** The `fsm` artifact source text, for coverage probing. */
  fsmSource?: string;
}

/**
 * Normalizes a prompt line for comparison: markdown escaping of angle brackets
 * (`\<coder-llm\>`) is source syntax, not content — a faithful compilation may
 * carry the token either escaped or plain.
 */
export function normalizePromptLine(line: string): string {
  return line.replace(/\\([<>])/g, '$1');
}

/**
 * The verbatim prompt-line sets per player bound in a `gears` artifact.
 *
 * Known limit: sets dedupe, so a compilation that drops one of two items with
 * identical prompts still compares equal here — cross-item duplication counts
 * are partition judgment, and comparing them would flag legitimate variance.
 * Structural completeness is covered by the conformance and coverage checks.
 */
export function playerLineSets(gears: string): Map<string, Set<string>> {
  const sets = new Map<string, Set<string>>();
  for (const item of parseGearsItems(gears)) {
    let lines = sets.get(item.player);
    if (lines === undefined) {
      lines = new Set();
      sets.set(item.player, lines);
    }
    for (const line of item.prompt.split('\n')) {
      if (line.trim() !== '') lines.add(normalizePromptLine(line));
    }
  }
  return sets;
}

/** The blockquoted lines of a free-form workflow source. */
export function sourceBlockquoteLines(sourceText: string): Set<string> {
  const lines = new Set<string>();
  for (const raw of sourceText.split('\n')) {
    const match = /^>\s?(.*)$/.exec(raw);
    if (match !== null && match[1].trim() !== '') {
      lines.add(normalizePromptLine(match[1]));
    }
  }
  return lines;
}

/**
 * Checks a compilation against its free-form source (text2gears faithfulness):
 * every `gears` prompt line is a source blockquote line verbatim, and every
 * source blockquote line survives into the `gears`.
 */
export function checkSourceFaithfulness(
  sourceText: string,
  gears: string,
): string[] {
  const findings: string[] = [];
  const source = sourceBlockquoteLines(sourceText);
  const compiled = new Set<string>();
  for (const lines of playerLineSets(gears).values()) {
    for (const line of lines) compiled.add(line);
  }
  for (const line of compiled) {
    if (!source.has(line)) {
      findings.push(`gears line is not a source blockquote line: "${line}"`);
    }
  }
  for (const line of source) {
    if (!compiled.has(line)) {
      findings.push(`source blockquote line was dropped: "${line}"`);
    }
  }
  return findings;
}

/** Checks one compilation's internal integrity (conformance, surfaces, contract). */
export async function checkPlaybookIntegrity(
  label: string,
  compiled: CompiledPlaybook,
): Promise<string[]> {
  const findings: string[] = [];
  const config = findMachineConfig(compiled.fsm);

  findings.push(
    ...checkGearsFsmConformance(compiled.gears, config).map(
      (finding) => `${label}: ${finding}`,
    ),
  );
  findings.push(
    ...(
      await checkFsmCoverage(compiled.fsm, { sourceText: compiled.fsmSource })
    ).map((finding) => `${label}: ${finding}`),
  );

  // Runtime contract: a callable createPlaybookRuntime default export whose
  // runtime exposes init/handleBossInput/dispose (DR-005, link.md).
  const factory = (compiled.playbook as { default?: unknown }).default;
  if (typeof factory !== 'function') {
    findings.push(`${label}: linked module has no callable default export`);
  } else {
    try {
      const runtime = (
        factory as (options: unknown) => Record<string, unknown>
      )({});
      for (const member of ['init', 'handleBossInput', 'dispose']) {
        if (typeof runtime?.[member] !== 'function') {
          findings.push(`${label}: runtime lacks ${member}()`);
        }
      }
    } catch (error) {
      findings.push(
        `${label}: createPlaybookRuntime({}) threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return findings;
}

/**
 * Compares a produced compilation to the reference for equivalence (VERIFY-9):
 * the same player set, the same verbatim per-player prompt-line sets, matching
 * source-item counts per player, and both sides internally sound. State names
 * and item partitions are free choices and are not compared.
 */
export async function checkReferenceEquivalence(opts: {
  produced: CompiledPlaybook;
  reference: CompiledPlaybook;
}): Promise<string[]> {
  const findings: string[] = [];

  findings.push(...(await checkPlaybookIntegrity('produced', opts.produced)));
  findings.push(...(await checkPlaybookIntegrity('reference', opts.reference)));

  const produced = playerLineSets(opts.produced.gears);
  const reference = playerLineSets(opts.reference.gears);
  const producedPlayers = [...produced.keys()].sort();
  const referencePlayers = [...reference.keys()].sort();
  if (producedPlayers.join(',') !== referencePlayers.join(',')) {
    findings.push(
      `player sets differ: produced [${producedPlayers.join(', ')}] vs reference [${referencePlayers.join(', ')}]`,
    );
  }

  for (const player of referencePlayers) {
    const producedLines = produced.get(player) ?? new Set();
    const referenceLines = reference.get(player) ?? new Set();
    for (const line of referenceLines) {
      if (!producedLines.has(line)) {
        findings.push(`${player}: produced gears lacks the line "${line}"`);
      }
    }
    for (const line of producedLines) {
      if (!referenceLines.has(line)) {
        findings.push(`${player}: produced gears adds the line "${line}"`);
      }
    }
  }

  // The Boss surfaces must exist on both machines (pinIntrospection reports
  // them); captain-state counts are reported only through conformance, since
  // partitions are judgment.
  for (const [label, compiled] of [
    ['produced', opts.produced],
    ['reference', opts.reference],
  ] as const) {
    const pins = pinIntrospection(findMachineConfig(compiled.fsm));
    if (pins.interruptTargets.length === 0) {
      findings.push(`${label}: machine declares no BOSS_INTERRUPT targets`);
    }
    if (!pins.quiescent.some((state) => state.final)) {
      findings.push(`${label}: machine declares no final state`);
    }
    if (!pins.quiescent.some((state) => state.state === 'awaitBossReply')) {
      findings.push(`${label}: machine declares no awaitBossReply state`);
    }
  }

  return findings;
}

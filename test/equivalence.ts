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
  AWAIT_BOSS_REPLY_STATE,
  BOSS_REPLY_EVENT,
  checkGearsFsmConformance,
  findMachineConfig,
  parseGearsItems,
  pinIntrospection,
} from '../src/verify.js';
import { checkFsmCoverage } from '../src/verify-coverage.js';
import {
  isPlaybookRunResult,
  type RuntimeContractProfile,
} from '../src/playbook-contract.js';

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

export type RuntimeCapabilityProfile = RuntimeContractProfile;

/** Immutable linked-module export used where callable shape is ambiguous. */
export const RUNTIME_CONTRACT_PROFILE_EXPORT = 'runtimeContractProfile';

interface RuntimeProfileInspection {
  profile: RuntimeCapabilityProfile | null;
  findings: string[];
}

/**
 * Returns the linked runtime's exact observable contract profile.
 *
 * `legacy` and `session-v1` have the same three methods, so callable shape is
 * insufficient. The harness initializes fresh runtimes through each candidate
 * boundary and drives one inert, non-empty turn. An optional immutable marker
 * resolves a deliberately permissive fixture, but never overrides a boundary
 * or method-surface conflict.
 */
export async function runtimeCapabilityProfile(
  playbook: unknown,
): Promise<RuntimeCapabilityProfile | null> {
  return (await inspectRuntimeProfile(playbook)).profile;
}

async function inspectRuntimeProfile(
  playbook: unknown,
): Promise<RuntimeProfileInspection> {
  const findings: string[] = [];
  if (typeof playbook !== 'object' || playbook === null) {
    return { profile: null, findings };
  }
  const linked = playbook as Record<string, unknown>;
  const rawMarker = linked[RUNTIME_CONTRACT_PROFILE_EXPORT];
  const marker = isRuntimeContractProfile(rawMarker) ? rawMarker : undefined;
  if (rawMarker !== undefined && marker === undefined) {
    findings.push(
      `linked module declares unsupported ${RUNTIME_CONTRACT_PROFILE_EXPORT} ${JSON.stringify(rawMarker)}`,
    );
    return { profile: null, findings };
  }

  const factory = linked.default;
  if (typeof factory !== 'function') {
    findings.push('linked module has no callable default export');
    return { profile: null, findings };
  }
  const create = factory as (options: unknown) => unknown;
  const surface = inspectFactorySurface(create);
  findings.push(...surface.findings);
  if (!surface.valid) return { profile: null, findings };

  if (marker === 'composed-v2' && !surface.resumable) {
    findings.push('composed-v2 runtime lacks resumePlaybookCall()');
    return { profile: null, findings };
  }
  if ((marker === 'legacy' || marker === 'session-v1') && surface.resumable) {
    findings.push(
      `${marker} runtime unexpectedly exposes resumePlaybookCall()`,
    );
    return { profile: null, findings };
  }

  const candidates: readonly RuntimeContractProfile[] =
    marker !== undefined
      ? [marker]
      : surface.resumable
        ? ['composed-v2']
        : ['legacy', 'session-v1'];
  const probes = await Promise.all(
    candidates.map(async (profile) => ({
      profile,
      ...(await probeRuntimeProfile(create, profile)),
    })),
  );
  const accepted = probes.filter((probe) => probe.accepted);
  if (accepted.length === 1) {
    return { profile: accepted[0].profile, findings };
  }
  if (accepted.length > 1) {
    findings.push(
      `runtime accepts ambiguous contract profiles: ${accepted
        .map(({ profile }) => profile)
        .join(', ')}`,
    );
    return { profile: null, findings };
  }
  findings.push(
    `runtime matches no exact contract profile (${probes
      .map(({ profile, reason }) => `${profile}: ${reason}`)
      .join('; ')})`,
  );
  return { profile: null, findings };
}

function inspectFactorySurface(factory: (options: unknown) => unknown): {
  valid: boolean;
  resumable: boolean;
  findings: string[];
} {
  const findings: string[] = [];
  let runtime: unknown;
  try {
    runtime = factory({});
  } catch (error) {
    return {
      valid: false,
      resumable: false,
      findings: [`createPlaybookRuntime({}) threw: ${messageOf(error)}`],
    };
  }
  if (typeof runtime !== 'object' || runtime === null) {
    return {
      valid: false,
      resumable: false,
      findings: ['createPlaybookRuntime({}) returned a non-object'],
    };
  }
  const surface = runtime as Record<string, unknown>;
  for (const member of ['init', 'handleBossInput', 'dispose']) {
    if (typeof surface[member] !== 'function') {
      findings.push(`runtime lacks ${member}()`);
    }
  }
  if (
    surface.resumePlaybookCall !== undefined &&
    typeof surface.resumePlaybookCall !== 'function'
  ) {
    findings.push('runtime has non-callable resumePlaybookCall');
  }
  return {
    valid: findings.length === 0,
    resumable: typeof surface.resumePlaybookCall === 'function',
    findings,
  };
}

async function probeRuntimeProfile(
  factory: (options: unknown) => unknown,
  profile: RuntimeContractProfile,
): Promise<{ accepted: boolean; reason: string }> {
  let runtime: Record<string, unknown> | undefined;
  let reason = '';
  try {
    const created = factory({});
    if (typeof created !== 'object' || created === null) {
      return { accepted: false, reason: 'factory returned a non-object' };
    }
    runtime = created as Record<string, unknown>;
    const init = callable(runtime.init, 'init');
    const handle = callable(runtime.handleBossInput, 'handleBossInput');
    callable(runtime.dispose, 'dispose');
    const resumable = typeof runtime.resumePlaybookCall === 'function';
    if ((profile === 'composed-v2') !== resumable) {
      return {
        accepted: false,
        reason:
          profile === 'composed-v2'
            ? 'resumePlaybookCall is absent'
            : 'resumePlaybookCall is unexpectedly present',
      };
    }

    const signal = new AbortController().signal;
    await init.call(runtime, probeInitValue(profile));
    const result = await handle.call(runtime, {
      text: 'SLC runtime contract profile probe',
      signal,
    });
    if (profile === 'composed-v2') {
      if (!isPlaybookRunResult(result)) {
        reason = 'turn did not return a valid structured result';
      }
    } else if (result !== undefined) {
      reason = 'void-result profile returned a value';
    }
  } catch (error) {
    reason = messageOf(error);
  } finally {
    if (runtime !== undefined && typeof runtime.dispose === 'function') {
      try {
        await (runtime.dispose as () => Promise<void>).call(runtime);
      } catch (error) {
        if (reason === '') reason = `dispose failed: ${messageOf(error)}`;
      }
    }
  }
  return { accepted: reason === '', reason: reason || 'accepted' };
}

function probeInitValue(profile: RuntimeContractProfile): unknown {
  const ports = probePorts(profile === 'composed-v2');
  if (profile === 'legacy') return ports;
  if (profile === 'session-v1') {
    return { sessionId: 'slc-profile-probe', playbookId: 'probe', ports };
  }
  return {
    sessionId: 'slc-profile-probe',
    playbookId: 'probe',
    rootSessionId: 'slc-profile-probe',
    depth: 0,
    ports,
  };
}

function probePorts(composed: boolean): Record<string, unknown> {
  return {
    callPlayer: async () => ({
      status: 'error',
      error: 'profile probe does not invoke players',
    }),
    callJudge: async () => '{}',
    ...(composed
      ? {
          callPlaybook: async (request: { playbookId?: unknown }) => ({
            state: 'settled',
            result: {
              status: 'error',
              playbookId:
                typeof request.playbookId === 'string'
                  ? request.playbookId
                  : 'probe',
              error: {
                name: 'UnsupportedOperationError',
                message: 'profile probe does not invoke child playbooks',
              },
            },
          }),
        }
      : {}),
    emitStatus: async () => {},
    emitTelemetry: async () => {},
  };
}

function callable(
  value: unknown,
  name: string,
): (...args: unknown[]) => unknown {
  if (typeof value !== 'function') throw new Error(`runtime lacks ${name}()`);
  return value as (...args: unknown[]) => unknown;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRuntimeContractProfile(
  value: unknown,
): value is RuntimeContractProfile {
  return (
    value === 'legacy' || value === 'session-v1' || value === 'composed-v2'
  );
}

interface StateSurface {
  id?: string;
  tags?: string | readonly string[];
  on?: Record<string, unknown>;
  states?: Record<string, StateSurface>;
}

/** Accepts the legacy scalar wait or a structured branch-local parked wait. */
export function hasBossReplySurface(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false;
  const states = (config as { states?: unknown }).states;
  if (typeof states !== 'object' || states === null || Array.isArray(states)) {
    return false;
  }

  const visit = (entries: Record<string, StateSurface>): boolean =>
    Object.entries(entries).some(([key, state]) => {
      if (
        key === AWAIT_BOSS_REPLY_STATE ||
        state.id === AWAIT_BOSS_REPLY_STATE
      ) {
        return true;
      }
      const tags =
        typeof state.tags === 'string'
          ? [state.tags]
          : Array.isArray(state.tags)
            ? state.tags
            : [];
      if (
        tags.includes('playbook.parked') &&
        state.on?.[BOSS_REPLY_EVENT] !== undefined
      ) {
        return true;
      }
      return state.states === undefined ? false : visit(state.states);
    });

  return visit(states as Record<string, StateSurface>);
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
    // A nested call is an authored playbook dependency, not a Captain player
    // prompt. Key it by target so changing `code-review` to `security-review`
    // cannot compare equal merely because both behaviors say Captain calls it.
    const participant =
      item.playbookId === undefined
        ? item.player
        : `playbook:${item.playbookId}`;
    let lines = sets.get(participant);
    if (lines === undefined) {
      lines = new Set();
      sets.set(participant, lines);
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

  const runtime = await inspectRuntimeProfile(compiled.playbook);
  findings.push(...runtime.findings.map((finding) => `${label}: ${finding}`));
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

  const [producedProfile, referenceProfile] = await Promise.all([
    runtimeCapabilityProfile(opts.produced.playbook),
    runtimeCapabilityProfile(opts.reference.playbook),
  ]);
  if (
    producedProfile !== null &&
    referenceProfile !== null &&
    producedProfile !== referenceProfile
  ) {
    findings.push(
      `runtime contract profiles differ: produced ${producedProfile} vs reference ${referenceProfile}`,
    );
  }

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
    if (!hasBossReplySurface(findMachineConfig(compiled.fsm))) {
      findings.push(`${label}: machine declares no Boss-reply wait state`);
    }
  }

  return findings;
}

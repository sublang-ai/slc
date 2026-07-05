// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * FSM transition-coverage verification for a compiled `playbook` artifact
 * (VERIFY-6; DR-009).
 *
 * {@link checkFsmCoverage} drives the artifact's machine with a scripted
 * captain actor and returns findings when a declared transition is not
 * reachable: every captain state's result keys must each fire a transition out
 * (with `needsBossReply` suspending in the Boss-reply wait state and resuming
 * on `BOSS_REPLY`), every `onError` arm must land on its target, every
 * `BOSS_INTERRUPT` target must be enterable, and guard-free root entry events
 * must transition. Context-dependent `onDone` arms that a jumped-in actor
 * cannot satisfy are covered by deterministic guard-satisfiability probing —
 * candidate values mined from the guard's own source — so an unsatisfiable arm
 * is still flagged. The checker needs only the artifact and `xstate`; the
 * emitted per-artifact test runs it beside the artifacts. See
 * specs/dev/verification.md.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createActor, fromPromise } from 'xstate';

import {
  AWAIT_BOSS_REPLY_STATE,
  BOSS_REPLY_EVENT,
  INTERRUPT_EVENT,
  NEEDS_BOSS_REPLY,
  VERIFY_MODULE,
  enumerateCaptainStates,
  loadFsmModule,
  normalizeArms,
  type CaptainState,
  type MachineConfigLike,
} from './verify.js';

/** The `gears2fsm`-mandated captain actor name a machine declares. */
export const CAPTAIN_ACTOR = 'captain';

/** The minimal machine surface the coverage driver needs. */
interface MachineLike {
  config: MachineConfigLike;
  provide(implementations: { actors: Record<string, unknown> }): MachineLike;
  /** XState exposes `setup()`-registered guards here. */
  implementations?: { guards?: Record<string, unknown> };
}

/** Resolves an arm's guard to a callable: inline functions directly, named
 * (string) guards through the machine's `setup()` implementations. */
function resolveGuard(
  machine: MachineLike,
  guard: unknown,
): ((arg: { context: unknown; event: unknown }) => unknown) | undefined {
  const resolved =
    typeof guard === 'string'
      ? machine.implementations?.guards?.[guard]
      : guard;
  return typeof resolved === 'function'
    ? (resolved as (arg: { context: unknown; event: unknown }) => unknown)
    : undefined;
}

/**
 * Finds the XState machine an `fsm` module exports — the export carrying a
 * `.config.states` and a `.provide` — so the coverage driver can supply the
 * scripted captain.
 *
 * @throws when the module exports no such machine.
 */
export function findMachine(fsmModule: unknown): MachineLike {
  if (typeof fsmModule === 'object' && fsmModule !== null) {
    for (const value of Object.values(fsmModule)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'config' in value &&
        'provide' in value &&
        typeof (value as { provide: unknown }).provide === 'function'
      ) {
        const config = (value as { config?: unknown }).config;
        if (
          typeof config === 'object' &&
          config !== null &&
          'states' in config
        ) {
          return value as MachineLike;
        }
      }
    }
  }
  throw new Error(
    'fsm module exports no providable XState machine with a `.config.states`',
  );
}

/** How long a driven actor may take to settle; transitions resolve in microtasks. */
const SETTLE_MS = 1_000;

/** Payload fields a result description requires, per the adjudicator convention. */
const REQUIRED_FIELD = /Output shall include `([A-Za-z_][A-Za-z0-9_]*):/g;

function requiredFields(description: string): string[] {
  return [...description.matchAll(REQUIRED_FIELD)].map((match) => match[1]);
}

/** Synthesizes a captain output that selects `key` under the state's contract. */
function synthOutput(
  state: CaptainState,
  key: string,
): Record<string, unknown> {
  const output: Record<string, unknown> = { guard: key };
  for (const field of requiredFields(state.result[key] ?? '')) {
    output[field] =
      field === 'question' ? 'What should happen next?' : `coverage:${field}`;
  }
  return output;
}

type Snapshot = {
  value: unknown;
  context: Record<string, unknown>;
  status?: string;
};

interface DrivenActor {
  send(event: Record<string, unknown>): void;
  getSnapshot(): Snapshot;
  start(): unknown;
  stop(): unknown;
  subscribe(observer: {
    next?: (snapshot: Snapshot) => void;
    error?: (error: unknown) => void;
  }): { unsubscribe(): void };
}

/** A captain script: resolves an output, rejects, or hangs (null). */
type CaptainScript = (
  input: Record<string, unknown>,
) => Record<string, unknown> | null;

function makeActor(machine: MachineLike, script: CaptainScript): DrivenActor {
  const provided = machine.provide({
    actors: {
      [CAPTAIN_ACTOR]: fromPromise(
        async ({ input }: { input: Record<string, unknown> }) => {
          const output = script(input ?? {});
          if (output === null) return new Promise(() => {});
          if (output instanceof Error) throw output;
          return output;
        },
      ),
    },
  });
  const actor = createActor(
    provided as never,
    {
      input: {},
    } as never,
  ) as unknown as DrivenActor;
  actor.subscribe({ error: () => {} });
  actor.start();
  return actor;
}

/**
 * An arming gate for drive scripts: a machine whose initial state invokes the
 * captain fires an invocation at actor start, before the driver jumps into the
 * state under test; an unarmed script leaves that eager invocation hanging so
 * it can neither consume the one-shot output nor race the machine to a final
 * state. Drives arm the gate after start and before the jump.
 */
interface ArmingGate {
  armed: boolean;
}

/** A script that rejects the captain invocation for the given source item. */
function throwingScript(sourceItem: string, gate: ArmingGate): CaptainScript {
  return (input) => {
    if (!gate.armed || input.sourceItem !== sourceItem) return null;
    return new Error('coverage: forced captain failure') as never;
  };
}

/** A script that resolves `output` once for the given source item, then hangs. */
function onceScript(
  sourceItem: string,
  output: Record<string, unknown>,
  gate: ArmingGate,
): CaptainScript {
  let used = false;
  return (input) => {
    if (!gate.armed || used || input.sourceItem !== sourceItem) return null;
    used = true;
    return output;
  };
}

/** Waits until the actor's snapshot satisfies `predicate`, or times out. */
function settle(
  actor: DrivenActor,
  predicate: (snapshot: Snapshot) => boolean,
  ms = SETTLE_MS,
): Promise<boolean> {
  return new Promise((resolveSettled) => {
    let subscription: { unsubscribe(): void } | undefined = undefined;
    const finish = (outcome: boolean): void => {
      clearTimeout(timer);
      subscription?.unsubscribe();
      resolveSettled(outcome);
    };
    const timer = setTimeout(() => finish(predicate(actor.getSnapshot())), ms);
    subscription = actor.subscribe({
      next: (snapshot) => {
        if (predicate(snapshot)) finish(true);
      },
    });
    if (predicate(actor.getSnapshot())) finish(true);
  });
}

const atState =
  (state: string) =>
  (snapshot: Snapshot): boolean =>
    snapshot.value === state;

const leftState =
  (state: string) =>
  (snapshot: Snapshot): boolean =>
    snapshot.value !== state;

/*
 * Guard-satisfiability probing: a jumped-in actor carries the initial context,
 * so an arm guarded on accumulated state (e.g. a routing field set by an
 * earlier transition) cannot fire in the driven run. Such arms are checked
 * deterministically instead: candidate context/event values are mined from the
 * guard function's own source literals, and the arm is flagged only when no
 * bounded assignment satisfies it.
 */

const GENERIC_VALUES: unknown[] = ['coverage', true, 1, ['coverage']];
const MAX_PROBES = 30_000;

function minedLiterals(fn: unknown): string[] {
  let source: string;
  try {
    source = String(fn);
  } catch {
    return [];
  }
  const literals = source.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) ?? [];
  return [...new Set(literals.map((literal) => literal.slice(1, -1)))];
}

// Routing-field values (e.g. a change origin or review subject) are bound at
// helper call sites, invisible in the guard closures themselves; the module's
// identifier-like string literals recover them without dragging prompt prose
// into the candidate pool.
const IDENTIFIER_LITERAL = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** Mines identifier-like string literals from an artifact's source text. */
export function identifierLiterals(sourceText: string): string[] {
  const literals =
    sourceText.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g) ?? [];
  return [
    ...new Set(
      literals
        .map((literal) => literal.slice(1, -1))
        .filter((literal) => IDENTIFIER_LITERAL.test(literal)),
    ),
  ];
}

/**
 * Reports whether a bounded search finds a context/output assignment under
 * which the guard passes, seeding candidate values from the guard's source and
 * the caller's extra candidates (typically the machine's state keys and the
 * artifact's identifier literals, since typed routing fields hold values that
 * guards compare against helper-bound constants).
 *
 * A conjunctive guard short-circuits, so each probe pass reveals at most one
 * new field read; the search deepens iteratively — assign a discovered field
 * each candidate value, re-probe for the next read — within a global probe
 * budget, and an exhausted budget reports unsatisfiable ("under probing").
 */
export function guardSatisfiable(
  guard: (arg: { context: unknown; event: unknown }) => unknown,
  baseOutput: Record<string, unknown>,
  extraValues: readonly unknown[] = [],
): boolean {
  // Guard-source literals first: the likeliest matches are tried earliest.
  const values = [
    ...new Set([...minedLiterals(guard), ...extraValues, ...GENERIC_VALUES]),
  ];
  let probes = 0;

  // An assignment covers the context, the done-event output, and the event's
  // own fields (a `setup()` guard may compare `event.type` against its
  // done-actor id, which the mined literals supply).
  type Assignment = {
    context: Record<string, unknown>;
    output: Record<string, unknown>;
    event: Record<string, unknown>;
  };

  const passes = (a: Assignment): boolean => {
    probes++;
    try {
      return Boolean(
        guard({ context: a.context, event: { ...a.event, output: a.output } }),
      );
    } catch {
      return false;
    }
  };

  // Records the unassigned fields the guard reads under the given assignment.
  const readsUnder = (a: Assignment): string[] => {
    const reads = new Set<string>();
    const recording = (
      assigned: Record<string, unknown>,
      tag: string,
      fixed: Record<string, unknown> = {},
    ): unknown =>
      new Proxy(assigned, {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined;
          if (prop in fixed) return fixed[prop];
          if (prop in target) return target[prop];
          reads.add(`${tag}${prop}`);
          return undefined;
        },
        has() {
          return true;
        },
      });
    try {
      const output = recording(a.output, 'o:');
      guard({
        context: recording(a.context, 'c:'),
        event: recording(a.event, 'e:', { output }),
      });
    } catch {
      // Reads observed before the throw still guide the search.
    }
    return [...reads];
  };

  const search = (a: Assignment, depth: number): boolean => {
    if (probes > MAX_PROBES) return false;
    if (passes(a)) return true;
    if (depth >= 4) return false;
    for (const key of readsUnder(a)) {
      const tag = key.slice(0, 2);
      const field = key.slice(2);
      for (const value of values) {
        if (probes > MAX_PROBES) return false;
        const next =
          tag === 'c:'
            ? { ...a, context: { ...a.context, [field]: value } }
            : tag === 'o:'
              ? { ...a, output: { ...a.output, [field]: value } }
              : { ...a, event: { ...a.event, [field]: value } };
        if (search(next, depth + 1)) return true;
      }
    }
    return false;
  };

  return search({ context: {}, output: { ...baseOutput }, event: {} }, 0);
}

/**
 * Checks transition coverage over a compiled `playbook` artifact's machine
 * (VERIFY-6) and returns findings (empty when every declared transition is
 * reachable). Requires the machine to declare the `gears2fsm` surfaces it
 * drives through: the `BOSS_INTERRUPT` root event and the Boss-reply wait
 * state.
 */
export async function checkFsmCoverage(
  fsmModule: unknown,
  opts: {
    /** The artifact's source text, mined for routing-value candidates. */
    sourceText?: string;
  } = {},
): Promise<string[]> {
  const findings: string[] = [];
  const machine = findMachine(fsmModule);
  const config = machine.config;
  const states = config.states ?? {};
  const captainStates = enumerateCaptainStates(config);
  const sourceCandidates = identifierLiterals(opts.sourceText ?? '');

  const finalStates = Object.entries(states).filter(
    ([, state]) => state.type === 'final',
  );
  if (finalStates.length === 0) {
    findings.push('machine declares no final state');
  }

  const rootArms = normalizeArms((config.on ?? {})[INTERRUPT_EVENT]);
  const canJump = rootArms.length > 0;
  if (!canJump) {
    findings.push(`machine declares no root ${INTERRUPT_EVENT} event`);
  }
  const hasWaitState = AWAIT_BOSS_REPLY_STATE in states;
  if (!hasWaitState) {
    findings.push(`machine declares no ${AWAIT_BOSS_REPLY_STATE} state`);
  }

  // Every BOSS_INTERRUPT target is enterable (the captain hangs, so entering a
  // captain state parks in it).
  if (canJump) {
    for (const arm of rootArms) {
      if (arm.target === null) continue;
      const actor = makeActor(machine, () => null);
      actor.send({ type: INTERRUPT_EVENT, targetId: arm.target });
      if (!(await settle(actor, atState(arm.target)))) {
        findings.push(
          `${INTERRUPT_EVENT} target ${arm.target} is not enterable`,
        );
      }
      actor.stop();
    }
  }

  // Guard-free root entry events transition from the initial state.
  const initial = typeof config.initial === 'string' ? config.initial : null;
  const entryArms: Record<string, unknown> = {
    ...(initial !== null ? (states[initial]?.on ?? {}) : {}),
    ...(config.on ?? {}),
  };
  for (const [event, raw] of Object.entries(entryArms)) {
    if (event === INTERRUPT_EVENT) continue;
    const arms = normalizeArms(raw);
    const free = arms.find(
      (arm) => !arm.guarded && arm.target !== null && arm.target !== initial,
    );
    if (free === undefined) continue;
    const actor = makeActor(machine, () => null);
    actor.send({ type: event });
    if (!(await settle(actor, leftState(initial ?? '')))) {
      findings.push(`root event ${event} fired no transition`);
    }
    actor.stop();
  }

  for (const state of captainStates) {
    if (!canJump) break;
    const raw = states[state.stateId];
    const onDoneArms = normalizeArms(raw?.invoke?.onDone);
    const rawArms = Array.isArray(raw?.invoke?.onDone)
      ? (raw?.invoke?.onDone as unknown[])
      : raw?.invoke?.onDone !== undefined
        ? [raw?.invoke?.onDone]
        : [];

    // Every result key fires a transition out of the state; needsBossReply
    // suspends in the wait state. A key whose matching arms are all
    // context-guarded beyond the driven context is covered by probing below.
    for (const key of Object.keys(state.result)) {
      const output = synthOutput(state, key);
      const predicted = rawArms.some((arm) => {
        const raw = (arm as { guard?: unknown })?.guard;
        if (raw === undefined) return true;
        const guard = resolveGuard(machine, raw);
        if (guard === undefined) return true;
        try {
          return Boolean(guard({ context: {}, event: { output } }));
        } catch {
          return false;
        }
      });
      if (!predicted) continue;
      const gate: ArmingGate = { armed: false };
      const actor = makeActor(
        machine,
        onceScript(state.sourceItem, output, gate),
      );
      gate.armed = true;
      actor.send({ type: INTERRUPT_EVENT, targetId: state.stateId });
      const left = await settle(actor, leftState(state.stateId));
      if (!left) {
        findings.push(
          `state ${state.stateId}: result "${key}" fired no transition`,
        );
      } else if (
        key === NEEDS_BOSS_REPLY &&
        hasWaitState &&
        actor.getSnapshot().value !== AWAIT_BOSS_REPLY_STATE
      ) {
        findings.push(
          `state ${state.stateId}: ${NEEDS_BOSS_REPLY} did not suspend in ${AWAIT_BOSS_REPLY_STATE}`,
        );
      } else if (key === NEEDS_BOSS_REPLY && hasWaitState) {
        // Boss-reply resume: BOSS_REPLY returns to the suspended state, and a
        // blank answer must not resume it.
        actor.send({ type: BOSS_REPLY_EVENT, answer: 'Proceed as planned.' });
        if (!(await settle(actor, atState(state.stateId)))) {
          findings.push(
            `state ${state.stateId}: ${BOSS_REPLY_EVENT} did not resume the suspended state`,
          );
        }
        actor.stop();

        const blankGate: ArmingGate = { armed: false };
        const blank = makeActor(
          machine,
          onceScript(
            state.sourceItem,
            synthOutput(state, NEEDS_BOSS_REPLY),
            blankGate,
          ),
        );
        blankGate.armed = true;
        blank.send({ type: INTERRUPT_EVENT, targetId: state.stateId });
        if (await settle(blank, atState(AWAIT_BOSS_REPLY_STATE))) {
          blank.send({ type: BOSS_REPLY_EVENT, answer: '   ' });
          const out = await settle(blank, leftState(AWAIT_BOSS_REPLY_STATE));
          if (!out || blank.getSnapshot().value === state.stateId) {
            findings.push(
              `state ${state.stateId}: a blank ${BOSS_REPLY_EVENT} answer must not resume the state`,
            );
          }
        }
        blank.stop();
        continue;
      }
      actor.stop();
    }

    // Every onDone arm is satisfiable: driven when the initial context allows,
    // probed deterministically otherwise. Routing fields hold state keys/ids or
    // helper-bound identifiers from the artifact source, so both seed the
    // probe's candidate values.
    const stateKeys = Object.entries(states).flatMap(([key, value]) =>
      typeof value.id === 'string' && value.id !== key
        ? [key, value.id]
        : [key],
    );
    for (const [index, arm] of rawArms.entries()) {
      const raw = (arm as { guard?: unknown })?.guard;
      if (raw === undefined) continue;
      const guard = resolveGuard(machine, raw);
      if (guard === undefined) {
        // A named guard the machine does not register cannot be probed —
        // surface it rather than silently skipping (VERIFY-6).
        findings.push(
          `state ${state.stateId}: onDone arm ${index} names an unresolvable guard "${String(raw)}"`,
        );
        continue;
      }
      // Try each key's full synthesized output AND its bare {guard} form: a
      // malformed-output arm (e.g. needsBossReply without its question) is
      // satisfiable only when the required payload is absent.
      const candidates = [...stateKeys, ...sourceCandidates];
      const anyOutput = Object.keys(state.result).some(
        (key) =>
          guardSatisfiable(guard, synthOutput(state, key), candidates) ||
          guardSatisfiable(guard, { guard: key }, candidates),
      );
      if (!anyOutput) {
        findings.push(
          `state ${state.stateId}: onDone arm ${index} (target ${
            onDoneArms[index]?.target ?? 'none'
          }) is unsatisfiable under probing`,
        );
      }
    }

    // onError lands on its declared target.
    const onErrorArms = normalizeArms(raw?.invoke?.onError);
    if (onErrorArms.length === 0) {
      findings.push(`state ${state.stateId} declares no onError transition`);
    } else {
      const target = onErrorArms[0].target;
      const gate: ArmingGate = { armed: false };
      const actor = makeActor(machine, throwingScript(state.sourceItem, gate));
      gate.armed = true;
      actor.send({ type: INTERRUPT_EVENT, targetId: state.stateId });
      const landed = await settle(
        actor,
        target !== null ? atState(target) : leftState(state.stateId),
      );
      if (!landed) {
        findings.push(
          `state ${state.stateId}: onError did not reach ${target ?? 'a quiescent state'}`,
        );
      }
      actor.stop();
    }
  }

  return findings;
}

/**
 * Builds a per-artifact vitest module running the transition-coverage check
 * beside the artifacts (VERIFY-6).
 */
export function generateFsmCoverageTest(opts: {
  basename: string;
  fsmModule: string;
  verifyModule: string;
}): string {
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Generated by slc (DR-009): FSM transition coverage for ${opts.basename}.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkFsmCoverage } from '${opts.verifyModule}';
import * as fsm from '${opts.fsmModule}';

describe('${opts.basename}: FSM coverage', () => {
  it('reaches every declared transition', async () => {
    const sourceText = readFileSync(
      fileURLToPath(new URL('${opts.fsmModule}', import.meta.url)),
      'utf8',
    );
    expect(await checkFsmCoverage(fsm, { sourceText })).toEqual([]);
  });
});
`;
}

/**
 * Emits the transition-coverage test beside a compiled `playbook` artifact
 * (VERIFY-6): validates the produced `fsm` drives cleanly, then writes
 * `<basename>.fsm.coverage.test.ts` and returns its path with any coverage
 * findings as diagnostics.
 *
 * @throws when the `fsm` artifact cannot be imported or exports no machine.
 */
export async function emitFsmCoverageTest(opts: {
  artifactDir: string;
  basename: string;
  verifyModule?: string;
}): Promise<{ path: string; diagnostics: string[] }> {
  const fsmPath = join(opts.artifactDir, `${opts.basename}.fsm.ts`);
  const module = await loadFsmModule(fsmPath);
  const findings = await checkFsmCoverage(module, {
    sourceText: await readFile(fsmPath, 'utf8'),
  });
  const content = generateFsmCoverageTest({
    basename: opts.basename,
    fsmModule: `./${opts.basename}.fsm.ts`,
    verifyModule: opts.verifyModule ?? VERIFY_MODULE,
  });
  await mkdir(opts.artifactDir, { recursive: true });
  const path = join(opts.artifactDir, `${opts.basename}.fsm.coverage.test.ts`);
  await writeFile(path, content);
  return {
    path,
    diagnostics: findings.map((finding) => `fsm coverage: ${finding}`),
  };
}

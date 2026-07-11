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
  /** XState's resolved state nodes expose the actual invocation actor ids. */
  root?: {
    states?: Record<string, { invoke?: Array<{ id?: string }> }>;
  };
}

type GuardArgs = { context: unknown; event: unknown };
type GuardImplementation = (args: GuardArgs, params?: unknown) => unknown;

interface ResolvedGuard {
  run(args: GuardArgs): unknown;
  /** Values hidden in an implementation or parameter descriptor seed probing. */
  probeValues: unknown[];
}

/** Scalar values carried by a parameterized XState guard descriptor. */
function descriptorValues(value: unknown, seen = new Set<object>()): unknown[] {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return [value];
  }
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((item) => descriptorValues(item, seen));
}

/** Resolves inline, named, and parameterized named XState guards. */
function resolveGuard(
  machine: MachineLike,
  guard: unknown,
): ResolvedGuard | undefined {
  if (typeof guard === 'function') {
    const implementation = guard as GuardImplementation;
    return {
      run: (args) => implementation(args),
      probeValues: minedLiterals(implementation),
    };
  }

  const descriptor =
    typeof guard === 'string'
      ? { type: guard, params: undefined }
      : typeof guard === 'object' && guard !== null && 'type' in guard
        ? (guard as { type?: unknown; params?: unknown })
        : undefined;
  if (typeof descriptor?.type !== 'string') return undefined;
  const candidate = machine.implementations?.guards?.[descriptor.type];
  if (typeof candidate !== 'function') return undefined;
  const implementation = candidate as GuardImplementation;
  const params = descriptor.params;
  return {
    run: (args) =>
      implementation(
        args,
        typeof params === 'function'
          ? (params as (args: GuardArgs) => unknown)(args)
          : params,
      ),
    probeValues: [
      ...minedLiterals(implementation),
      ...(typeof params === 'function' ? minedLiterals(params) : []),
      ...descriptorValues(params),
    ],
  };
}

function guardLabel(guard: unknown): string {
  if (typeof guard === 'string') return guard;
  try {
    return JSON.stringify(guard) ?? String(guard);
  } catch {
    return String(guard);
  }
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

type States = NonNullable<MachineConfigLike['states']>;

function stableStateId(states: States, stateKey: string): string {
  const id = states[stateKey]?.id;
  return typeof id === 'string' ? id : stateKey;
}

/** Resolves either a relative state key or a `#`-target's stable id to its key. */
function stateKeyForTarget(states: States, target: string): string | undefined {
  if (target in states) return target;
  return Object.keys(states).find(
    (key) => stableStateId(states, key) === target,
  );
}

/** The actor id XState actually uses for a state's first invocation. */
function invocationActorId(
  machine: MachineLike,
  stateKey: string,
  state: States[string],
): string {
  const resolved = machine.root?.states?.[stateKey]?.invoke?.[0]?.id;
  if (typeof resolved === 'string') return resolved;
  const declared = (state.invoke as { id?: unknown } | undefined)?.id;
  if (typeof declared === 'string') return declared;
  const stateHasExplicitId = typeof state.id === 'string';
  const machineId = (machine.config as { id?: unknown }).id;
  return stateHasExplicitId
    ? `0.${state.id}`
    : `0.${typeof machineId === 'string' ? machineId : '(machine)'}.${stateKey}`;
}

function invocationEvent(
  machine: MachineLike,
  stateKey: string,
  state: States[string],
  kind: 'done' | 'error',
): Record<string, unknown> {
  const actorId = invocationActorId(machine, stateKey, state);
  return { type: `xstate.${kind}.actor.${actorId}`, actorId };
}

function transitionArms(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
}

function armGuard(arm: unknown): unknown {
  return typeof arm === 'object' && arm !== null
    ? (arm as { guard?: unknown }).guard
    : undefined;
}

/**
 * Builds the predicate that selects one ordered XState transition arm: every
 * preceding guarded arm must reject and the selected arm must accept (or be
 * the unguarded fallback). An earlier unguarded arm shadows all later arms.
 */
function orderedArmPredicate(
  machine: MachineLike,
  arms: readonly unknown[],
  selected: number,
): ResolvedGuard | undefined {
  const prior: ResolvedGuard[] = [];
  for (let index = 0; index <= selected; index++) {
    const rawGuard = armGuard(arms[index]);
    if (rawGuard === undefined) {
      if (index < selected) {
        return { run: () => false, probeValues: [] };
      }
      return {
        run: (args) => prior.every((guard) => !guard.run(args)),
        probeValues: prior.flatMap((guard) => guard.probeValues),
      };
    }
    const guard = resolveGuard(machine, rawGuard);
    if (guard === undefined) return undefined;
    if (index === selected) {
      return {
        run: (args) =>
          prior.every((candidate) => !candidate.run(args)) && guard.run(args),
        probeValues: [
          ...prior.flatMap((candidate) => candidate.probeValues),
          ...guard.probeValues,
        ],
      };
    }
    prior.push(guard);
  }
  return undefined;
}

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
  return probeGuardSatisfiable(
    guard,
    {},
    [{ eventField: 'output', tag: 'o:', base: baseOutput }],
    extraValues,
  );
}

interface ProbePayload {
  eventField: string;
  /** A two-character assignment/read tag, such as `o:` or `r:`. */
  tag: string;
  base: object;
  /** Error properties are variable inputs even when the seed already has one. */
  varyExisting?: boolean;
}

interface ProbeAssignment {
  context: Record<string, unknown>;
  payloads: Record<string, Record<string, unknown>>;
}

function overlaidObject(
  base: object,
  assigned: Record<string, unknown>,
): Record<string, unknown> {
  const copy = Object.create(Object.getPrototypeOf(base)) as Record<
    string,
    unknown
  >;
  Object.defineProperties(copy, Object.getOwnPropertyDescriptors(base));
  Object.assign(copy, assigned);
  return copy;
}

/**
 * Bounded guard probing with a fixed, real event surface. Only context and the
 * named nested payloads are assignable; event-level fields such as `type` and
 * `actorId` remain the values XState actually supplies.
 */
function probeGuardSatisfiable(
  guard: (arg: GuardArgs) => unknown,
  fixedEvent: Readonly<Record<string, unknown>>,
  payloads: readonly ProbePayload[],
  extraValues: readonly unknown[],
): boolean {
  // Guard-source literals first: the likeliest matches are tried earliest.
  const values = [
    ...new Set([...minedLiterals(guard), ...extraValues, ...GENERIC_VALUES]),
  ];
  let probes = 0;

  const eventFor = (assignment: ProbeAssignment): Record<string, unknown> => {
    const event = { ...fixedEvent };
    for (const payload of payloads) {
      event[payload.eventField] = overlaidObject(
        payload.base,
        assignment.payloads[payload.tag] ?? {},
      );
    }
    return event;
  };

  const passes = (assignment: ProbeAssignment): boolean => {
    probes++;
    try {
      return Boolean(
        guard({ context: assignment.context, event: eventFor(assignment) }),
      );
    } catch {
      return false;
    }
  };

  // Records the unassigned fields the guard reads under the given assignment.
  const readsUnder = (assignment: ProbeAssignment): string[] => {
    const reads = new Set<string>();
    const recording = (
      base: object,
      assigned: Record<string, unknown>,
      tag: string,
    ): unknown =>
      new Proxy(overlaidObject(base, assigned), {
        get(target, prop) {
          if (typeof prop !== 'string') return undefined;
          if (prop in target) {
            const payload = payloads.find((item) => item.tag === tag);
            if (payload?.varyExisting === true && !(prop in assigned)) {
              reads.add(`${tag}${prop}`);
            }
            return target[prop];
          }
          reads.add(`${tag}${prop}`);
          return undefined;
        },
        has(target, prop) {
          if (typeof prop === 'string' && !(prop in target)) {
            reads.add(`${tag}${prop}`);
          }
          return prop in target;
        },
      });
    try {
      const event = { ...fixedEvent };
      for (const payload of payloads) {
        event[payload.eventField] = recording(
          payload.base,
          assignment.payloads[payload.tag] ?? {},
          payload.tag,
        );
      }
      guard({
        context: recording({}, assignment.context, 'c:'),
        event,
      });
    } catch {
      // Reads observed before the throw still guide the search.
    }
    return [...reads];
  };

  const search = (assignment: ProbeAssignment, depth: number): boolean => {
    if (probes > MAX_PROBES) return false;
    if (passes(assignment)) return true;
    if (depth >= 4) return false;
    for (const key of readsUnder(assignment)) {
      const tag = key.slice(0, 2);
      const field = key.slice(2);
      for (const value of values) {
        if (probes > MAX_PROBES) return false;
        const next =
          tag === 'c:'
            ? {
                ...assignment,
                context: { ...assignment.context, [field]: value },
              }
            : {
                ...assignment,
                payloads: {
                  ...assignment.payloads,
                  [tag]: {
                    ...(assignment.payloads[tag] ?? {}),
                    [field]: value,
                  },
                },
              };
        if (search(next, depth + 1)) return true;
      }
    }
    return false;
  };

  return search({ context: {}, payloads: {} }, 0);
}

function doneGuardSatisfiable(
  guard: ResolvedGuard,
  event: Readonly<Record<string, unknown>>,
  output: Record<string, unknown>,
  extraValues: readonly unknown[],
): boolean {
  return probeGuardSatisfiable(
    guard.run,
    event,
    [{ eventField: 'output', tag: 'o:', base: output }],
    [...guard.probeValues, ...extraValues],
  );
}

function errorGuardSatisfiable(
  guard: ResolvedGuard,
  event: Readonly<Record<string, unknown>>,
  error: Error,
  extraValues: readonly unknown[],
): boolean {
  return probeGuardSatisfiable(
    guard.run,
    event,
    [{ eventField: 'error', tag: 'r:', base: error, varyExisting: true }],
    [...guard.probeValues, ...extraValues],
  );
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
  const waitStateKey = stateKeyForTarget(states, AWAIT_BOSS_REPLY_STATE);
  const hasWaitState = waitStateKey !== undefined;
  if (!hasWaitState) {
    findings.push(`machine declares no ${AWAIT_BOSS_REPLY_STATE} state`);
  }

  // Every BOSS_INTERRUPT target is enterable (the captain hangs, so entering a
  // captain state parks in it).
  if (canJump) {
    for (const arm of rootArms) {
      if (arm.target === null) continue;
      const targetKey = stateKeyForTarget(states, arm.target);
      const targetId =
        targetKey === undefined ? arm.target : stableStateId(states, targetKey);
      const actor = makeActor(machine, () => null);
      actor.send({ type: INTERRUPT_EVENT, targetId });
      if (
        targetKey === undefined ||
        !(await settle(actor, atState(targetKey)))
      ) {
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

  const stateCandidates = Object.entries(states).flatMap(([key, value]) =>
    typeof value.id === 'string' && value.id !== key ? [key, value.id] : [key],
  );

  for (const state of captainStates) {
    if (!canJump) break;
    const stateKey = state.stateId;
    const stateNode = states[stateKey];
    if (stateNode === undefined) continue;
    const stateId = stableStateId(states, stateKey);
    const candidates = [...stateCandidates, ...sourceCandidates];
    const doneEvent = invocationEvent(machine, stateKey, stateNode, 'done');
    const errorEvent = invocationEvent(machine, stateKey, stateNode, 'error');
    const rawDoneArms = transitionArms(stateNode.invoke?.onDone);
    const onDoneArms = normalizeArms(stateNode.invoke?.onDone);

    // Every declared result needs an arm that explicitly accepts its complete
    // valid output. A sole unguarded arm accepts the whole local result
    // contract; an array's unguarded arm is a fallback and cannot make an
    // otherwise orphaned key look covered.
    for (const key of Object.keys(state.result)) {
      const output = synthOutput(state, key);
      const accepting = new Set<number>();
      for (const [index, arm] of rawDoneArms.entries()) {
        const target = onDoneArms[index]?.target ?? null;
        const rawGuard = armGuard(arm);
        if (rawGuard === undefined) {
          if (rawDoneArms.length === 1 && target !== null) accepting.add(index);
          continue;
        }
        if (target === null || resolveGuard(machine, rawGuard) === undefined) {
          continue;
        }
        const guard = orderedArmPredicate(machine, rawDoneArms, index);
        if (
          guard !== undefined &&
          doneGuardSatisfiable(guard, doneEvent, output, candidates)
        ) {
          accepting.add(index);
        }
      }

      if (accepting.size === 0) {
        findings.push(
          `state ${stateKey}: result "${key}" has no reachable accepting transition`,
        );
        continue;
      }

      // Drive only when the first arm XState would inspect under the real
      // initial context is a known accepting arm. Encountering an unresolved
      // guard first makes driving unsafe: XState reports that error
      // asynchronously, so the arm audit below owns the finding (c887fc4).
      let directArm: number | undefined;
      let safeToDrive = true;
      for (const [index, arm] of rawDoneArms.entries()) {
        const rawGuard = armGuard(arm);
        if (rawGuard === undefined) {
          directArm = index;
          break;
        }
        const guard = resolveGuard(machine, rawGuard);
        if (guard === undefined) {
          safeToDrive = false;
          break;
        }
        try {
          if (guard.run({ context: {}, event: { ...doneEvent, output } })) {
            directArm = index;
            break;
          }
        } catch {
          safeToDrive = false;
          break;
        }
      }
      if (
        !safeToDrive ||
        directArm === undefined ||
        !accepting.has(directArm)
      ) {
        continue;
      }

      const gate: ArmingGate = { armed: false };
      const actor = makeActor(
        machine,
        onceScript(state.sourceItem, output, gate),
      );
      gate.armed = true;
      actor.send({ type: INTERRUPT_EVENT, targetId: stateId });
      const left = await settle(actor, leftState(stateKey));
      if (!left) {
        findings.push(`state ${stateKey}: result "${key}" fired no transition`);
      } else if (
        key === NEEDS_BOSS_REPLY &&
        hasWaitState &&
        actor.getSnapshot().value !== waitStateKey
      ) {
        findings.push(
          `state ${stateKey}: ${NEEDS_BOSS_REPLY} did not suspend in ${AWAIT_BOSS_REPLY_STATE}`,
        );
      } else if (key === NEEDS_BOSS_REPLY && waitStateKey !== undefined) {
        // Boss-reply resume: BOSS_REPLY returns to the suspended state, and a
        // blank answer must not resume it.
        actor.send({ type: BOSS_REPLY_EVENT, answer: 'Proceed as planned.' });
        if (!(await settle(actor, atState(stateKey)))) {
          findings.push(
            `state ${stateKey}: ${BOSS_REPLY_EVENT} did not resume the suspended state`,
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
        blank.send({ type: INTERRUPT_EVENT, targetId: stateId });
        if (await settle(blank, atState(waitStateKey))) {
          blank.send({ type: BOSS_REPLY_EVENT, answer: '   ' });
          const out = await settle(blank, leftState(waitStateKey));
          if (!out || blank.getSnapshot().value === stateKey) {
            findings.push(
              `state ${stateKey}: a blank ${BOSS_REPLY_EVENT} answer must not resume the state`,
            );
          }
        }
        blank.stop();
        continue;
      }
      actor.stop();
    }

    // Every onDone arm is satisfiable under the actual done-event identity.
    // Try each key's full output and bare malformed form; neither probe may
    // invent a different event type or actor id.
    for (const [index, arm] of rawDoneArms.entries()) {
      const rawGuard = armGuard(arm);
      if (rawGuard === undefined) continue;
      const declaredGuard = resolveGuard(machine, rawGuard);
      if (declaredGuard === undefined) {
        findings.push(
          `state ${stateKey}: onDone arm ${index} names an unresolvable guard "${guardLabel(rawGuard)}"`,
        );
        continue;
      }
      const guard = orderedArmPredicate(machine, rawDoneArms, index);
      // A prior unresolvable arm already owns the actionable finding, and makes
      // ordered reachability of later arms unsafe to evaluate.
      if (guard === undefined) continue;
      const anyOutput = Object.keys(state.result).some(
        (key) =>
          doneGuardSatisfiable(
            guard,
            doneEvent,
            synthOutput(state, key),
            candidates,
          ) ||
          doneGuardSatisfiable(guard, doneEvent, { guard: key }, candidates),
      );
      if (!anyOutput) {
        findings.push(
          `state ${stateKey}: onDone arm ${index} (target ${
            onDoneArms[index]?.target ?? 'none'
          }) is unsatisfiable under probing`,
        );
      }
    }

    // Audit every onError arm under the real error-event identity. Guarded arms
    // are probed deterministically; one directly selected arm is also driven to
    // confirm XState lands on its declared target.
    const rawErrorArms = transitionArms(stateNode.invoke?.onError);
    const onErrorArms = normalizeArms(stateNode.invoke?.onError);
    if (onErrorArms.length === 0) {
      findings.push(`state ${stateKey} declares no onError transition`);
      continue;
    }
    const forcedError = new Error('coverage: forced captain failure');
    let hasUnresolvableErrorGuard = false;
    for (const [index, arm] of rawErrorArms.entries()) {
      const rawGuard = armGuard(arm);
      if (rawGuard !== undefined) {
        const declaredGuard = resolveGuard(machine, rawGuard);
        if (declaredGuard === undefined) {
          hasUnresolvableErrorGuard = true;
          findings.push(
            `state ${stateKey}: onError arm ${index} names an unresolvable guard "${guardLabel(rawGuard)}"`,
          );
          continue;
        }
      }
      const guard = orderedArmPredicate(machine, rawErrorArms, index);
      if (guard === undefined) continue;
      if (!errorGuardSatisfiable(guard, errorEvent, forcedError, candidates)) {
        findings.push(
          `state ${stateKey}: onError arm ${index} (target ${
            onErrorArms[index]?.target ?? 'none'
          }) is unsatisfiable under probing`,
        );
      }
    }

    if (hasUnresolvableErrorGuard) continue;
    let directErrorArm: number | undefined;
    let errorDriveSafe = true;
    for (const [index, arm] of rawErrorArms.entries()) {
      const rawGuard = armGuard(arm);
      if (rawGuard === undefined) {
        directErrorArm = index;
        break;
      }
      const guard = resolveGuard(machine, rawGuard);
      if (guard === undefined) {
        errorDriveSafe = false;
        break;
      }
      try {
        if (
          guard.run({
            context: {},
            event: { ...errorEvent, error: forcedError },
          })
        ) {
          directErrorArm = index;
          break;
        }
      } catch {
        errorDriveSafe = false;
        break;
      }
    }
    if (!errorDriveSafe || directErrorArm === undefined) continue;

    const target = onErrorArms[directErrorArm]?.target ?? null;
    const targetKey =
      target === null ? undefined : stateKeyForTarget(states, target);
    const gate: ArmingGate = { armed: false };
    const actor = makeActor(machine, throwingScript(state.sourceItem, gate));
    gate.armed = true;
    actor.send({ type: INTERRUPT_EVENT, targetId: stateId });
    const landed = await settle(
      actor,
      target !== null && targetKey !== undefined
        ? atState(targetKey)
        : leftState(stateKey),
    );
    if (!landed || (target !== null && targetKey === undefined)) {
      findings.push(
        `state ${stateKey}: onError arm ${directErrorArm} did not reach ${target ?? 'a quiescent state'}`,
      );
    }
    actor.stop();
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
  const commentBasename = JSON.stringify(opts.basename)
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
  const fsmModule = JSON.stringify(opts.fsmModule);
  const verifyModule = JSON.stringify(opts.verifyModule);
  const suiteName = JSON.stringify(`${opts.basename}: FSM coverage`);
  return `// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Generated by slc (DR-009): FSM transition coverage for ${commentBasename}.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkFsmCoverage } from ${verifyModule};
import * as fsm from ${fsmModule};

describe(${suiteName}, () => {
  it('reaches every declared transition', async () => {
    const sourceText = readFileSync(
      fileURLToPath(new URL(${fsmModule}, import.meta.url)),
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

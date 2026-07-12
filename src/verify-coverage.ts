// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * FSM transition-coverage verification for a compiled `playbook` artifact
 * (VERIFY-6; DR-009).
 *
 * {@link checkFsmCoverage} drives the artifact's machine with scripted Captain
 * and nested-playbook actors and returns findings when a declared transition
 * is not reachable: every Captain result key must fire a transition out (with
 * `needsBossReply` suspending in the Boss-reply wait state and resuming on
 * `BOSS_REPLY`), nested calls must transition on success and failure, every
 * `onError` arm must land on its target, every `BOSS_INTERRUPT` target must be
 * enterable, and guard-free root entry events must transition.
 * Context-dependent `onDone` arms that a jumped-in actor cannot satisfy are
 * covered by deterministic guard-satisfiability probing — candidate values
 * mined from the guard's own source — so an unsatisfiable arm is still flagged.
 * The checker needs only the artifact and `xstate`; the emitted per-artifact
 * test runs it beside the artifacts. See specs/dev/verification.md.
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
  config: MachineConfigLike & { id?: string };
  provide(implementations: { actors: Record<string, unknown> }): MachineLike;
  /** XState exposes `setup()`-registered guards here. */
  implementations?: { guards?: Record<string, unknown> };
  /** XState's resolved state nodes expose the actual invocation actor ids. */
  root?: ResolvedStateNodeLike;
}

interface InvokeLike {
  id?: string;
  src?: unknown;
  input?: (arg: { context: Record<string, unknown> }) => unknown;
  onDone?: unknown;
  onError?: unknown;
}

interface StateNodeLike {
  id?: string;
  meta?: { playbook?: { stateId?: unknown } };
  type?: string;
  tags?: string | readonly string[];
  initial?: string;
  states?: Record<string, StateNodeLike>;
  invoke?: InvokeLike | readonly InvokeLike[];
  onDone?: unknown;
  on?: Record<string, unknown>;
}

interface ResolvedStateNodeLike {
  states?: Record<string, ResolvedStateNodeLike>;
  invoke?: Array<{ id?: string }>;
}

interface StateRef {
  key: string;
  path: readonly string[];
  configId?: string;
  stableId: string;
  state: StateNodeLike;
  parent?: StateRef;
}

interface CaptainRef {
  binding: CaptainState;
  invocation: InvokeLike;
  invocationIndex: number;
  ref: StateRef;
}

interface PlaybookRef {
  invocation: InvokeLike;
  invocationIndex: number;
  ref: StateRef;
}

function captainPublicStateId(captain: CaptainRef): string {
  return captain.binding.stateId || captain.ref.stableId;
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

function invocations(state: StateNodeLike): readonly InvokeLike[] {
  if (Array.isArray(state.invoke)) return state.invoke;
  return state.invoke === undefined ? [] : [state.invoke as InvokeLike];
}

function invocationSource(src: unknown): string | undefined {
  if (typeof src === 'string') return src;
  if (
    typeof src === 'object' &&
    src !== null &&
    'type' in src &&
    typeof src.type === 'string'
  ) {
    return src.type;
  }
  return undefined;
}

/** Walks every state node in declaration order while retaining its ancestry. */
function stateRefs(config: MachineConfigLike): StateRef[] {
  const out: StateRef[] = [];
  const visit = (
    states: Record<string, StateNodeLike>,
    parent?: StateRef,
  ): void => {
    for (const [key, state] of Object.entries(states)) {
      const path = [...(parent?.path ?? []), key];
      const ref: StateRef = {
        key,
        path,
        ...(typeof state.id === 'string' ? { configId: state.id } : {}),
        stableId:
          typeof state.meta?.playbook?.stateId === 'string'
            ? state.meta.playbook.stateId
            : typeof state.id === 'string'
              ? state.id
              : path.join('.'),
        state,
        ...(parent === undefined ? {} : { parent }),
      };
      out.push(ref);
      if (state.states !== undefined) visit(state.states, ref);
    }
  };
  visit((config.states ?? {}) as Record<string, StateNodeLike>);
  return out;
}

/** Captain bindings paired with the nested state node that owns the invoke. */
function captainRefs(config: MachineConfigLike): CaptainRef[] {
  const out: CaptainRef[] = [];
  const refs = stateRefs(config);
  const used = new Set<InvokeLike>();
  for (const binding of enumerateCaptainStates(config)) {
    const statePath = binding.statePath;
    const ref =
      (statePath === undefined
        ? undefined
        : refs.find((candidate) => candidate.path.join('.') === statePath)) ??
      refs.find(
        (candidate) =>
          candidate.stableId === binding.stateId ||
          (candidate.path.length === 1 && candidate.key === binding.stateId),
      );
    if (ref === undefined) continue;
    const choices = invocations(ref.state);
    const invocationIndex = choices.findIndex((invocation) => {
      if (used.has(invocation)) return false;
      const source = invocationSource(invocation.src);
      const explicitlyCaptain = source === 'captain';
      if (
        (!explicitlyCaptain && source !== undefined) ||
        typeof invocation.input !== 'function'
      ) {
        return explicitlyCaptain && binding.sourceItem === '';
      }
      try {
        const input = invocation.input({ context: {} });
        if (
          typeof input !== 'object' ||
          input === null ||
          Array.isArray(input)
        ) {
          return explicitlyCaptain && binding.sourceItem === '';
        }
        const sourceItem = (input as { sourceItem?: unknown }).sourceItem;
        if (binding.sourceItem !== '') return sourceItem === binding.sourceItem;
        return explicitlyCaptain;
      } catch {
        return explicitlyCaptain && binding.sourceItem === '';
      }
    });
    // A malformed explicit captain invoke can lack a distinguishable input;
    // retain declaration order rather than silently dropping coverage.
    const selected =
      invocationIndex >= 0
        ? invocationIndex
        : choices.findIndex(
            (invocation) =>
              !used.has(invocation) &&
              invocationSource(invocation.src) === 'captain',
          );
    if (selected < 0) continue;
    used.add(choices[selected]);
    out.push({
      binding,
      invocation: choices[selected],
      invocationIndex: selected,
      ref,
    });
  }
  return out;
}

function playbookRefs(config: MachineConfigLike): PlaybookRef[] {
  return stateRefs(config).flatMap((ref) =>
    invocations(ref.state).flatMap((invocation, invocationIndex) =>
      invocationSource(invocation.src) === 'playbook'
        ? [{ invocation, invocationIndex, ref }]
        : [],
    ),
  );
}

function tagsOf(state: StateNodeLike): readonly string[] {
  if (typeof state.tags === 'string') return [state.tags];
  return Array.isArray(state.tags) ? state.tags : [];
}

function stateRefForTarget(
  refs: readonly StateRef[],
  target: string,
  source?: StateRef,
): StateRef | undefined {
  const absolute = target.startsWith('#');
  const normalized = absolute
    ? target.slice(1)
    : target.startsWith('.')
      ? target.slice(1)
      : target;
  if (!absolute && source?.parent !== undefined) {
    const siblingPath = [...source.parent.path, normalized].join('.');
    const sibling = refs.find((ref) => ref.path.join('.') === siblingPath);
    if (sibling !== undefined) return sibling;
  }

  const byStableId = refs.find(
    (ref) => ref.stableId === normalized || ref.configId === normalized,
  );
  if (byStableId !== undefined) return byStableId;

  const byPath = refs.find((ref) => ref.path.join('.') === normalized);
  if (byPath !== undefined) return byPath;
  const byKey = refs.filter((ref) => ref.key === normalized);
  return byKey.length === 1 ? byKey[0] : undefined;
}

function resolvedStateNode(
  machine: MachineLike,
  ref: StateRef,
): ResolvedStateNodeLike | undefined {
  let node = machine.root;
  for (const key of ref.path) {
    node = node?.states?.[key];
    if (node === undefined) return undefined;
  }
  return node;
}

type Snapshot = {
  value: unknown;
  context: Record<string, unknown>;
  status?: string;
  getMeta?: () => Record<string, unknown>;
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

/** A scripted invocation resolves an output, rejects, or hangs (`null`). */
type ScriptResult = Record<string, unknown> | Error | null;
type CaptainScript = (input: Record<string, unknown>) => ScriptResult;
type PlaybookScript = (
  input: Record<string, unknown>,
  actorId: string,
) => ScriptResult;

function makeActor(
  machine: MachineLike,
  script: CaptainScript,
  playbookScript: PlaybookScript = () => null,
): DrivenActor {
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
      // A child script is opt-in. All unrelated child invocations hang until
      // the driven actor is stopped, preserving Captain and parallel probes.
      playbook: fromPromise(
        async ({
          input,
          self,
        }: {
          input: Record<string, unknown>;
          self: { id: string };
        }) => {
          const output = playbookScript(input ?? {}, self.id);
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
    return new Error('coverage: forced captain failure');
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

/** Lets XState process an event whose correct outcome is no transition. */
async function settleNoTransition(): Promise<void> {
  await new Promise((resolveSettled) => setTimeout(resolveSettled, 10));
}

function activeStateIds(snapshot: Snapshot): Set<string> {
  const ids = new Set<string>();
  if (typeof snapshot.getMeta === 'function') {
    for (const [nodeId, raw] of Object.entries(snapshot.getMeta())) {
      if (typeof raw !== 'object' || raw === null) continue;
      const playbook = (raw as { playbook?: unknown }).playbook;
      if (typeof playbook !== 'object' || playbook === null) continue;
      const stateId = (playbook as { stateId?: unknown }).stateId;
      if (typeof stateId === 'string') ids.add(stateId);
      // XState's metadata map keys are public state-node ids. Retain them as
      // an additional compatibility surface for authored metadata that omits
      // playbook.stateId.
      ids.add(nodeId.startsWith('#') ? nodeId.slice(1) : nodeId);
    }
  }

  const walkValue = (value: unknown, prefix: readonly string[] = []): void => {
    if (typeof value === 'string') {
      ids.add(value);
      ids.add([...prefix, value].join('.'));
      return;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      walkValue(nested, [...prefix, key]);
    }
  };
  walkValue(snapshot.value);
  return ids;
}

const atState =
  (ref: StateRef) =>
  (snapshot: Snapshot): boolean => {
    const active = activeStateIds(snapshot);
    return (
      active.has(ref.stableId) ||
      active.has(ref.path.join('.')) ||
      (ref.path.length === 1 && active.has(ref.key))
    );
  };

const leftState =
  (ref: StateRef) =>
  (snapshot: Snapshot): boolean =>
    !atState(ref)(snapshot);

/** The actor id XState actually uses for a declared invocation. */
function invocationActorId(
  machine: MachineLike,
  invocation: Pick<
    CaptainRef | PlaybookRef,
    'ref' | 'invocation' | 'invocationIndex'
  >,
): string {
  const resolved = resolvedStateNode(machine, invocation.ref)?.invoke?.[
    invocation.invocationIndex
  ]?.id;
  if (typeof resolved === 'string') return resolved;
  const declared = invocation.invocation.id;
  if (typeof declared === 'string') return declared;
  if (typeof invocation.ref.state.id === 'string') {
    return `0.${invocation.ref.state.id}`;
  }
  return `0.${typeof machine.config.id === 'string' ? machine.config.id : '(machine)'}.${invocation.ref.path.join('.')}`;
}

function invocationEvent(
  machine: MachineLike,
  captain: CaptainRef,
  kind: 'done' | 'error',
): Record<string, unknown> {
  const actorId = invocationActorId(machine, captain);
  return { type: `xstate.${kind}.actor.${actorId}`, actorId };
}

function transitionArms(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
}

function rawArmTarget(arm: unknown): string | undefined {
  if (typeof arm === 'string') return arm;
  if (typeof arm !== 'object' || arm === null) return undefined;
  const target = (arm as { target?: unknown }).target;
  return typeof target === 'string' ? target : undefined;
}

function armGuard(arm: unknown): unknown {
  return typeof arm === 'object' && arm !== null
    ? (arm as { guard?: unknown }).guard
    : undefined;
}

/** The first transition arm XState selects for one concrete actor event. */
function directlySelectedEventArm(
  machine: MachineLike,
  arms: readonly unknown[],
  event: Record<string, unknown>,
): number | undefined {
  for (const [index, arm] of arms.entries()) {
    const rawGuard = armGuard(arm);
    if (rawGuard === undefined) return index;
    const guard = resolveGuard(machine, rawGuard);
    if (guard === undefined) return undefined;
    try {
      if (guard.run({ context: {}, event })) return index;
    } catch {
      return undefined;
    }
  }
  return undefined;
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

/** The arm XState selects for one concrete invocation output and empty context. */
function directlySelectedArm(
  machine: MachineLike,
  captain: CaptainRef,
  output: Record<string, unknown>,
): number | undefined {
  const event = {
    ...invocationEvent(machine, captain, 'done'),
    output,
  };
  return directlySelectedEventArm(
    machine,
    transitionArms(captain.invocation.onDone),
    event,
  );
}

function directTargetRef(
  machine: MachineLike,
  refs: readonly StateRef[],
  captain: CaptainRef,
  output: Record<string, unknown>,
): StateRef | undefined {
  const arms = transitionArms(captain.invocation.onDone);
  const selected = directlySelectedArm(machine, captain, output);
  if (selected === undefined) return undefined;
  const target = rawArmTarget(arms[selected]);
  return target === undefined
    ? undefined
    : stateRefForTarget(refs, target, captain.ref);
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

function isDescendantOf(ref: StateRef, ancestor: StateRef): boolean {
  return (
    ref.path.length > ancestor.path.length &&
    ancestor.path.every((part, index) => ref.path[index] === part)
  );
}

/** Picks the initially active Captain leaf from each immediate parallel region. */
function parallelBranchCaptains(
  parallel: StateRef,
  refs: readonly StateRef[],
  captains: readonly CaptainRef[],
): CaptainRef[] {
  const regions = refs.filter((ref) => ref.parent === parallel);
  const selected: CaptainRef[] = [];
  for (const region of regions) {
    const candidates = captains.filter((captain) =>
      isDescendantOf(captain.ref, region),
    );
    const initial = region.state.initial;
    const captain =
      (initial === undefined
        ? undefined
        : candidates.find(
            (candidate) => candidate.ref.path[region.path.length] === initial,
          )) ?? candidates[0];
    if (captain !== undefined) selected.push(captain);
  }
  return selected;
}

function scriptedOutputs(
  entries: readonly {
    captain: CaptainRef;
    output: Record<string, unknown>;
  }[],
): { script: CaptainScript; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const byState = new Map(
    entries.map(({ captain, output }) => [
      captainPublicStateId(captain),
      output,
    ]),
  );
  const bySource = new Map(
    entries.map(({ captain, output }) => [captain.binding.sourceItem, output]),
  );
  return {
    calls,
    script: (input) => {
      const stateId =
        typeof input.stateId === 'string' ? input.stateId : undefined;
      const sourceItem =
        typeof input.sourceItem === 'string' ? input.sourceItem : undefined;
      const key = stateId ?? sourceItem;
      const output =
        (stateId === undefined ? undefined : byState.get(stateId)) ??
        (sourceItem === undefined ? undefined : bySource.get(sourceItem));
      if (key === undefined || output === undefined) return null;
      const count = (calls.get(key) ?? 0) + 1;
      calls.set(key, count);
      return count === 1 ? output : null;
    },
  };
}

function callCount(
  calls: ReadonlyMap<string, number>,
  captain: CaptainRef,
): number {
  return (
    calls.get(captainPublicStateId(captain)) ??
    calls.get(captain.binding.sourceItem) ??
    0
  );
}

type PlaybookOutcome = 'onDone' | 'onError';

/**
 * Drives one nested invocation outcome through the call state's public id.
 * The one-shot child is selected by both its resolved XState actor id and its
 * `PlaybookInput.stateId`; every other child remains parked until actor stop.
 */
async function probePlaybookOutcome(
  machine: MachineLike,
  playbook: PlaybookRef,
  refs: readonly StateRef[],
  outcome: PlaybookOutcome,
): Promise<string[]> {
  const rawArms = transitionArms(
    outcome === 'onDone'
      ? playbook.invocation.onDone
      : playbook.invocation.onError,
  );
  if (rawArms.length === 0) {
    return [
      `state ${playbook.ref.stableId} declares no nested playbook ${outcome} transition`,
    ];
  }

  const actorId = invocationActorId(machine, playbook);
  const successOutput = { response: 'coverage: nested playbook completed' };
  const forcedError = new Error('coverage: forced nested playbook failure');
  const event =
    outcome === 'onDone'
      ? { type: `xstate.done.actor.${actorId}`, actorId, output: successOutput }
      : { type: `xstate.error.actor.${actorId}`, actorId, error: forcedError };
  const armIndex = directlySelectedEventArm(machine, rawArms, event);
  if (armIndex === undefined) {
    return [
      `state ${playbook.ref.stableId}: nested playbook ${outcome} has no directly selectable transition`,
    ];
  }

  const rawTarget = rawArmTarget(rawArms[armIndex]);
  const target =
    rawTarget === undefined
      ? undefined
      : stateRefForTarget(refs, rawTarget, playbook.ref);
  if (rawTarget === undefined || target === undefined) {
    return [
      `state ${playbook.ref.stableId}: nested playbook ${outcome} arm ${armIndex} has no observable target`,
    ];
  }
  if (target === playbook.ref) {
    return [
      `state ${playbook.ref.stableId}: nested playbook ${outcome} arm ${armIndex} does not leave the call state`,
    ];
  }

  const gate: ArmingGate = { armed: false };
  let calls = 0;
  const actor = makeActor(
    machine,
    () => null,
    (input, invokedActorId) => {
      if (
        !gate.armed ||
        calls > 0 ||
        invokedActorId !== actorId ||
        input.stateId !== playbook.ref.stableId
      ) {
        return null;
      }
      calls++;
      return outcome === 'onDone' ? successOutput : forcedError;
    },
  );
  gate.armed = true;
  actor.send({
    type: INTERRUPT_EVENT,
    targetId: playbook.ref.stableId,
  });
  const landed = await settle(
    actor,
    (snapshot) => calls === 1 && atState(target)(snapshot),
  );
  actor.stop();
  return landed
    ? []
    : [
        `state ${playbook.ref.stableId}: nested playbook ${outcome} arm ${armIndex} did not reach ${target.stableId}`,
      ];
}

async function probePlaybookInvocation(
  machine: MachineLike,
  playbook: PlaybookRef,
  refs: readonly StateRef[],
): Promise<string[]> {
  return [
    ...(await probePlaybookOutcome(machine, playbook, refs, 'onDone')),
    ...(await probePlaybookOutcome(machine, playbook, refs, 'onError')),
  ];
}

async function probeParallelQuestions(
  machine: MachineLike,
  parallel: StateRef,
  refs: readonly StateRef[],
  captains: readonly CaptainRef[],
): Promise<string[]> {
  const branches = parallelBranchCaptains(parallel, refs, captains);
  const plans = branches.flatMap((captain) => {
    if (captain.binding.result[NEEDS_BOSS_REPLY] === undefined) return [];
    const output = synthOutput(captain.binding, NEEDS_BOSS_REPLY);
    const wait = directTargetRef(machine, refs, captain, output);
    if (
      wait === undefined ||
      (wait.stableId !== AWAIT_BOSS_REPLY_STATE &&
        !tagsOf(wait.state).includes('playbook.parked'))
    ) {
      return [];
    }
    return [{ captain, output, wait }];
  });
  if (plans.length < 2) return [];

  const { script, calls } = scriptedOutputs(plans);
  const actor = makeActor(machine, script);
  actor.send({
    type: INTERRUPT_EVENT,
    targetId: captainPublicStateId(plans[0].captain),
  });
  const parked = await settle(
    actor,
    (snapshot) => plans.every(({ wait }) => atState(wait)(snapshot)),
    500,
  );
  if (!parked) {
    actor.stop();
    return [
      `parallel state ${parallel.stableId}: branch questions did not become simultaneously pending`,
    ];
  }

  const [selected, ...others] = plans;
  actor.send({
    type: BOSS_REPLY_EVENT,
    questionId: captainPublicStateId(selected.captain),
    answer: 'Continue only this branch.',
  });
  const isolated = await settle(
    actor,
    (snapshot) =>
      callCount(calls, selected.captain) >= 2 &&
      atState(selected.captain.ref)(snapshot) &&
      others.every(({ wait }) => atState(wait)(snapshot)),
    500,
  );
  actor.stop();
  return isolated
    ? []
    : [
        `parallel state ${parallel.stableId}: a keyed Boss reply did not resume exactly one pending branch`,
      ];
}

function combinations<T>(lists: readonly (readonly T[])[], limit = 64): T[][] {
  let out: T[][] = [[]];
  for (const list of lists) {
    out = out.flatMap((prefix) => list.map((item) => [...prefix, item]));
    if (out.length > limit) return out.slice(0, limit);
  }
  return out;
}

async function probeParallelJoins(
  machine: MachineLike,
  parallel: StateRef,
  refs: readonly StateRef[],
  captains: readonly CaptainRef[],
): Promise<string[]> {
  const arms = transitionArms(parallel.state.onDone);
  if (arms.length === 0) return [];
  const branches = parallelBranchCaptains(parallel, refs, captains);
  if (branches.length < 2) {
    return [
      `parallel state ${parallel.stableId}: onDone join coverage is unsupported without one Captain leaf per branch`,
    ];
  }

  const branchOutputs = branches.map((captain) =>
    Object.keys(captain.binding.result).flatMap((key) => {
      if (key === NEEDS_BOSS_REPLY) return [];
      const output = synthOutput(captain.binding, key);
      const target = directTargetRef(machine, refs, captain, output);
      return target?.state.type === 'final' ? [output] : [];
    }),
  );
  if (branchOutputs.some((outputs) => outputs.length === 0)) {
    return [
      `parallel state ${parallel.stableId}: onDone join coverage is unsupported without a final-reaching branch result`,
    ];
  }

  const outputs = combinations(branchOutputs);
  const normalizedTargets = arms.map((arm) => rawArmTarget(arm) ?? null);
  const findings: string[] = [];
  for (const [armIndex, rawTarget] of normalizedTargets.entries()) {
    if (rawTarget === null) {
      findings.push(
        `parallel state ${parallel.stableId}: onDone join arm ${armIndex} coverage is unsupported for a target-less arm`,
      );
      continue;
    }
    const duplicateTarget = normalizedTargets.some(
      (candidate, index) => index !== armIndex && candidate === rawTarget,
    );
    const target = stateRefForTarget(refs, rawTarget, parallel);
    if (duplicateTarget || target === undefined) {
      findings.push(
        `parallel state ${parallel.stableId}: onDone join arm ${armIndex} coverage is unsupported because its target is not uniquely observable`,
      );
      continue;
    }

    let exercised = false;
    for (const combination of outputs) {
      const entries = branches.map((captain, index) => ({
        captain,
        output: combination[index],
      }));
      const { script, calls } = scriptedOutputs(entries);
      const actor = makeActor(machine, script);
      actor.send({
        type: INTERRUPT_EVENT,
        targetId: captainPublicStateId(branches[0]),
      });
      exercised = await settle(
        actor,
        (snapshot) =>
          target === parallel
            ? branches.every((captain) => callCount(calls, captain) >= 2) &&
              branches.every((captain) => atState(captain.ref)(snapshot))
            : atState(target)(snapshot),
        250,
      );
      actor.stop();
      if (exercised) break;
    }
    if (!exercised) {
      findings.push(
        `parallel state ${parallel.stableId}: onDone join arm ${armIndex} could not be exercised under bounded branch-result probing`,
      );
    }
  }
  return findings;
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
  const states = (config.states ?? {}) as Record<string, StateNodeLike>;
  const refs = stateRefs(config);
  const captains = captainRefs(config);
  const playbooks = playbookRefs(config);
  const captainByRef = new Map(
    captains.map((captain) => [captain.ref, captain]),
  );
  const sourceCandidates = identifierLiterals(opts.sourceText ?? '');

  const parallelRefs = refs.filter((ref) => ref.state.type === 'parallel');
  for (const ref of parallelRefs) {
    if (!normalizeArms(ref.state.onDone).some((arm) => arm.target !== null)) {
      findings.push(`parallel state ${ref.stableId} declares no onDone join`);
    }
  }

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
  if (canJump) {
    for (const playbook of playbooks) {
      findings.push(
        ...(await probePlaybookInvocation(machine, playbook, refs)),
      );
    }
    for (const parallel of parallelRefs) {
      findings.push(
        ...(await probeParallelQuestions(machine, parallel, refs, captains)),
        ...(await probeParallelJoins(machine, parallel, refs, captains)),
      );
    }
  }
  const waitStates = refs.filter(
    (ref) =>
      ref.stableId === AWAIT_BOSS_REPLY_STATE ||
      (tagsOf(ref.state).includes('playbook.parked') &&
        ref.state.on?.[BOSS_REPLY_EVENT] !== undefined),
  );
  if (waitStates.length === 0) {
    findings.push(
      `machine declares no ${AWAIT_BOSS_REPLY_STATE} state or branch-local Boss-reply wait state`,
    );
  }

  // Every BOSS_INTERRUPT target is enterable (the captain hangs, so entering a
  // captain state parks in it).
  if (canJump) {
    for (const arm of rootArms) {
      if (arm.target === null) continue;
      const target = stateRefForTarget(refs, arm.target);
      const targetCaptain =
        target === undefined ? undefined : captainByRef.get(target);
      const targetId =
        targetCaptain === undefined
          ? (target?.stableId ?? arm.target)
          : captainPublicStateId(targetCaptain);
      const actor = makeActor(machine, () => null);
      actor.send({ type: INTERRUPT_EVENT, targetId });
      if (target === undefined || !(await settle(actor, atState(target)))) {
        findings.push(
          `${INTERRUPT_EVENT} target ${arm.target} is not enterable`,
        );
      }
      actor.stop();
    }
  }

  // Guard-free root entry events transition from the initial state.
  const initial = typeof config.initial === 'string' ? config.initial : null;
  const initialRef =
    initial === null
      ? undefined
      : refs.find((ref) => ref.path.length === 1 && ref.key === initial);
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
    if (
      initialRef === undefined ||
      !(await settle(actor, leftState(initialRef)))
    ) {
      findings.push(`root event ${event} fired no transition`);
    }
    actor.stop();
  }

  const stateCandidates = refs.flatMap((ref) => [
    ref.key,
    ref.stableId,
    ...(ref.configId === undefined ? [] : [ref.configId]),
  ]);

  for (const captain of captains) {
    if (!canJump) break;
    const state = captain.binding;
    const stateKey = state.stateId;
    const stateId = captainPublicStateId(captain);
    const candidates = [...stateCandidates, ...sourceCandidates];
    const doneEvent = invocationEvent(machine, captain, 'done');
    const errorEvent = invocationEvent(machine, captain, 'error');
    const rawDoneArms = transitionArms(captain.invocation.onDone);
    const onDoneArms = normalizeArms(captain.invocation.onDone);

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
      const left = await settle(actor, leftState(captain.ref));
      if (!left) {
        findings.push(`state ${stateKey}: result "${key}" fired no transition`);
      } else if (key === NEEDS_BOSS_REPLY) {
        const waitTarget =
          rawArmTarget(rawDoneArms[directArm]) ?? onDoneArms[directArm]?.target;
        const waitRef =
          waitTarget === null || waitTarget === undefined
            ? undefined
            : stateRefForTarget(refs, waitTarget, captain.ref);
        if (
          waitRef === undefined ||
          (waitRef.stableId !== AWAIT_BOSS_REPLY_STATE &&
            !tagsOf(waitRef.state).includes('playbook.parked')) ||
          !(await settle(actor, atState(waitRef)))
        ) {
          findings.push(
            `state ${stateKey}: ${NEEDS_BOSS_REPLY} did not suspend in ${AWAIT_BOSS_REPLY_STATE} or a branch-local Boss-reply wait state`,
          );
          actor.stop();
          continue;
        }

        if (waitRef.stableId !== AWAIT_BOSS_REPLY_STATE) {
          actor.send({
            type: BOSS_REPLY_EVENT,
            questionId: 'coverage-unknown-question',
            answer: 'This answer belongs to no pending branch.',
          });
          await settleNoTransition();
          if (!atState(waitRef)(actor.getSnapshot())) {
            findings.push(
              `state ${stateKey}: an unknown ${BOSS_REPLY_EVENT} questionId moved the branch`,
            );
            actor.stop();
            continue;
          }
        }

        // Boss-reply resume: BOSS_REPLY returns to the suspended state, and a
        // blank answer must not resume it.
        actor.send({
          type: BOSS_REPLY_EVENT,
          questionId: stateId,
          answer: 'Proceed as planned.',
        });
        if (!(await settle(actor, atState(captain.ref)))) {
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
        if (await settle(blank, atState(waitRef))) {
          blank.send({
            type: BOSS_REPLY_EVENT,
            questionId: stateId,
            answer: '   ',
          });
          await settleNoTransition();
          if (atState(captain.ref)(blank.getSnapshot())) {
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
    const rawErrorArms = transitionArms(captain.invocation.onError);
    const onErrorArms = normalizeArms(captain.invocation.onError);
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
    const rawTarget = rawArmTarget(rawErrorArms[directErrorArm]) ?? target;
    const targetRef =
      rawTarget === null
        ? undefined
        : stateRefForTarget(refs, rawTarget, captain.ref);
    const gate: ArmingGate = { armed: false };
    const actor = makeActor(machine, throwingScript(state.sourceItem, gate));
    gate.armed = true;
    actor.send({ type: INTERRUPT_EVENT, targetId: stateId });
    const landed = await settle(
      actor,
      target !== null && targetRef !== undefined
        ? atState(targetRef)
        : leftState(captain.ref),
    );
    if (!landed || (target !== null && targetRef === undefined)) {
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

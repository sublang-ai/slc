// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { fromPromise, setup } from 'xstate';

import {
  CONTROLLER_ACTION_GUARDS,
  artifactSchemaForPlaybookProvenance,
  loadFsmModule,
  loadLinkedModuleForVerification,
} from '../src/verify.js';
import {
  checkPlaybookIntegrity,
  checkReferenceEquivalence,
  hasBossReplySurface,
  interposeSchema3LinkedModule,
  loadInterposedSchema3Registry,
  playerLineSets,
  runtimeCapabilityProfile,
  type CompiledPlaybook,
  type RuntimeCapabilityProfile,
} from './equivalence.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
// The dependency lock selects the released oracle used in every environment;
// an unrelated mutable sibling checkout must not change acceptance semantics.
const referenceDir = join(
  repoRoot,
  'node_modules/@sublang/playbook/reference/sdlc/code.playbook',
);
const installedPlaybookVersion = (
  JSON.parse(
    readFileSync(
      join(repoRoot, 'node_modules/@sublang/playbook/package.json'),
      'utf8',
    ),
  ) as { version: string }
).version;
const installedPlaybookProvenance = `@sublang/playbook@${installedPlaybookVersion}`;
const installedArtifactSchema = artifactSchemaForPlaybookProvenance(
  installedPlaybookProvenance,
);

/** Loads the immutable Playbook-4 schema-1 reference fixture. */
async function loadReference(): Promise<CompiledPlaybook> {
  const playbook = await import(join(referenceDir, 'code.playbook.js'));
  const schema3 =
    installedArtifactSchema === 3
      ? await loadInterposedSchema3Registry(
          join(referenceDir, 'code.registry.ts'),
          join(referenceDir, 'code.playbook.js'),
          playbook,
        )
      : undefined;
  return {
    gears: readFileSync(join(referenceDir, 'code.gears.md'), 'utf8'),
    fsm: await import(join(referenceDir, 'code.fsm.js')),
    playbook: schema3?.playbook ?? playbook,
    fsmSource: readFileSync(join(referenceDir, 'code.fsm.ts'), 'utf8'),
    linkTargetProvenance: installedPlaybookProvenance,
    ...(schema3 === undefined ? {} : { registry: schema3.registry }),
  };
}

/** Loads an `slc playbook` output directory as a {@link CompiledPlaybook}. */
async function loadProduced(dir: string): Promise<CompiledPlaybook> {
  const linkedPath = join(dir, 'code.playbook.ts');
  const fsmPath = join(dir, 'code.fsm.ts');
  const playbook = await loadLinkedModuleForVerification({
    linkedPath,
    fsmPath,
  });
  const entryPath = join(dirname(dir), 'code.ts');
  const schema3 =
    installedArtifactSchema === 3 && existsSync(entryPath)
      ? await loadInterposedSchema3Registry(entryPath, linkedPath, playbook)
      : undefined;
  return {
    gears: readFileSync(join(dir, 'code.gears.md'), 'utf8'),
    fsm: await loadFsmModule(fsmPath),
    playbook: schema3?.playbook ?? playbook,
    fsmSource: readFileSync(join(dir, 'code.fsm.ts'), 'utf8'),
    linkTargetProvenance: installedPlaybookProvenance,
    ...(schema3 === undefined ? {} : { registry: schema3.registry }),
  };
}

const profileState = {
  value: 'ready',
  activeStateIds: ['ready'],
  tags: ['playbook.parked'],
  status: 'active' as const,
  quiescent: true,
};

function withRuntimeProfile(
  compiled: CompiledPlaybook,
  profile: RuntimeCapabilityProfile,
): CompiledPlaybook {
  return {
    ...compiled,
    playbook: {
      runtimeContractProfile: profile,
      default: () => ({
        init: async () => {},
        handleBossInput: async () =>
          profile === 'composed-v2'
            ? { outcome: 'no-action', state: profileState }
            : undefined,
        ...(profile === 'composed-v2'
          ? { resumePlaybookCall: async () => {} }
          : {}),
        dispose: async () => {},
      }),
    },
  };
}

function unmarkedStrictRuntime(profile: 'legacy' | 'session-v1'): unknown {
  return {
    default: () => {
      let ports: { callJudge(prompt: string, signal: AbortSignal): unknown };
      return {
        async init(value: unknown) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('invalid init value');
          }
          const record = value as Record<string, unknown>;
          const selected =
            profile === 'legacy'
              ? record
              : (record.ports as Record<string, unknown> | undefined);
          if (
            profile === 'session-v1' &&
            (record.sessionId !== 'slc-profile-probe' ||
              record.playbookId !== 'probe')
          ) {
            throw new Error('session identity is required');
          }
          if (typeof selected?.callJudge !== 'function') {
            throw new Error('exact profile ports are required');
          }
          ports = selected as typeof ports;
        },
        async handleBossInput(turn: { signal: AbortSignal }) {
          await ports.callJudge('classify probe', turn.signal);
        },
        async dispose() {},
      };
    },
  };
}

function unmarkedStrictComposedRuntime(): unknown {
  return {
    default: () => {
      let ports: {
        callCaptain(
          prompt: string,
          signal: AbortSignal,
          options: {
            visibility: 'visible' | 'hidden';
            resume: false;
            allowedTools: readonly [];
          },
        ): Promise<unknown>;
      };
      return {
        async init(value: unknown) {
          if (typeof value !== 'object' || value === null) {
            throw new Error('invalid init value');
          }
          const record = value as Record<string, unknown>;
          if (
            record.sessionId !== 'slc-profile-probe' ||
            record.playbookId !== 'probe' ||
            record.rootSessionId !== 'slc-profile-probe' ||
            record.depth !== 0
          ) {
            throw new Error('causal root identity is required');
          }
          if (typeof record.ports !== 'object' || record.ports === null) {
            throw new Error('composed ports are required');
          }
          const selected = record.ports as Record<string, unknown>;
          const names = Object.keys(selected).sort();
          if (
            JSON.stringify(names) !==
              JSON.stringify([
                'callCaptain',
                'callJudge',
                'callPlaybook',
                'callPlayer',
                'emitStatus',
                'emitTelemetry',
              ]) ||
            names.some((name) => typeof selected[name] !== 'function')
          ) {
            throw new Error('exact six-port profile is required');
          }
          ports = selected as unknown as typeof ports;
        },
        async handleBossInput(turn: { signal: AbortSignal }) {
          await ports.callCaptain('direct probe', turn.signal, {
            visibility: 'hidden',
            resume: false,
            allowedTools: [],
          });
          return { outcome: 'no-action', state: profileState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: profileState };
        },
        async dispose() {},
      };
    },
  };
}

const playbook10Provenance = '@sublang/playbook@10.0.0';

type Schema3FixtureKind = 'shared-factory' | 'bespoke';

interface Schema3FixtureOptions {
  kind: Schema3FixtureKind;
  compatMode?: 'exact' | 'missing' | 'mutable' | 'accessor';
  roles?: readonly string[];
  concurrentRoleSets?: readonly (readonly string[])[];
  validateOptions?: (value: unknown) => unknown;
  result?: unknown;
  effect?: 'player' | 'repository' | 'ledger';
  entryMode?:
    | 'exact'
    | 'zero-call'
    | 'two-call'
    | 'two-argument-construction'
    | 'suppressed-construction-failure'
    | 'extra-construction'
    | 'restored-malformed-construction'
    | 'restored-configured-options-drift'
    | 'restored-host-capabilities-drift'
    | 'replacement'
    | 'proxy';
  interpose?: boolean;
  runtimePatch?: (runtime: Record<string, unknown>) => void;
}

function assertExactDataRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${label} must be a plain record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(descriptors).length !== keys.length ||
    keys.some((key) => {
      const descriptor = descriptors[key];
      return (
        descriptor === undefined ||
        !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
        descriptor.enumerable !== true
      );
    })
  ) {
    throw new Error(`${label} must contain exact enumerable own data`);
  }
  return value as Record<string, unknown>;
}

function schema3Fixture(options: Schema3FixtureOptions): {
  playbook: unknown;
  registry: Record<string, unknown>;
  observations: { turns: number; disposals: number };
} {
  const roles = [...(options.roles ?? [])];
  const concurrentRoleSets = (options.concurrentRoleSets ?? []).map((set) => [
    ...set,
  ]);
  const observations = { turns: 0, disposals: 0 };
  let lastValidated: unknown;

  const constructRuntime = (construction: unknown) => {
    const input = assertExactDataRecord(
      construction,
      ['configuredOptions', 'hostCapabilities'],
      'shared-factory construction',
    );
    if (input.configuredOptions !== lastValidated) {
      throw new Error('configured options did not cross by exact identity');
    }
    const capabilities = assertExactDataRecord(
      input.hostCapabilities,
      ['authority', 'repository', 'effectLedger'],
      'host capabilities',
    );
    const authority = assertExactDataRecord(
      capabilities.authority,
      [
        'playbookId',
        'artifactSchema',
        'cwd',
        'sessionId',
        'leaseOwnerToken',
        'canonicalWorktree',
        'requiredRoleIds',
        'concurrentRoleSets',
      ],
      'host authority',
    );
    const canonicalWorktree = assertExactDataRecord(
      authority.canonicalWorktree,
      ['worktree', 'gitDir'],
      'canonical worktree',
    );
    const repository = assertExactDataRecord(
      capabilities.repository,
      [
        'identity',
        'observe',
        'acquire',
        'runExclusive',
        'runCohort',
        'runDeferred',
      ],
      'repository capability',
    );
    const identity = assertExactDataRecord(
      repository.identity,
      ['worktree', 'gitDir'],
      'repository identity',
    );
    const ledger = assertExactDataRecord(
      capabilities.effectLedger,
      ['snapshot', 'writeAhead'],
      'effect-ledger capability',
    );
    if (
      authority.playbookId !== 'synthetic-v3' ||
      authority.artifactSchema !== 3 ||
      authority.cwd !== canonicalWorktree.worktree ||
      identity.worktree !== canonicalWorktree.worktree ||
      identity.gitDir !== canonicalWorktree.gitDir ||
      !existsSync(join(String(canonicalWorktree.worktree), '.git')) ||
      JSON.stringify(authority.requiredRoleIds) !== JSON.stringify(roles) ||
      JSON.stringify(authority.concurrentRoleSets) !==
        JSON.stringify(concurrentRoleSets)
    ) {
      throw new Error('host authority does not match the registry/worktree');
    }
    const snapshot = (ledger.snapshot as () => unknown)();
    const nextSnapshot = (ledger.snapshot as () => unknown)();
    if (
      snapshot === nextSnapshot ||
      JSON.stringify(snapshot) !==
        JSON.stringify({
          schemaVersion: 1,
          revision: 0,
          boundaries: [],
          logicalOperations: [],
        })
    ) {
      throw new Error('effect-ledger snapshots must be exact and detached');
    }

    let ports: Record<string, unknown> | undefined;
    const runtime: Record<string, unknown> = {
      async init(session: unknown) {
        const initialized = assertExactDataRecord(
          session,
          ['sessionId', 'playbookId', 'rootSessionId', 'depth', 'ports'],
          'schema-3 session',
        );
        ports = assertExactDataRecord(
          initialized.ports,
          [
            'callPlayer',
            'callJudge',
            'callCaptain',
            'callPlaybook',
            'emitStatus',
            'emitTelemetry',
          ],
          'schema-3 ports',
        );
        if (
          initialized.sessionId !== 'slc-profile-probe' ||
          initialized.playbookId !== 'synthetic-v3' ||
          initialized.rootSessionId !== 'slc-profile-probe' ||
          initialized.depth !== 0 ||
          Object.values(ports).some((member) => typeof member !== 'function')
        ) {
          throw new Error('schema-3 causal-root session is malformed');
        }
      },
      async handleBossInput() {
        observations.turns += 1;
        if (options.effect === 'player') {
          await (ports?.callPlayer as (...args: unknown[]) => Promise<unknown>)(
            'worker',
            'work',
            new AbortController().signal,
            { resume: false },
          );
        } else if (options.effect === 'repository') {
          await (repository.runExclusive as () => Promise<unknown>)();
        } else if (options.effect === 'ledger') {
          await (ledger.writeAhead as () => Promise<unknown>)();
        }
        return options.result ?? { outcome: 'no-action', state: profileState };
      },
      async resumePlaybookCall() {
        return { outcome: 'no-action', state: profileState };
      },
      async dispose() {
        observations.disposals += 1;
      },
    };
    options.runtimePatch?.(runtime);
    return runtime;
  };
  const linkedFactory = (...args: unknown[]) => {
    if (options.entryMode === 'suppressed-construction-failure') {
      throw new Error('synthetic linked factory construction failed');
    }
    if (options.entryMode === 'restored-configured-options-drift') {
      const configuredOptions = (
        args[0] as { configuredOptions: Record<string, unknown> }
      ).configuredOptions;
      const extra = configuredOptions.extra;
      Reflect.deleteProperty(configuredOptions, 'extra');
      try {
        return constructRuntime(args[0]);
      } finally {
        configuredOptions.extra = extra;
      }
    }
    if (options.entryMode === 'restored-host-capabilities-drift') {
      const authority = (
        args[0] as {
          hostCapabilities: { authority: Record<string, unknown> };
        }
      ).hostCapabilities.authority;
      const playbookId = authority.playbookId;
      authority.playbookId = 'synthetic-v3';
      try {
        return constructRuntime(args[0]);
      } finally {
        authority.playbookId = playbookId;
      }
    }
    if (options.entryMode === 'restored-malformed-construction') {
      const construction = args[0] as Record<string, unknown>;
      return constructRuntime({
        configuredOptions: construction.configuredOptions,
        hostCapabilities: construction.hostCapabilities,
      });
    }
    return constructRuntime(args[0]);
  };
  const compat =
    options.compatMode === 'mutable'
      ? { artifactSchema: 3, runtimeAbi: 1 }
      : Object.freeze({ artifactSchema: 3, runtimeAbi: 1 });
  if (options.kind === 'shared-factory') {
    if (options.compatMode === 'accessor') {
      Object.defineProperty(linkedFactory, 'compat', {
        get: () => compat,
        enumerable: true,
        configurable: false,
      });
    } else if (options.compatMode !== 'missing') {
      Object.defineProperty(linkedFactory, 'compat', {
        value: compat,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
  }
  const interposed =
    options.interpose === false
      ? { playbook: { default: linkedFactory }, factory: linkedFactory }
      : interposeSchema3LinkedModule({ default: linkedFactory });
  const factory = interposed.factory;
  const runtimeProfile = Object.freeze(
    options.kind === 'shared-factory'
      ? { kind: 'shared-factory', compat }
      : { kind: 'bespoke', artifactSchema: 3 },
  );
  const registry: Record<string, unknown> = {
    id: 'synthetic-v3',
    command: 'synthetic-v3',
    intent: 'exercise the dormant schema-3 equivalence boundary',
    artifactSchema: 3,
    runtimeProfile,
    requiredRoleIds: roles,
    concurrentRoleSets,
    validateOptions(value: unknown) {
      lastValidated =
        options.validateOptions === undefined
          ? value === undefined
            ? options.entryMode === 'restored-configured-options-drift'
              ? {}
              : Object.freeze({})
            : value
          : options.validateOptions(value);
      return lastValidated;
    },
    createRuntime(configuredOptions: unknown, hostCapabilities: unknown) {
      const configuredRecord = configuredOptions as Record<string, unknown>;
      const authority = (
        hostCapabilities as { authority: Record<string, unknown> }
      ).authority;
      const construction =
        options.entryMode === 'extra-construction' ||
        options.entryMode === 'restored-malformed-construction'
          ? { configuredOptions, hostCapabilities, extra: true }
          : { configuredOptions, hostCapabilities };
      if (options.entryMode === 'zero-call') {
        return constructRuntime(construction);
      }
      if (options.entryMode === 'restored-configured-options-drift') {
        configuredRecord.extra = true;
      }
      if (options.entryMode === 'restored-host-capabilities-drift') {
        authority.playbookId = 'drifted-v3';
      }
      let linkedRuntime: unknown;
      try {
        linkedRuntime =
          options.entryMode === 'two-argument-construction'
            ? factory(construction, 'unexpected')
            : factory(construction);
      } catch (error) {
        if (options.entryMode !== 'suppressed-construction-failure') {
          throw error;
        }
        linkedRuntime = constructRuntime(construction);
      } finally {
        if (options.entryMode === 'restored-configured-options-drift') {
          Reflect.deleteProperty(configuredRecord, 'extra');
        }
        if (options.entryMode === 'restored-host-capabilities-drift') {
          authority.playbookId = 'synthetic-v3';
        }
      }
      if (options.entryMode === 'restored-malformed-construction') {
        Reflect.deleteProperty(construction, 'extra');
      }
      if (options.entryMode === 'two-call') {
        factory(construction);
      }
      if (options.entryMode === 'replacement') {
        return constructRuntime(construction);
      }
      if (options.entryMode === 'proxy') {
        return new Proxy(linkedRuntime as object, {});
      }
      return linkedRuntime;
    },
  };
  return {
    playbook: interposed.playbook,
    registry,
    observations,
  };
}

const schema3Gears = `# Synthetic schema-3 equivalence fixture

Roles:

- Worker

## Behaviors

### SYNTHETIC-1

When Boss requests synthetic work, Captain shall prompt Worker:
> Perform the synthetic work.
`;

const rolelessSchema3Gears = `# Synthetic roleless schema-3 equivalence fixture

## Behaviors

### SYNTHETIC-DIRECT-1

When Boss requests a synthetic answer, Captain shall answer directly:
> Answer the synthetic request.
`;

const schema3NeedsBossReply =
  "The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.";

/** A complete synthetic Roles/FSM closure, independent of the schema-1 oracle. */
function syntheticSchema3Compilation(roleless = false): CompiledPlaybook {
  const sourceItem = roleless ? 'SYNTHETIC-DIRECT-1' : 'SYNTHETIC-1';
  const prompt = roleless
    ? 'Answer the synthetic request.'
    : 'Perform the synthetic work.';
  const machine = setup({
    actors: {
      player: fromPromise(async () => {
        throw new Error('player actor must be supplied by the runtime');
      }),
      captain: fromPromise(async () => {
        throw new Error('Captain actor must be supplied by the runtime');
      }),
    },
  }).createMachine({
    id: 'syntheticSchema3',
    initial: 'ready',
    context: {},
    on: {
      BOSS_INTERRUPT: [
        {
          target: '#work',
          reenter: true,
          guard: (({ event }: { event: { targetId?: unknown } }) =>
            event.targetId === 'work') as never,
        },
        {
          target: '#ready',
          reenter: true,
          guard: (({ event }: { event: { targetId?: unknown } }) =>
            event.targetId === 'ready') as never,
        },
      ],
    },
    states: {
      ready: {
        id: 'ready',
        tags: 'playbook.parked',
        on: { GO: { target: '#work' } },
      },
      work: {
        id: 'work',
        tags: 'playbook.busy',
        meta: {
          playbook: {
            stateId: 'work',
            description: 'Performing synthetic work',
            ...(roleless ? {} : { role: 'worker' }),
          },
        },
        invoke: {
          src: roleless ? 'captain' : 'player',
          input: () => ({
            stateId: 'work',
            ...(roleless ? {} : { role: 'worker' }),
            sourceItem,
            prompt,
            result: {
              done: 'The synthetic work is complete.',
              needsBossReply: schema3NeedsBossReply,
            },
          }),
          onDone: [
            {
              target: '#done',
              guard: (({
                event,
              }: {
                event: { output?: { guard?: unknown } };
              }) => event.output?.guard === 'done') as never,
            },
            {
              target: '#awaitBossReply',
              guard: (({
                event,
              }: {
                event: { output?: { guard?: unknown; question?: unknown } };
              }) =>
                event.output?.guard === 'needsBossReply' &&
                typeof event.output.question === 'string') as never,
            },
          ],
          onError: { target: '#failed' },
        },
      },
      awaitBossReply: {
        id: 'awaitBossReply',
        tags: 'playbook.parked',
        on: {
          BOSS_REPLY: [
            {
              target: '#work',
              reenter: true,
              guard: (({ event }: { event: { answer?: unknown } }) =>
                typeof event.answer === 'string' &&
                event.answer.trim() !== '') as never,
            },
            { target: '#failed' },
          ],
        },
      },
      failed: {
        id: 'failed',
        tags: 'playbook.parked',
        on: { GO: { target: '#work' } },
      },
      done: { id: 'done', type: 'final' },
    },
  } as never);
  return {
    gears: roleless ? rolelessSchema3Gears : schema3Gears,
    fsm: { machine, concurrentRoleSets: [] },
    playbook: {},
  };
}

/** Same source contract with a grounded schema-3 controller decision FSM. */
function syntheticControllerCompilation(
  drift?: 'missing-action' | 'extra-action',
): CompiledPlaybook {
  const result = {
    respond: 'Respond to Boss and return to the session hub.',
    resume: 'Resume the selected session and return to the session hub.',
    start: 'Start the selected playbook and return to the session hub.',
    switch: 'Switch sessions and return to the session hub.',
    dismiss: 'Dismiss the selected session and return to the session hub.',
    deliver: 'Deliver the selected result and return to the session hub.',
    runtime: 'Apply the selected runtime action and return to the session hub.',
    ...(drift === 'extra-action' ? { other: 'Unsupported action.' } : {}),
  };
  if (drift === 'missing-action') Reflect.deleteProperty(result, 'runtime');
  const selects = (key: string) =>
    (({ event }: { event: { output?: { guard?: unknown } } }) =>
      event.output?.guard === key) as never;
  const machine = setup({
    actors: {
      captain: fromPromise(async () => {
        throw new Error('Captain actor must be supplied by the runtime');
      }),
    },
    guards: {
      respond: selects('respond'),
      resume: selects('resume'),
      start: selects('start'),
      switch: selects('switch'),
      dismiss: selects('dismiss'),
      deliver: selects('deliver'),
      runtime: selects('runtime'),
    },
  }).createMachine({
    id: 'syntheticController',
    initial: 'ready',
    context: {},
    states: {
      ready: {
        id: 'ready',
        tags: 'playbook.parked',
        on: { GO: { target: '#decision' } },
      },
      decision: {
        id: 'decision',
        tags: 'playbook.busy',
        meta: {
          playbook: {
            stateId: 'decision',
            description: 'Selecting a controller action',
          },
        },
        invoke: {
          src: 'captain',
          input: () => ({
            stateId: 'decision',
            sourceItem: 'SYNTHETIC-DIRECT-1',
            prompt: 'Answer the synthetic request.',
            result,
          }),
          onDone: CONTROLLER_ACTION_GUARDS.map((guard) => ({
            target: '#ready',
            guard,
          })),
          onError: { target: '#failed' },
        },
      },
      failed: {
        id: 'failed',
        tags: 'playbook.parked',
        on: { GO: { target: '#decision' } },
      },
      done: { id: 'done', type: 'final' },
    },
  } as never);
  return {
    gears: rolelessSchema3Gears,
    fsm: { machine, concurrentRoleSets: [] },
    playbook: {},
  };
}

function withSchema3Runtime(
  compiled: CompiledPlaybook,
  fixture: ReturnType<typeof schema3Fixture>,
): CompiledPlaybook {
  return {
    ...compiled,
    playbook: fixture.playbook,
    registry: fixture.registry,
    linkTargetProvenance: playbook10Provenance,
  };
}

function schema3ProfileOptions(
  fixture: ReturnType<typeof schema3Fixture>,
  ...configuredOptions: [] | [unknown]
): {
  provenance: string;
  registry: unknown;
  configuredOptions?: unknown;
} {
  return {
    provenance: playbook10Provenance,
    registry: fixture.registry,
    ...(configuredOptions.length === 0
      ? {}
      : { configuredOptions: configuredOptions[0] }),
  };
}

describe('reference equivalence harness (verification-9)', () => {
  it('accepts the reference compared to itself', async () => {
    const reference = await loadReference();
    expect(
      await checkReferenceEquivalence({ produced: reference, reference }),
    ).toEqual([]);
  });

  it('accepts each matching exact runtime contract profile', async () => {
    const reference = await loadReference();
    for (const profile of ['legacy', 'session-v1', 'composed-v2'] as const) {
      const compiled = withRuntimeProfile(reference, profile);
      expect(await runtimeCapabilityProfile(compiled.playbook)).toBe(profile);
      expect(
        await checkReferenceEquivalence({
          produced: compiled,
          reference: compiled,
        }),
      ).toEqual([]);
    }
  });

  it.each([
    ['legacy', 'session-v1'],
    ['session-v1', 'composed-v2'],
    ['legacy', 'composed-v2'],
  ] as const)(
    'rejects a %s vs %s runtime contract mismatch',
    async (producedProfile, referenceProfile) => {
      const reference = await loadReference();
      const findings = await checkReferenceEquivalence({
        produced: withRuntimeProfile(reference, producedProfile),
        reference: withRuntimeProfile(reference, referenceProfile),
      });
      expect(findings).toContain(
        `runtime contract profiles differ: produced ${producedProfile} vs reference ${referenceProfile}`,
      );
    },
  );

  it('detects the composed profile on the released reference runtime', async () => {
    const reference = await loadReference();
    expect(await runtimeCapabilityProfile(reference.playbook)).toBe(
      'composed-v2',
    );
  });

  it('distinguishes unmarked legacy and session-v1 init boundaries', async () => {
    expect(
      await runtimeCapabilityProfile(unmarkedStrictRuntime('legacy')),
    ).toBe('legacy');
    expect(
      await runtimeCapabilityProfile(unmarkedStrictRuntime('session-v1')),
    ).toBe('session-v1');
  });

  it('supplies the exact six-port composed-v2 probe boundary', async () => {
    expect(
      await runtimeCapabilityProfile(unmarkedStrictComposedRuntime()),
    ).toBe('composed-v2');
  });

  it.each([
    [
      'session-v1 with a resumable surface',
      {
        runtimeContractProfile: 'session-v1',
        default: () => ({
          init: async () => {},
          handleBossInput: async () => {},
          resumePlaybookCall: async () => {},
          dispose: async () => {},
        }),
      },
      'session-v1 runtime unexpectedly exposes resumePlaybookCall()',
    ],
    [
      'composed-v2 without a resumable surface',
      {
        runtimeContractProfile: 'composed-v2',
        default: () => ({
          init: async () => {},
          handleBossInput: async () => {},
          dispose: async () => {},
        }),
      },
      'composed-v2 runtime lacks resumePlaybookCall()',
    ],
  ] as const)(
    'rejects an inconsistent marker: %s',
    async (_name, playbook, expected) => {
      const reference = await loadReference();
      const compiled = { ...reference, playbook };
      expect(await runtimeCapabilityProfile(playbook)).toBeNull();
      expect(await checkPlaybookIntegrity('marked', compiled)).toContain(
        `marked: ${expected}`,
      );
    },
  );

  it('recognizes shared and bespoke composed-v3 registries', async () => {
    for (const kind of ['shared-factory', 'bespoke'] as const) {
      const fixture = schema3Fixture({ kind });

      expect(
        await runtimeCapabilityProfile(
          fixture.playbook,
          schema3ProfileOptions(fixture),
        ),
      ).toBe('composed-v3');
      expect(fixture.observations).toEqual({ turns: 1, disposals: 1 });
    }
  });

  it('loads a source registry through comparison-owned linked-factory interposition', async () => {
    const entryPath = join(
      repoRoot,
      'test/fixtures/schema-3-entry-fixture.mjs',
    );
    const linkedPath = join(
      repoRoot,
      'test/fixtures/workflow.playbook/workflow.playbook.ts',
    );
    const loaded = await loadInterposedSchema3Registry(
      entryPath,
      linkedPath,
      await loadFsmModule(linkedPath),
    );

    expect(
      await runtimeCapabilityProfile(loaded.playbook, {
        provenance: playbook10Provenance,
        artifactSchema: 3,
        registry: loaded.registry,
      }),
    ).toBe('composed-v3');
  });

  it('does not probe an unaccompanied exact schema-3 factory as composed-v2', async () => {
    const historical = await loadReference();
    const playbook = unmarkedStrictComposedRuntime() as {
      default: (...args: unknown[]) => unknown;
    };
    Object.defineProperty(playbook.default, 'compat', {
      value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
      enumerable: true,
      writable: false,
      configurable: false,
    });

    expect(
      await checkPlaybookIntegrity('unaccompanied', {
        ...historical,
        playbook,
        linkTargetProvenance: undefined,
      }),
    ).toContain(
      'unaccompanied: artifact schema signals disagree (FSM historical-player structure: 1, linked factory compatibility: 3)',
    );
  });

  it('uses the loaded Roles contract to reject schema-3 output missing its registry closure', async () => {
    const compiled = {
      ...syntheticSchema3Compilation(),
      playbook: unmarkedStrictComposedRuntime(),
    };

    expect(await checkPlaybookIntegrity('unaccompanied', compiled)).toContain(
      'unaccompanied: composed-v3 requires exact @sublang/playbook@10.0.0 provenance',
    );
  });

  it('rejects runtime-profile schema signals that disagree with FSM actor bindings', async () => {
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
    });
    const findings = await checkPlaybookIntegrity('conflicted', {
      ...withSchema3Runtime(syntheticSchema3Compilation(), fixture),
      linkTargetProvenance: '@sublang/playbook@4.0.0',
    });

    expect(findings.join('\n')).toMatch(
      /conflicted: artifact schema signals disagree \(reviewed link-target provenance: 1, FSM role\/controller structure: 3, linked factory compatibility: 3\)/,
    );
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it('does not use a registry artifactSchema self-declaration as schema evidence', async () => {
    const historical = await loadReference();
    const fixture = schema3Fixture({ kind: 'bespoke', interpose: false });
    const findings = await checkPlaybookIntegrity('self-declared', {
      ...historical,
      playbook: fixture.playbook,
      registry: fixture.registry,
    });

    expect(findings).toContain(
      'self-declared: schema-3 registry conflicts with selected artifact schema 1',
    );
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it('reports a recognized-vs-unrecognized runtime profile mismatch', async () => {
    const schema3 = syntheticSchema3Compilation();
    const referenceFixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
    });
    const findings = await checkReferenceEquivalence({
      produced: { ...schema3, playbook: unmarkedStrictComposedRuntime() },
      reference: withSchema3Runtime(schema3, referenceFixture),
    });

    expect(findings).toContain(
      'runtime contract profiles differ: produced unrecognized vs reference composed-v3',
    );
  });

  it('accepts an exact mutable outer profile with frozen shared compatibility', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });
    const profile = fixture.registry.runtimeProfile as Record<string, unknown>;
    fixture.registry.runtimeProfile = {
      kind: profile.kind,
      compat: profile.compat,
    };

    expect(Object.isFrozen(fixture.registry.runtimeProfile)).toBe(false);
    expect(Object.isFrozen(profile.compat)).toBe(true);
    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBe('composed-v3');
  });

  it('accepts a host-supported optional schema-3 registry summary policy', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });
    fixture.registry.summaryPolicy = Object.freeze({
      stateCountLabels: Object.freeze({ done: 'completed rounds' }),
      copyPasteGuardNames: Object.freeze(['done']),
      savedCountsLine: () => 'Saved synthetic work.',
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBe('composed-v3');
  });

  it('rejects a malformed optional schema-3 registry summary policy', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });
    fixture.registry.summaryPolicy = Object.freeze({
      stateCountLabels: Object.freeze({ done: 1 }),
      copyPasteGuardNames: Object.freeze(['done']),
      savedCountsLine: () => 'Saved synthetic work.',
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it.each([
    [
      'an arbitrary extra member',
      (registry: Record<string, unknown>) => {
        registry.playerAliases = Object.freeze({});
      },
    ],
    [
      'an id/command mismatch',
      (registry: Record<string, unknown>) => {
        registry.command = 'different-command';
      },
    ],
  ] as const)('rejects a schema-3 registry with %s', async (_label, mutate) => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });
    mutate(fixture.registry);

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it('rejects reordered duplicate schema-3 concurrent role sets', async () => {
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['coder', 'reviewer'],
      concurrentRoleSets: [
        ['coder', 'reviewer'],
        ['reviewer', 'coder'],
      ],
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it('initializes but does not drive a role-bearing composed-v3 registry', async () => {
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBe('composed-v3');
    expect(fixture.observations).toEqual({ turns: 0, disposals: 1 });
  });

  it.each([
    [
      'zero-call',
      'registry createRuntime invoked the linked factory 0 times, expected exactly once',
    ],
    [
      'two-call',
      'registry createRuntime invoked the linked factory 2 times, expected exactly once',
    ],
    [
      'two-argument-construction',
      'linked factory was not called with exactly one construction argument',
    ],
    [
      'suppressed-construction-failure',
      'registry createRuntime suppressed a linked-factory construction failure',
    ],
    [
      'extra-construction',
      'linked factory construction is not exact own-data { configuredOptions, hostCapabilities }',
    ],
    [
      'restored-malformed-construction',
      'linked factory construction is not exact own-data { configuredOptions, hostCapabilities }',
    ],
    [
      'restored-configured-options-drift',
      'linked factory received configured options that drifted at call time',
    ],
    [
      'restored-host-capabilities-drift',
      'linked factory received host capabilities that drifted at call time',
    ],
    [
      'replacement',
      'registry createRuntime did not return the linked factory runtime directly',
    ],
    [
      'proxy',
      'registry createRuntime did not return the linked factory runtime directly',
    ],
  ] as const)(
    'rejects a schema-3 registry with %s linked-factory wiring',
    async (entryMode, diagnostic) => {
      const fixture = schema3Fixture({
        kind: 'shared-factory',
        roles: ['worker'],
        entryMode,
      });

      expect(
        await checkPlaybookIntegrity(
          'wiring',
          withSchema3Runtime(syntheticSchema3Compilation(), fixture),
        ),
      ).toContain(`wiring: composed-v3 runtime probe failed: ${diagnostic}`);
      expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
    },
  );

  it('rejects a shared schema-3 registry loaded without comparison-owned factory interposition', async () => {
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      interpose: false,
    });

    expect(
      await runtimeCapabilityProfile(fixture.playbook, {
        provenance: playbook10Provenance,
        registry: fixture.registry,
      }),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it('accepts a bespoke schema-3 registry without linked-factory interposition', async () => {
    const fixture = schema3Fixture({ kind: 'bespoke', interpose: false });

    expect(
      await runtimeCapabilityProfile(fixture.playbook, {
        provenance: playbook10Provenance,
        registry: fixture.registry,
      }),
    ).toBe('composed-v3');
    expect(fixture.observations).toEqual({ turns: 1, disposals: 1 });
  });

  it('accepts an exact roleless schema-3 compiled closure', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });

    expect(
      await checkPlaybookIntegrity(
        'roleless',
        withSchema3Runtime(syntheticSchema3Compilation(true), fixture),
      ),
    ).toEqual([]);
    expect(fixture.observations).toEqual({ turns: 1, disposals: 1 });
  });

  it('rejects an absent FSM concurrent-role export for an empty schema-3 closure', async () => {
    const schema3 = syntheticSchema3Compilation();
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
    });
    const fsm = { ...(schema3.fsm as Record<string, unknown>) } as {
      concurrentRoleSets?: unknown;
      machine: unknown;
    };
    delete fsm.concurrentRoleSets;

    expect(
      await checkPlaybookIntegrity(
        'empty-cohort',
        withSchema3Runtime({ ...schema3, fsm }, fixture),
      ),
    ).toContain(
      'empty-cohort: schema-3 FSM exports no valid registry-matching concurrentRoleSets array',
    );
  });

  it('compares matching nonempty validated schema-3 option slices', async () => {
    const schema3 = syntheticSchema3Compilation();
    const validateOptions = (value: unknown) => {
      const mode = (value as { mode?: unknown } | undefined)?.mode;
      if (mode !== 'strict') throw new Error('mode must be strict');
      return { mode };
    };
    const producedFixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      validateOptions,
    });
    const referenceFixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      validateOptions,
    });

    expect(
      await checkReferenceEquivalence({
        produced: withSchema3Runtime(schema3, producedFixture),
        reference: withSchema3Runtime(schema3, referenceFixture),
        configuredOptions: { mode: 'strict' },
      }),
    ).toEqual([]);
  });

  it('rejects unequal validated schema-3 option slices', async () => {
    const schema3 = syntheticSchema3Compilation();
    const producedFixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      validateOptions: () => ({ mode: 'strict' }),
    });
    const referenceFixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      validateOptions: () => ({ mode: 'relaxed' }),
    });
    const findings = await checkReferenceEquivalence({
      produced: withSchema3Runtime(schema3, producedFixture),
      reference: withSchema3Runtime(schema3, referenceFixture),
      configuredOptions: { mode: 'requested' },
    });

    expect(findings).toContain(
      'schema-3 validated options differ: produced {"mode":"strict"} vs reference {"mode":"relaxed"}',
    );
  });

  it('rejects a shared-factory versus bespoke schema-3 pair', async () => {
    const schema3 = syntheticSchema3Compilation();
    const shared = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
    });
    const bespoke = schema3Fixture({ kind: 'bespoke', roles: ['worker'] });
    const findings = await checkReferenceEquivalence({
      produced: withSchema3Runtime(schema3, shared),
      reference: withSchema3Runtime(schema3, bespoke),
    });

    expect(findings).toContain(
      'schema-3 runtime implementations differ: produced shared-factory vs reference bespoke',
    );
  });

  it('rejects produced and reference controller-classification drift', async () => {
    const producedFixture = schema3Fixture({ kind: 'shared-factory' });
    const referenceFixture = schema3Fixture({ kind: 'shared-factory' });
    const produced = withSchema3Runtime(
      syntheticControllerCompilation(),
      producedFixture,
    );
    const reference = withSchema3Runtime(
      syntheticSchema3Compilation(true),
      referenceFixture,
    );

    expect(await checkPlaybookIntegrity('produced', produced)).toEqual([]);
    expect(await checkPlaybookIntegrity('reference', reference)).toEqual([]);

    const findings = await checkReferenceEquivalence({
      produced,
      reference,
    });

    expect(findings).toEqual([
      'controller classifications differ: produced controller vs reference ordinary',
    ]);
  });

  it('keeps controller near-miss diagnostics free of ordinary Boss-surface advice', async () => {
    const producedFixture = schema3Fixture({ kind: 'shared-factory' });
    const referenceFixture = schema3Fixture({ kind: 'shared-factory' });
    const produced = withSchema3Runtime(
      syntheticControllerCompilation('missing-action'),
      producedFixture,
    );
    const reference = withSchema3Runtime(
      syntheticControllerCompilation('missing-action'),
      referenceFixture,
    );
    const findings = await checkReferenceEquivalence({ produced, reference });

    expect(findings.join('\n')).toMatch(
      /controller decision contract near-miss \(missing "runtime"\)/,
    );
    expect(findings).not.toContain(
      'produced: machine declares no BOSS_INTERRUPT targets',
    );
    expect(findings).not.toContain(
      'produced: machine declares no Boss-reply wait state',
    );
    expect(findings).not.toContain(
      'reference: machine declares no BOSS_INTERRUPT targets',
    );
    expect(findings).not.toContain(
      'reference: machine declares no Boss-reply wait state',
    );
  });

  it('rejects a composed-v3 registry mixed with the historical schema-1 closure', async () => {
    const historical = await loadReference();
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
    });

    expect(
      await checkPlaybookIntegrity(
        'mixed',
        withSchema3Runtime(historical, fixture),
      ),
    ).toContain(
      'mixed: artifact schema signals disagree (reviewed link-target provenance: 3, FSM historical-player structure: 1, linked factory compatibility: 3)',
    );
  });

  it('rejects schema-3 registry role and FSM cohort drift', async () => {
    const schema3 = syntheticSchema3Compilation();
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['reviewer'],
    });
    const fsm = schema3.fsm as Record<string, unknown>;
    const findings = await checkPlaybookIntegrity(
      'drifted',
      withSchema3Runtime(
        {
          ...schema3,
          fsm: {
            ...fsm,
            concurrentRoleSets: [['worker', 'worker']],
          },
        },
        fixture,
      ),
    );

    expect(findings).toContain(
      'drifted: schema-3 registry requiredRoleIds ["reviewer"] do not match GEARS roles ["worker"]',
    );
    expect(findings).toContain(
      'drifted: schema-3 FSM exports no valid registry-matching concurrentRoleSets array',
    );
  });

  it.each(
    (['shared-factory', 'bespoke'] as const).flatMap((kind) =>
      (['legacy', 'session-v1', 'composed-v2'] as const).map(
        (historicalProfile) => [kind, historicalProfile] as const,
      ),
    ),
  )(
    'rejects a composed-v3 %s versus historical %s profile pair',
    async (kind, historicalProfile) => {
      const reference = await loadReference();
      const schema3 = syntheticSchema3Compilation();
      const fixture = schema3Fixture({
        kind,
        roles: ['worker'],
      });
      const findings = await checkReferenceEquivalence({
        produced: withSchema3Runtime(schema3, fixture),
        reference: withRuntimeProfile(reference, historicalProfile),
      });

      expect(findings).toContain(
        `runtime contract profiles differ: produced composed-v3 vs reference ${historicalProfile}`,
      );
    },
  );

  it('passes a detached copy of the comparison option slice to validation', async () => {
    const configuredOptions = { mode: 'strict' };
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      validateOptions(value) {
        (value as { mode: string }).mode = 'validated';
        return value;
      },
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture, configuredOptions),
      ),
    ).toBe('composed-v3');
    expect(configuredOptions).toEqual({ mode: 'strict' });
  });

  it.each([
    [
      'validator rejection',
      () => {
        throw new Error('rejected configured options');
      },
    ],
    ['non-plain result', () => new Date(0)],
  ] as const)('rejects schema-3 %s', async (_label, validateOptions) => {
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      validateOptions,
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it('requires exact Playbook 10 provenance for a schema-3 registry', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });

    expect(
      await runtimeCapabilityProfile(fixture.playbook, {
        provenance: '@sublang/playbook@9.0.0',
        registry: fixture.registry,
      }),
    ).toBeNull();
    expect(
      await runtimeCapabilityProfile(fixture.playbook, {
        registry: fixture.registry,
      }),
    ).toBeNull();
  });

  it('rejects a historical marker on an exact schema-3 registry boundary', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });
    fixture.playbook = {
      ...(fixture.playbook as object),
      runtimeContractProfile: 'composed-v2',
    };

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it.each([
    [
      'mismatched shared compat',
      (fixture: ReturnType<typeof schema3Fixture>) => {
        fixture.registry.runtimeProfile = Object.freeze({
          kind: 'shared-factory',
          compat: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
        });
      },
    ],
    [
      'bespoke ABI claim',
      (fixture: ReturnType<typeof schema3Fixture>) => {
        fixture.registry.runtimeProfile = Object.freeze({
          kind: 'bespoke',
          artifactSchema: 3,
          runtimeAbi: 1,
        });
      },
    ],
    [
      'bespoke profile on a shared factory',
      (fixture: ReturnType<typeof schema3Fixture>) => {
        fixture.registry.runtimeProfile = Object.freeze({
          kind: 'bespoke',
          artifactSchema: 3,
        });
      },
    ],
  ] as const)(
    'rejects a schema-3 declaration with %s',
    async (_label, mutate) => {
      const fixture = schema3Fixture({
        kind: _label === 'bespoke ABI claim' ? 'bespoke' : 'shared-factory',
      });
      mutate(fixture);

      expect(
        await runtimeCapabilityProfile(
          fixture.playbook,
          schema3ProfileOptions(fixture),
        ),
      ).toBeNull();
      expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
    },
  );

  it.each(['missing', 'mutable', 'accessor'] as const)(
    'rejects %s shared-factory compatibility',
    async (compatMode) => {
      const fixture = schema3Fixture({
        kind: 'shared-factory',
        compatMode,
      });

      expect(
        await runtimeCapabilityProfile(
          fixture.playbook,
          schema3ProfileOptions(fixture),
        ),
      ).toBeNull();
      expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
    },
  );

  it('rejects an accessor-backed schema-3 implementation declaration', async () => {
    const fixture = schema3Fixture({ kind: 'shared-factory' });
    const registry = { ...fixture.registry };
    Object.defineProperty(registry, 'runtimeProfile', {
      get: () => fixture.registry.runtimeProfile,
      enumerable: true,
      configurable: true,
    });

    expect(
      await runtimeCapabilityProfile(fixture.playbook, {
        provenance: playbook10Provenance,
        registry,
      }),
    ).toBeNull();
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it.each(['player', 'repository', 'ledger'] as const)(
    'rejects a roleless schema-3 probe that invokes a governed %s effect',
    async (effect) => {
      const fixture = schema3Fixture({ kind: 'shared-factory', effect });

      expect(
        await runtimeCapabilityProfile(
          fixture.playbook,
          schema3ProfileOptions(fixture),
        ),
      ).toBeNull();
      expect(fixture.observations).toEqual({ turns: 1, disposals: 1 });
    },
  );

  it.each(['non-plain', 'extra', 'accessor', 'mismatched'] as const)(
    'rejects %s live schema-3 capabilities before runtime construction',
    async (drift) => {
      const fixture = schema3Fixture({ kind: 'shared-factory' });
      const createRuntime = fixture.registry.createRuntime as (
        options: unknown,
        capabilities: unknown,
      ) => unknown;
      fixture.registry.createRuntime = (
        configuredOptions: unknown,
        capabilities: unknown,
      ) => {
        const exact = capabilities as {
          authority: Record<string, unknown>;
          repository: unknown;
          effectLedger: unknown;
        };
        let drifted: unknown;
        if (drift === 'non-plain') {
          drifted = Object.create(exact);
        } else if (drift === 'extra') {
          drifted = { ...exact, extra: true };
        } else if (drift === 'mismatched') {
          drifted = {
            ...exact,
            authority: { ...exact.authority, playbookId: 'wrong' },
          };
        } else {
          drifted = {
            repository: exact.repository,
            effectLedger: exact.effectLedger,
          };
          Object.defineProperty(drifted, 'authority', {
            get: () => exact.authority,
            enumerable: true,
          });
        }
        return createRuntime(configuredOptions, drifted);
      };

      expect(
        await checkPlaybookIntegrity(
          'drifted',
          withSchema3Runtime(syntheticSchema3Compilation(true), fixture),
        ),
      ).toContain(
        'drifted: composed-v3 runtime probe failed: linked factory did not receive live host capabilities by exact identity',
      );
      expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
    },
  );

  it('rejects a shared registry that does not pass its exact validated options', async () => {
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      roles: ['worker'],
      validateOptions: () => ({ mode: 'strict' }),
    });
    const createRuntime = fixture.registry.createRuntime as (
      options: unknown,
      capabilities: unknown,
    ) => unknown;
    fixture.registry.createRuntime = (
      options: unknown,
      capabilities: unknown,
    ) => createRuntime({ ...(options as object) }, capabilities);

    expect(
      await checkPlaybookIntegrity(
        'drifted',
        withSchema3Runtime(syntheticSchema3Compilation(true), fixture),
        { configuredOptions: { mode: 'strict' } },
      ),
    ).toContain(
      'drifted: composed-v3 runtime probe failed: linked factory did not receive validated options by exact identity',
    );
    expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
  });

  it.each([
    ['missing init', 'init', undefined],
    ['non-callable turn', 'handleBossInput', true],
    ['missing resume', 'resumePlaybookCall', undefined],
    ['non-callable dispose', 'dispose', 'dispose'],
  ] as const)(
    'rejects a schema-3 runtime with %s',
    async (_label, member, replacement) => {
      const fixture = schema3Fixture({
        kind: 'shared-factory',
        runtimePatch(runtime) {
          if (replacement === undefined) delete runtime[member];
          else runtime[member] = replacement;
        },
      });

      expect(
        await runtimeCapabilityProfile(
          fixture.playbook,
          schema3ProfileOptions(fixture),
        ),
      ).toBeNull();
      expect(fixture.observations).toEqual({ turns: 0, disposals: 0 });
    },
  );

  it('accepts the complete valid schema-3 optional surface', async () => {
    let adoptionCalls = 0;
    let controlCalls = 0;
    let unresolvedInspections = 0;
    const fixture = schema3Fixture({
      kind: 'shared-factory',
      runtimePatch(runtime) {
        runtime.exportSnapshot = () => undefined;
        runtime.restore = async () => {};
        runtime.adopt = async () => {
          adoptionCalls += 1;
        };
        runtime.retainedGenerationMetadata = {
          unfinishedFinalStateIds: ['unfinished'],
        };
        runtime.describe = () => {
          controlCalls += 1;
          return {};
        };
        runtime.apply = async () => {
          controlCalls += 1;
          return { disposition: 'rejected', reason: 'unused' };
        };
        runtime.unresolvedEffectEnvelopes = () => {
          unresolvedInspections += 1;
          return [
            { kind: 'boundary', boundaryId: 'boundary-1' },
            {
              kind: 'logical-operation',
              operationId: 'operation-1',
            },
          ];
        };
      },
    });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBe('composed-v3');
    expect(adoptionCalls).toBe(0);
    expect(controlCalls).toBe(0);
    expect(unresolvedInspections).toBe(1);
  });

  it.each([
    ['unpaired snapshot', { exportSnapshot: () => undefined }],
    ['unpaired restore', { restore: async () => {} }],
    ['non-callable adoption', { adopt: true }],
    [
      'malformed retained metadata',
      { retainedGenerationMetadata: { unfinishedFinalStateIds: [7] } },
    ],
    ['unpaired control surface', { describe: () => ({}) }],
    [
      'unpaired control application',
      {
        apply: async () => ({ disposition: 'rejected', reason: 'unused' }),
      },
    ],
    [
      'invalid unresolved envelope',
      {
        unresolvedEffectEnvelopes: () => [{ kind: 'boundary', boundaryId: 7 }],
      },
    ],
  ] as const)(
    'rejects a schema-3 runtime with %s',
    async (_label, additions) => {
      const fixture = schema3Fixture({
        kind: 'shared-factory',
        runtimePatch(runtime) {
          Object.assign(runtime, additions);
        },
      });

      expect(
        await runtimeCapabilityProfile(
          fixture.playbook,
          schema3ProfileOptions(fixture),
        ),
      ).toBeNull();
    },
  );

  it.each([
    {
      outcome: 'terminal',
      state: profileState,
      stateDescription: 7,
    },
    {
      outcome: 'no-action',
      state: profileState,
      stateDescription: 'terminal only',
    },
    { outcome: 'unresolved-effect', state: profileState, extra: true },
  ])('rejects a malformed schema-3 driven result %#', async (result) => {
    const fixture = schema3Fixture({ kind: 'shared-factory', result });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBeNull();
  });

  it.each([
    {
      outcome: 'terminal',
      state: profileState,
      stateDescription: 'complete',
      output: { ok: true },
    },
    { outcome: 'unresolved-effect', state: profileState },
  ])('accepts a profile-exact schema-3 driven result %#', async (result) => {
    const fixture = schema3Fixture({ kind: 'shared-factory', result });

    expect(
      await runtimeCapabilityProfile(
        fixture.playbook,
        schema3ProfileOptions(fixture),
      ),
    ).toBe('composed-v3');
  });

  it('recognizes a branch-local structured Boss-reply wait surface', () => {
    expect(
      hasBossReplySurface({
        states: {
          parallel: {
            type: 'parallel',
            states: {
              branch: {
                states: {
                  waiting: {
                    id: 'waitBranchReply',
                    tags: 'playbook.parked',
                    on: { BOSS_REPLY: { target: 'working' } },
                  },
                },
              },
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('rejects a compilation that drops or rewrites a prompt line', async () => {
    const reference = await loadReference();
    const drifted: CompiledPlaybook = {
      ...reference,
      gears: reference.gears.replaceAll(
        "> Think thoroughly — don't just approve or reject.",
        '> Think about it.',
      ),
    };
    const findings = await checkReferenceEquivalence({
      produced: drifted,
      reference,
    });
    expect(findings.join('\n')).toMatch(/lacks the line/);
    expect(findings.join('\n')).toMatch(/adds the line "Think about it\."/);
  });

  it('rejects a compilation that loses a player', async () => {
    const reference = await loadReference();
    const drifted: CompiledPlaybook = {
      ...reference,
      gears: reference.gears.replaceAll('Committer', 'Reviewer'),
    };
    const findings = await checkReferenceEquivalence({
      produced: drifted,
      reference,
    });
    expect(findings.join('\n')).toMatch(/player sets differ/);
  });

  it('binds the reference prompt lines to Coder, Reviewer, and Committer', async () => {
    const reference = await loadReference();
    const players = [...playerLineSets(reference.gears).keys()].sort();
    expect(players).toEqual(['Coder', 'Committer', 'Reviewer']);
  });

  it('keys nested calls by playbook target rather than Captain', () => {
    const nested = (target: string) => `## Behaviors

### FLOW-1

When review is needed, Captain shall call playbook \`${target}\`:
> Review the current changes.
`;
    expect([...playerLineSets(nested('code-review')).keys()]).toEqual([
      'playbook:code-review',
    ]);
    expect([...playerLineSets(nested('security-review')).keys()]).toEqual([
      'playbook:security-review',
    ]);

    const dynamic = `## Behaviors

### FLOW-2

When routing is needed, Captain shall call playbook selected by \`nextPlaybookId\`:
> <nextPlaybookInput>
`;
    expect([...playerLineSets(dynamic).keys()]).toEqual([
      'playbook-context:nextPlaybookId:nextPlaybookInput',
    ]);
  });

  it('keys schema-3 prompts by canonical local role', () => {
    const roleful = `Roles:

- Coder
- Reviewer

### FLOW-1

Captain shall prompt Coder:
> Draft it.

### FLOW-2

Captain shall prompt Reviewer:
> Review it.
`;
    expect([...playerLineSets(roleful).keys()]).toEqual([
      'role:coder',
      'role:reviewer',
    ]);
  });

  // The real acceptance: `slc playbook <source>` output compared to the manual
  // reference under verification-9 and DR-009. Gated on a produced directory —
  // a real agent compile — so a clean checkout skips rather than fails.
  it('accepts real slc playbook output when produced (gated)', async (context) => {
    const producedDir =
      process.env.SLC_EQUIVALENCE_DIR ??
      join(repoRoot, '.scratch/sdlc/code.playbook');
    if (!existsSync(join(producedDir, 'code.playbook.ts'))) {
      console.warn(
        `equivalence: no produced output at ${producedDir}; run \`slc playbook <code.md> --link @sublang/playbook\` there first`,
      );
      context.skip();
      return;
    }
    const produced = await loadProduced(producedDir);
    const reference = await loadReference();
    expect(await checkReferenceEquivalence({ produced, reference })).toEqual(
      [],
    );
  });
});

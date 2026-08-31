// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PlaybookPorts } from '@sublang/playbook/runtime';

import { createCompiledExecutor } from '../src/compiled-executor.js';
import type { ExecuteRequest } from '../src/execution.js';
import type { AgentClient } from '../src/interpreter.js';
import { isPlaybookRunResult } from '../src/playbook-contract.js';

const execFileAsync = promisify(execFile);

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'phase-fixture.mjs',
);
const composedV3Fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'phase-v3-fixture.mjs',
);

// An agent transport that is never invoked by the fixture (it only does file IO),
// present to satisfy the ports adapter.
const idleAgent: AgentClient = {
  async run() {
    return { status: 'success', text: '' };
  },
};

const structuredState = {
  value: 'ready',
  activeStateIds: ['ready'],
  tags: ['playbook.parked'],
  status: 'active' as const,
  quiescent: true,
  stateId: 'ready',
};
const sparseJson: unknown[] = [];
sparseJson.length = 1;
const accessorJson = Object.defineProperty({}, 'secret', {
  enumerable: true,
  get: () => 'hidden',
});
const symbolJson = { [Symbol('secret')]: 'hidden' };

describe('structured PlaybookRunResult validation', () => {
  it('rejects fields owned by another outcome variant', () => {
    const pendingCall = {
      callId: 'call-1',
      playbookId: 'child',
      childSessionId: 'child-session',
    };
    for (const result of [
      { outcome: 'quiescent', state: structuredState, output: 'wrong' },
      { outcome: 'no-action', state: structuredState, pendingCall },
      { outcome: 'failed', state: structuredState, output: 'wrong' },
      { outcome: 'terminal', state: structuredState, pendingCall },
      { outcome: 'suspended', state: structuredState, pendingCall, output: 1 },
    ]) {
      expect(isPlaybookRunResult(result)).toBe(false);
    }
  });

  it('rejects coerced status values and hostile result accessors', () => {
    expect(
      isPlaybookRunResult({
        outcome: 'quiescent',
        state: {
          ...structuredState,
          status: { toString: () => 'active' },
        },
      }),
    ).toBe(false);

    const accessor = Object.defineProperty({}, 'outcome', {
      enumerable: true,
      get() {
        throw new Error('do not read me');
      },
    });
    expect(() => isPlaybookRunResult(accessor)).not.toThrow();
    expect(isPlaybookRunResult(accessor)).toBe(false);

    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('hostile proxy');
        },
      },
    );
    expect(() => isPlaybookRunResult(proxy)).not.toThrow();
    expect(isPlaybookRunResult(proxy)).toBe(false);
  });

  it.each(['activeStateIds', 'tags'] as const)(
    'rejects sparse, accessor-backed, and extra-property %s arrays in both composed profiles',
    (field) => {
      const sparse: string[] = [];
      sparse.length = 1;
      const accessor: string[] = [];
      Object.defineProperty(accessor, '0', {
        get: () => 'ready',
        enumerable: true,
        configurable: true,
      });
      const extra = Object.assign(['ready'], { extra: 'not array data' });

      for (const profile of ['composed-v2', 'composed-v3'] as const) {
        for (const value of [sparse, accessor, extra]) {
          expect(
            isPlaybookRunResult(
              {
                outcome: 'quiescent',
                state: { ...structuredState, [field]: value },
              },
              profile,
            ),
          ).toBe(false);
        }
      }
    },
  );

  it.each(['data', 'accessor'] as const)(
    'rejects a non-enumerable %s member in recursive state and terminal output',
    (kind) => {
      const hiddenRecord = (): Record<string, unknown> => {
        const value: Record<string, unknown> = {};
        Object.defineProperty(
          value,
          'hidden',
          kind === 'data'
            ? { value: 'secret', enumerable: false }
            : { get: () => 'secret', enumerable: false },
        );
        return value;
      };

      for (const profile of ['composed-v2', 'composed-v3'] as const) {
        expect(
          isPlaybookRunResult(
            {
              outcome: 'quiescent',
              state: { ...structuredState, value: hiddenRecord() },
            },
            profile,
          ),
        ).toBe(false);
        expect(
          isPlaybookRunResult(
            {
              outcome: 'terminal',
              state: structuredState,
              output: hiddenRecord(),
            },
            profile,
          ),
        ).toBe(false);
      }
    },
  );
});

// Integration: a compiled `playbook` artifact driven non-interactively through
// the executor over a fixture run root (phase-execution-26).
describe('createCompiledExecutor (phase-execution-26)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-compiled-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fixtureExecutor = () =>
    createCompiledExecutor({
      artifactPath: fixture,
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
    });

  const runFixture = async (sourceContent: string) => {
    await writeFile(join(root, 'src.md'), sourceContent);
    const request: ExecuteRequest = {
      kind: 'compile',
      definitionPath: join(root, 'phase.md'),
      source: 'src.md',
      target: 'out.ts',
    };
    return fixtureExecutor().run(request, new AbortController().signal);
  };

  const runComposedV3Fixture = async (sourceContent: string) => {
    let playerTransports = 0;
    await writeFile(join(root, 'src.md'), sourceContent);
    const executor = createCompiledExecutor({
      artifactPath: composedV3Fixture,
      runRoot: root,
      runtimeContract: 'composed-v3',
      player: () => {
        playerTransports += 1;
        return idleAgent;
      },
      judge: idleAgent,
      createSessionId: () => 'schema-3-session',
      playbookId: 'schema-3-phase',
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );
    return { result, playerTransports };
  };

  it('constructs and drives the exact roleless composed-v3 phase-host boundary', async () => {
    // `root` is an isolated non-Git directory. The physical fixture itself
    // checks the exact factory descriptor and argument, detached synchronous
    // ledger snapshots, the authority-free capability shape, causal-root six
    // ports, and non-observation of the optional schema-3 control surface.
    const { result, playerTransports } =
      await runComposedV3Fixture('hello schema 3');

    expect(result).toEqual({ status: 'ok', diagnostics: [] });
    expect(playerTransports).toBe(0);
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe(
      'compiled-v3:hello schema 3',
    );
  });

  it('drives the same roleless composed-v3 fixture inside a Git worktree', async () => {
    await execFileAsync('git', ['init', '--quiet'], { cwd: root });

    const { result, playerTransports } = await runComposedV3Fixture(
      'hello schema 3 in git',
    );

    expect(result).toEqual({ status: 'ok', diagnostics: [] });
    expect(playerTransports).toBe(0);
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe(
      'compiled-v3:hello schema 3 in git',
    );
  });

  it.each([
    'missing',
    'bespoke',
    'inherited',
    'accessor',
    'writable',
    'configurable',
    'non-enumerable',
    'unfrozen',
    'non-enumerable-member',
    'wrong',
    'extra',
  ] as const)(
    'rejects a %s composed-v3 compatibility declaration before construction',
    async (kind) => {
      let constructions = 0;
      const factory = () => {
        constructions += 1;
        return {
          async init() {},
          async handleBossInput() {
            return { outcome: 'no-action', state: structuredState };
          },
          async dispose() {},
        };
      };
      const exact = Object.freeze({ artifactSchema: 3, runtimeAbi: 1 });
      const define = (
        descriptor: PropertyDescriptor,
        target: object = factory,
      ): void => {
        Object.defineProperty(target, 'compat', descriptor);
      };
      switch (kind) {
        case 'missing':
          break;
        case 'bespoke':
          Object.defineProperty(factory, 'runtimeProfile', {
            value: Object.freeze({ kind: 'bespoke', artifactSchema: 3 }),
            enumerable: true,
            writable: false,
            configurable: false,
          });
          break;
        case 'inherited': {
          const parent = Object.create(
            Object.getPrototypeOf(factory),
          ) as object;
          define(
            {
              value: exact,
              enumerable: true,
              writable: false,
              configurable: false,
            },
            parent,
          );
          Object.setPrototypeOf(factory, parent);
          break;
        }
        case 'accessor':
          define({ get: () => exact, enumerable: true, configurable: false });
          break;
        case 'writable':
          define({
            value: exact,
            enumerable: true,
            writable: true,
            configurable: false,
          });
          break;
        case 'configurable':
          define({
            value: exact,
            enumerable: true,
            writable: false,
            configurable: true,
          });
          break;
        case 'non-enumerable':
          define({
            value: exact,
            enumerable: false,
            writable: false,
            configurable: false,
          });
          break;
        case 'unfrozen':
          define({
            value: { artifactSchema: 3, runtimeAbi: 1 },
            enumerable: true,
            writable: false,
            configurable: false,
          });
          break;
        case 'non-enumerable-member': {
          const value = Object.defineProperties(
            {},
            {
              artifactSchema: {
                value: 3,
                enumerable: false,
                writable: false,
                configurable: false,
              },
              runtimeAbi: {
                value: 1,
                enumerable: true,
                writable: false,
                configurable: false,
              },
            },
          );
          define({
            value: Object.freeze(value),
            enumerable: true,
            writable: false,
            configurable: false,
          });
          break;
        }
        case 'wrong':
          define({
            value: Object.freeze({ artifactSchema: 3, runtimeAbi: 2 }),
            enumerable: true,
            writable: false,
            configurable: false,
          });
          break;
        case 'extra':
          define({
            value: Object.freeze({
              artifactSchema: 3,
              runtimeAbi: 1,
              inferred: true,
            }),
            enumerable: true,
            writable: false,
            configurable: false,
          });
          break;
      }

      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract: 'composed-v3',
        player: idleAgent,
        judge: idleAgent,
        loadFactory: async () => factory as never,
      });
      const result = await executor.run(
        {
          kind: 'compile',
          definitionPath: join(root, 'phase.md'),
          source: 'src.md',
          target: 'out.ts',
        },
        new AbortController().signal,
      );

      expect(result.status).toBe('error');
      expect(result.diagnostics.join('\n')).toMatch(
        /composed-v3|compat|artifactSchema|runtimeAbi/i,
      );
      expect(constructions).toBe(0);
    },
  );

  it.each(['options-only wrapper', 'required configured option'] as const)(
    'does not retry a composed-v3 factory that rejects the exact construction as %s',
    async (kind) => {
      let constructions = 0;
      const factory = (...args: unknown[]) => {
        constructions += 1;
        if (kind === 'options-only wrapper') {
          if (args.length !== 0) throw new Error('options-only wrapper');
        } else {
          const argument = args[0] as {
            configuredOptions?: { required?: unknown };
          };
          if (argument.configuredOptions?.required === undefined) {
            throw new Error('required configured option is absent');
          }
        }
        throw new Error('fixture accepted an unsupported construction');
      };
      Object.defineProperty(factory, 'compat', {
        value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
        enumerable: true,
        writable: false,
        configurable: false,
      });
      let playerTransports = 0;
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract: 'composed-v3',
        player: () => {
          playerTransports += 1;
          return idleAgent;
        },
        judge: idleAgent,
        loadFactory: async () => factory as never,
      });

      const result = await executor.run(
        {
          kind: 'compile',
          definitionPath: join(root, 'phase.md'),
          source: 'src.md',
          target: 'out.ts',
        },
        new AbortController().signal,
      );

      expect(result.status).toBe('error');
      expect(result.diagnostics.join('\n')).toContain(
        kind === 'options-only wrapper'
          ? 'options-only wrapper'
          : 'required configured option is absent',
      );
      expect(constructions).toBe(1);
      expect(playerTransports).toBe(0);
    },
  );

  it.each([
    ['AUTHORITY', /authority/i],
    ['REPOSITORY_EXCLUSIVE', /repository/i],
    ['REPOSITORY_DEFERRED', /repository/i],
    ['EFFECT_WRITE', /effect/i],
    ['PLAYER', /composed-v3|player|delegated role/i],
  ] as const)(
    'fails closed when a roleless composed-v3 fixture requests %s',
    async (sourceContent, diagnostic) => {
      const { result, playerTransports } =
        await runComposedV3Fixture(sourceContent);

      expect(result.status).toBe('error');
      expect(result.diagnostics.join('\n')).toMatch(diagnostic);
      expect(result.diagnostics.join('\n')).not.toContain(
        'repository operation was invoked',
      );
      expect(playerTransports).toBe(0);
    },
  );

  it.each([
    [
      'composed-v3 terminal stateDescription',
      'composed-v3',
      {
        outcome: 'terminal',
        state: structuredState,
        stateDescription: 'finished cleanly',
      },
      'ok',
      undefined,
    ],
    [
      'composed-v3 non-string stateDescription',
      'composed-v3',
      {
        outcome: 'terminal',
        state: structuredState,
        stateDescription: 7,
      },
      'error',
      /invalid run result/i,
    ],
    [
      'composed-v3 stateDescription on a non-terminal variant',
      'composed-v3',
      {
        outcome: 'quiescent',
        state: structuredState,
        stateDescription: 'not terminal',
      },
      'error',
      /invalid run result/i,
    ],
    [
      'composed-v3 unresolved effect',
      'composed-v3',
      { outcome: 'unresolved-effect', state: structuredState },
      'error',
      /unresolved.?effect/i,
    ],
    [
      'composed-v3 unresolved effect with an extra field',
      'composed-v3',
      {
        outcome: 'unresolved-effect',
        state: structuredState,
        error: { name: 'Error', message: 'not allowed' },
      },
      'error',
      /invalid run result/i,
    ],
    [
      'composed-v2 terminal stateDescription',
      'composed-v2',
      {
        outcome: 'terminal',
        state: structuredState,
        stateDescription: 'schema-3-only field',
      },
      'error',
      /invalid run result/i,
    ],
  ] as const)(
    'maps a %s profile-exact structured result',
    async (_name, runtimeContract, outcome, status, diagnostic) => {
      const target = join(root, 'out.ts');
      const factory = () => ({
        async init() {},
        async handleBossInput() {
          await writeFile(target, 'fresh');
          return outcome;
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      });
      Object.defineProperty(factory, 'compat', {
        value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
        enumerable: true,
        writable: false,
        configurable: false,
      });
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract,
        player: idleAgent,
        judge: idleAgent,
        loadFactory: async () => factory as never,
      });

      const result = await executor.run(
        {
          kind: 'compile',
          definitionPath: join(root, 'phase.md'),
          source: 'src.md',
          target,
        },
        new AbortController().signal,
      );

      expect(result.status).toBe(status);
      if (diagnostic !== undefined) {
        expect(result.diagnostics.join('\n')).toMatch(diagnostic);
      }
    },
  );

  it('seeds and drives a compile request through the fixture runtime (phase-execution-29)', async () => {
    const result = await runFixture('hello');
    expect(result.status).toBe('ok');
    // The runtime returns void; the only diagnostics are its drained status.
    expect(result.diagnostics).toEqual(['fixture wrote target']);
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe('compiled:hello');
  });

  it('seeds and drives a link request through the fixture runtime (phase-execution-29)', async () => {
    await writeFile(join(root, 'object.ts'), 'object');
    await writeFile(join(root, 'runtime.ts'), 'runtime');
    const result = await fixtureExecutor().run(
      {
        kind: 'link',
        definitionPath: join(root, 'link.md'),
        objects: ['object.ts'],
        linkTarget: 'runtime.ts',
        options: [],
        linked: 'linked.ts',
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('ok');
    expect(result.diagnostics).toEqual(['fixture wrote target']);
    expect(await readFile(join(root, 'linked.ts'), 'utf8')).toBe(
      'compiled:object',
    );
  });

  it('streams status live to a configured sink without duplicating diagnostics (phase-execution-37)', async () => {
    const streamed: string[] = [];
    let streamedDuringTurn = 0;
    let ports: PlaybookPorts | undefined;
    const target = join(root, 'out.ts');
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      onStatus: (line) => streamed.push(line),
      loadFactory: async () => () => ({
        async init(value) {
          ports = value as PlaybookPorts;
        },
        async handleBossInput() {
          await ports?.emitStatus('Entered transform.');
          await ports?.emitTelemetry({
            topic: 'playbook.fsm.state',
            payload: { from: 'ready', to: 'transform' },
          });
          await ports?.emitTelemetry({
            topic: 'playbook.trace',
            payload: { prompt: 'private prompt', resumeToken: 'private' },
          });
          // Live streaming: the lines arrived while the turn was still running.
          streamedDuringTurn = streamed.length;
          await writeFile(target, 'compiled output');
        },
        async dispose() {},
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(streamed).toEqual([
      'Entered transform.',
      '[playbook.fsm.state] {"from":"ready","to":"transform"}',
    ]);
    expect(streamedDuringTurn).toBe(2);
    // Streamed lines do not repeat as end-of-run diagnostics, and trace
    // payloads reach neither channel (phase-execution-25).
    expect(result.diagnostics).toEqual([]);
    expect(streamed.join('\n')).not.toContain('private');
  });

  it('derives blocked when a clean turn produces no output', async () => {
    const result = await runFixture('BLOCK');
    expect(result.status).toBe('blocked');
    expect(result.diagnostics).toContain('fixture parked');
  });

  it('derives blocked when a stale target pre-exists and the turn writes nothing', async () => {
    await writeFile(join(root, 'out.ts'), 'stale prior artifact\n');
    const result = await runFixture('BLOCK');
    // A pre-existing target must not be mistaken for produced output.
    expect(result.status).toBe('blocked');
    expect(await readFile(join(root, 'out.ts'), 'utf8')).toBe(
      'stale prior artifact\n',
    );
  });

  it('recognizes an atomic replacement whose mtime is preserved as produced output', async () => {
    const target = join(root, 'out.ts');
    const replacement = join(root, 'replacement.ts');
    await writeFile(target, 'stale prior artifact');
    await writeFile(replacement, 'fresh compiled artifact');
    const fixedTime = new Date('2001-01-01T00:00:00.000Z');
    await utimes(target, fixedTime, fixedTime);
    await utimes(replacement, fixedTime, fixedTime);
    const priorMtime = (await stat(target)).mtimeMs;

    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init() {},
        async handleBossInput() {
          await rename(replacement, target);
        },
        async dispose() {},
      }),
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect((await stat(target)).mtimeMs).toBe(priorMtime);
    expect(await readFile(target, 'utf8')).toBe('fresh compiled artifact');
  });

  it('derives error when standard telemetry reports the failed quiescent state', async () => {
    let ports: PlaybookPorts | undefined;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value) {
          ports = value;
        },
        async handleBossInput() {
          await ports?.emitTelemetry({
            topic: 'playbook.fsm.state',
            payload: { from: 'transform', to: 'failed' },
          });
        },
        async dispose() {},
      }),
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target: join(root, 'out.ts'),
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('error');
    expect(result.diagnostics).toContain(
      'compiled runtime reached the failed quiescent state',
    );
    expect(result.diagnostics).toContain(
      '[playbook.fsm.state] {"from":"transform","to":"failed"}',
    );
    expect(result.diagnostics.join('\n')).not.toContain(
      'parked for Boss input',
    );
  });

  it('derives error when the turn throws', async () => {
    const result = await runFixture('ERR');
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]).toMatch(/fixture error/);
  });

  it('initializes a legacy runtime with exactly four recorded ports', async () => {
    let keys: string[] = [];
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          keys = Object.keys(value as object);
        },
        async handleBossInput() {},
        async dispose() {},
      }),
    });
    await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );

    expect(keys.sort()).toEqual([
      'callJudge',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
  });

  it('initializes a traced session-v1 runtime with its exact boundary', async () => {
    const target = join(root, 'out.ts');
    let initValue: unknown;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'session-v1',
      playbookId: 'phase',
      createSessionId: () => 'session-v1',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          initValue = value;
        },
        async handleBossInput() {
          await writeFile(target, 'fresh');
        },
        async dispose() {},
      }),
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(Object.keys(initValue as object).sort()).toEqual([
      'playbookId',
      'ports',
      'sessionId',
    ]);
    const session = initValue as { ports: Record<string, unknown> };
    expect(Object.keys(session.ports).sort()).toEqual([
      'callJudge',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
  });

  it('initializes a causal root session with exactly six runtime ports', async () => {
    let initValue: unknown;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      playbookId: 'text2gears',
      createSessionId: () => 'session-1',
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          initValue = value;
        },
        async handleBossInput() {
          return { outcome: 'no-action', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });
    await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );

    expect(initValue).toMatchObject({
      sessionId: 'session-1',
      playbookId: 'text2gears',
      rootSessionId: 'session-1',
      depth: 0,
    });
    const session = initValue as { ports: Record<string, unknown> };
    expect(Object.keys(session.ports).sort()).toEqual([
      'callCaptain',
      'callJudge',
      'callPlaybook',
      'callPlayer',
      'emitStatus',
      'emitTelemetry',
    ]);
    expect(Object.keys(session.ports)).not.toContain('drainDiagnostics');
  });

  it('routes isolated direct Captain calls without continuation output', async () => {
    const target = join(root, 'out.ts');
    const calls: Array<{
      prompt: string;
      resume?: string | false;
      allowedTools?: readonly string[];
    }> = [];
    const captain: AgentClient = {
      async run(request) {
        calls.push({
          prompt: request.prompt,
          resume: request.resume,
          allowedTools: request.allowedTools,
        });
        return {
          status: 'success',
          text: 'Captain response',
          resumeToken: 'private-player-token',
        };
      },
    };
    let ports:
      | {
          callCaptain(
            prompt: string,
            signal: AbortSignal,
            options: {
              visibility: 'visible' | 'hidden';
              resume: false;
              allowedTools: readonly [];
            },
          ): Promise<unknown>;
          callJudge(prompt: string, signal: AbortSignal): Promise<string>;
        }
      | undefined;
    let captainResult: unknown;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: captain,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          ports = (value as { ports: typeof ports }).ports;
        },
        async handleBossInput({ signal }: { signal: AbortSignal }) {
          captainResult = await ports?.callCaptain(
            'Handle this directly.',
            signal,
            { visibility: 'visible', resume: false, allowedTools: [] },
          );
          await ports?.callJudge('Adjudicate this.', signal);
          await writeFile(target, 'fresh');
          return { outcome: 'terminal', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(captainResult).toEqual({
      status: 'ok',
      finalText: 'Captain response',
    });
    expect(calls).toEqual([
      {
        prompt: 'Handle this directly.',
        resume: false,
        allowedTools: [],
      },
      {
        prompt: 'Adjudicate this.',
        resume: false,
        allowedTools: [],
      },
    ]);
  });

  it('carries update context to a performing Captain (incremental-compilation-16)', async () => {
    const target = join(root, 'out.ts');
    const prompts: string[] = [];
    const captain: AgentClient = {
      async run(request) {
        prompts.push(request.prompt);
        return { status: 'success', text: 'Captain response' };
      },
    };
    let ports:
      | {
          callCaptain(
            prompt: string,
            signal: AbortSignal,
            options: { visibility: 'visible'; resume: false },
          ): Promise<unknown>;
        }
      | undefined;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: captain,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          ports = (value as { ports: typeof ports }).ports;
        },
        async handleBossInput({ signal }: { signal: AbortSignal }) {
          await ports?.callCaptain('Transform it.', signal, {
            visibility: 'visible',
            resume: false,
          });
          await writeFile(target, 'updated');
          return { outcome: 'terminal', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });

    const priorInput = join(root, '.slc/builds/1/source');
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target,
        update: {
          priorInput,
          diff: '@@ -1,1 +1,1 @@\n-old\n+new',
        },
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Transform it.');
    expect(prompts[0]).toContain('Incremental update');
    expect(prompts[0]).toContain(priorInput);
    expect(prompts[0]).toContain(target);
    expect(prompts[0]).toContain('-old');
  });

  it.each(['session-v1', 'composed-v2'] as const)(
    'rejects omitted or invalid %s player continuation options',
    async (runtimeContract) => {
      for (const supplied of ['missing', 'invalid'] as const) {
        let playerCalls = 0;
        let runtimePorts:
          | {
              callPlayer(
                playerId: string,
                prompt: string,
                signal: AbortSignal,
                options?: unknown,
              ): Promise<unknown>;
            }
          | undefined;
        const player: AgentClient = {
          async run() {
            playerCalls++;
            return { status: 'success', text: 'unexpected' };
          },
        };
        const executor = createCompiledExecutor({
          artifactPath: 'ignored',
          runRoot: root,
          runtimeContract,
          player,
          judge: idleAgent,
          loadFactory: async () => () =>
            ({
              async init(value: unknown) {
                runtimePorts = (value as { ports: typeof runtimePorts }).ports;
              },
              async handleBossInput({ signal }: { signal: AbortSignal }) {
                if (supplied === 'missing') {
                  await runtimePorts?.callPlayer('writer', 'work', signal);
                } else {
                  await runtimePorts?.callPlayer('writer', 'work', signal, {
                    resume: true,
                  });
                }
                return runtimeContract === 'composed-v2'
                  ? { outcome: 'no-action', state: structuredState }
                  : undefined;
              },
              async resumePlaybookCall() {
                return { outcome: 'no-action', state: structuredState };
              },
              async dispose() {},
            }) as never,
        });

        const result = await executor.run(
          {
            kind: 'compile',
            definitionPath: join(root, 'phase.md'),
            source: 'src.md',
            target: 'out.ts',
          },
          new AbortController().signal,
        );
        expect(result.status).toBe('error');
        expect(result.diagnostics.join('\n')).toMatch(
          /explicit PlayerCallOptions|options\.resume must be false or a string/,
        );
        expect(playerCalls).toBe(0);
      }
    },
  );

  it('preserves omitted player options on the legacy port boundary', async () => {
    const target = join(root, 'out.ts');
    let ports: PlaybookPorts | undefined;
    let playerCalls = 0;
    const player: AgentClient = {
      async run() {
        playerCalls++;
        return { status: 'success', text: 'legacy result' };
      },
    };
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      player,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value) {
          ports = value;
        },
        async handleBossInput({ signal }) {
          await ports?.callPlayer('writer', 'legacy work', signal);
          await writeFile(target, 'fresh');
        },
        async dispose() {},
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target,
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('ok');
    expect(playerCalls).toBe(1);
  });

  it('maps structured outcomes directly instead of failed telemetry', async () => {
    const target = join(root, 'out.ts');
    let ports: { emitTelemetry(event: unknown): Promise<void> } | undefined;
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init(value: unknown) {
          ports = (value as typeof value & { ports: typeof ports }).ports;
        },
        async handleBossInput() {
          await writeFile(target, 'fresh');
          await ports?.emitTelemetry({
            topic: 'playbook.fsm.state',
            payload: { to: 'failed' },
          });
          await ports?.emitTelemetry({
            topic: 'playbook.trace',
            payload: {
              prompt: 'private prompt',
              reply: 'private reply',
              resumeToken: 'private token',
            },
          });
          return { outcome: 'quiescent', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );

    expect(result.status).toBe('ok');
    expect(result.diagnostics.join('\n')).not.toMatch(
      /private prompt|private reply|private token/,
    );
  });

  it('maps a hostile structured-result accessor to an invalid-result error', async () => {
    const hostile = Object.defineProperty({}, 'outcome', {
      enumerable: true,
      get() {
        throw new Error('hostile outcome getter');
      },
    });
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () =>
        ({
          async init() {},
          async handleBossInput() {
            return hostile;
          },
          async resumePlaybookCall() {
            return { outcome: 'no-action', state: structuredState };
          },
          async dispose() {},
        }) as never,
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      status: 'error',
      diagnostics: ['compiled runtime returned an invalid run result'],
    });
  });

  it.each([
    ['no-action', { outcome: 'no-action', state: structuredState }, 'blocked'],
    ['failed', { outcome: 'failed', state: structuredState }, 'error'],
    ['aborted', { outcome: 'aborted', state: structuredState }, 'error'],
    ['missing', undefined, 'error'],
    [
      'non-json output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: 1n,
      },
      'error',
    ],
    [
      'sparse output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: sparseJson,
      },
      'error',
    ],
    [
      'accessor output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: accessorJson,
      },
      'error',
    ],
    [
      'symbol output',
      {
        outcome: 'terminal',
        state: structuredState,
        output: symbolJson,
      },
      'error',
    ],
    [
      'malformed state',
      {
        outcome: 'quiescent',
        state: { ...structuredState, stateId: 7 },
      },
      'error',
    ],
    [
      'accessor state value',
      {
        outcome: 'quiescent',
        state: { ...structuredState, value: accessorJson },
      },
      'error',
    ],
    [
      'symbol state value',
      {
        outcome: 'quiescent',
        state: { ...structuredState, value: symbolJson },
      },
      'error',
    ],
    [
      'suspended',
      {
        outcome: 'suspended',
        state: structuredState,
        pendingCall: {
          callId: 'child-1',
          playbookId: 'child',
          childSessionId: 'session-child',
        },
      },
      'error',
    ],
    ['invalid', { outcome: 'quiescent', state: {} }, 'error'],
  ] as const)(
    'maps a structured %s result to %s',
    async (_name, outcome, status) => {
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract: 'composed-v2',
        player: idleAgent,
        judge: idleAgent,
        loadFactory: async () => () => ({
          async init() {},
          async handleBossInput() {
            return outcome;
          },
          async resumePlaybookCall() {
            return { outcome: 'no-action', state: structuredState };
          },
          async dispose() {},
        }),
      });

      const result = await executor.run(
        {
          kind: 'compile',
          definitionPath: join(root, 'phase.md'),
          source: join(root, 'src.md'),
          target: join(root, 'out.ts'),
        },
        new AbortController().signal,
      );
      expect(result.status).toBe(status);
    },
  );

  it('carries the Captain host-failure message in the failed diagnostic (DR-017)', async () => {
    // Under playbook 2.0.0 a failing host Captain reply resolves the turn as
    // the structured `failed` outcome (PBRT-47) instead of rejecting; the
    // host maps it to `error` with the runtime-failed diagnostic.
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init() {},
        async handleBossInput() {
          return {
            outcome: 'failed',
            state: structuredState,
            error: { name: 'Error', message: 'captain reply unavailable' },
          };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {},
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target: join(root, 'out.ts'),
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
    expect(result.diagnostics).toContain(
      'compiled runtime failed: captain reply unavailable',
    );
  });

  it('reports disposal failure instead of returning success', async () => {
    const target = join(root, 'out.ts');
    const executor = createCompiledExecutor({
      artifactPath: 'ignored',
      runRoot: root,
      runtimeContract: 'composed-v2',
      player: idleAgent,
      judge: idleAgent,
      loadFactory: async () => () => ({
        async init() {},
        async handleBossInput() {
          await writeFile(target, 'fresh');
          return { outcome: 'terminal', state: structuredState };
        },
        async resumePlaybookCall() {
          return { outcome: 'no-action', state: structuredState };
        },
        async dispose() {
          throw new Error('trace drain failed');
        },
      }),
    });

    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: join(root, 'src.md'),
        target,
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
    expect(result.diagnostics).toContain(
      'compiled runtime disposal failed: trace drain failed',
    );
  });

  it.each([
    ['session id', { sessionId: ' ', playbookId: 'phase' }],
    ['playbook id', { sessionId: 'session', playbookId: '' }],
  ])(
    'rejects an empty %s before runtime initialization',
    async (_name, ids) => {
      let initialized = false;
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: root,
        runtimeContract: 'composed-v2',
        playbookId: ids.playbookId,
        createSessionId: () => ids.sessionId,
        player: idleAgent,
        judge: idleAgent,
        loadFactory: async () => () => ({
          async init() {
            initialized = true;
          },
          async handleBossInput() {
            return { outcome: 'no-action', state: structuredState };
          },
          async resumePlaybookCall() {
            return { outcome: 'no-action', state: structuredState };
          },
          async dispose() {},
        }),
      });

      await expect(
        executor.run(
          {
            kind: 'compile',
            definitionPath: join(root, 'phase.md'),
            source: join(root, 'src.md'),
            target: join(root, 'out.ts'),
          },
          new AbortController().signal,
        ),
      ).rejects.toThrow(/must be non-empty/);
      expect(initialized).toBe(false);
    },
  );

  it('reports error when the artifact has no createPlaybookRuntime export', async () => {
    const bad = join(root, 'bad.mjs');
    await writeFile(bad, 'export const notDefault = 1;\n');
    const executor = createCompiledExecutor({
      artifactPath: bad,
      runRoot: root,
      player: idleAgent,
      judge: idleAgent,
    });
    const result = await executor.run(
      {
        kind: 'compile',
        definitionPath: join(root, 'phase.md'),
        source: 'src.md',
        target: 'out.ts',
      },
      new AbortController().signal,
    );
    expect(result.status).toBe('error');
    expect(result.diagnostics[0]).toMatch(/no createPlaybookRuntime/);
  });
});

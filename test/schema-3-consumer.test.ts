// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  constructInterposedSchema3Runtime,
  loadInterposedSchema3Registry,
} from './equivalence.js';
import fixtureEntry, {
  createConfiguredRegistryPlan,
} from './fixtures/schema-3-entry-fixture.mjs';
import createPlaybookRuntime from './fixtures/workflow.playbook/workflow.playbook.ts';

const linkedFixtureFactory =
  createPlaybookRuntime as typeof createPlaybookRuntime & {
    readonly compat: Readonly<{ artifactSchema: 3; runtimeAbi: 1 }>;
  };

const execFileAsync = promisify(execFile);
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'schema-3-entry-fixture.mjs',
);
const linkedFixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'workflow.playbook',
  'workflow.playbook.ts',
);
const emptyLedger = {
  schemaVersion: 1,
  revision: 0,
  boundaries: [],
  logicalOperations: [],
};
describe('dormant schema-3 registry consumer fixture', () => {
  let root: string;
  let entryPath: string;
  let linkedPath: string;
  let worktree: string;
  let gitDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-schema-3-consumer-'));
    entryPath = join(root, 'workflow.mjs');
    linkedPath = join(root, 'workflow.playbook', 'workflow.playbook.ts');
    await mkdir(dirname(linkedPath), { recursive: true });
    await copyFile(fixturePath, entryPath);
    await copyFile(linkedFixturePath, linkedPath);
    await writeFile(join(root, 'baseline.txt'), 'schema-3 fixture baseline\n');
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], {
      cwd: root,
    });
    await execFileAsync(
      'git',
      [
        'add',
        'baseline.txt',
        'workflow.mjs',
        'workflow.playbook/workflow.playbook.ts',
      ],
      { cwd: root },
    );
    await execFileAsync(
      'git',
      [
        '-c',
        'user.name=Schema 3 Fixture',
        '-c',
        'user.email=schema-3-fixture@example.invalid',
        '-c',
        'commit.gpgSign=false',
        'commit',
        '--quiet',
        '-m',
        'fixture baseline',
      ],
      { cwd: root },
    );
    const topLevel = await execFileAsync(
      'git',
      ['rev-parse', '--show-toplevel'],
      { cwd: root },
    );
    const absoluteGitDir = await execFileAsync(
      'git',
      ['rev-parse', '--absolute-git-dir'],
      { cwd: root },
    );
    worktree = await realpath(topLevel.stdout.trim());
    gitDir = await realpath(absoluteGitDir.stdout.trim());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exposes dormant schema-3 roles, concurrency, immutable compat, and empty options (release-22)', () => {
    expect(fixtureEntry).toMatchObject({
      id: 'workflow',
      command: 'workflow',
      intent: 'Synthetic schema-3 consumer fixture.',
      artifactSchema: 3,
      requiredRoleIds: ['coder', 'reviewer'],
      concurrentRoleSets: [['coder', 'reviewer']],
    });
    expect(fixtureEntry.runtimeProfile).toEqual({
      kind: 'shared-factory',
      compat: { artifactSchema: 3, runtimeAbi: 1 },
    });
    expect(fixtureEntry.runtimeProfile.compat).toBe(
      linkedFixtureFactory.compat,
    );
    expect(Object.isFrozen(linkedFixtureFactory.compat)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(linkedFixtureFactory, 'compat'),
    ).toEqual({
      value: linkedFixtureFactory.compat,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    expect(fixtureEntry.createRuntime).toHaveLength(2);
    const entrySource = readFileSync(fixturePath, 'utf8');
    expect(entrySource).toContain(
      "import createPlaybookRuntime from './workflow.playbook/workflow.playbook.ts';",
    );
    expect(entrySource).not.toMatch(/\b(?:Proxy|withRoleBinding)\b/);

    const absent = fixtureEntry.validateOptions(undefined);
    const explicit = fixtureEntry.validateOptions({});
    expect(absent).toEqual({});
    expect(explicit).toEqual({});
    expect(Object.getPrototypeOf(absent)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptors(absent)).toEqual({});
    expect(absent).not.toBe(explicit);
    expect(() => fixtureEntry.validateOptions({ committer: 'coder' })).toThrow(
      /configured options.*exact own-data shape/,
    );
    expect(() => fixtureEntry.validateOptions(null)).toThrow(
      /configured options.*exact plain record/,
    );
  });

  it('initializes and disposes one causal root against exact live capabilities without governed effects (release-22)', async () => {
    const history = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      {
        cwd: root,
      },
    );
    const status = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: root,
    });
    expect(history.stdout.trim()).toBe('1');
    expect(status.stdout).toBe('');

    const linkedModule = await import(pathToFileURL(linkedPath).href);
    const loaded = await loadInterposedSchema3Registry(
      entryPath,
      linkedPath,
      linkedModule,
    );
    const copied = loaded.registry as typeof fixtureEntry;
    expect(copied.requiredRoleIds).toEqual(['coder', 'reviewer']);
    expect(copied.concurrentRoleSets).toEqual([['coder', 'reviewer']]);

    const sessionId = 'schema-3-consumer-session';
    const canonicalWorktree = { worktree, gitDir };
    const authority = {
      playbookId: copied.id,
      artifactSchema: copied.artifactSchema,
      cwd: worktree,
      sessionId,
      leaseOwnerToken: 'schema-3-consumer-lease',
      canonicalWorktree,
      requiredRoleIds: [...copied.requiredRoleIds],
      concurrentRoleSets: copied.concurrentRoleSets.map((set: string[]) => [
        ...set,
      ]),
    };
    const governedUses: string[] = [];
    const failGovernedUse = (name: string) => async () => {
      governedUses.push(name);
      throw new Error(`${name} must not be used by the consumer probe`);
    };
    const repository = {
      identity: { worktree, gitDir },
      observe: failGovernedUse('repository.observe'),
      acquire: failGovernedUse('repository.acquire'),
      runExclusive: failGovernedUse('repository.runExclusive'),
      runCohort: failGovernedUse('repository.runCohort'),
      runDeferred: failGovernedUse('repository.runDeferred'),
    };
    const ledgerSnapshots: (typeof emptyLedger)[] = [];
    const effectLedger = {
      snapshot() {
        const snapshot = {
          schemaVersion: 1,
          revision: 0,
          boundaries: [] as [],
          logicalOperations: [] as [],
        };
        ledgerSnapshots.push(snapshot);
        return snapshot;
      },
      writeAhead: failGovernedUse('effectLedger.writeAhead'),
    };
    const hostCapabilities = { authority, repository, effectLedger };
    const options = copied.validateOptions(undefined);
    const snapshotsBeforeConstruction = ledgerSnapshots.length;
    const runtime = constructInterposedSchema3Runtime({
      playbook: loaded.playbook,
      registry: copied,
      configuredOptions: options,
      hostCapabilities,
    }) as {
      init(session: unknown): Promise<void>;
      handleBossInput(turn: unknown): Promise<unknown>;
      resumePlaybookCall(call: unknown): Promise<unknown>;
      dispose(): Promise<void>;
    };
    const constructionSnapshotCount =
      ledgerSnapshots.length - snapshotsBeforeConstruction;
    expect(constructionSnapshotCount).toBeGreaterThan(0);
    effectLedger.snapshot();
    expect(runtime).toMatchObject({
      init: expect.any(Function),
      handleBossInput: expect.any(Function),
      resumePlaybookCall: expect.any(Function),
      dispose: expect.any(Function),
    });
    expect(Object.keys(hostCapabilities)).toEqual([
      'authority',
      'repository',
      'effectLedger',
    ]);
    expect(repository.identity).not.toBe(canonicalWorktree);
    expect(repository.identity).toEqual(canonicalWorktree);

    const callPortUses: string[] = [];
    const failCallPortUse = (name: string) => async () => {
      callPortUses.push(name);
      throw new Error(`${name} must not be used by the consumer probe`);
    };
    const emissions: unknown[] = [];
    await runtime.init({
      sessionId,
      playbookId: copied.id,
      rootSessionId: sessionId,
      depth: 0,
      ports: {
        callPlayer: failCallPortUse('callPlayer'),
        callCaptain: failCallPortUse('callCaptain'),
        callJudge: failCallPortUse('callJudge'),
        callPlaybook: failCallPortUse('callPlaybook'),
        emitStatus: async (message: unknown, data: unknown) => {
          emissions.push({ kind: 'status', message, data });
        },
        emitTelemetry: async (event: unknown) => {
          emissions.push({ kind: 'telemetry', event });
        },
      },
    });
    await runtime.dispose();

    expect(callPortUses).toEqual([]);
    expect(governedUses).toEqual([]);
    expect(emissions).toContainEqual({
      kind: 'telemetry',
      event: {
        topic: 'playbook.trace',
        payload: { type: 'session.started' },
      },
    });
    expect(ledgerSnapshots.length).toBeGreaterThanOrEqual(2);
    for (const snapshot of ledgerSnapshots)
      expect(snapshot).toEqual(emptyLedger);
    expect(new Set(ledgerSnapshots).size).toBe(ledgerSnapshots.length);
    expect(
      new Set(ledgerSnapshots.map(({ boundaries }) => boundaries)).size,
    ).toBe(ledgerSnapshots.length);
    expect(
      new Set(ledgerSnapshots.map(({ logicalOperations }) => logicalOperations))
        .size,
    ).toBe(ledgerSnapshots.length);

    const historyAfter = await execFileAsync(
      'git',
      ['rev-list', '--count', 'HEAD'],
      { cwd: root },
    );
    const statusAfter = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: root,
    });
    expect(historyAfter.stdout.trim()).toBe('1');
    expect(statusAfter.stdout).toBe('');
  });

  it('plans deferred Playbook 10 configured-registry slash-command invocation without positional or removed run inputs (DR-024, DR-025)', () => {
    const task = 'repair the synthetic sample';
    const configHome = join(root, 'config-home');
    const plan = createConfiguredRegistryPlan({
      configHome,
      entryPath,
      roleBindings: {
        coder: 'fixture-coder',
        reviewer: 'fixture-reviewer',
      },
      task,
    });

    expect(plan.configPath).toBe(
      join(configHome, 'playbook', 'playbook.config.yaml'),
    );
    expect(plan.config).toEqual({
      captain: { adapter: 'fixture-captain' },
      players: {
        'fixture-coder': { adapter: 'fixture-coder' },
        'fixture-reviewer': { adapter: 'fixture-reviewer' },
      },
      playbooks: {
        workflow: {
          from: entryPath,
          roles: {
            coder: 'fixture-coder',
            reviewer: 'fixture-reviewer',
          },
        },
      },
    });
    expect(plan.argv).toEqual([
      'playbook',
      'run',
      '--json',
      '/workflow repair the synthetic sample',
    ]);
    expect(plan.argv).not.toContain(entryPath);
    expect(plan.argv).not.toContain('--player');
    expect(plan.argv).not.toContain('--captain');
    expect(plan.argv).not.toContain('--option');
    expect(plan.argv).not.toContain('--cwd');
    expect(() =>
      createConfiguredRegistryPlan({
        configHome,
        entryPath,
        roleBindings: {
          coder: 'fixture-shared',
          reviewer: 'fixture-shared',
        },
        task,
      }),
    ).toThrow(/concurrent roles must bind distinct stable players/);
    expect(() =>
      createConfiguredRegistryPlan({
        configHome,
        entryPath,
        roleBindings: {
          Coder: 'fixture-coder',
          reviewer: 'fixture-reviewer',
        },
        task,
      }),
    ).toThrow(/configured role bindings.*exact own-data shape/);
  });
});

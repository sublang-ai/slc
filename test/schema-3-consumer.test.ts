// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import fixtureEntry, {
  createConfiguredRegistryPlan,
  createPlaybookRuntime,
} from './fixtures/schema-3-entry-fixture.mjs';

const execFileAsync = promisify(execFile);
const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'schema-3-entry-fixture.mjs',
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
  let worktree: string;
  let gitDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-schema-3-consumer-'));
    entryPath = join(root, 'workflow.mjs');
    await copyFile(fixturePath, entryPath);
    await writeFile(join(root, 'baseline.txt'), 'schema-3 fixture baseline\n');
    await execFileAsync('git', ['init', '--quiet', '--initial-branch=main'], {
      cwd: root,
    });
    await execFileAsync('git', ['add', 'baseline.txt', 'workflow.mjs'], {
      cwd: root,
    });
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

  it('exposes canonical roles, concurrency, immutable compat, and empty options (self-hosting-14, self-hosting-15, self-hosting-16)', () => {
    expect(fixtureEntry).toMatchObject({
      id: 'workflow',
      command: 'workflow',
      artifactSchema: 3,
      requiredRoleIds: ['coder', 'reviewer'],
      concurrentRoleSets: [['coder', 'reviewer']],
    });
    expect(fixtureEntry.runtimeProfile).toEqual({
      kind: 'shared-factory',
      compat: { artifactSchema: 3, runtimeAbi: 1 },
    });
    expect(fixtureEntry.runtimeProfile.compat).toBe(
      createPlaybookRuntime.compat,
    );
    expect(Object.isFrozen(createPlaybookRuntime.compat)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(createPlaybookRuntime, 'compat'),
    ).toEqual({
      value: createPlaybookRuntime.compat,
      enumerable: true,
      writable: false,
      configurable: false,
    });
    expect(fixtureEntry.createRuntime).toHaveLength(2);

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

  it('initializes and disposes a causal root against exact live capabilities without governed effects (release-18)', async () => {
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

    const copiedModule = await import(pathToFileURL(entryPath).href);
    const copied = copiedModule.default;
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
    let snapshotReads = 0;
    const effectLedger = {
      snapshot() {
        snapshotReads += 1;
        return {
          schemaVersion: 1,
          revision: 0,
          boundaries: [],
          logicalOperations: [],
        };
      },
      writeAhead: failGovernedUse('effectLedger.writeAhead'),
    };
    const firstLedger = effectLedger.snapshot();
    const secondLedger = effectLedger.snapshot();
    expect(firstLedger).toEqual(emptyLedger);
    expect(secondLedger).toEqual(emptyLedger);
    expect(firstLedger).not.toBe(secondLedger);
    expect(firstLedger.boundaries).not.toBe(secondLedger.boundaries);
    expect(firstLedger.logicalOperations).not.toBe(
      secondLedger.logicalOperations,
    );

    const hostCapabilities = { authority, repository, effectLedger };
    const options = copied.validateOptions(undefined);
    const runtime = copied.createRuntime(options, hostCapabilities);
    expect(runtime).toMatchObject({
      init: expect.any(Function),
      handleBossInput: expect.any(Function),
      resumePlaybookCall: expect.any(Function),
      dispose: expect.any(Function),
    });
    const construction = copiedModule.lastLinkedFactoryConstruction();
    expect(construction).toEqual({
      configuredOptions: options,
      hostCapabilities,
    });
    expect(construction.configuredOptions).toBe(options);
    expect(construction.hostCapabilities).toBe(hostCapabilities);
    expect(Object.keys(hostCapabilities)).toEqual([
      'authority',
      'repository',
      'effectLedger',
    ]);
    expect(repository.identity).not.toBe(canonicalWorktree);
    expect(repository.identity).toEqual(canonicalWorktree);

    const portUses: string[] = [];
    const failPortUse = (name: string) => async () => {
      portUses.push(name);
      throw new Error(`${name} must not be used by the consumer probe`);
    };
    await runtime.init({
      sessionId,
      playbookId: copied.id,
      rootSessionId: sessionId,
      depth: 0,
      ports: {
        callPlayer: failPortUse('callPlayer'),
        callCaptain: failPortUse('callCaptain'),
        callJudge: failPortUse('callJudge'),
        callPlaybook: failPortUse('callPlaybook'),
        emitStatus: failPortUse('emitStatus'),
        emitTelemetry: failPortUse('emitTelemetry'),
      },
    });
    await runtime.dispose();

    expect(portUses).toEqual([]);
    expect(governedUses).toEqual([]);
    expect(snapshotReads).toBe(2);
  });

  it('plans configured-registry slash-command invocation without positional or removed run inputs (self-hosting-14, release-18)', () => {
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

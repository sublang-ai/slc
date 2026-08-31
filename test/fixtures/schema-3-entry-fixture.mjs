// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A synthetic role-bearing schema-3 registry entry. It is deliberately
// independent of the installed Playbook generation so Task 3 can exercise the
// future consumer contract while exact Playbook 10 provenance remains dormant.

import { isAbsolute, join } from 'node:path';

const ENTRY_ID = 'workflow';
const REQUIRED_ROLE_IDS = Object.freeze(['coder', 'reviewer']);
const CONCURRENT_ROLE_SETS = Object.freeze([
  Object.freeze(['coder', 'reviewer']),
]);
const COMPAT = Object.freeze({ artifactSchema: 3, runtimeAbi: 1 });

let lastConstruction;

function exactPlainRecord(value, keys, label) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new Error(`${label} is not an exact plain record`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Object.keys(descriptors).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some(
      (descriptor) =>
        !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'),
    )
  ) {
    throw new Error(`${label} does not have the exact own-data shape`);
  }
}

function assertExactArray(value, length, label) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new Error(`${label} is not an exact array`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const indexes = Array.from({ length }, (_, index) => String(index));
  if (
    value.length !== length ||
    Object.keys(descriptors).length !== length + 1 ||
    !Object.hasOwn(descriptors, 'length') ||
    !indexes.every(
      (index) =>
        Object.hasOwn(descriptors, index) &&
        descriptors[index].enumerable &&
        Object.hasOwn(descriptors[index], 'value'),
    )
  ) {
    throw new Error(`${label} does not have the exact array shape`);
  }
}

function exactStringArray(value, expected, label) {
  assertExactArray(value, expected.length, label);
  if (value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} does not match the registry declaration`);
  }
}

function exactConcurrentRoleSets(value, label) {
  assertExactArray(value, CONCURRENT_ROLE_SETS.length, label);
  value.forEach((set, index) =>
    exactStringArray(set, CONCURRENT_ROLE_SETS[index], `${label}[${index}]`),
  );
}

function assertCallableRecord(value, keys, label) {
  exactPlainRecord(value, keys, label);
  if (keys.some((key) => typeof value[key] !== 'function')) {
    throw new Error(`${label} contains a non-callable operation`);
  }
}

function assertHostCapabilities(hostCapabilities) {
  exactPlainRecord(
    hostCapabilities,
    ['authority', 'repository', 'effectLedger'],
    'host capabilities',
  );
  const { authority, repository, effectLedger } = hostCapabilities;
  exactPlainRecord(
    authority,
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
    'authority',
  );
  exactPlainRecord(
    authority.canonicalWorktree,
    ['worktree', 'gitDir'],
    'canonical worktree',
  );
  if (
    authority.playbookId !== ENTRY_ID ||
    authority.artifactSchema !== 3 ||
    typeof authority.cwd !== 'string' ||
    authority.cwd !== authority.canonicalWorktree.worktree ||
    typeof authority.sessionId !== 'string' ||
    authority.sessionId === '' ||
    typeof authority.leaseOwnerToken !== 'string' ||
    authority.leaseOwnerToken === '' ||
    typeof authority.canonicalWorktree.worktree !== 'string' ||
    !isAbsolute(authority.canonicalWorktree.worktree) ||
    typeof authority.canonicalWorktree.gitDir !== 'string' ||
    !isAbsolute(authority.canonicalWorktree.gitDir)
  ) {
    throw new Error('authority does not match the schema-3 registry session');
  }
  exactStringArray(
    authority.requiredRoleIds,
    REQUIRED_ROLE_IDS,
    'authority required roles',
  );
  exactConcurrentRoleSets(
    authority.concurrentRoleSets,
    'authority concurrent role sets',
  );

  exactPlainRecord(
    repository,
    [
      'identity',
      'observe',
      'acquire',
      'runExclusive',
      'runCohort',
      'runDeferred',
    ],
    'repository',
  );
  exactPlainRecord(
    repository.identity,
    ['worktree', 'gitDir'],
    'repository identity',
  );
  if (
    repository.identity.worktree !== authority.canonicalWorktree.worktree ||
    repository.identity.gitDir !== authority.canonicalWorktree.gitDir
  ) {
    throw new Error('repository identity does not match canonical worktree');
  }
  for (const operation of [
    'observe',
    'acquire',
    'runExclusive',
    'runCohort',
    'runDeferred',
  ]) {
    if (typeof repository[operation] !== 'function') {
      throw new Error(`repository ${operation} is not callable`);
    }
  }

  assertCallableRecord(
    effectLedger,
    ['snapshot', 'writeAhead'],
    'effect ledger',
  );
}

export function validateOptions(value) {
  if (value !== undefined) {
    exactPlainRecord(value, [], 'configured options');
  }
  return {};
}

export function createPlaybookRuntime(construction) {
  if (arguments.length !== 1) {
    throw new Error('linked factory requires exactly one construction object');
  }
  exactPlainRecord(
    construction,
    ['configuredOptions', 'hostCapabilities'],
    'linked-factory construction',
  );
  exactPlainRecord(construction.configuredOptions, [], 'configured options');
  assertHostCapabilities(construction.hostCapabilities);
  lastConstruction = construction;

  let session;
  let disposed = false;
  return {
    async init(value) {
      if (session !== undefined || disposed) {
        throw new Error('schema-3 fixture initialized out of order');
      }
      exactPlainRecord(
        value,
        ['sessionId', 'playbookId', 'rootSessionId', 'depth', 'ports'],
        'causal-root session',
      );
      const { authority } = construction.hostCapabilities;
      if (
        value.sessionId !== authority.sessionId ||
        value.rootSessionId !== value.sessionId ||
        value.playbookId !== ENTRY_ID ||
        value.depth !== 0 ||
        Object.hasOwn(value, 'parentSessionId') ||
        Object.hasOwn(value, 'parentCallId')
      ) {
        throw new Error('schema-3 fixture received a non-root session');
      }
      assertCallableRecord(
        value.ports,
        [
          'callPlayer',
          'callCaptain',
          'callJudge',
          'callPlaybook',
          'emitStatus',
          'emitTelemetry',
        ],
        'runtime ports',
      );
      session = value;
    },
    async handleBossInput() {
      throw new Error(
        'role-bearing consumer fixture must not receive a Boss turn',
      );
    },
    async resumePlaybookCall() {
      throw new Error(
        'role-bearing consumer fixture must not resume a child call',
      );
    },
    async dispose() {
      if (session === undefined || disposed) {
        throw new Error('schema-3 fixture disposed out of order');
      }
      disposed = true;
    },
  };
}

Object.defineProperty(createPlaybookRuntime, 'compat', {
  value: COMPAT,
  enumerable: true,
  writable: false,
  configurable: false,
});

export function lastLinkedFactoryConstruction() {
  return lastConstruction;
}

export function createConfiguredRegistryPlan({
  configHome,
  entryPath,
  roleBindings,
  task,
}) {
  if (typeof configHome !== 'string' || !isAbsolute(configHome)) {
    throw new Error('configured registry home must be absolute');
  }
  if (typeof entryPath !== 'string' || !isAbsolute(entryPath)) {
    throw new Error('configured registry entry path must be absolute');
  }
  exactPlainRecord(roleBindings, REQUIRED_ROLE_IDS, 'configured role bindings');
  if (
    REQUIRED_ROLE_IDS.some(
      (roleId) =>
        typeof roleBindings[roleId] !== 'string' || roleBindings[roleId] === '',
    )
  ) {
    throw new Error('configured role bindings must name concrete players');
  }
  if (roleBindings.coder === roleBindings.reviewer) {
    throw new Error('concurrent roles must bind distinct stable players');
  }
  if (typeof task !== 'string' || task.trim() === '') {
    throw new Error('configured registry task must be non-empty');
  }
  return {
    configPath: join(configHome, 'playbook', 'playbook.config.yaml'),
    config: {
      captain: { adapter: 'fixture-captain' },
      players: {
        [roleBindings.coder]: { adapter: 'fixture-coder' },
        [roleBindings.reviewer]: { adapter: 'fixture-reviewer' },
      },
      playbooks: {
        [ENTRY_ID]: {
          from: entryPath,
          roles: {
            coder: roleBindings.coder,
            reviewer: roleBindings.reviewer,
          },
        },
      },
    },
    argv: ['playbook', 'run', '--json', `/${ENTRY_ID} ${task}`],
  };
}

const entry = {
  id: ENTRY_ID,
  command: ENTRY_ID,
  artifactSchema: 3,
  runtimeProfile: {
    kind: 'shared-factory',
    compat: createPlaybookRuntime.compat,
  },
  requiredRoleIds: [...REQUIRED_ROLE_IDS],
  concurrentRoleSets: CONCURRENT_ROLE_SETS.map((set) => [...set]),
  intent: 'Synthetic schema-3 consumer fixture.',
  validateOptions,
  createRuntime(options, hostCapabilities) {
    if (arguments.length !== 2) {
      throw new Error(
        'registry entry createRuntime requires exactly two arguments',
      );
    }
    return createPlaybookRuntime({
      configuredOptions: options,
      hostCapabilities,
    });
  },
};

export default entry;

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Synthetic linked schema-3 artifact imported by the dormant registry-entry
// fixture through the same source-only TypeScript bundle edge production emission uses.

import { isAbsolute } from 'node:path';

const ENTRY_ID = 'workflow';
const REQUIRED_ROLE_IDS = Object.freeze(['coder', 'reviewer']);
const CONCURRENT_ROLE_SETS = Object.freeze([
  Object.freeze(['coder', 'reviewer']),
]);
const COMPAT = Object.freeze({ artifactSchema: 3, runtimeAbi: 1 });

function exactPlainRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
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

function assertExactArray(
  value: unknown,
  length: number,
  label: string,
): asserts value is unknown[] {
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

function exactStringArray(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is string[] {
  assertExactArray(value, expected.length, label);
  if (value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} does not match the registry declaration`);
  }
}

function exactConcurrentRoleSets(
  value: unknown,
  label: string,
): asserts value is string[][] {
  assertExactArray(value, CONCURRENT_ROLE_SETS.length, label);
  value.forEach((set, index) =>
    exactStringArray(set, CONCURRENT_ROLE_SETS[index], `${label}[${index}]`),
  );
}

function assertCallableRecord<K extends string>(
  value: unknown,
  keys: readonly K[],
  label: string,
): asserts value is Record<K, (...args: unknown[]) => unknown> {
  exactPlainRecord(value, keys, label);
  if (keys.some((key) => typeof value[key] !== 'function')) {
    throw new Error(`${label} contains a non-callable operation`);
  }
}

function assertEmptyLedger(value: unknown) {
  exactPlainRecord(
    value,
    ['schemaVersion', 'revision', 'boundaries', 'logicalOperations'],
    'effect-ledger snapshot',
  );
  if (value.schemaVersion !== 1 || value.revision !== 0) {
    throw new Error('effect-ledger snapshot has the wrong identity');
  }
  assertExactArray(value.boundaries, 0, 'effect-ledger boundaries');
  assertExactArray(
    value.logicalOperations,
    0,
    'effect-ledger logical operations',
  );
}

interface FixtureHostCapabilities {
  authority: Record<string, unknown> & {
    canonicalWorktree: Record<string, unknown>;
    requiredRoleIds: string[];
    concurrentRoleSets: string[][];
  };
  repository: Record<string, unknown> & {
    identity: Record<string, unknown>;
  };
  effectLedger: Record<
    'snapshot' | 'writeAhead',
    (...args: unknown[]) => unknown
  >;
}

function assertHostCapabilities(
  hostCapabilities: unknown,
): asserts hostCapabilities is FixtureHostCapabilities {
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

export function createPlaybookRuntime(
  construction: unknown,
): Record<string, unknown> {
  if (arguments.length !== 1) {
    throw new Error('linked factory requires exactly one construction object');
  }
  exactPlainRecord(
    construction,
    ['configuredOptions', 'hostCapabilities'],
    'linked-factory construction',
  );
  const configuredOptions = construction.configuredOptions;
  const hostCapabilities = construction.hostCapabilities;
  exactPlainRecord(configuredOptions, [], 'configured options');
  assertHostCapabilities(hostCapabilities);
  assertEmptyLedger(hostCapabilities.effectLedger.snapshot());
  let session: Record<string, unknown> | undefined;
  let disposed = false;
  const runtime = {
    async init(value: unknown) {
      if (session !== undefined || disposed) {
        throw new Error('schema-3 fixture initialized out of order');
      }
      exactPlainRecord(
        value,
        ['sessionId', 'playbookId', 'rootSessionId', 'depth', 'ports'],
        'causal-root session',
      );
      const { authority } = hostCapabilities;
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
      const ports = value.ports;
      assertCallableRecord(
        ports,
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
      await ports.emitTelemetry({
        topic: 'playbook.trace',
        payload: { type: 'session.started' },
      });
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
  return runtime;
}

Object.defineProperty(createPlaybookRuntime, 'compat', {
  value: COMPAT,
  enumerable: true,
  writable: false,
  configurable: false,
});

export default createPlaybookRuntime;

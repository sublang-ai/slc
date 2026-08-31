// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// An isolated roleless schema-3 compiled-phase fixture. It checks the exact
// phase-host construction before returning a runtime, then selects successful
// or deliberately unsupported behavior from the compile source's contents.

import { readFile, writeFile } from 'node:fs/promises';

const compat = Object.freeze({ artifactSchema: 3, runtimeAbi: 1 });

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

function resultState() {
  return {
    value: 'done',
    activeStateIds: ['done'],
    tags: [],
    status: 'done',
    quiescent: true,
    stateId: 'done',
  };
}

function createPlaybookRuntime(...args) {
  if (args.length !== 1) {
    throw new Error(
      'schema-3 fixture factory was not called with exactly one argument',
    );
  }
  const construction = args[0];
  exactPlainRecord(
    construction,
    ['configuredOptions', 'hostCapabilities'],
    'factory argument',
  );
  exactPlainRecord(construction.configuredOptions, [], 'configured options');
  exactPlainRecord(
    construction.hostCapabilities,
    ['repository', 'effectLedger'],
    'host capabilities',
  );
  if (Object.hasOwn(construction.hostCapabilities, 'authority')) {
    throw new Error('the roleless phase host supplied Captain authority');
  }

  const { repository, effectLedger } = construction.hostCapabilities;
  exactPlainRecord(repository, ['runExclusive', 'runDeferred'], 'repository');
  exactPlainRecord(effectLedger, ['snapshot', 'writeAhead'], 'effect ledger');
  if (
    typeof repository.runExclusive !== 'function' ||
    typeof repository.runDeferred !== 'function' ||
    typeof effectLedger.snapshot !== 'function' ||
    typeof effectLedger.writeAhead !== 'function'
  ) {
    throw new Error('schema-3 fixture received a non-callable capability');
  }

  const firstLedger = effectLedger.snapshot();
  const secondLedger = effectLedger.snapshot();
  const emptyLedger = {
    schemaVersion: 1,
    revision: 0,
    boundaries: [],
    logicalOperations: [],
  };
  if (
    firstLedger instanceof Promise ||
    secondLedger instanceof Promise ||
    firstLedger === secondLedger ||
    firstLedger.boundaries === secondLedger.boundaries ||
    firstLedger.logicalOperations === secondLedger.logicalOperations ||
    JSON.stringify(firstLedger) !== JSON.stringify(emptyLedger) ||
    JSON.stringify(secondLedger) !== JSON.stringify(emptyLedger)
  ) {
    throw new Error(
      'effect-ledger snapshots were not synchronous and detached',
    );
  }

  let session;
  return {
    async init(value) {
      exactPlainRecord(
        value,
        ['sessionId', 'playbookId', 'rootSessionId', 'depth', 'ports'],
        'causal root session',
      );
      if (
        value.sessionId !== value.rootSessionId ||
        value.depth !== 0 ||
        Object.hasOwn(value, 'parentSessionId') ||
        Object.hasOwn(value, 'parentCallId')
      ) {
        throw new Error('schema-3 fixture received a non-root session');
      }
      exactPlainRecord(
        value.ports,
        [
          'callPlayer',
          'callCaptain',
          'callJudge',
          'callPlaybook',
          'emitStatus',
          'emitTelemetry',
        ],
        'schema-3 ports',
      );
      if (
        Object.values(value.ports).some((port) => typeof port !== 'function') ||
        Object.values(value).includes(construction.hostCapabilities) ||
        Object.values(value.ports).includes(construction.hostCapabilities)
      ) {
        throw new Error('live capabilities leaked into machine input');
      }
      session = value;
    },

    async handleBossInput({ text, signal }) {
      if (session === undefined) {
        throw new Error('schema-3 fixture was driven before initialization');
      }
      const marker = 'Request: ';
      const line = text
        .split('\n')
        .find((candidate) => candidate.startsWith(marker));
      const request = JSON.parse(line.slice(marker.length));
      const content = (await readFile(request.source, 'utf8')).trim();

      if (content === 'AUTHORITY') {
        throw new Error(
          'schema-3 roleless phase host has no authority capability',
        );
      }
      if (content === 'REPOSITORY_EXCLUSIVE') {
        await repository.runExclusive(async () => {
          throw new Error('repository operation was invoked');
        });
      }
      if (content === 'REPOSITORY_DEFERRED') {
        await repository.runDeferred(async () => {
          throw new Error('repository operation was invoked');
        });
      }
      if (content === 'EFFECT_WRITE') {
        await effectLedger.writeAhead({ fixture: 'must be rejected' });
      }
      if (content === 'PLAYER') {
        await session.ports.callPlayer('writer', 'delegated work', signal, {
          resume: false,
        });
      }
      if (content === 'UNRESOLVED') {
        return { outcome: 'unresolved-effect', state: resultState() };
      }

      await writeFile(request.target, `compiled-v3:${content}`);
      return {
        outcome: 'terminal',
        state: resultState(),
        stateDescription: 'schema-3 fixture completed',
      };
    },

    // The phase host must not inspect or invoke the schema-3 optional control
    // surface while driving its one non-interactive turn.
    async exportSnapshot() {
      throw new Error('phase host invoked exportSnapshot');
    },
    async restore() {
      throw new Error('phase host invoked restore');
    },
    async adopt() {
      throw new Error('phase host invoked adopt');
    },
    async describe() {
      throw new Error('phase host invoked describe');
    },
    async apply() {
      throw new Error('phase host invoked apply');
    },
    async unresolvedEffectEnvelopes() {
      throw new Error('phase host invoked unresolvedEffectEnvelopes');
    },
    get retainedGenerationMetadata() {
      throw new Error('phase host observed retainedGenerationMetadata');
    },
    async dispose() {},
  };
}

Object.defineProperty(createPlaybookRuntime, 'compat', {
  value: compat,
  enumerable: true,
  writable: false,
  configurable: false,
});

export default createPlaybookRuntime;

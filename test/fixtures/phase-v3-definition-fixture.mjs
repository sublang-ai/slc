// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A roleless schema-3 compiled-phase fixture whose options validator declares
// the single configured option `definition`, the way a meta-phase bundle
// compiled from a definition carrying a `## Compiled execution` section does
// (DR-028): it rejects the exact empty construction, binds the definition's
// exact text at construction, and writes that text verbatim to the request's
// target or linked artifact so a test can compare it with the file's bytes.
// The seeded Boss turn must carry paths only — a `definition` member on the
// `Request:` line is a host defect the fixture reports.

import { writeFile } from 'node:fs/promises';

const compat = Object.freeze({ artifactSchema: 3, runtimeAbi: 1 });
const LABEL = 'definition fixture';

const isPlainObject = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Validates and snapshots the configured options like a linked bundle's
 * `snapshotOptions`: undeclared keys and a missing or empty `definition`
 * reject before any actor exists.
 */
const snapshotOptions = (value) => {
  if (!isPlainObject(value)) {
    throw new TypeError(`${LABEL} options must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key !== 'definition') {
      throw new TypeError(`${LABEL} options: undeclared option ${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      !descriptor.enumerable
    ) {
      throw new TypeError(
        `${LABEL} options: ${key} must be an enumerable data property`,
      );
    }
  }
  if (typeof value.definition !== 'string' || value.definition === '') {
    throw new TypeError(
      `${LABEL} options: definition must be a non-empty string`,
    );
  }
  return Object.freeze({ definition: value.definition });
};

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
      `${LABEL} factory was not called with exactly one argument`,
    );
  }
  const construction = args[0];
  if (
    !isPlainObject(construction) ||
    Object.keys(construction).length !== 2 ||
    !Object.hasOwn(construction, 'configuredOptions') ||
    !Object.hasOwn(construction, 'hostCapabilities')
  ) {
    throw new Error(`${LABEL} factory argument is not the exact construction`);
  }
  const options = snapshotOptions(construction.configuredOptions);

  return {
    async init() {},

    async handleBossInput({ text }) {
      const marker = 'Request: ';
      const line = text
        .split('\n')
        .find((candidate) => candidate.startsWith(marker));
      const request = JSON.parse(line.slice(marker.length));
      if (Object.hasOwn(request, 'definition')) {
        throw new Error(
          `${LABEL} seed carries the definition on the Request line`,
        );
      }
      const output =
        request.kind === 'compile' ? request.target : request.linked;
      await writeFile(output, options.definition);
      return {
        outcome: 'terminal',
        state: resultState(),
        stateDescription: 'definition fixture echoed its configured option',
      };
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

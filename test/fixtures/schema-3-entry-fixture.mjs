// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// A synthetic role-bearing schema-3 registry entry. It is deliberately
// independent of the installed Playbook generation so Task 3 can exercise the
// future consumer contract while exact Playbook 10 provenance remains dormant.

import { isAbsolute, join } from 'node:path';

import createPlaybookRuntime from './workflow.playbook/workflow.playbook.ts';
export {
  lastLinkedFactoryConstruction,
  lastLinkedFactoryRuntime,
  linkedFactoryCallCount,
} from './workflow.playbook/workflow.playbook.ts';

const ENTRY_ID = 'workflow';
const ENTRY_INTENT = 'Synthetic schema-3 consumer fixture.';
const REQUIRED_ROLE_IDS = Object.freeze(['coder', 'reviewer']);
const CONCURRENT_ROLE_SETS = Object.freeze([
  Object.freeze(['coder', 'reviewer']),
]);

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

export function validateOptions(value) {
  if (value !== undefined) {
    exactPlainRecord(value, [], 'configured options');
  }
  return {};
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
  intent: ENTRY_INTENT,
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

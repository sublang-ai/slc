// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Registry entry exposing the compiled demo workflow to `playbook run`.
 *
 * This is the one piece the compiler does not emit (DR-009 scopes registry
 * and host wiring to the Playbook side): a ~40-line adapter that names the
 * playbook, its required roles — the two players the source declared — and
 * how to construct the linked runtime. The `cwd` option (the script state's
 * working directory) defaults to the process working directory, so running
 * from the demo repository needs no options at all.
 */

import createPlaybookRuntime, {
  type PlaybookRuntime,
  type WorkflowPlaybookOptions,
} from './workflow.zh.playbook/workflow.zh.playbook.ts';

interface RegistryPlayer {
  id: string;
  adapter: string;
  model?: string;
}

function validateWorkflowOptions(value: unknown): WorkflowPlaybookOptions {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('workflow options must be an object');
  }
  const options: WorkflowPlaybookOptions = {};
  for (const [key, option] of Object.entries(value)) {
    if (key !== 'cwd') {
      throw new Error(`unknown workflow option "${key}" (allowed: cwd)`);
    }
    if (typeof option !== 'string' || option === '') {
      throw new Error('workflow option "cwd" must be a non-empty string');
    }
    options.cwd = option;
  }
  return options;
}

const workflowRegistryEntry = {
  id: 'workflow',
  command: 'workflow',
  intent: 'two-agent commit/review/debate loop over the current repository',
  requiredRoleIds: ['编码者', '审查者'],
  validateOptions: validateWorkflowOptions,
  createRuntime(options: {
    captainOptions?: unknown;
    players?: readonly RegistryPlayer[];
  }): PlaybookRuntime {
    const validated = validateWorkflowOptions(options.captainOptions);
    return createPlaybookRuntime({
      cwd: validated.cwd ?? process.cwd(),
    });
  },
};

export default workflowRegistryEntry;

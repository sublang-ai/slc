// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Agent/model configuration and interpreted-executor construction for the `slc`
 * bin (CLI-7, CLI-12, DR-004).
 *
 * `resolveAgentSelection` reads `SLC_AGENT`/`SLC_MODEL` from the environment and
 * refuses an unset or unsupported agent with no implicit default (CLI-12).
 * `createConfiguredExecutor` builds the selected Cligent adapter, wraps it as a
 * transport, and binds the optional model as configuration — not phase
 * semantics (PHEXEC-13); credentials are left for the agent CLI to read from the
 * inherited process environment. The adapter factory is injectable so tests can
 * fake adapter construction. See specs/dev/cli.md.
 */

import { ClaudeCodeAdapter } from '@sublang/cligent/adapters/claude-code';
import { CodexAdapter } from '@sublang/cligent/adapters/codex';
import { GeminiAdapter } from '@sublang/cligent/adapters/gemini';
import { OpenCodeAdapter } from '@sublang/cligent/adapters/opencode';
import type { AgentAdapter, PermissionPolicy } from '@sublang/cligent';

import { createCligentAgent } from './cligent-agent.js';
import type { PhaseExecutor } from './execution.js';
import { createInterpretedExecutor } from './interpreter.js';

/** Agent CLI ids the executable registers (CLI-7). */
export const SUPPORTED_AGENTS = [
  'claude-code',
  'codex',
  'gemini',
  'opencode',
] as const;

/** One of the registered agent CLI ids (CLI-7). */
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

/** Constructs the Cligent adapter for a supported agent id (CLI-7). */
export type AdapterFactory = (agent: SupportedAgent) => AgentAdapter;

/** Default factory: Cligent's built-in adapters, constructed on demand (CLI-7). */
export const defaultAdapterFactory: AdapterFactory = (agent) => {
  switch (agent) {
    case 'claude-code':
      return new ClaudeCodeAdapter();
    case 'codex':
      return new CodexAdapter();
    case 'gemini':
      return new GeminiAdapter();
    case 'opencode':
      return new OpenCodeAdapter();
  }
};

/** A resolved agent/model selection (CLI-7). */
export interface AgentSelection {
  agent: SupportedAgent;
  /** Optional model; omitted so the agent CLI uses its own default. */
  model?: string;
}

/** Machine-readable reason agent configuration was refused (CLI-12). */
export type ConfigErrorCode = 'agent-unset' | 'agent-unsupported';

/** Raised when `SLC_AGENT` is unset or names an unsupported agent CLI (CLI-12). */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

/** Reports whether `agent` is one of the registered ids (CLI-7). */
export function isSupportedAgent(agent: string): agent is SupportedAgent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(agent);
}

/**
 * Resolves the agent/model selection from environment configuration (CLI-7,
 * CLI-12): `SLC_AGENT` names a registered agent CLI and `SLC_MODEL` optionally
 * names a model.
 *
 * @throws {ConfigError} when `SLC_AGENT` is unset/blank (`agent-unset`) or
 *   outside the registered set (`agent-unsupported`); no implicit default agent
 *   is applied.
 */
export function resolveAgentSelection(
  env: Record<string, string | undefined>,
): AgentSelection {
  const agent = (env.SLC_AGENT ?? '').trim();
  if (agent === '') {
    throw new ConfigError(
      'agent-unset',
      `SLC_AGENT is not set; set it to one of: ${SUPPORTED_AGENTS.join(', ')}`,
    );
  }
  if (!isSupportedAgent(agent)) {
    throw new ConfigError(
      'agent-unsupported',
      `SLC_AGENT "${agent}" is not a supported agent CLI; choose one of: ${SUPPORTED_AGENTS.join(', ')}`,
    );
  }
  const model = (env.SLC_MODEL ?? '').trim();
  return { agent, model: model === '' ? undefined : model };
}

/**
 * Builds the interpreted {@link PhaseExecutor} for a selection (CLI-7, CLI-8):
 * constructs the agent CLI's adapter, wraps it as a Cligent-backed transport,
 * and binds the optional model as configuration, not phase semantics
 * (PHEXEC-13). The adapter factory is injectable so tests can fake adapter
 * construction; `permissions` is where a host configures the DR-003 write-scope
 * sandbox.
 */
export function createConfiguredExecutor(
  selection: AgentSelection,
  opts: {
    adapterFactory?: AdapterFactory;
    cwd?: string;
    maxTurns?: number;
    permissions?: PermissionPolicy;
  } = {},
): PhaseExecutor {
  const adapter = (opts.adapterFactory ?? defaultAdapterFactory)(
    selection.agent,
  );
  const agent = createCligentAgent({
    adapter,
    maxTurns: opts.maxTurns,
    permissions: opts.permissions,
  });
  return createInterpretedExecutor({
    agent,
    config: { model: selection.model, cwd: opts.cwd },
  });
}

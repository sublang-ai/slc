// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Agent/model configuration and executor construction for the `slc` bin (CLI-7,
 * CLI-8, CLI-12, DR-004, DR-005).
 *
 * `resolveAgentSelection` reads `SLC_AGENT`/`SLC_MODEL` from the environment and
 * refuses an unset or unsupported agent with no implicit default (CLI-12).
 * `createConfiguredExecutor` builds the interpreted executor and
 * `createConfiguredCompiledFactory` the compiled-execution factory pinned phases
 * select, both over Cligent-backed transports for the selected agent, binding
 * the optional model as configuration — not phase semantics (PHEXEC-13);
 * credentials are left for the agent CLI to read from the inherited process
 * environment. The adapter factory is injectable so tests can fake adapter
 * construction. See specs/dev/cli.md.
 */

import { resolve } from 'node:path';

import { ClaudeCodeAdapter } from '@sublang/cligent/adapters/claude-code';
import { CodexAdapter } from '@sublang/cligent/adapters/codex';
import { GeminiAdapter } from '@sublang/cligent/adapters/gemini';
import { OpenCodeAdapter } from '@sublang/cligent/adapters/opencode';
import type { AgentAdapter, PermissionPolicy } from '@sublang/cligent';

import { createCligentAgent } from './cligent-agent.js';
import { createCompiledExecutor } from './compiled-executor.js';
import type { PhaseExecutor } from './execution.js';
import type { AgentClient } from './interpreter.js';
import { createInterpretedExecutor } from './interpreter.js';
import type { CompiledSelection } from './runner.js';

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
  const agent = createConfiguredAgentClient(selection, opts);
  return createInterpretedExecutor({
    agent,
    config: { model: selection.model, cwd: opts.cwd },
  });
}

/**
 * Builds one Cligent-backed {@link AgentClient} for a selection (CLI-7): a fresh
 * adapter wrapped as a transport. Each client is a single-flight Cligent
 * instance that resumes its own agent session across calls, so callers wanting
 * isolated sessions construct one client per role or player.
 */
export function createConfiguredAgentClient(
  selection: AgentSelection,
  opts: {
    adapterFactory?: AdapterFactory;
    maxTurns?: number;
    permissions?: PermissionPolicy;
  } = {},
): AgentClient {
  const adapter = (opts.adapterFactory ?? defaultAdapterFactory)(
    selection.agent,
  );
  return createCligentAgent({
    adapter,
    maxTurns: opts.maxTurns,
    permissions: opts.permissions,
  });
}

/**
 * Builds the compiled-execution factory the bin injects as `SlcDeps.compiled`
 * (CLI-8, PHEXEC-27): for a current pinned phase it drives the pinned `playbook`
 * artifact — resolved against its pipeline directory — through the compiled
 * executor, backing the runtime's player ports with one agent transport per
 * player id and its Captain/judge ports with one shared transport (PHEXEC-25),
 * and applying the selected model as the default per-player model (PHEXEC-13).
 */
export function createConfiguredCompiledFactory(
  selection: AgentSelection,
  opts: {
    adapterFactory?: AdapterFactory;
    cwd?: string;
    maxTurns?: number;
    permissions?: PermissionPolicy;
  } = {},
): (choice: CompiledSelection) => PhaseExecutor {
  const client = (): AgentClient =>
    createConfiguredAgentClient(selection, opts);
  return (choice) =>
    createCompiledExecutor({
      artifactPath: resolve(choice.pipelineDir, choice.record.artifact.path),
      runRoot: opts.cwd ?? process.cwd(),
      playbookId: choice.phase,
      runtimeContract: runtimeContractForPin(choice),
      player: () => client(),
      judge: client(),
      defaultModel: selection.model,
      cwd: opts.cwd,
    });
}

function runtimeContractForPin(
  choice: CompiledSelection,
): 'legacy' | 'composed-v2' {
  const provenance = choice.record.linkTarget.provenance;
  if (provenance === undefined || provenance === '@sublang/playbook@0.9.0') {
    return 'legacy';
  }
  // Playbook 0.10 ships the composed six-port contract (DR-011); artifacts
  // linked against it run through the composed session profile.
  if (provenance === '@sublang/playbook@0.10.0') {
    return 'composed-v2';
  }
  throw new Error(
    `unsupported pinned Playbook runtime contract: ${provenance}`,
  );
}

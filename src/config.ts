// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Agent/model configuration and executor construction for the `slc` bin (cli-7,
 * cli-8, cli-12, DR-004, DR-005).
 *
 * `resolveAgentSelection` reads the Coder and optional Reviewer selections from
 * the environment and refuses unset or unsupported required values (cli-12,
 * DR-022).
 * `createConfiguredExecutor` builds the interpreted executor and
 * `createConfiguredCompiledFactory` the compiled-execution factory pinned phases
 * select, both over Cligent-backed transports for the selected agent, binding
 * the optional model as configuration — not phase semantics (phase-execution-13);
 * credentials are left for the agent CLI to read from the inherited process
 * environment. The adapter factory is injectable so tests can fake adapter
 * construction. See specs/packages/cli.md.
 */

import { resolve } from 'node:path';

import { ClaudeCodeAdapter } from '@sublang/cligent/adapters/claude-code';
import { CodexAdapter } from '@sublang/cligent/adapters/codex';
import { GeminiAdapter } from '@sublang/cligent/adapters/gemini';
import { OpenCodeAdapter } from '@sublang/cligent/adapters/opencode';
import { isEffortSupported, supportedEffortValues } from '@sublang/cligent';
import type { AgentAdapter, PermissionPolicy } from '@sublang/cligent';

import { createCligentAgent } from './cligent-agent.js';
import { createCompiledExecutor } from './compiled-executor.js';
import type { PhaseExecutor } from './execution.js';
import type { AgentClient } from './interpreter.js';
import { createInterpretedExecutor } from './interpreter.js';
import { createReviewingAgent } from './reviewing-agent.js';
import type { CompiledSelection } from './runner.js';

/** Agent CLI ids the executable registers (cli-7). */
export const SUPPORTED_AGENTS = [
  'claude-code',
  'codex',
  'gemini',
  'opencode',
] as const;

/** One of the registered agent CLI ids (cli-7). */
export type SupportedAgent = (typeof SUPPORTED_AGENTS)[number];

/** Constructs the Cligent adapter for a supported agent id (cli-7). */
export type AdapterFactory = (agent: SupportedAgent) => AgentAdapter;

/** Default factory: Cligent's built-in adapters, constructed on demand (cli-7). */
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

/** A resolved Coder and optional Reviewer selection (cli-7, DR-022). */
export interface AgentSelection {
  agent: SupportedAgent;
  /** Optional model; omitted so the agent CLI uses its own default. */
  model?: string;
  /** Optional adapter-scoped reasoning effort; omitted for the default. */
  effort?: string;
  /** Optional independent Reviewer selection; presence enables DR-022. */
  reviewer?: Omit<AgentSelection, 'reviewer'>;
}

/** Machine-readable reason agent configuration was refused (cli-12). */
export type ConfigErrorCode =
  | 'agent-unset'
  | 'agent-unsupported'
  | 'effort-unsupported'
  | 'reviewer-agent-unset'
  | 'reviewer-agent-unsupported'
  | 'reviewer-effort-unsupported';

/** Raised when a required Coder or Reviewer selection is invalid. */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

/** Reports whether `agent` is one of the registered ids (cli-7). */
export function isSupportedAgent(agent: string): agent is SupportedAgent {
  return (SUPPORTED_AGENTS as readonly string[]).includes(agent);
}

/**
 * Resolves the Coder and optional Reviewer selections from environment configuration
 * (cli-7, cli-12): `SLC_AGENT` names a registered agent CLI, `SLC_MODEL`
 * optionally names a model, and `SLC_EFFORT` optionally selects an
 * adapter-scoped reasoning effort validated against Cligent's support
 * metadata.
 *
 * @throws {ConfigError} when `SLC_AGENT` is unset/blank (`agent-unset`) or
 *   outside the registered set (`agent-unsupported`), or when `SLC_EFFORT`
 *   names a value the selected agent does not support
 *   (`effort-unsupported`); no implicit default agent is applied.
 */
export function resolveAgentSelection(
  env: Record<string, string | undefined>,
): AgentSelection {
  const selection = resolveOneSelection(env, {
    agent: 'SLC_AGENT',
    model: 'SLC_MODEL',
    effort: 'SLC_EFFORT',
    unsetCode: 'agent-unset',
    unsupportedCode: 'agent-unsupported',
    effortCode: 'effort-unsupported',
    required: true,
  });
  if (selection === undefined) {
    throw new Error('required Coder selection unexpectedly resolved empty');
  }
  const reviewer = resolveOneSelection(env, {
    agent: 'SLC_REVIEWER_AGENT',
    model: 'SLC_REVIEWER_MODEL',
    effort: 'SLC_REVIEWER_EFFORT',
    unsetCode: 'reviewer-agent-unset',
    unsupportedCode: 'reviewer-agent-unsupported',
    effortCode: 'reviewer-effort-unsupported',
    required: false,
  });
  return reviewer === undefined ? selection : { ...selection, reviewer };
}

function resolveOneSelection(
  env: Record<string, string | undefined>,
  names: {
    agent: string;
    model: string;
    effort: string;
    unsetCode: ConfigErrorCode;
    unsupportedCode: ConfigErrorCode;
    effortCode: ConfigErrorCode;
    required: boolean;
  },
): Omit<AgentSelection, 'reviewer'> | undefined {
  const agent = (env[names.agent] ?? '').trim();
  const model = (env[names.model] ?? '').trim();
  const effort = (env[names.effort] ?? '').trim();
  if (agent === '') {
    if (!names.required && model === '' && effort === '') return undefined;
    throw new ConfigError(
      names.unsetCode,
      names.required
        ? `${names.agent} is not set; set it to one of: ${SUPPORTED_AGENTS.join(', ')}`
        : `${names.agent} is not set; ${names.model} and ${names.effort} require a reviewer agent; set ${names.agent} to one of: ${SUPPORTED_AGENTS.join(', ')}`,
    );
  }
  if (!isSupportedAgent(agent)) {
    throw new ConfigError(
      names.unsupportedCode,
      `${names.agent} "${agent}" is not a supported agent CLI; choose one of: ${SUPPORTED_AGENTS.join(', ')}`,
    );
  }
  if (effort !== '' && !isEffortSupported(agent, effort)) {
    throw new ConfigError(
      names.effortCode,
      `${names.effort} "${effort}" is not supported by ${agent}; choose one of: ${(supportedEffortValues(agent) ?? []).join(', ')}`,
    );
  }
  return {
    agent,
    model: model === '' ? undefined : model,
    effort: effort === '' ? undefined : effort,
  };
}

/**
 * Builds the interpreted {@link PhaseExecutor} for a selection (cli-7, cli-8):
 * constructs the agent CLI's adapter, wraps it as a Cligent-backed transport,
 * and binds the optional model as configuration, not phase semantics
 * (phase-execution-13). The adapter factory is injectable so tests can fake adapter
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
    /** Agent-stall watchdog window in milliseconds; 0/absent disables (DR-019). */
    stallTimeoutMs?: number;
  } = {},
): PhaseExecutor {
  const coder = createConfiguredAgentClient(selection, opts);
  const agent = configuredReviewingClient(selection, coder, opts);
  return createInterpretedExecutor({
    agent,
    config: { model: selection.model, cwd: opts.cwd },
  });
}

/**
 * Builds one Cligent-backed {@link AgentClient} for a selection (cli-7): a fresh
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
    /** Agent-stall watchdog window in milliseconds; 0/absent disables (DR-019). */
    stallTimeoutMs?: number;
  } = {},
): AgentClient {
  const adapter = (opts.adapterFactory ?? defaultAdapterFactory)(
    selection.agent,
  );
  return createCligentAgent({
    adapter,
    maxTurns: opts.maxTurns,
    permissions: opts.permissions,
    effort: selection.effort,
    stallTimeoutMs: opts.stallTimeoutMs,
  });
}

/**
 * Builds the compiled-execution factory the bin injects as `SlcDeps.compiled`
 * (cli-8, phase-execution-27): for a current pinned phase it drives the pinned `playbook`
 * artifact — resolved against its pipeline directory — through the compiled
 * executor, backing the runtime's player ports with one agent transport per
 * player id and its Captain/judge ports with one shared transport; the dormant
 * roleless composed-v3 path rejects its player port before that lazy player
 * transport is constructed (phase-execution-25). The factory applies the
 * selected model as the default per-player model (phase-execution-13).
 */
export function createConfiguredCompiledFactory(
  selection: AgentSelection,
  opts: {
    adapterFactory?: AdapterFactory;
    cwd?: string;
    maxTurns?: number;
    permissions?: PermissionPolicy;
    /** Agent-stall watchdog window in milliseconds; 0/absent disables (DR-019). */
    stallTimeoutMs?: number;
    /** Live status sink streaming the runtime's non-trace status (DR-019, phase-execution-25). */
    onStatus?: (line: string) => void;
  } = {},
): (choice: CompiledSelection) => PhaseExecutor {
  const client = (): AgentClient => {
    const coder = createConfiguredAgentClient(selection, opts);
    return configuredReviewingClient(selection, coder, opts);
  };
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
      onStatus: opts.onStatus,
    });
}

function configuredReviewingClient(
  selection: AgentSelection,
  coder: AgentClient,
  opts: Parameters<typeof createConfiguredAgentClient>[1],
): AgentClient {
  const reviewer = selection.reviewer;
  if (reviewer === undefined) return coder;
  return createReviewingAgent({
    coder,
    reviewer: () =>
      createConfiguredAgentClient(reviewer, {
        ...opts,
        // Reviewer inspection is read-only even though the Coder is allowed to
        // write its declared artifact (DR-022).
        permissions: {
          fileWrite: 'deny',
          shellExecute: 'deny',
          networkAccess: 'deny',
        },
      }),
    reviewerModel: reviewer.model,
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
  // linked against it run through the composed session profile. 1.0.0 is the
  // published release of that same contract generation — 0.10.0 was cut
  // locally and superseded before it ever reached the registry. 2.0.0 keeps
  // the six-port boundary and structured results while moving Captain host
  // failures onto the resolved `failed` path and emitting thin linked
  // modules (DR-017), so all three provenances select the composed profile.
  // 3.1.0 ships runtime.ts byte-identical to 2.0.0 and only adds the
  // additive DR-022 compat self-report on the shared engine, so it selects
  // the same profile (DR-018). 4.0.0 keeps runtime.ts and the engine
  // byte-identical to 3.1.0's — its major marks the SDK-topology break,
  // with cligent owning runtime versions, not a contract change — so it
  // selects the same profile (DR-020). 1.3.0 and 3.0.0 were never
  // installed or reviewed here and stay fail-closed. Exact Playbook 10 remains
  // deliberately unmapped until IR-023's atomic adoption task activates the
  // already-wired composed-v3 host together with its reviewed asset closure.
  if (
    provenance === '@sublang/playbook@0.10.0' ||
    provenance === '@sublang/playbook@1.0.0' ||
    provenance === '@sublang/playbook@2.0.0' ||
    provenance === '@sublang/playbook@3.1.0' ||
    provenance === '@sublang/playbook@4.0.0'
  ) {
    return 'composed-v2';
  }
  throw new Error(
    `unsupported pinned Playbook runtime contract: ${provenance}`,
  );
}

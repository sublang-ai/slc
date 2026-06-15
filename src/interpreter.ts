// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Interpreted phase execution (DR-004).
 *
 * `createInterpretedExecutor` implements the {@link PhaseExecutor} boundary by
 * prompting a coding agent once per phase (PHEXEC-12) with the phase or link
 * definition and the phase inputs (PHEXEC-11), establishing the agent contract
 * (PHEXEC-14) and allowing the agent to run definition-called tools and read
 * cited content (PHEXEC-15). The agent is reached through an injected
 * {@link AgentClient}; the Cligent-backed default lives in cligent-agent.ts so
 * this core stays transport-free and testable. Agent and model selection are
 * configuration, not phase semantics (PHEXEC-13). See
 * specs/dev/phase-execution.md.
 */

import { readFile } from 'node:fs/promises';

import type {
  ExecuteRequest,
  ExecutorResult,
  LinkOptionPair,
  PhaseExecutor,
} from './execution.js';

/** A single agent invocation: a prompt plus per-run configuration. */
export interface AgentRunRequest {
  prompt: string;
  cwd?: string;
  model?: string;
  signal: AbortSignal;
}

/** The normalized outcome of one agent invocation. */
export interface AgentRunResult {
  /** `success` when the agent finished cleanly; otherwise it did not. */
  status: 'success' | 'error' | 'incomplete';
  /** The agent's final textual report (its summary, or `BLOCKED:` lines). */
  text: string;
}

/** The transport to a coding agent, backed by Cligent in production. */
export interface AgentClient {
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}

/** Agent/model selection, applied as configuration not phase semantics (PHEXEC-13). */
export interface InterpreterConfig {
  model?: string;
  cwd?: string;
}

/**
 * Builds the agent-contract prompt for a phase from its definition and inputs
 * (PHEXEC-11, PHEXEC-14, PHEXEC-15).
 */
export function buildPhasePrompt(opts: {
  request: ExecuteRequest;
  definition: string;
}): string {
  const { request, definition } = opts;
  const target = request.kind === 'compile' ? request.target : request.linked;
  const inputs =
    request.kind === 'compile'
      ? [`source to read: ${request.source}`]
      : [
          `object artifacts to read, in order: ${request.objects.join(', ')}`,
          `link target module: ${request.linkTarget}`,
          `options: ${formatOptions(request.options)}`,
        ];

  return [
    'You are executing one phase of the SubLang Compiler (slc).',
    'The phase definition below is authoritative; follow it exactly and add no rules of your own.',
    '',
    '--- DEFINITION ---',
    definition,
    '--- END DEFINITION ---',
    '',
    'Inputs:',
    ...inputs.map((line) => `- ${line}`),
    `- artifact to write: ${target}`,
    '',
    'Contract — you must:',
    `- write only ${target}, creating or overwriting exactly that file;`,
    '- not edit the sources, the phase or link definition, specs, link targets, object artifacts, or any other file;',
    '- not commit or otherwise touch version control;',
    '- produce a complete artifact, not a sketch or placeholder;',
    '- add no domain semantics beyond what the source implies or the definition requires, and drop nothing the source states;',
    '- preserve verbatim any content the definition requires to be preserved;',
    '- run only the deterministic tools or commands the definition calls for, and read only the content it cites or references;',
    '- verify the produced artifact against the definition before finishing.',
    '',
    'When done, reply with a concise summary of what you produced and any ambiguity you resolved.',
    'If the inputs are malformed under the definition, or the definition is incompatible with them, do not guess: leave the artifact unwritten and reply with a line beginning "BLOCKED:" followed by the concrete reason(s).',
  ].join('\n');
}

/**
 * Creates a {@link PhaseExecutor} that interprets a phase via one agent
 * invocation (DR-004). Plugs into the DR-003 boundary (`runPhase`), which
 * applies the generic checks to whatever the agent wrote.
 */
export function createInterpretedExecutor(opts: {
  agent: AgentClient;
  config?: InterpreterConfig;
}): PhaseExecutor {
  const { agent } = opts;
  const config = opts.config ?? {};

  return {
    async run(
      request: ExecuteRequest,
      signal: AbortSignal,
    ): Promise<ExecutorResult> {
      const definition = await readFile(request.definitionPath, 'utf8');
      const prompt = buildPhasePrompt({ request, definition });
      const response = await agent.run({
        prompt,
        cwd: config.cwd,
        model: config.model,
        signal,
      });

      if (response.status !== 'success') {
        const fallback =
          response.status === 'incomplete'
            ? 'agent did not finish'
            : 'agent reported an error';
        return {
          status: 'error',
          diagnostics: textLines(response.text, fallback),
        };
      }

      const blocked = blockedReasons(response.text);
      if (blocked !== null) {
        return { status: 'blocked', diagnostics: blocked };
      }
      return { status: 'ok', diagnostics: textLines(response.text) };
    },
  };
}

function formatOptions(options: readonly LinkOptionPair[]): string {
  if (options.length === 0) return '(none)';
  return options.map((option) => `${option.name}=${option.value}`).join(', ');
}

/** Returns the `BLOCKED:` diagnostic lines, or `null` when the agent did not block. */
function blockedReasons(text: string): string[] | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => /^BLOCKED\b/i.test(line));
  if (start === -1) return null;
  const reasons = lines.slice(start).filter((line) => line.length > 0);
  return reasons.length > 0 ? reasons : ['BLOCKED'];
}

function textLines(text: string, fallback?: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length > 0) return lines;
  return fallback ? [fallback] : [];
}

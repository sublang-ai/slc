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
import {
  UPDATE_TRACE_SCHEMA,
  canonicalJson,
  parseUpdateTrace,
  type UpdateTrace,
} from './build-record.js';
import {
  appendWorkspaceContract,
  type WorkspaceReadBinding,
  type WorkspaceRecord,
} from './workspace.js';

/** A single agent invocation: a prompt plus per-run configuration. */
export interface AgentRunRequest {
  prompt: string;
  cwd?: string;
  model?: string;
  /** Explicit backend continuation selection for Playbook player calls. */
  resume?: string | false;
  /** Explicit tool allowlist for isolated Playbook Captain control calls. */
  allowedTools?: readonly string[];
  signal: AbortSignal;
}

/** The normalized outcome of one agent invocation. */
export interface AgentRunResult {
  /** `success` when the agent finished cleanly; otherwise it did not. */
  status: 'success' | 'error' | 'incomplete';
  /** The agent's final textual report (its summary, or `BLOCKED:` lines). */
  text: string;
  /** Opaque backend continuation token, when the transport exposes one. */
  resumeToken?: string;
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
  workspace: WorkspaceRecord;
}): string {
  const { request, definition, workspace } = opts;
  const target = workspace.write.logicalPath;
  const inputs =
    request.kind === 'compile'
      ? [
          `source to read: ${logicalRead(workspace, 'source')}`,
          ...workspace.reads
            .filter((read) => read.role.startsWith('reference:'))
            .map(
              (read) => `reference to consult (read-only): ${read.logicalPath}`,
            ),
          ...workspace.reads
            .filter((read) => read.role.startsWith('semantic-input:'))
            .map(
              (read) => `declared semantic input to read: ${read.logicalPath}`,
            ),
        ]
      : [
          `object artifacts to read, in order: ${workspace.reads
            .filter((read) => read.role.startsWith('object:'))
            .map((read) => read.logicalPath)
            .join(', ')}`,
          `link target module: ${logicalRead(workspace, 'link-target')}`,
          ...workspace.reads
            .filter((read) => read.role.startsWith('semantic-input:'))
            .map(
              (read) => `declared semantic input to read: ${read.logicalPath}`,
            ),
          `options: ${formatOptions(request.options)}`,
        ];

  const prompt = [
    'You are executing one phase of the SubLang Compiler (slc).',
    'The phase definition below is authoritative; follow it exactly and add no rules of your own.',
    '',
    '--- DEFINITION ---',
    definition,
    '--- END DEFINITION ---',
    '',
    'Logical request:',
    `- phase definition: ${logicalRead(workspace, 'definition')}`,
    ...inputs.map((line) => `- ${line}`),
    `- artifact to produce: ${target}`,
    '',
    'Contract — you must:',
    '- treat every logical path above as a semantic identifier only, with no filesystem authority;',
    '- use the final host workspace binding as the sole filesystem authority for its named host-supplied reads and write sink;',
    '- write only the one host-bound physical sink named by that final binding, and do not write the canonical logical target when it differs from that sink;',
    '- not edit sources, phase or link definitions, specs, link targets, object artifacts, or any unrelated file;',
    '- not commit or otherwise touch version control;',
    '- produce a complete artifact, not a sketch or placeholder;',
    '- add no domain semantics beyond what the source implies or the definition requires, and drop nothing the source states;',
    '- preserve verbatim any content the definition requires to be preserved;',
    '- run the deterministic tools or commands the definition calls for and read the content it cites or references as needed to follow it;',
    '- verify the complete produced artifact against the definition before finishing.',
    '',
    ...updateInstructions(request),
    'When done, reply with a concise summary of what you produced, any ambiguity you resolved, and any diagnostics.',
    'If the inputs are malformed under the definition, or the definition is incompatible with them, do not guess: leave the artifact unwritten and reply with a line beginning "BLOCKED:" followed by the concrete reason(s).',
  ].join('\n');

  return appendWorkspaceContract(prompt, workspace);
}

/**
 * Renders the scoped-update contract into the prompt when the request
 * carries one: what changed, which target scopes may move, and the exact
 * replacement metadata the host will check the candidate against
 * (DR-021 §Update request).
 */
function updateInstructions(request: ExecuteRequest): string[] {
  if (request.kind !== 'compile' || request.update === undefined) return [];
  const update = request.update;
  return [
    '',
    'Scoped update — this is not a fresh compile:',
    '- the prior source is bound as the read named "prior-input" and the artifact you produced from it as "prior-target";',
    `- exactly these half-open byte ranges of the source changed: ${update.changes
      .map(
        (hunk) =>
          `prior[${hunk.priorStart},${hunk.priorEnd}) -> current[${hunk.currentStart},${hunk.currentEnd})`,
      )
      .join('; ')};`,
    `- you may rewrite only these target scopes: ${update.allowedTargetScopes.join(', ')};`,
    '- every other byte of the prior target must survive exactly, including whitespace — the host compares them and rejects the run otherwise;',
    '- write the complete updated artifact to the sink, never a patch;',
    `- the scopes and dependencies you were given last time are: ${canonicalJson(update.priorTrace)};`,
    '- reply with the reserved result suffix carrying replacement metadata whose input partition describes the current source and whose target partition describes exactly the bytes you wrote.',
  ];
}

function logicalRead(workspace: WorkspaceRecord, role: string): string {
  return requiredRead(workspace, role).logicalPath;
}

function requiredRead(
  workspace: WorkspaceRecord,
  role: string,
): WorkspaceReadBinding {
  const read = workspace.reads.find((candidate) => candidate.role === role);
  if (read === undefined) {
    throw new Error(`workspace is missing required ${role} read`);
  }
  return read;
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
      workspace: WorkspaceRecord,
      signal: AbortSignal,
    ): Promise<ExecutorResult> {
      const definition = await readFile(
        requiredRead(workspace, 'definition').physicalPath,
        'utf8',
      );
      const prompt = buildPhasePrompt({ request, definition, workspace });
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

      // The reserved suffix is stripped before any status or diagnostic
      // parsing, so neither the markers nor the payload can reach either
      // (PHEXEC-39). A malformed occurrence yields no metadata and one host
      // diagnostic, never a failed phase.
      const decoded = decodeInterpretedResult(response.text);
      const blocked = blockedReasons(decoded.text);
      if (blocked !== null) {
        return {
          status: 'blocked',
          diagnostics: [...blocked, ...decoded.diagnostics],
        };
      }
      return {
        status: 'ok',
        diagnostics: [...textLines(decoded.text), ...decoded.diagnostics],
        ...(decoded.trace === null
          ? {}
          : { metadata: { [UPDATE_TRACE_SCHEMA]: decoded.trace } }),
      };
    },
  };
}

function formatOptions(options: readonly LinkOptionPair[]): string {
  if (options.length === 0) return '(none)';
  return options.map((option) => `${option.name}=${option.value}`).join(', ');
}

/** Reserved markers delimiting the SLC-owned interpreted result envelope. */
export const RESULT_BEGIN = 'SLC_RESULT_BEGIN';
export const RESULT_END = 'SLC_RESULT_END';
const INTERPRETED_RESULT_SCHEMA = 'sublang.slc.interpreted-result.v1';

interface DecodedInterpretedResult {
  /** The agent prose with every reserved block removed. */
  readonly text: string;
  readonly trace: UpdateTrace | null;
  readonly diagnostics: string[];
}

/**
 * Extracts the at-most-one reserved suffix from an agent's final text.
 *
 * A valid suffix is exactly BEGIN, one canonical-JSON line, END as the final
 * nonblank lines. Anything else — duplicated, misplaced, unterminated, or
 * malformed — withholds every reserved block from status and diagnostic
 * parsing, supplies no metadata, and adds one host diagnostic; the agent's
 * ordinary status still stands (DR-021, PHEXEC-39).
 */
function decodeInterpretedResult(text: string): DecodedInterpretedResult {
  const lines = text.split(/\r?\n/);
  const marked = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(
      (entry) => entry.line === RESULT_BEGIN || entry.line === RESULT_END,
    );
  if (marked.length === 0) return { text, trace: null, diagnostics: [] };

  // Strip from the first reserved marker so no marker or payload text can
  // reach status parsing or diagnostics.
  const withheld = (): DecodedInterpretedResult => ({
    text: lines.slice(0, marked[0].index).join('\n'),
    trace: null,
    diagnostics: ['slc: ignored a malformed reserved result block'],
  });

  let lastNonblank = lines.length - 1;
  while (lastNonblank >= 0 && lines[lastNonblank].trim() === '') lastNonblank--;
  const [begin, end] = marked;
  if (
    marked.length !== 2 ||
    begin.line !== RESULT_BEGIN ||
    end.line !== RESULT_END ||
    begin.index + 2 !== end.index ||
    end.index !== lastNonblank
  ) {
    return withheld();
  }

  const payload = lines[begin.index + 1].trim();
  let trace: UpdateTrace;
  try {
    const parsed = JSON.parse(payload) as {
      metadata?: Record<string, unknown>;
    };
    trace = parseUpdateTrace(
      parsed.metadata?.[UPDATE_TRACE_SCHEMA],
      'metadata',
    );
    // One canonical line with exactly these fields in this order: the round
    // trip subsumes every field, ordering, and encoding check.
    const canonical = canonicalJson({
      schema: INTERPRETED_RESULT_SCHEMA,
      metadata: { [UPDATE_TRACE_SCHEMA]: trace },
    });
    if (canonical !== payload) return withheld();
  } catch {
    return withheld();
  }
  return {
    text: lines.slice(0, begin.index).join('\n'),
    trace,
    diagnostics: [],
  };
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

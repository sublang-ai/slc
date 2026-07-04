// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Cligent-backed `PlaybookPorts` adapter for compiled phase execution (PHEXEC-25;
 * DR-005, DR-004).
 *
 * A compiled artifact reaches coding agents and judges only through Playbook's
 * source-owned ports. This adapter backs those ports with the same
 * {@link AgentClient} transport the interpreter uses (Cligent in production,
 * fakes in tests): `callPlayer` runs a coding agent — selecting the per-player
 * model as configuration, not phase semantics (PHEXEC-13) — and `callJudge` runs
 * a judge and returns its text. The artifact's `emitStatus`/`emitTelemetry`
 * emissions are collected here so {@link PlaybookPortsAdapter.drainDiagnostics}
 * can surface them as diagnostics for every run status (DR-005). The adapter holds
 * no host specifics beyond the injected transports. See
 * specs/dev/phase-execution.md.
 */

import type { PlaybookPorts, PlayerResult } from '@sublang/playbook/runtime';

import type { AgentClient, AgentRunResult } from './interpreter.js';

/** A {@link PlaybookPorts} whose collected status and telemetry can be drained (DR-005). */
export interface PlaybookPortsAdapter extends PlaybookPorts {
  /** Returns the status and telemetry collected since the last drain, and clears them. */
  drainDiagnostics(): string[];
}

/**
 * The transport(s) backing `callPlayer`: one shared client, or a per-player
 * factory so each player id keeps its own agent session (a Cligent transport is
 * single-flight and resumes its own session across calls).
 */
export type PlayerTransport = AgentClient | ((playerId: string) => AgentClient);

/** Builds a {@link PlaybookPortsAdapter} over coding-agent transports (PHEXEC-25). */
export function createPlaybookPorts(opts: {
  /** Transport backing `callPlayer`; a factory yields one client per player id. */
  player: PlayerTransport;
  /** Transport backing `callJudge`. */
  judge: AgentClient;
  /** Per-player model binding, applied as configuration (PHEXEC-13). */
  models?: Readonly<Record<string, string>>;
  /** Model for players the `models` binding does not name (PHEXEC-13). */
  defaultModel?: string;
  /** Working directory handed to the transports. */
  cwd?: string;
}): PlaybookPortsAdapter {
  const diagnostics: string[] = [];
  const players = new Map<string, AgentClient>();
  const playerFor = (playerId: string): AgentClient => {
    if (typeof opts.player !== 'function') return opts.player;
    let client = players.get(playerId);
    if (client === undefined) {
      client = opts.player(playerId);
      players.set(playerId, client);
    }
    return client;
  };

  return {
    async callPlayer(
      playerId: string,
      prompt: string,
      signal: AbortSignal,
    ): Promise<PlayerResult> {
      const result = await playerFor(playerId).run({
        prompt,
        model: opts.models?.[playerId] ?? opts.defaultModel,
        cwd: opts.cwd,
        signal,
      });
      return toPlayerResult(result, signal);
    },

    async callJudge(prompt: string, signal: AbortSignal): Promise<string> {
      const result = await opts.judge.run({
        prompt,
        model: opts.defaultModel,
        cwd: opts.cwd,
        signal,
      });
      if (result.status !== 'success') {
        throw new Error(
          `judge did not complete (${result.status})${result.text ? `: ${result.text}` : ''}`,
        );
      }
      return result.text;
    },

    async emitStatus(message: string, data?: unknown): Promise<void> {
      diagnostics.push(
        data === undefined ? message : `${message} ${stringify(data)}`,
      );
    },

    async emitTelemetry(event: {
      topic: string;
      payload: unknown;
    }): Promise<void> {
      diagnostics.push(`[${event.topic}] ${stringify(event.payload)}`);
    },

    drainDiagnostics(): string[] {
      return diagnostics.splice(0);
    },
  };
}

/** Maps a normalized agent outcome onto Playbook's {@link PlayerResult} (DR-005). */
function toPlayerResult(
  result: AgentRunResult,
  signal: AbortSignal,
): PlayerResult {
  switch (result.status) {
    case 'success':
      return { status: 'ok', finalText: result.text };
    case 'error':
      return {
        status: 'error',
        error: result.text || 'agent reported an error',
      };
    case 'incomplete':
      return signal.aborted
        ? { status: 'aborted' }
        : { status: 'error', error: result.text || 'agent did not finish' };
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

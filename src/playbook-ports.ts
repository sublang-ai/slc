// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Cligent-backed `PlaybookPorts` adapter for compiled phase execution (PHEXEC-25;
 * DR-005, DR-004).
 *
 * A compiled artifact reaches coding agents and judges only through Playbook's
 * source-owned ports. This adapter backs those ports with the same
 * {@link AgentClient} transport the interpreter uses (Cligent in production,
 * fakes in tests): `callPlayer` runs a coding agent with Playbook's explicit
 * continuation selection, `callJudge` serializes the single-flight judge,
 * `callPlaybook` fails closed because SLC has no child stack, and status plus
 * non-trace operational telemetry can be drained as diagnostics. Exact
 * `playbook.trace` payloads stay out of ordinary diagnostics (DR-010). The
 * adapter holds no host specifics beyond the injected transports. See
 * specs/dev/phase-execution.md.
 */

import type { AgentClient, AgentRunResult } from './interpreter.js';
import type {
  CompatiblePlaybookPorts,
  PlaybookCallRequest,
  PlaybookCallStart,
  PlayerCallOptions,
  PlayerResult,
} from './playbook-contract.js';

/** Source-owned ports plus a host-only non-sensitive diagnostic drain. */
export interface PlaybookPortsAdapter extends CompatiblePlaybookPorts {
  /** Returns collected status/operational telemetry and clears the buffer. */
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
  let judgeGate: Promise<void> = Promise.resolve();
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
      options?: PlayerCallOptions,
    ): Promise<PlayerResult> {
      const result = await playerFor(playerId).run({
        prompt,
        model: opts.models?.[playerId] ?? opts.defaultModel,
        cwd: opts.cwd,
        ...(options !== undefined ? { resume: options.resume } : {}),
        signal,
      });
      return toPlayerResult(result, signal);
    },

    async callJudge(prompt: string, signal: AbortSignal): Promise<string> {
      return withSerialJudge(signal, async () => {
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
      });
    },

    async callPlaybook(
      request: PlaybookCallRequest,
    ): Promise<PlaybookCallStart> {
      return unsupportedNestedCall(request);
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
      if (event.topic === 'playbook.trace') return;
      diagnostics.push(`[${event.topic}] ${stringify(event.payload)}`);
    },

    drainDiagnostics(): string[] {
      return diagnostics.splice(0);
    },
  };

  async function withSerialJudge<T>(
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = judgeGate;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    judgeGate = previous.then(() => gate);

    try {
      await waitForGate(previous, signal);
    } catch (error) {
      void previous.then(release, release);
      throw error;
    }

    try {
      if (signal.aborted) throw abortReason(signal);
      return await run();
    } finally {
      release();
    }
  }
}

/** Maps a normalized agent outcome onto Playbook's {@link PlayerResult} (DR-005). */
function toPlayerResult(
  result: AgentRunResult,
  signal: AbortSignal,
): PlayerResult {
  const continuation =
    result.resumeToken === undefined ? {} : { resumeToken: result.resumeToken };
  switch (result.status) {
    case 'success':
      return { status: 'ok', finalText: result.text, ...continuation };
    case 'error':
      return {
        status: 'error',
        error: result.text || 'agent reported an error',
        ...continuation,
      };
    case 'incomplete':
      return signal.aborted
        ? { status: 'aborted', ...continuation }
        : {
            status: 'error',
            error: result.text || 'agent did not finish',
            ...continuation,
          };
  }
}

function unsupportedNestedCall(
  request: PlaybookCallRequest,
): PlaybookCallStart {
  return {
    state: 'settled',
    result: {
      status: 'error',
      playbookId: request.playbookId,
      error: {
        name: 'UnsupportedOperationError',
        message:
          'nested playbook calls are unavailable in SLC compiled phase execution',
      },
    },
  };
}

function waitForGate(gate: Promise<void>, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void gate.then(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('operation aborted');
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

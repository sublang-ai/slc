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
 * continuation selection, `callCaptain` and `callJudge` share the Captain
 * transport's single-flight queue, `callPlaybook` fails closed because SLC has
 * no child stack, and status plus non-trace operational telemetry can be
 * drained as diagnostics. A transformation-performing direct Captain call —
 * one whose source-owned options carry no tool restriction — additionally
 * carries the host workspace contract appended to its composed prompt, because
 * the linked artifact is host-agnostic and only the host owns the request's
 * workspace paths (PHEXEC-34). Exact `playbook.trace` payloads stay out of ordinary
 * diagnostics (DR-010, DR-011). The adapter holds no host specifics beyond the
 * injected transports. See specs/dev/phase-execution.md.
 */

import type { AgentClient, AgentRunResult } from './interpreter.js';
import type {
  CaptainCallOptions,
  CaptainResult,
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
  /** Shared transport backing `callCaptain` and `callJudge`. */
  judge: AgentClient;
  /** Per-player model binding, applied as configuration (PHEXEC-13). */
  models?: Readonly<Record<string, string>>;
  /** Model for players the `models` binding does not name (PHEXEC-13). */
  defaultModel?: string;
  /** Working directory handed to the transports. */
  cwd?: string;
  /**
   * Host workspace contract appended to transformation-performing direct
   * Captain prompts — those whose source-owned options carry no `allowedTools`
   * restriction (PHEXEC-34). Routing-only Captain and judge calls never
   * carry it.
   */
  captainWorkspace?: string;
}): PlaybookPortsAdapter {
  const diagnostics: string[] = [];
  const players = new Map<string, AgentClient>();
  let captainGate: Promise<void> = Promise.resolve();
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

    async callCaptain(
      prompt: string,
      signal: AbortSignal,
      options: CaptainCallOptions,
    ): Promise<CaptainResult> {
      const isolation = requireCaptainCallOptions(options);
      // A transformation-performing Captain (absent source-owned tool
      // restriction) gets the host workspace contract appended: the artifact
      // composes host-agnostic prompts, and only the host knows the request's
      // absolute source/target paths (PHEXEC-34).
      const transported =
        isolation.allowedTools === undefined &&
        opts.captainWorkspace !== undefined
          ? `${prompt}\n\n${opts.captainWorkspace}`
          : prompt;
      return withSerialCaptain(signal, async () => {
        const result = await opts.judge.run({
          prompt: transported,
          model: opts.defaultModel,
          cwd: opts.cwd,
          resume: isolation.resume,
          allowedTools: isolation.allowedTools,
          signal,
        });
        return toCaptainResult(result, signal);
      });
    },

    async callJudge(prompt: string, signal: AbortSignal): Promise<string> {
      return withSerialCaptain(signal, async () => {
        const result = await opts.judge.run({
          prompt,
          model: opts.defaultModel,
          cwd: opts.cwd,
          resume: false,
          allowedTools: [],
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

  async function withSerialCaptain<T>(
    signal: AbortSignal,
    run: () => Promise<T>,
  ): Promise<T> {
    const previous = captainGate;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    captainGate = previous.then(() => gate);

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

/** Maps a normalized agent outcome onto Playbook's direct-Captain result. */
function toCaptainResult(
  result: AgentRunResult,
  signal: AbortSignal,
): CaptainResult {
  switch (result.status) {
    case 'success':
      return { status: 'ok', finalText: result.text };
    case 'error':
      return {
        status: 'error',
        error: result.text || 'Captain agent reported an error',
      };
    case 'incomplete':
      return signal.aborted
        ? { status: 'aborted' }
        : {
            status: 'error',
            error: result.text || 'Captain agent did not finish',
          };
  }
}

function requireCaptainCallOptions(options: CaptainCallOptions): {
  resume: false;
  allowedTools?: readonly [];
} {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('callCaptain requires CaptainCallOptions');
  }
  const visibility = Object.getOwnPropertyDescriptor(options, 'visibility');
  if (
    visibility === undefined ||
    !Object.prototype.hasOwnProperty.call(visibility, 'value') ||
    (visibility.value !== 'visible' && visibility.value !== 'hidden')
  ) {
    throw new TypeError(
      'callCaptain options.visibility must be visible or hidden',
    );
  }
  const resume = Object.getOwnPropertyDescriptor(options, 'resume');
  if (
    resume === undefined ||
    !Object.prototype.hasOwnProperty.call(resume, 'value') ||
    resume.value !== false
  ) {
    throw new TypeError('callCaptain options.resume must be false');
  }
  // The tool restriction is source-owned (link.md §PlaybookPorts contract):
  // a routing-only Captain passes an explicitly empty allowlist; a
  // transformation-performing Captain omits the property so the host
  // Captain works with its tools.
  const allowedTools = Object.getOwnPropertyDescriptor(options, 'allowedTools');
  if (allowedTools === undefined) {
    return { resume: false };
  }
  if (
    !Object.prototype.hasOwnProperty.call(allowedTools, 'value') ||
    !Array.isArray(allowedTools.value) ||
    allowedTools.value.length !== 0
  ) {
    throw new TypeError(
      'callCaptain options.allowedTools must be absent or an explicitly empty array',
    );
  }
  return { resume: false, allowedTools: [] };
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

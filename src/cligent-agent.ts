// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Cligent-backed {@link AgentClient} (DR-004).
 *
 * Backs the interpreter's agent transport with Cligent (npm `@sublang/cligent`),
 * draining its event stream into a normalized {@link AgentRunResult}. The host
 * supplies the concrete `AgentAdapter` (e.g. Claude Code, Codex) and any write
 * permissions, keeping agent selection a configuration concern (phase-execution-13); the
 * DR-003 write-scope sandbox would be configured here via `permissions`.
 *
 * The transport also owns the agent-stall watchdog (DR-019, phase-execution-36): with a
 * positive `stallTimeoutMs`, an in-flight call that observes no adapter event
 * for that window is aborted through a call-local controller — the caller's
 * signal is composed in, never mutated — and reported as an error carrying the
 * inactivity duration. Cligent's abort drain guarantees the event loop then
 * terminates promptly with a terminal event, so a tripped watchdog cannot
 * itself hang. No retry occurs at this seam (phase-execution-12, phase-execution-23).
 *
 * This transport is exercised by integration runs and by tests that fake the
 * adapter's event stream. See specs/packages/phase-execution.md.
 */

import { Cligent } from '@sublang/cligent';
import type {
  AgentAdapter,
  AgentEvent,
  Effort,
  PermissionPolicy,
} from '@sublang/cligent';

import type { AgentClient, AgentRunResult } from './interpreter.js';
import { formatElapsed } from './progress.js';

/** Timer seams for the stall watchdog; injected in tests. */
export interface WatchdogTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * The production watchdog timers. Exported so a test can assert the ref
 * behavior the watchdog's correctness depends on, which an injected fake
 * would bypass.
 */
export const defaultWatchdogTimers: WatchdogTimers = {
  // Deliberately referenced: the watchdog is the only thing guaranteed to end
  // a stalled call, so it must hold the event loop open for its window. An
  // unref'd timer lets Node exit the moment a dead agent transport stops
  // holding I/O, killing the run before the stall is ever diagnosed. The
  // timer is cleared on every event and in `dispose`, so it cannot outlive
  // the call it guards.
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** Wraps a Cligent adapter as an {@link AgentClient} for the interpreter. */
export function createCligentAgent(opts: {
  adapter: AgentAdapter;
  maxTurns?: number;
  permissions?: PermissionPolicy;
  /** Adapter-scoped reasoning effort, validated by the configuration layer. */
  effort?: string;
  /**
   * Milliseconds of adapter-event inactivity after which the in-flight call is
   * aborted and reported as an error (DR-019, phase-execution-36). Zero or absent
   * disables the watchdog.
   */
  stallTimeoutMs?: number;
  /** Watchdog timer seams; defaults to real timers. Injected in tests. */
  watchdogTimers?: WatchdogTimers;
}): AgentClient {
  const cligent = new Cligent(opts.adapter, {
    maxTurns: opts.maxTurns,
    permissions: opts.permissions,
    // Validated adapter-scoped by the configuration layer (CLI-12).
    ...(opts.effort !== undefined ? { effort: opts.effort as Effort } : {}),
  });
  const stallMs = opts.stallTimeoutMs ?? 0;
  const timers = opts.watchdogTimers ?? defaultWatchdogTimers;

  return {
    async run({
      prompt,
      cwd,
      model,
      resume,
      allowedTools,
      signal,
    }): Promise<AgentRunResult> {
      const watchdog = createWatchdog(signal, stallMs, timers);
      const texts: string[] = [];
      let resultText = '';
      let status: AgentRunResult['status'] = 'incomplete';
      let resumeToken: string | undefined;

      try {
        for await (const raw of cligent.run(prompt, {
          abortSignal: watchdog.signal,
          cwd,
          model,
          ...(resume !== undefined ? { resume } : {}),
          ...(allowedTools !== undefined
            ? { allowedTools: [...allowedTools] }
            : {}),
        })) {
          // Any adapter event is activity, regardless of type: the reliable
          // event subset differs per adapter, so the watchdog resets on every
          // iteration (DR-019).
          watchdog.touch();
          const event: AgentEvent = raw;
          if (event.type === 'text') {
            texts.push(event.payload.content);
          } else if (event.type === 'error') {
            status = 'error';
            texts.push(event.payload.message);
          } else if (event.type === 'done') {
            status =
              event.payload.status === 'success'
                ? 'success'
                : event.payload.status === 'error'
                  ? 'error'
                  : 'incomplete';
            if (event.payload.result) resultText = event.payload.result;
            resumeToken = event.payload.resumeToken;
          }
        }
      } finally {
        watchdog.dispose();
      }

      // A real success that lands inside Cligent's post-abort drain wins over
      // the stall verdict: the call did complete, and reporting a hang would
      // discard a finished phase — the expensive false negative this watchdog
      // exists to avoid causing. A genuine stall drains to `interrupted`, so
      // this never softens a real hang.
      if (watchdog.tripped && status !== 'success') {
        return {
          status: 'error',
          text:
            `agent call stalled: no agent activity for ${formatElapsed(stallMs)}; ` +
            'aborted by the stall watchdog (SLC_STALL_TIMEOUT / stallTimeout)',
          ...(resumeToken !== undefined ? { resumeToken } : {}),
        };
      }
      return {
        status,
        text: (resultText || texts.join('\n')).trim(),
        ...(resumeToken !== undefined ? { resumeToken } : {}),
      };
    },
  };
}

/** The per-call inactivity watchdog over the composed abort signal. */
interface Watchdog {
  /** The signal to hand the transport: caller aborts and stalls both fire it. */
  signal: AbortSignal;
  /** Resets the inactivity window; called on every adapter event. */
  touch(): void;
  /** True once the watchdog aborted the call for inactivity. */
  readonly tripped: boolean;
  /** Clears the pending timer and the caller-signal listener. */
  dispose(): void;
}

/**
 * Builds the watchdog for one call: a call-local controller composed with the
 * caller's signal, plus a single reset-on-activity timeout (DR-019). With a
 * non-positive window the caller's signal passes through untouched.
 */
function createWatchdog(
  signal: AbortSignal,
  stallMs: number,
  timers: WatchdogTimers,
): Watchdog {
  if (stallMs <= 0) {
    return {
      signal,
      touch: () => {},
      tripped: false,
      dispose: () => {},
    };
  }

  const controller = new AbortController();
  let tripped = false;
  let handle: unknown;

  const onCallerAbort = (): void => controller.abort(signal.reason);
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const arm = (): unknown =>
    timers.setTimeout(() => {
      tripped = true;
      controller.abort(
        new Error(`agent call stalled for ${formatElapsed(stallMs)}`),
      );
    }, stallMs);
  handle = arm();

  return {
    signal: controller.signal,
    touch: () => {
      timers.clearTimeout(handle);
      if (!tripped && !controller.signal.aborted) handle = arm();
    },
    get tripped() {
      return tripped;
    },
    dispose: () => {
      timers.clearTimeout(handle);
      signal.removeEventListener('abort', onCallerAbort);
    },
  };
}

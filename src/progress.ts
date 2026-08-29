// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * In-run progress reporting (DR-019).
 *
 * The step loop emits {@link ProgressEvent}s — phase start/finish/failure with
 * elapsed times, plus streamed compiled-runtime status lines — through an
 * optional {@link ProgressSink} on `SlcDeps` (CLI-32). The bin renders them as
 * human-readable lines on stderr via {@link createProgressReporter}, which also
 * owns the 30-second silence-bounded heartbeat (CLI-33): whenever no event has
 * been rendered for the bound while a phase is in flight, it emits an
 * elapsed-time heartbeat line. Timer construction is injectable so tests drive
 * the heartbeat deterministically. The exact line format is host-owned
 * presentation and deliberately unspecified. See specs/user/cli.md and
 * specs/dev/cli.md.
 */

/** One in-run progress event the step loop reports (CLI-32). */
export type ProgressEvent =
  | { kind: 'phase-start'; phase: string; target: string }
  | { kind: 'phase-finish'; phase: string; target: string; elapsedMs: number }
  | { kind: 'phase-fail'; phase: string; target: string; elapsedMs: number }
  /** A streamed compiled-runtime status or telemetry line (phase-execution-25). */
  | { kind: 'status'; text: string }
  | { kind: 'heartbeat'; phase: string; elapsedMs: number };

/** Receives progress events as they occur; injected beside the executors. */
export type ProgressSink = (event: ProgressEvent) => void;

/** The silence bound after which the reporter emits a heartbeat (CLI-33). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Renders a duration as a compact human-readable elapsed time. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m${pad(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${pad(minutes % 60)}m`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Renders one progress event as a single stderr line (host presentation). */
export function formatProgressEvent(event: ProgressEvent): string {
  switch (event.kind) {
    case 'phase-start':
      return `→ ${event.phase} (writing ${event.target})`;
    case 'phase-finish':
      return `✓ ${event.phase} wrote ${event.target} (${formatElapsed(event.elapsedMs)})`;
    case 'phase-fail':
      return `✗ ${event.phase} failed at ${event.target} (${formatElapsed(event.elapsedMs)})`;
    case 'status':
      return `◇ ${event.text}`;
    case 'heartbeat':
      return `… ${event.phase} still running (${formatElapsed(event.elapsedMs)})`;
  }
}

/** Timer seams for {@link createProgressReporter}; injected in tests. */
export interface ProgressTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
}

const defaultTimers: ProgressTimers = {
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms);
    // Never keep the process alive just for the heartbeat.
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
  now: () => Date.now(),
};

/** A progress reporter: the sink to inject plus a disposer for its timer. */
export interface ProgressReporter {
  sink: ProgressSink;
  /** Stops the heartbeat timer; call when the run settles. */
  dispose(): void;
}

/**
 * Builds the bin's progress reporter (CLI-35): renders each event as a line
 * through `write`, and, while a phase is in flight, emits a heartbeat whenever
 * no line has been written for `intervalMs` (CLI-33). The heartbeat's elapsed
 * time counts from the running phase's start, so a long phase reads as one
 * growing duration rather than a series of 30-second gaps.
 */
export function createProgressReporter(
  write: (line: string) => void,
  opts: { intervalMs?: number; timers?: ProgressTimers } = {},
): ProgressReporter {
  const timers = opts.timers ?? defaultTimers;
  const intervalMs = opts.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  let running: { phase: string; startedAt: number } | undefined;
  let lastLineAt = timers.now();
  let handle: unknown;

  const emit = (event: ProgressEvent): void => {
    write(`${formatProgressEvent(event)}\n`);
    lastLineAt = timers.now();
  };

  const sink: ProgressSink = (event) => {
    if (event.kind === 'phase-start') {
      running = { phase: event.phase, startedAt: timers.now() };
    } else if (event.kind === 'phase-finish' || event.kind === 'phase-fail') {
      running = undefined;
    }
    emit(event);
  };

  if (intervalMs > 0) {
    // Tick finer than the bound so worst-case silence stays near the bound
    // itself rather than approaching twice it.
    const tickMs = Math.max(250, Math.floor(intervalMs / 6));
    handle = timers.setInterval(() => {
      if (running === undefined) return;
      const now = timers.now();
      if (now - lastLineAt < intervalMs) return;
      emit({
        kind: 'heartbeat',
        phase: running.phase,
        elapsedMs: now - running.startedAt,
      });
    }, tickMs);
  }

  return {
    sink,
    dispose: () => {
      if (handle !== undefined) timers.clearInterval(handle);
      handle = undefined;
    },
  };
}

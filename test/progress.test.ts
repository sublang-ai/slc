// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import {
  createProgressReporter,
  formatElapsed,
  formatProgressEvent,
  type ProgressTimers,
} from '../src/progress.js';

describe('formatElapsed', () => {
  it('renders seconds, minutes, and hours compactly', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(32_000)).toBe('32s');
    expect(formatElapsed(252_000)).toBe('4m12s');
    expect(formatElapsed(3_780_000)).toBe('1h03m');
  });

  it('never renders a negative duration', () => {
    expect(formatElapsed(-5)).toBe('0s');
  });
});

describe('formatProgressEvent', () => {
  it('renders each event kind as one line', () => {
    expect(
      formatProgressEvent({
        kind: 'phase-start',
        phase: 'text2gears',
        target: 'a.gears.md',
      }),
    ).toBe('→ text2gears (writing a.gears.md)');
    expect(
      formatProgressEvent({
        kind: 'phase-finish',
        phase: 'text2gears',
        target: 'a.gears.md',
        elapsedMs: 252_000,
      }),
    ).toBe('✓ text2gears wrote a.gears.md (4m12s)');
    expect(
      formatProgressEvent({
        kind: 'phase-fail',
        phase: 'gears2fsm',
        target: 'a.fsm.ts',
        elapsedMs: 61_000,
      }),
    ).toBe('✗ gears2fsm failed at a.fsm.ts (1m01s)');
    expect(
      formatProgressEvent({ kind: 'status', text: 'Entered transform.' }),
    ).toBe('◇ Entered transform.');
    expect(
      formatProgressEvent({
        kind: 'heartbeat',
        phase: 'gears2fsm',
        elapsedMs: 30_000,
      }),
    ).toBe('… gears2fsm still running (30s)');
  });
});

/** Manually stepped timers: `tick(ms)` advances the clock and runs due ticks. */
const fakeTimers = (): ProgressTimers & { tick: (ms: number) => void } => {
  let now = 0;
  let interval: { callback: () => void; ms: number; due: number } | undefined;
  return {
    setInterval(callback, ms) {
      interval = { callback, ms, due: now + ms };
      return interval;
    },
    clearInterval() {
      interval = undefined;
    },
    now: () => now,
    tick(ms) {
      const end = now + ms;
      while (interval !== undefined && interval.due <= end) {
        now = interval.due;
        interval.due += interval.ms;
        interval.callback();
      }
      now = end;
    },
  };
};

describe('createProgressReporter heartbeat (CLI-33)', () => {
  it('emits a heartbeat once silence exceeds the bound, only while a phase runs', () => {
    const lines: string[] = [];
    const timers = fakeTimers();
    const reporter = createProgressReporter((line) => lines.push(line), {
      intervalMs: 30_000,
      timers,
    });

    // No phase in flight: ticks stay silent.
    timers.tick(120_000);
    expect(lines).toEqual([]);

    reporter.sink({
      kind: 'phase-start',
      phase: 'gears2fsm',
      target: 'a.fsm.ts',
    });
    timers.tick(31_000);
    expect(lines).toEqual([
      '→ gears2fsm (writing a.fsm.ts)\n',
      '… gears2fsm still running (30s)\n',
    ]);

    // The heartbeat itself resets the silence window and keeps counting the
    // phase's total elapsed time.
    timers.tick(31_000);
    expect(lines[2]).toBe('… gears2fsm still running (1m00s)\n');

    // Any rendered event resets the silence window.
    reporter.sink({ kind: 'status', text: 'Entered transform.' });
    timers.tick(20_000);
    expect(lines).toHaveLength(4);

    reporter.sink({
      kind: 'phase-finish',
      phase: 'gears2fsm',
      target: 'a.fsm.ts',
      elapsedMs: 82_000,
    });
    timers.tick(120_000);
    expect(lines).toHaveLength(5);
    reporter.dispose();
  });

  it('stops ticking after dispose', () => {
    const lines: string[] = [];
    const timers = fakeTimers();
    const reporter = createProgressReporter((line) => lines.push(line), {
      intervalMs: 30_000,
      timers,
    });
    reporter.sink({ kind: 'phase-start', phase: 'p', target: 't' });
    reporter.dispose();
    timers.tick(120_000);
    expect(lines).toEqual(['→ p (writing t)\n']);
  });
});

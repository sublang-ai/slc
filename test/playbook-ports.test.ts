// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import type {
  AgentClient,
  AgentRunRequest,
  AgentRunResult,
} from '../src/interpreter.js';
import { createPlaybookPorts } from '../src/playbook-ports.js';

/** A fake agent transport that records its requests and returns a scripted result. */
function fakeAgent(
  result: AgentRunResult,
): AgentClient & { calls: AgentRunRequest[] } {
  const calls: AgentRunRequest[] = [];
  return {
    calls,
    async run(request) {
      calls.push(request);
      return result;
    },
  };
}

const notAborted = new AbortController().signal;

describe('createPlaybookPorts (PHEXEC-25)', () => {
  it('maps a successful agent run to an ok PlayerResult', async () => {
    const player = fakeAgent({ status: 'success', text: 'wrote artifact' });
    const ports = createPlaybookPorts({ player, judge: player });

    const result = await ports.callPlayer('drafter', 'do it', notAborted);
    expect(result).toEqual({ status: 'ok', finalText: 'wrote artifact' });
  });

  it('maps an errored run to an error PlayerResult', async () => {
    const player = fakeAgent({ status: 'error', text: 'boom' });
    const ports = createPlaybookPorts({ player, judge: player });

    expect(await ports.callPlayer('drafter', 'do it', notAborted)).toEqual({
      status: 'error',
      error: 'boom',
    });
  });

  it('maps an incomplete run to aborted or error by the signal', async () => {
    const player = fakeAgent({ status: 'incomplete', text: '' });
    const ports = createPlaybookPorts({ player, judge: player });

    expect((await ports.callPlayer('drafter', 'x', notAborted)).status).toBe(
      'error',
    );

    const aborted = AbortSignal.abort();
    expect((await ports.callPlayer('drafter', 'x', aborted)).status).toBe(
      'aborted',
    );
  });

  it('applies the per-player model binding as configuration', async () => {
    const player = fakeAgent({ status: 'success', text: 'ok' });
    const ports = createPlaybookPorts({
      player,
      judge: player,
      models: { drafter: 'fast-model' },
      cwd: '/work',
    });

    await ports.callPlayer('drafter', 'p', notAborted);
    expect(player.calls[0]).toMatchObject({
      model: 'fast-model',
      cwd: '/work',
    });
  });

  it('returns judge text on success and throws otherwise', async () => {
    const judge = fakeAgent({ status: 'success', text: 'verdict: pass' });
    const okPorts = createPlaybookPorts({ player: judge, judge });
    expect(await okPorts.callJudge('grade', notAborted)).toBe('verdict: pass');

    const badJudge = fakeAgent({ status: 'error', text: 'judge crashed' });
    const badPorts = createPlaybookPorts({ player: badJudge, judge: badJudge });
    await expect(badPorts.callJudge('grade', notAborted)).rejects.toThrow(
      /judge crashed/,
    );
  });

  it('collects status and telemetry as drainable diagnostics', async () => {
    const agent = fakeAgent({ status: 'success', text: 'ok' });
    const ports = createPlaybookPorts({ player: agent, judge: agent });

    await ports.emitStatus('drafting');
    await ports.emitStatus('progress', { turn: 2 });
    await ports.emitTelemetry({ topic: 'cost', payload: { tokens: 100 } });

    expect(ports.drainDiagnostics()).toEqual([
      'drafting',
      'progress {"turn":2}',
      '[cost] {"tokens":100}',
    ]);
    // Draining clears the buffer.
    expect(ports.drainDiagnostics()).toEqual([]);
  });
});

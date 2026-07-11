// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it, vi } from 'vitest';

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

  it('forwards explicit resume selection and returns continuation tokens', async () => {
    const player = fakeAgent({
      status: 'success',
      text: 'continued',
      resumeToken: 'next-session',
    });
    const ports = createPlaybookPorts({ player, judge: player });

    const fresh = await ports.callPlayer('drafter', 'first', notAborted, {
      resume: false,
    });
    const resumed = await ports.callPlayer('drafter', 'second', notAborted, {
      resume: 'prior-session',
    });

    expect(player.calls.map((call) => call.resume)).toEqual([
      false,
      'prior-session',
    ]);
    expect(fresh.resumeToken).toBe('next-session');
    expect(resumed.resumeToken).toBe('next-session');
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

  it('falls back to the default model for players the binding does not name', async () => {
    const player = fakeAgent({ status: 'success', text: 'ok' });
    const ports = createPlaybookPorts({
      player,
      judge: player,
      models: { drafter: 'fast-model' },
      defaultModel: 'base-model',
    });

    await ports.callPlayer('drafter', 'p', notAborted);
    await ports.callPlayer('reviewer', 'p', notAborted);
    expect(player.calls[0].model).toBe('fast-model');
    expect(player.calls[1].model).toBe('base-model');
  });

  it('builds one transport per player id from a player factory and reuses it', async () => {
    const built: Array<AgentClient & { calls: AgentRunRequest[] }> = [];
    const ids: string[] = [];
    const ports = createPlaybookPorts({
      player: (playerId) => {
        ids.push(playerId);
        const client = fakeAgent({ status: 'success', text: 'ok' });
        built.push(client);
        return client;
      },
      judge: fakeAgent({ status: 'success', text: 'ok' }),
    });

    await ports.callPlayer('coder', 'first', notAborted);
    await ports.callPlayer('reviewer', 'second', notAborted);
    await ports.callPlayer('coder', 'third', notAborted);

    // One client per player id, memoized across calls so each player keeps its
    // own agent session (a Cligent transport is single-flight and resuming).
    expect(ids).toEqual(['coder', 'reviewer']);
    expect(built[0].calls.map((call) => call.prompt)).toEqual([
      'first',
      'third',
    ]);
    expect(built[1].calls.map((call) => call.prompt)).toEqual(['second']);
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

  it('serializes concurrent judge calls through one FIFO', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const judge: AgentClient = {
      async run(request) {
        calls.push(request.prompt);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        return { status: 'success', text: request.prompt };
      },
    };
    const ports = createPlaybookPorts({ player: judge, judge });

    const first = ports.callJudge('first', notAborted);
    const second = ports.callJudge('second', notAborted);
    await vi.waitFor(() => expect(calls).toEqual(['first']));
    releases.shift()?.();
    await expect(first).resolves.toBe('first');
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));
    releases.shift()?.();
    await expect(second).resolves.toBe('second');
    expect(maximum).toBe(1);
  });

  it('removes an aborted queued judge call and continues the FIFO', async () => {
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const judge: AgentClient = {
      async run(request) {
        calls.push(request.prompt);
        await new Promise<void>((resolve) => releases.push(resolve));
        return { status: 'success', text: request.prompt };
      },
    };
    const ports = createPlaybookPorts({ player: judge, judge });
    const queued = new AbortController();

    const first = ports.callJudge('first', notAborted);
    const aborted = ports.callJudge('aborted', queued.signal);
    const third = ports.callJudge('third', notAborted);
    await vi.waitFor(() => expect(calls).toEqual(['first']));
    queued.abort(new Error('cancel queued judge'));
    await expect(aborted).rejects.toThrow('cancel queued judge');

    releases.shift()?.();
    await expect(first).resolves.toBe('first');
    await vi.waitFor(() => expect(calls).toEqual(['first', 'third']));
    releases.shift()?.();
    await expect(third).resolves.toBe('third');
  });

  it('settles nested calls as unsupported host errors', async () => {
    const agent = fakeAgent({ status: 'success', text: 'ok' });
    const ports = createPlaybookPorts({ player: agent, judge: agent });

    await expect(
      ports.callPlaybook(
        { callId: 'call-1', playbookId: 'child', text: 'work' },
        notAborted,
      ),
    ).resolves.toMatchObject({
      state: 'settled',
      result: {
        status: 'error',
        playbookId: 'child',
        error: { name: 'UnsupportedOperationError' },
      },
    });
  });

  it('collects status and telemetry as drainable diagnostics', async () => {
    const agent = fakeAgent({ status: 'success', text: 'ok' });
    const ports = createPlaybookPorts({ player: agent, judge: agent });

    await ports.emitStatus('drafting');
    await ports.emitStatus('progress', { turn: 2 });
    await ports.emitTelemetry({ topic: 'cost', payload: { tokens: 100 } });
    await ports.emitTelemetry({
      topic: 'playbook.trace',
      payload: {
        prompt: 'private prompt',
        reply: 'private reply',
        resumeToken: 'private token',
      },
    });

    expect(ports.drainDiagnostics()).toEqual([
      'drafting',
      'progress {"turn":2}',
      '[cost] {"tokens":100}',
    ]);
    // Draining clears the buffer.
    expect(ports.drainDiagnostics()).toEqual([]);
  });
});

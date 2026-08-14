// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it, vi } from 'vitest';

import type {
  AgentClient,
  AgentRunRequest,
  AgentRunResult,
} from '../src/interpreter.js';
import { createPlaybookPorts } from '../src/playbook-ports.js';
import {
  appendWorkspaceContract,
  encodeWorkspaceContract,
  WORKSPACE_BEGIN,
  WORKSPACE_END,
  WORKSPACE_SCHEMA,
  type WorkspaceRecord,
} from '../src/workspace.js';

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
const captainOptions = (visibility: 'visible' | 'hidden') => ({
  visibility,
  resume: false as const,
  allowedTools: [] as const,
});
const workspace: WorkspaceRecord = {
  schema: WORKSPACE_SCHEMA,
  reads: [
    {
      role: 'definition',
      logicalPath: '/logical/phase.md',
      physicalPath: '/physical/phase.md',
      kind: 'file',
      identity:
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    {
      role: 'source',
      logicalPath: '/logical/source.md',
      physicalPath: '/physical/source.md',
      kind: 'file',
      identity:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  ],
  write: {
    role: 'target',
    logicalPath: '/logical/output.md',
    physicalPath: '/physical/output.md',
    kind: 'file',
  },
};
const workspaceSuffix = encodeWorkspaceContract(workspace);
const performingPrompt = (prompt: string): string =>
  appendWorkspaceContract(prompt, workspace);
const createPorts = (
  options: Omit<Parameters<typeof createPlaybookPorts>[0], 'workspace'>,
) => createPlaybookPorts({ ...options, workspace });

describe('createPlaybookPorts (PHEXEC-25)', () => {
  it('maps a successful agent run to an ok PlayerResult', async () => {
    const player = fakeAgent({ status: 'success', text: 'wrote artifact' });
    const ports = createPorts({ player, judge: player });

    const result = await ports.callPlayer('drafter', 'do it', notAborted);
    expect(result).toEqual({ status: 'ok', finalText: 'wrote artifact' });
  });

  it('maps direct Captain results without player continuation data', async () => {
    const captain = fakeAgent({
      status: 'success',
      text: 'Captain handled it',
      resumeToken: 'private-player-token',
    });
    const ports = createPorts({ player: captain, judge: captain });

    await expect(
      ports.callCaptain('handle it', notAborted, captainOptions('hidden')),
    ).resolves.toEqual({ status: 'ok', finalText: 'Captain handled it' });
    expect(captain.calls[0]).toMatchObject({
      resume: false,
      allowedTools: [],
    });
  });

  it('preserves direct Captain error and abort statuses', async () => {
    const errored = fakeAgent({ status: 'error', text: 'Captain failed' });
    const errorPorts = createPorts({
      player: errored,
      judge: errored,
    });
    await expect(
      errorPorts.callCaptain(
        'handle it',
        notAborted,
        captainOptions('visible'),
      ),
    ).resolves.toEqual({ status: 'error', error: 'Captain failed' });

    const abort = new AbortController();
    const incomplete = fakeAgent({ status: 'incomplete', text: '' });
    const aborting: AgentClient = {
      async run(request) {
        const result = await incomplete.run(request);
        abort.abort(new Error('Captain call aborted'));
        return result;
      },
    };
    const abortedPorts = createPorts({
      player: aborting,
      judge: aborting,
    });
    await expect(
      abortedPorts.callCaptain(
        'handle it',
        abort.signal,
        captainOptions('hidden'),
      ),
    ).resolves.toEqual({ status: 'aborted' });
    expect(incomplete.calls).toHaveLength(1);
  });

  it('rejects an invalid direct Captain visibility before transport', async () => {
    const captain = fakeAgent({ status: 'success', text: 'unexpected' });
    const ports = createPorts({ player: captain, judge: captain });

    await expect(
      ports.callCaptain('handle it', notAborted, {
        visibility: 'private',
        resume: false,
        allowedTools: [],
      } as never),
    ).rejects.toThrow(/visibility must be visible or hidden/);
    expect(captain.calls).toEqual([]);
  });

  it.each([
    ['missing resume', { visibility: 'hidden', allowedTools: [] }],
    [
      'inherited resume',
      Object.assign(Object.create({ resume: false }), {
        visibility: 'hidden',
        allowedTools: [],
      }),
    ],
    [
      'accessor resume',
      Object.defineProperty(
        { visibility: 'hidden', allowedTools: [] },
        'resume',
        { get: () => false },
      ),
    ],
    [
      'resuming',
      { visibility: 'hidden', resume: 'prior-session', allowedTools: [] },
    ],
    [
      'accessor tools',
      Object.defineProperty(
        { visibility: 'hidden', resume: false },
        'allowedTools',
        { get: () => [] },
      ),
    ],
    [
      'nonempty tools',
      { visibility: 'hidden', resume: false, allowedTools: ['Read'] },
    ],
  ])('rejects %s before direct Captain transport', async (_label, options) => {
    const captain = fakeAgent({ status: 'success', text: 'unexpected' });
    const ports = createPorts({ player: captain, judge: captain });

    await expect(
      ports.callCaptain('route it', notAborted, options as never),
    ).rejects.toThrow(/options\.(?:resume|allowedTools)/);
    expect(captain.calls).toEqual([]);
  });

  it('forwards fresh-session and empty-tool Captain isolation', async () => {
    const captain = fakeAgent({ status: 'success', text: 'route selected' });
    const ports = createPorts({ player: captain, judge: captain });

    await ports.callCaptain('route it', notAborted, captainOptions('visible'));

    expect(captain.calls).toEqual([
      expect.objectContaining({ resume: false, allowedTools: [] }),
    ]);
  });

  // The tool restriction is source-owned (link.md, PHEXEC-32): an absent own
  // `allowedTools` — including one only inherited from a prototype — forwards
  // no restriction, so a transformation-performing Captain keeps its tools.
  it.each([
    ['absent tools', { visibility: 'visible', resume: false }],
    [
      'inherited tools',
      Object.assign(Object.create({ allowedTools: [] }), {
        visibility: 'visible',
        resume: false,
      }),
    ],
  ])('forwards no tool restriction for %s', async (_label, options) => {
    const captain = fakeAgent({ status: 'success', text: 'artifact written' });
    const ports = createPorts({ player: captain, judge: captain });

    await ports.callCaptain('compile it', notAborted, options as never);

    expect(captain.calls).toHaveLength(1);
    expect(captain.calls[0].allowedTools).toBeUndefined();
  });

  // PHEXEC-34: every Player and a transformation-performing Captain receive
  // the exact final host suffix; routing-only Captain and judge prompts cross
  // byte-identically.
  it('appends one final workspace suffix only to performing calls', async () => {
    const agent = fakeAgent({ status: 'success', text: 'ok' });
    const ports = createPorts({ player: agent, judge: agent });

    await ports.callPlayer('writer', 'draft it', notAborted);
    await ports.callCaptain('compile it', notAborted, {
      visibility: 'visible',
      resume: false,
    });
    await ports.callCaptain('route it', notAborted, captainOptions('visible'));
    await ports.callJudge('grade it', notAborted);

    expect(agent.calls.map((call) => call.prompt)).toEqual([
      performingPrompt('draft it'),
      performingPrompt('compile it'),
      'route it',
      'grade it',
    ]);
    for (const call of agent.calls.slice(0, 2)) {
      expect(call.prompt.endsWith(workspaceSuffix)).toBe(true);
      expect(call.prompt.split(WORKSPACE_BEGIN)).toHaveLength(2);
      expect(call.prompt.split(WORKSPACE_END)).toHaveLength(2);
    }
    for (const call of agent.calls.slice(2)) {
      expect(call.prompt).not.toContain(WORKSPACE_BEGIN);
      expect(call.prompt).not.toContain(WORKSPACE_END);
    }
  });

  it('snapshots Captain isolation before queued transport work', async () => {
    const captain = fakeAgent({ status: 'success', text: 'route selected' });
    const ports = createPorts({ player: captain, judge: captain });
    const options: {
      visibility: 'visible';
      resume: false | string;
      allowedTools: string[];
    } = { visibility: 'visible', resume: false, allowedTools: [] };

    const result = ports.callCaptain('route it', notAborted, options as never);
    options.resume = 'late-session';
    options.allowedTools.push('Read');

    await result;
    expect(captain.calls).toEqual([
      expect.objectContaining({ resume: false, allowedTools: [] }),
    ]);
  });

  it('forwards explicit resume selection and returns continuation tokens', async () => {
    const player = fakeAgent({
      status: 'success',
      text: 'continued',
      resumeToken: 'next-session',
    });
    const ports = createPorts({ player, judge: player });

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
    const ports = createPorts({ player, judge: player });

    expect(await ports.callPlayer('drafter', 'do it', notAborted)).toEqual({
      status: 'error',
      error: 'boom',
    });
  });

  it('maps an incomplete run to aborted or error by the signal', async () => {
    const player = fakeAgent({ status: 'incomplete', text: '' });
    const ports = createPorts({ player, judge: player });

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
    const ports = createPorts({
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
    const ports = createPorts({
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
    const ports = createPorts({
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
      performingPrompt('first'),
      performingPrompt('third'),
    ]);
    expect(built[1].calls.map((call) => call.prompt)).toEqual([
      performingPrompt('second'),
    ]);
  });

  it('returns judge text on success and throws otherwise', async () => {
    const judge = fakeAgent({ status: 'success', text: 'verdict: pass' });
    const okPorts = createPorts({ player: judge, judge });
    expect(await okPorts.callJudge('grade', notAborted)).toBe('verdict: pass');
    expect(judge.calls[0]).toMatchObject({
      resume: false,
      allowedTools: [],
    });

    const badJudge = fakeAgent({ status: 'error', text: 'judge crashed' });
    const badPorts = createPorts({ player: badJudge, judge: badJudge });
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
    const ports = createPorts({ player: judge, judge });

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

  it('serializes Captain and judge calls through one shared FIFO', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const calls: string[] = [];
    const captain: AgentClient = {
      async run(request) {
        calls.push(request.prompt);
        active++;
        maximum = Math.max(maximum, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        return { status: 'success', text: request.prompt };
      },
    };
    const ports = createPorts({ player: captain, judge: captain });

    const first = ports.callCaptain(
      'first',
      notAborted,
      captainOptions('visible'),
    );
    const second = ports.callJudge('second', notAborted);
    const third = ports.callCaptain(
      'third',
      notAborted,
      captainOptions('hidden'),
    );
    await vi.waitFor(() => expect(calls).toEqual(['first']));
    releases.shift()?.();
    await expect(first).resolves.toEqual({
      status: 'ok',
      finalText: 'first',
    });
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));
    releases.shift()?.();
    await expect(second).resolves.toBe('second');
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second', 'third']));
    releases.shift()?.();
    await expect(third).resolves.toEqual({
      status: 'ok',
      finalText: 'third',
    });
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
    const ports = createPorts({ player: judge, judge });
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
    const ports = createPorts({ player: agent, judge: agent });

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
    const ports = createPorts({ player: agent, judge: agent });

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

  it('streams status and telemetry live to a configured sink instead of buffering (DR-019)', async () => {
    const agent = fakeAgent({ status: 'success', text: 'ok' });
    const streamed: string[] = [];
    const ports = createPorts({
      player: agent,
      judge: agent,
      onStatus: (line) => streamed.push(line),
    });

    await ports.emitStatus('drafting');
    await ports.emitStatus('progress', { turn: 2 });
    await ports.emitTelemetry({ topic: 'cost', payload: { tokens: 100 } });
    // Trace privacy holds on the streamed path too (PHEXEC-25, PHEXEC-37).
    await ports.emitTelemetry({
      topic: 'playbook.trace',
      payload: { prompt: 'private prompt', resumeToken: 'private token' },
    });

    expect(streamed).toEqual([
      'drafting',
      'progress {"turn":2}',
      '[cost] {"tokens":100}',
    ]);
    // Streamed lines never repeat as drained diagnostics.
    expect(ports.drainDiagnostics()).toEqual([]);
  });
});

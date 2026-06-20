// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import type { AgentAdapter } from '@sublang/cligent';
import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  SUPPORTED_AGENTS,
  type AdapterFactory,
  createConfiguredExecutor,
  defaultAdapterFactory,
  isSupportedAgent,
  resolveAgentSelection,
} from '../src/config.js';

describe('resolveAgentSelection (CLI-7, CLI-12)', () => {
  it('resolves a supported agent and model', () => {
    expect(
      resolveAgentSelection({ SLC_AGENT: 'claude-code', SLC_MODEL: 'opus' }),
    ).toEqual({ agent: 'claude-code', model: 'opus' });
  });

  it('accepts every registered agent id', () => {
    for (const agent of SUPPORTED_AGENTS) {
      expect(resolveAgentSelection({ SLC_AGENT: agent })).toEqual({
        agent,
        model: undefined,
      });
    }
  });

  it('omits the model when SLC_MODEL is unset or blank', () => {
    expect(resolveAgentSelection({ SLC_AGENT: 'codex' }).model).toBeUndefined();
    expect(
      resolveAgentSelection({ SLC_AGENT: 'codex', SLC_MODEL: '   ' }).model,
    ).toBeUndefined();
  });

  it('trims surrounding whitespace from the agent and model', () => {
    expect(
      resolveAgentSelection({ SLC_AGENT: '  gemini  ', SLC_MODEL: ' g-2 ' }),
    ).toEqual({ agent: 'gemini', model: 'g-2' });
  });

  it('refuses an unset or blank SLC_AGENT with no implicit default', () => {
    for (const env of [{}, { SLC_AGENT: '' }, { SLC_AGENT: '   ' }]) {
      let caught: unknown;
      try {
        resolveAgentSelection(env);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).code).toBe('agent-unset');
    }
  });

  it('refuses an unsupported agent, naming the supported set', () => {
    try {
      resolveAgentSelection({ SLC_AGENT: 'gpt' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as ConfigError).code).toBe('agent-unsupported');
      expect((error as ConfigError).message).toContain('claude-code');
    }
  });
});

describe('isSupportedAgent (CLI-7)', () => {
  it('is true only for registered ids', () => {
    expect(isSupportedAgent('opencode')).toBe(true);
    expect(isSupportedAgent('claude-code')).toBe(true);
    expect(isSupportedAgent('gpt')).toBe(false);
    expect(isSupportedAgent('')).toBe(false);
  });
});

describe('defaultAdapterFactory (CLI-7)', () => {
  it('maps each id to a Cligent adapter advertising that id', () => {
    for (const agent of SUPPORTED_AGENTS) {
      expect(defaultAdapterFactory(agent).agent).toBe(agent);
    }
  });
});

describe('createConfiguredExecutor (CLI-7, CLI-8)', () => {
  const fakeAdapter = (id: string): AgentAdapter => ({
    agent: id,
    isAvailable: async () => true,
    // eslint-disable-next-line require-yield
    run: async function* () {
      return;
    },
  });

  it('builds the adapter for the selected agent and returns a phase executor', () => {
    const requested: string[] = [];
    const factory: AdapterFactory = (agent) => {
      requested.push(agent);
      return fakeAdapter(agent);
    };

    const executor = createConfiguredExecutor(
      { agent: 'codex', model: 'm1' },
      { adapterFactory: factory },
    );

    expect(requested).toEqual(['codex']);
    expect(typeof executor.run).toBe('function');
  });

  it('does not construct any other agent than the one selected', () => {
    const requested: string[] = [];
    const factory: AdapterFactory = (agent) => {
      requested.push(agent);
      return fakeAdapter(agent);
    };

    createConfiguredExecutor({ agent: 'gemini' }, { adapterFactory: factory });

    expect(requested).toEqual(['gemini']);
  });
});

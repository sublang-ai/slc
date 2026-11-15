// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile } from '../src/config-file.js';
import { resolveRunConfig } from '../src/app.js';
import {
  createConfiguredAgentClient,
  type AdapterFactory,
} from '../src/config.js';

// Stand in for the two results the model policy can return, including
// on the published dependency lock that predates the policy export.
const defaultModels = vi.hoisted(() =>
  vi.fn((agent: string, env: NodeJS.ProcessEnv) => {
    if (
      agent === 'claude-code' &&
      !env.CLAUDE_CODE_USE_VERTEX &&
      !env.ANTHROPIC_BASE_URL
    ) {
      return { model: 'claude-fable-5-2', subagentModel: 'claude-opus-5-5' };
    }
    return agent === 'codex'
      ? { model: 'gpt-6-astra', subagentModel: 'gpt-6.1-sol' }
      : {};
  }),
);
vi.mock('@sublang/cligent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  defaultAgentModels: defaultModels,
}));

it('resolves opt-in defaults and delivers child pins to runtime calls and omits them from tool-free controls (cli-51)', async () => {
  for (const [agent, parent, child] of [
    ['claude-code', 'claude-fable-5-2', 'claude-opus-5-5'],
    ['codex', 'gpt-6-astra', 'gpt-6.1-sol'],
  ] as const) {
    const selection = resolveRunConfig(
      {},
      { agent, modelDefaults: true },
    ).selection;
    expect(selection.model).toBe(parent);
    expect(selection.subagentModel).toBe(child);
    let delivered: Record<string, unknown> | undefined;
    const factory: AdapterFactory = () => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(_prompt, options) {
        delivered = options as unknown as Record<string, unknown>;
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: 'models',
          payload: {
            status: 'success',
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as never;
      },
    });
    const client = createConfiguredAgentClient(selection, {
      adapterFactory: factory,
    });
    await client.run({
      prompt: 'check',
      model: selection.model,
      signal: new AbortController().signal,
    });
    expect(delivered?.model).toBe(parent);
    expect(delivered?.subagentModel).toBe(child);
    await client.run({
      prompt: 'judge',
      model: selection.model,
      allowedTools: [],
      signal: new AbortController().signal,
    });
    expect(delivered?.subagentModel).toBeUndefined();
    expect(
      resolveRunConfig({}, { agent, modelDefaults: false }).selection.model,
    ).toBeUndefined();
    expect(resolveRunConfig({}, { agent }).selection.model).toBeUndefined();
    expect(
      resolveRunConfig(
        { SLC_SUBAGENT_MODEL: 'false' },
        { agent, modelDefaults: true },
      ).selection.subagentModel,
    ).toBeUndefined();
    expect(
      resolveRunConfig({ SLC_MODEL: 'custom' }, { agent, modelDefaults: true })
        .selection.model,
    ).toBe('custom');
  }
  expect(
    resolveRunConfig(
      { ANTHROPIC_BASE_URL: 'https://custom.test' },
      { agent: 'claude-code', modelDefaults: true },
    ).selection.model,
  ).toBeUndefined();
  const local = {
    HOME: '/user-home',
    CLAUDE_CONFIG_DIR: '/user-settings',
    CLAUDE_CODE_USE_VERTEX: '1',
  };
  expect(
    resolveRunConfig(local, { agent: 'claude-code', modelDefaults: true })
      .selection.model,
  ).toBeUndefined();
  expect(defaultModels).toHaveBeenCalledWith(
    'claude-code',
    expect.objectContaining(local),
    '/user-home',
  );
  expect(() =>
    resolveRunConfig(
      { SLC_REVIEWER_SUBAGENT_MODEL: 'false' },
      { agent: 'codex' },
    ),
  ).toThrow(/reviewer agent/);
});

it('keeps explicit child inheritance and provider settings', () => {
  const selection = resolveRunConfig(
    {
      SLC_SUBAGENT_MODEL: 'inherit',
      ANTHROPIC_BASE_URL: 'https://user:secret@custom.test',
    },
    {
      agent: 'claude-code',
      modelDefaults: true,
      model: 'authored',
      subagentModel: false,
    },
  ).selection;
  expect(selection.model).toBe('authored');
  expect(selection.subagentModel).toBe('inherit');
  const reviewed = resolveRunConfig(
    {},
    { agent: 'codex', reviewerAgent: 'claude-code', modelDefaults: true },
  ).selection;
  expect(reviewed.reviewer?.model).toBe('claude-fable-5-2');
  expect(reviewed.reviewer?.subagentModel).toBe('claude-opus-5-5');
  expect(
    resolveRunConfig(
      {},
      { agent: 'claude-code', modelDefaults: true, subagentModel: false },
    ).selection.subagentModel,
  ).toBeUndefined();
  expect(
    resolveRunConfig(
      { SLC_MODEL: '   ', SLC_SUBAGENT_MODEL: '   ' },
      { agent: 'claude-code' },
    ).selection.model,
  ).toBeUndefined();
  expect(
    resolveRunConfig(
      { ANTHROPIC_BASE_URL: 'bad-url' },
      { agent: 'claude-code', modelDefaults: true },
    ).selection.model,
  ).toBeUndefined();
  expect(() =>
    resolveRunConfig({ SLC_SUBAGENT_MODEL: 'pinned' }, { agent: 'gemini' }),
  ).toThrow(/subagent/i);
  expect(() =>
    resolveRunConfig(
      { SLC_REVIEWER_SUBAGENT_MODEL: 'pinned' },
      { agent: 'claude-code', reviewerAgent: 'gemini' },
    ),
  ).toThrow(/SLC_REVIEWER_SUBAGENT_MODEL/);
});

it('seeds adapter-aware defaults while preserving authored legacy omission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'slc-model-defaults-'));
  const cwd = join(root, 'work');
  const configHome = join(root, 'config');
  await mkdir(cwd);
  try {
    const fresh = await loadConfigFile({ cwd, configHome });
    expect(fresh.config.modelDefaults).toBe(true);
    expect(resolveRunConfig({}, fresh.config).selection.model).toBe(
      'claude-fable-5-2',
    );
    expect(
      resolveRunConfig({ SLC_AGENT: 'codex' }, fresh.config).selection.model,
    ).toBe('gpt-6-astra');
    await writeFile(
      join(cwd, 'slc.config.yaml'),
      'agent: claude-code\nsubagentModel: false\n',
    );
    const legacy = await loadConfigFile({ cwd, configHome });
    expect(resolveRunConfig({}, legacy.config).selection.model).toBeUndefined();
    expect(
      resolveRunConfig({}, legacy.config).selection.subagentModel,
    ).toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

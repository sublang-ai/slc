// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile } from '../src/config-file.js';
import { resolveRunConfig } from '../src/app.js';
import {
  createConfiguredAgentClient,
  type AdapterFactory,
} from '../src/config.js';

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'slc-model-defaults-'));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it('resolves opt-in defaults and delivers both pins to runtime calls (cli-51)', async () => {
  for (const [agent, parent, child] of [
    ['claude-code', 'claude-fable-5-2', 'claude-opus-5-5'],
    ['codex', 'gpt-6-astra', 'gpt-6.1-sol'],
  ] as const) {
    const selection = resolveRunConfig(
      { HOME: home },
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
    expect(
      resolveRunConfig({}, { agent, modelDefaults: false }).selection.model,
    ).toBeUndefined();
    expect(resolveRunConfig({}, { agent }).selection.model).toBeUndefined();
    expect(
      resolveRunConfig(
        { HOME: home, SLC_SUBAGENT_MODEL: 'false' },
        { agent, modelDefaults: true },
      ).selection.subagentModel,
    ).toBeUndefined();
    expect(
      resolveRunConfig(
        { HOME: home, SLC_MODEL: 'custom' },
        { agent, modelDefaults: true },
      ).selection.model,
    ).toBe('custom');
    const mixed = resolveRunConfig(
      { HOME: home, SLC_MODEL: 'custom' },
      { agent, modelDefaults: true },
    ).selection;
    expect(mixed.model).toBe('custom');
    expect(mixed.subagentModel).toBe(child);
    const mixedReviewer = resolveRunConfig(
      { HOME: home },
      {
        agent,
        reviewerAgent: agent,
        modelDefaults: true,
        reviewerModel: 'review-custom',
      },
    ).selection.reviewer!;
    expect(mixedReviewer.model).toBe('review-custom');
    expect(mixedReviewer.subagentModel).toBe(child);
  }
  expect(() =>
    resolveRunConfig(
      { SLC_REVIEWER_SUBAGENT_MODEL: 'false' },
      { agent: 'codex' },
    ),
  ).toThrow(/reviewer agent/);
});

it('passes the run environment and home for each role to Cligent', async () => {
  const claude = join(home, '.claude');
  const codex = join(home, 'isolated-codex');
  await mkdir(claude);
  await mkdir(codex);
  await writeFile(
    join(claude, 'settings.json'),
    JSON.stringify({
      env: { ANTHROPIC_BASE_URL: 'https://example.test/anthropic' },
    }),
  );
  await writeFile(
    join(codex, 'config.toml'),
    [
      'model_provider = "azure"',
      '[model_providers.azure]',
      'name = "Azure"',
      'base_url = "https://example.test/openai"',
    ].join('\n'),
  );
  const selection = resolveRunConfig(
    { HOME: home, CODEX_HOME: codex },
    { agent: 'claude-code', reviewerAgent: 'codex', modelDefaults: true },
  ).selection;
  for (const role of [selection, selection.reviewer!]) {
    expect(role.model).toBeUndefined();
    expect(role.subagentModel).toBeUndefined();
  }
});

it('keeps explicit child inheritance and provider settings', () => {
  const selection = resolveRunConfig(
    {
      HOME: home,
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
    { HOME: home },
    { agent: 'codex', reviewerAgent: 'claude-code', modelDefaults: true },
  ).selection;
  expect(reviewed.reviewer?.model).toBe('claude-fable-5-2');
  expect(reviewed.reviewer?.subagentModel).toBe('claude-opus-5-5');
  expect(
    resolveRunConfig(
      { HOME: home },
      { agent: 'claude-code', modelDefaults: true, subagentModel: false },
    ).selection.subagentModel,
  ).toBeUndefined();
  expect(
    resolveRunConfig(
      { SLC_MODEL: '   ', SLC_SUBAGENT_MODEL: '   ' },
      { agent: 'claude-code' },
    ).selection.model,
  ).toBeUndefined();
  expect(() =>
    resolveRunConfig({ SLC_SUBAGENT_MODEL: 'pinned' }, { agent: 'gemini' }),
  ).toThrow(/SLC_SUBAGENT_MODEL.*adapter "gemini"/);
  expect(() =>
    resolveRunConfig(
      { SLC_REVIEWER_SUBAGENT_MODEL: 'pinned' },
      { agent: 'claude-code', reviewerAgent: 'gemini' },
    ),
  ).toThrow(/SLC_REVIEWER_SUBAGENT_MODEL.*adapter "gemini"/);
});

it('seeds adapter-aware defaults while preserving authored legacy omission', async () => {
  const cwd = join(home, 'work');
  const configHome = join(home, 'config');
  await mkdir(cwd);
  const fresh = await loadConfigFile({ cwd, configHome });
  expect(fresh.config.modelDefaults).toBe(true);
  expect(resolveRunConfig({ HOME: home }, fresh.config).selection.model).toBe(
    'claude-fable-5-2',
  );
  expect(
    resolveRunConfig({ HOME: home, SLC_AGENT: 'codex' }, fresh.config).selection
      .model,
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
});

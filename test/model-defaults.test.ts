// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile } from '../src/config-file.js';
import { getSubagentModelSupport } from '@sublang/cligent';
import { resolveRunConfig } from '../src/app.js';
import {
  createConfiguredAgentClient,
  type AdapterFactory,
} from '../src/config.js';

it('resolves opt-in defaults and delivers child pins through installed Cligent (cli-51)', async () => {
  for (const [agent, parent, child] of [
    ['claude-code', 'claude-fable-5-2', 'claude-opus-5-5'],
    ['codex', 'gpt-6-astra', 'gpt-6.1-sol'],
  ] as const) {
    const selection = resolveRunConfig(
      {},
      { agent, modelDefaults: true },
    ).selection;
    const supported = getSubagentModelSupport(agent)?.requestSupported;
    expect(selection.model).toBe(parent);
    expect(selection.subagentModel).toBe(supported ? child : undefined);
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
    await createConfiguredAgentClient(selection, {
      adapterFactory: factory,
    }).run({
      prompt: 'check',
      model: selection.model,
      signal: new AbortController().signal,
    });
    expect(delivered?.model).toBe(parent);
    expect(delivered?.subagentModel).toBe(supported ? child : undefined);
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
  expect(
    resolveRunConfig(
      { ANTHROPIC_BASE_URL: 'https://api.anthropic.com/' },
      { agent: 'claude-code', modelDefaults: true },
    ).selection.model,
  ).toBe('claude-fable-5-2');
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
    { agent: 'claude-code', modelDefaults: true, model: 'authored' },
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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter, AgentOptions } from '@sublang/cligent';
import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  SUPPORTED_AGENTS,
  type AdapterFactory,
  createConfiguredCompiledFactory,
  createConfiguredExecutor,
  defaultAdapterFactory,
  isSupportedAgent,
  resolveAgentSelection,
} from '../src/config.js';
import type { CompiledSelection } from '../src/runner.js';

describe('resolveAgentSelection (cli-7, cli-12)', () => {
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

  it('resolves a supported adapter-scoped effort (cli-12)', () => {
    expect(
      resolveAgentSelection({ SLC_AGENT: 'claude-code', SLC_EFFORT: 'xhigh' })
        .effort,
    ).toBe('xhigh');
    expect(
      resolveAgentSelection({ SLC_AGENT: 'codex', SLC_EFFORT: ' xhigh ' })
        .effort,
    ).toBe('xhigh');
    expect(
      resolveAgentSelection({ SLC_AGENT: 'codex' }).effort,
    ).toBeUndefined();
  });

  it('refuses an effort the selected agent does not support (cli-12)', () => {
    expect(() =>
      resolveAgentSelection({ SLC_AGENT: 'claude-code', SLC_EFFORT: 'ultra' }),
    ).toThrow(expect.objectContaining({ code: 'effort-unsupported' }));
  });

  it('resolves and validates an optional independent Reviewer selection', () => {
    expect(
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_REVIEWER_AGENT: 'codex',
        SLC_REVIEWER_MODEL: 'gpt-review',
        SLC_REVIEWER_EFFORT: 'xhigh',
      }),
    ).toEqual({
      agent: 'claude-code',
      model: undefined,
      effort: undefined,
      reviewer: {
        agent: 'codex',
        model: 'gpt-review',
        effort: 'xhigh',
      },
    });
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'codex',
        SLC_REVIEWER_AGENT: 'unknown',
      }),
    ).toThrow(expect.objectContaining({ code: 'reviewer-agent-unsupported' }));
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'codex',
        SLC_REVIEWER_AGENT: 'claude-code',
        SLC_REVIEWER_EFFORT: 'ultra',
      }),
    ).toThrow(expect.objectContaining({ code: 'reviewer-effort-unsupported' }));
  });

  it('refuses Reviewer model or effort without reviewerAgent', () => {
    for (const reviewer of [
      { SLC_REVIEWER_MODEL: 'review-model' },
      { SLC_REVIEWER_EFFORT: 'high' },
    ]) {
      expect(() =>
        resolveAgentSelection({ SLC_AGENT: 'codex', ...reviewer }),
      ).toThrow(expect.objectContaining({ code: 'reviewer-agent-unset' }));
    }
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
      expect((caught as ConfigError).message).toBe(
        'SLC_AGENT is not set; set it to one of: claude-code, codex, gemini, opencode',
      );
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

describe('isSupportedAgent (cli-7)', () => {
  it('is true only for registered ids', () => {
    expect(isSupportedAgent('opencode')).toBe(true);
    expect(isSupportedAgent('claude-code')).toBe(true);
    expect(isSupportedAgent('gpt')).toBe(false);
    expect(isSupportedAgent('')).toBe(false);
  });
});

describe('defaultAdapterFactory (cli-7)', () => {
  it('maps each id to a Cligent adapter advertising that id', () => {
    for (const agent of SUPPORTED_AGENTS) {
      expect(defaultAdapterFactory(agent).agent).toBe(agent);
    }
  });
});

describe('createConfiguredExecutor (cli-7, cli-8)', () => {
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

  it('lazily constructs a read-only Reviewer and returns only clean Coder text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-reviewed-config-'));
    const definitionPath = join(dir, 'text2gears.md');
    await writeFile(definitionPath, 'perform the transformation');
    const requested: string[] = [];
    const optionsByAgent = new Map<string, AgentOptions>();
    const factory: AdapterFactory = (agent) => {
      requested.push(agent);
      return {
        agent,
        async isAvailable() {
          return true;
        },
        async *run(_prompt: string, options?: AgentOptions) {
          if (options !== undefined) optionsByAgent.set(agent, options);
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: `${agent}-session`,
            payload: {
              status: 'success',
              result: agent === 'gemini' ? 'NO_FINDINGS' : 'coder summary',
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      };
    };

    try {
      const executor = createConfiguredExecutor(
        {
          agent: 'codex',
          reviewer: { agent: 'gemini', model: 'review-model' },
        },
        { adapterFactory: factory, cwd: dir },
      );
      expect(requested).toEqual(['codex']);

      await expect(
        executor.run(
          {
            kind: 'compile',
            definitionPath,
            source: join(dir, 'source.txt'),
            target: join(dir, 'target.md'),
          },
          new AbortController().signal,
        ),
      ).resolves.toEqual({ status: 'ok', diagnostics: ['coder summary'] });

      expect(requested).toEqual(['codex', 'gemini']);
      expect(optionsByAgent.get('gemini')).toMatchObject({
        model: 'review-model',
        permissions: {
          fileWrite: 'deny',
          shellExecute: 'deny',
          networkAccess: 'deny',
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reviews a transformation reached through the configured compiled-player port', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-reviewed-compiled-'));
    const artifactPath = join(dir, 'phase.playbook.mjs');
    const definitionPath = join(dir, 'phase.md');
    const source = join(dir, 'source.md');
    const target = join(dir, 'target.ts');
    await writeFile(definitionPath, 'compiled phase definition');
    await writeFile(source, 'source input');
    await writeFile(
      artifactPath,
      [
        'export default function createPlaybookRuntime() {',
        '  let ports;',
        '  return {',
        '    async init(value) { ports = value; },',
        '    async handleBossInput({ text, signal }) {',
        "      const result = await ports.callPlayer('writer', text, signal);",
        "      if (result.status !== 'ok') throw new Error('player failed');",
        '    },',
        '    async dispose() {},',
        '  };',
        '}',
      ].join('\n'),
    );
    const runs: string[] = [];
    const factory: AdapterFactory = (agent) => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(prompt: string) {
        runs.push(agent);
        if (agent === 'codex') {
          const marker = 'Request: ';
          const line = prompt
            .split('\n')
            .find((candidate) => candidate.startsWith(marker));
          if (line === undefined) throw new Error('missing compiled request');
          const input = JSON.parse(line.slice(marker.length)) as {
            target: string;
          };
          await writeFile(input.target, 'compiled output');
        }
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: `${agent}-session`,
          payload: {
            status: 'success',
            result: agent === 'gemini' ? 'NO_FINDINGS' : 'coder summary',
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as never;
      },
    });

    try {
      const configured = createConfiguredCompiledFactory(
        {
          agent: 'codex',
          reviewer: { agent: 'gemini', model: 'review-model' },
        },
        { adapterFactory: factory, cwd: dir },
      );
      const executor = configured({
        phase: 'phase',
        pipelineDir: dir,
        record: {
          artifact: { path: 'phase.playbook.mjs' },
          linkTarget: { provenance: '@sublang/playbook@0.9.0' },
        },
      } as unknown as CompiledSelection);

      await expect(
        executor.run(
          { kind: 'compile', definitionPath, source, target },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ status: 'ok' });
      expect(runs).toEqual(['codex', 'gemini']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('binds compiled execution to the pin-recorded runtime contract', () => {
    const compiled = createConfiguredCompiledFactory(
      { agent: 'codex' },
      { adapterFactory: () => fakeAdapter('codex') },
    );
    const choice = (provenance?: string): CompiledSelection =>
      ({
        phase: 'text2gears',
        pipelineDir: '/pipeline',
        record: {
          artifact: { path: 'text2gears.slc/text2gears.playbook.ts' },
          linkTarget: provenance === undefined ? {} : { provenance },
        },
      }) as unknown as CompiledSelection;

    expect(typeof compiled(choice('@sublang/playbook@0.9.0')).run).toBe(
      'function',
    );
    expect(typeof compiled(choice()).run).toBe('function');
    // Playbook 0.10 pins select the composed six-port profile (DR-011), and so
    // do 1.0.0 pins — the published release of that same contract generation.
    expect(typeof compiled(choice('@sublang/playbook@0.10.0')).run).toBe(
      'function',
    );
    expect(typeof compiled(choice('@sublang/playbook@1.0.0')).run).toBe(
      'function',
    );
    // 2.0.0 keeps the six-port contract and joins the composed profile
    // (DR-017); the never-installed 1.3.0 stays fail-closed like any other
    // unmapped provenance.
    expect(typeof compiled(choice('@sublang/playbook@2.0.0')).run).toBe(
      'function',
    );
    expect(() => compiled(choice('@sublang/playbook@1.3.0'))).toThrow(
      /unsupported pinned Playbook runtime contract/,
    );
    expect(() => compiled(choice('@sublang/playbook@1.1.0'))).toThrow(
      /unsupported pinned Playbook runtime contract/,
    );
    // 3.1.0 ships runtime.ts byte-identical to 2.0.0 with only the additive
    // compat self-report, so it joins the composed profile (DR-018); the
    // never-installed 3.0.0 stays fail-closed.
    expect(typeof compiled(choice('@sublang/playbook@3.1.0')).run).toBe(
      'function',
    );
    expect(() => compiled(choice('@sublang/playbook@3.0.0'))).toThrow(
      /unsupported pinned Playbook runtime contract/,
    );
    // 4.0.0 ships runtime.ts and the engine byte-identical to 3.1.0's — its
    // major marks the SDK-topology break, cligent taking over runtime
    // versions, not a contract change — so it joins the composed profile
    // (DR-020); an unreviewed 4.1.0 stays fail-closed like any other.
    expect(typeof compiled(choice('@sublang/playbook@4.0.0')).run).toBe(
      'function',
    );
    expect(() => compiled(choice('@sublang/playbook@4.1.0'))).toThrow(
      /unsupported pinned Playbook runtime contract/,
    );
    // The DR-024 reviewed set has moved atomically, so exact 10.0.0 now
    // selects the schema-3 `composed-v3` profile. Reviewing 10.0.0 establishes
    // no contract identity for an intermediate release, so every unreviewed
    // version between 4.0.0 and 10.0.0 stays fail-closed.
    expect(typeof compiled(choice('@sublang/playbook@10.0.0')).run).toBe(
      'function',
    );
    for (const version of ['5.0.0', '6.0.0', '7.0.0', '8.0.0', '9.0.0']) {
      expect(() => compiled(choice(`@sublang/playbook@${version}`))).toThrow(
        `unsupported pinned Playbook runtime contract: @sublang/playbook@${version}`,
      );
    }
  });

  it('constructs an exact 10.0.0 pin as schema-3 and every mapped older pin as schema-1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-config-v3-'));
    const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
    const definitionPath = join(dir, 'phase.md');
    const source = join(dir, 'source.md');
    await writeFile(definitionPath, 'compiled phase definition');
    await writeFile(source, 'hello schema 3');
    const compiled = createConfiguredCompiledFactory(
      { agent: 'codex' },
      { adapterFactory: () => fakeAdapter('codex'), cwd: dir },
    );
    // One roleless schema-3 artifact drives both provenances: it accepts only
    // the exact `{ configuredOptions, hostCapabilities }` construction, so the
    // outcome witnesses which profile the pin actually bound.
    const choice = (provenance: string): CompiledSelection =>
      ({
        phase: 'text2gears',
        pipelineDir: fixtures,
        record: {
          artifact: { path: 'phase-v3-fixture.mjs' },
          linkTarget: { provenance },
        },
      }) as unknown as CompiledSelection;
    const run = (provenance: string, target: string) =>
      compiled(choice(provenance)).run(
        { kind: 'compile', definitionPath, source, target },
        new AbortController().signal,
      );

    try {
      const schema3Target = join(dir, 'schema-3.ts');
      await expect(
        run('@sublang/playbook@10.0.0', schema3Target),
      ).resolves.toEqual({ status: 'ok', diagnostics: [] });
      expect(await readFile(schema3Target, 'utf8')).toBe(
        'compiled-v3:hello schema 3',
      );

      // 4.0.0 keeps DR-020's `composed-v2` empty-object construction: the
      // schema-3 artifact refuses it instead of being silently upgraded.
      const schema1 = await run(
        '@sublang/playbook@4.0.0',
        join(dir, 'schema-1.ts'),
      );
      expect(schema1.status).toBe('error');
      expect(schema1.diagnostics.join('\n')).toContain(
        'factory argument does not have the exact own-data shape',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

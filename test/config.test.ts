// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAST_MODE_SUPPORT } from '@sublang/cligent';
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
  runtimeContractForPin,
  type SupportedAgent,
} from '../src/config.js';
import type { CompiledSelection } from '../src/runner.js';

import { writePlaybookEngineFixture } from './playbook-engine-fixture.js';

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

  it('accepts or refuses a literal fast mode by the installed Cligent contract, naming the agent (cli-7, cli-43)', () => {
    // The installed descriptor decides, so slc keeps no list of its own; the
    // registered set must straddle it for this test to prove anything.
    const supported = SUPPORTED_AGENTS.filter(
      (agent) => FAST_MODE_SUPPORT[agent].requestSupported,
    );
    const unsupported = SUPPORTED_AGENTS.filter(
      (agent) => !FAST_MODE_SUPPORT[agent].requestSupported,
    );
    expect(supported.length).toBeGreaterThan(0);
    expect(unsupported.length).toBeGreaterThan(0);

    for (const agent of supported) {
      expect(
        resolveAgentSelection({ SLC_AGENT: agent, SLC_FAST_MODE: 'true' })
          .fastMode,
      ).toBe(true);
      // `false` is a literal request, not an omission.
      expect(
        resolveAgentSelection({ SLC_AGENT: agent, SLC_FAST_MODE: ' false ' })
          .fastMode,
      ).toBe(false);
      expect(
        resolveAgentSelection({ SLC_AGENT: agent, SLC_FAST_MODE: '  ' })
          .fastMode,
      ).toBeUndefined();
    }
    for (const agent of unsupported) {
      for (const value of ['true', 'false']) {
        let caught: unknown;
        try {
          resolveAgentSelection({ SLC_AGENT: agent, SLC_FAST_MODE: value });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(ConfigError);
        expect((caught as ConfigError).code).toBe('fast-mode-unsupported');
        expect((caught as ConfigError).message).toContain(`"${agent}"`);
        expect((caught as ConfigError).message).toContain('SLC_FAST_MODE');
      }
    }
  });

  it('refuses an SLC_FAST_MODE other than exactly true or false, naming the variable (cli-43)', () => {
    for (const value of ['yes', '1', 'TRUE', 'on', 'True']) {
      let caught: unknown;
      try {
        resolveAgentSelection({
          SLC_AGENT: 'claude-code',
          SLC_FAST_MODE: value,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).code).toBe('fast-mode-invalid');
      expect((caught as ConfigError).message).toContain('SLC_FAST_MODE');
      expect((caught as ConfigError).message).toContain(`"${value}"`);
    }
  });

  it('resolves and validates an optional independent Reviewer selection', () => {
    expect(
      resolveAgentSelection({
        SLC_AGENT: 'claude-code',
        SLC_REVIEWER_AGENT: 'codex',
        SLC_REVIEWER_MODEL: 'gpt-review',
        SLC_REVIEWER_EFFORT: 'xhigh',
        SLC_REVIEWER_FAST_MODE: 'false',
      }),
    ).toEqual({
      agent: 'claude-code',
      model: undefined,
      effort: undefined,
      fastMode: undefined,
      reviewer: {
        agent: 'codex',
        model: 'gpt-review',
        effort: 'xhigh',
        fastMode: false,
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
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'codex',
        SLC_REVIEWER_AGENT: 'claude-code',
        SLC_REVIEWER_FAST_MODE: 'maybe',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'reviewer-fast-mode-invalid',
        message: expect.stringContaining('SLC_REVIEWER_FAST_MODE'),
      }),
    );
    const unsupported = SUPPORTED_AGENTS.find(
      (agent) => !FAST_MODE_SUPPORT[agent].requestSupported,
    );
    expect(unsupported).toBeDefined();
    expect(() =>
      resolveAgentSelection({
        SLC_AGENT: 'codex',
        SLC_REVIEWER_AGENT: unsupported,
        SLC_REVIEWER_FAST_MODE: 'true',
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'reviewer-fast-mode-unsupported',
        message: expect.stringContaining(`"${unsupported}"`),
      }),
    );
  });

  it('refuses Reviewer model, effort, or fast mode without reviewerAgent', () => {
    for (const reviewer of [
      { SLC_REVIEWER_MODEL: 'review-model' },
      { SLC_REVIEWER_EFFORT: 'high' },
      { SLC_REVIEWER_FAST_MODE: 'true' },
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

  it('carries the literal fast mode into every Coder and Reviewer call, and omission leaves it unset (cli-7, cli-40, cli-41, cli-43)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-fast-mode-config-'));
    const definitionPath = join(dir, 'text2gears.md');
    await writeFile(definitionPath, 'perform the transformation');
    const capture = (): {
      factory: AdapterFactory;
      options: Map<string, AgentOptions>;
    } => {
      const options = new Map<string, AgentOptions>();
      const factory: AdapterFactory = (agent) => ({
        agent,
        async isAvailable() {
          return true;
        },
        async *run(_prompt: string, runOptions?: AgentOptions) {
          if (runOptions !== undefined) options.set(agent, runOptions);
          yield {
            type: 'done',
            agent,
            timestamp: 1,
            sessionId: `${agent}-session`,
            payload: {
              status: 'success',
              result: agent === 'claude-code' ? 'NO_FINDINGS' : 'coder summary',
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      return { factory, options };
    };
    const request = {
      kind: 'compile' as const,
      definitionPath,
      source: join(dir, 'source.txt'),
      target: join(dir, 'target.md'),
    };

    try {
      // A literal on each side — `false` for the Reviewer is a request, not
      // an omission — rides the same call settings as effort.
      const literal = capture();
      await expect(
        createConfiguredExecutor(
          {
            agent: 'codex',
            effort: 'high',
            fastMode: true,
            reviewer: { agent: 'claude-code', fastMode: false },
          },
          { adapterFactory: literal.factory, cwd: dir },
        ).run(request, new AbortController().signal),
      ).resolves.toEqual({ status: 'ok', diagnostics: ['coder summary'] });
      expect(literal.options.get('codex')).toMatchObject({
        effort: 'high',
        fastMode: true,
      });
      expect(literal.options.get('claude-code')).toMatchObject({
        fastMode: false,
      });

      // Omission on both sides leaves the agent CLI's own default in force.
      const omitted = capture();
      await expect(
        createConfiguredExecutor(
          { agent: 'codex', reviewer: { agent: 'claude-code' } },
          { adapterFactory: omitted.factory, cwd: dir },
        ).run(request, new AbortController().signal),
      ).resolves.toEqual({ status: 'ok', diagnostics: ['coder summary'] });
      expect(omitted.options.get('codex')?.fastMode).toBeUndefined();
      expect(omitted.options.get('claude-code')?.fastMode).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('carries the literal fast mode into a compiled player call (cli-7, cli-43)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-fast-mode-compiled-'));
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
    const playerOptions: AgentOptions[] = [];
    const factory: AdapterFactory = (agent) => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(prompt: string, options?: AgentOptions) {
        if (options !== undefined) playerOptions.push(options);
        const marker = 'Request: ';
        const line = prompt
          .split('\n')
          .find((candidate) => candidate.startsWith(marker));
        if (line === undefined) throw new Error('missing compiled request');
        const input = JSON.parse(line.slice(marker.length)) as {
          target: string;
        };
        await writeFile(input.target, 'compiled output');
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: `${agent}-session`,
          payload: {
            status: 'success',
            result: 'player summary',
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as never;
      },
    });

    try {
      const executor = await createConfiguredCompiledFactory(
        { agent: 'codex', fastMode: false },
        { adapterFactory: factory, cwd: dir },
      )({
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
      expect(playerOptions).toHaveLength(1);
      expect(playerOptions[0]).toMatchObject({ fastMode: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requests the control-call tool allowlist only from an adapter that enforces one (phase-execution-31, phase-execution-32)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-control-isolation-'));
    const definitionPath = join(dir, 'phase.md');
    const source = join(dir, 'source.md');
    const target = join(dir, 'target.ts');
    await writeFile(definitionPath, 'compiled phase definition');
    await writeFile(source, 'source input');
    // A composed-v2 fixture whose single turn makes exactly the two control
    // calls: a routing-only Captain call carrying the source-owned empty
    // allowlist, then the hidden judge call the host isolates itself.
    await writeFile(
      join(dir, 'phase.playbook.mjs'),
      [
        "import { writeFile } from 'node:fs/promises';",
        '',
        'export default function createPlaybookRuntime() {',
        '  let ports;',
        '  return {',
        '    async init(session) { ports = session.ports; },',
        '    async handleBossInput({ text, signal }) {',
        "      await ports.callCaptain('Route this.', signal, {",
        "        visibility: 'visible',",
        '        resume: false,',
        '        allowedTools: [],',
        '      });',
        "      await ports.callJudge('Adjudicate this.', signal);",
        "      const marker = 'Request: ';",
        "      const line = text.split('\\n').find((c) => c.startsWith(marker));",
        '      const input = JSON.parse(line.slice(marker.length));',
        "      await writeFile(input.target, 'compiled output');",
        '      return {',
        "        outcome: 'terminal',",
        '        state: {',
        "          value: 'done',",
        "          activeStateIds: ['done'],",
        '          tags: [],',
        "          status: 'done',",
        '          quiescent: true,',
        "          stateId: 'done',",
        '        },',
        '      };',
        '    },',
        '    async dispose() {},',
        '  };',
        '}',
      ].join('\n'),
    );

    // The options each control call actually reaches the configured agent's
    // Cligent adapter with — the seam below the ports, where adapter tool
    // capability is host knowledge (phase-execution-31).
    const controlCallOptions = async (
      agent: SupportedAgent,
    ): Promise<AgentOptions[]> => {
      const seen: AgentOptions[] = [];
      const factory: AdapterFactory = (id) => ({
        agent: id,
        async isAvailable() {
          return true;
        },
        async *run(_prompt: string, options?: AgentOptions) {
          if (options !== undefined) seen.push(options);
          yield {
            type: 'done',
            agent: id,
            timestamp: 1,
            sessionId: `${id}-session`,
            payload: {
              status: 'success',
              result: 'control reply',
              usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
              durationMs: 1,
            },
          } as never;
        },
      });
      const executor = await createConfiguredCompiledFactory(
        { agent },
        { adapterFactory: factory, cwd: dir },
      )({
        phase: 'phase',
        pipelineDir: dir,
        record: {
          artifact: { path: 'phase.playbook.mjs' },
          linkTarget: { provenance: '@sublang/playbook@2.0.0' },
        },
      } as unknown as CompiledSelection);

      await expect(
        executor.run(
          { kind: 'compile', definitionPath, source, target },
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ status: 'ok' });
      await rm(target, { force: true });
      return seen;
    };
    const withoutTools = (options: AgentOptions): Record<string, unknown> => {
      const { allowedTools, abortSignal, ...rest } = options;
      void allowedTools;
      void abortSignal;
      return rest;
    };

    try {
      const enforcing = await controlCallOptions('claude-code');
      const promptOnly = await controlCallOptions('codex');

      // The same two control calls under either selection.
      expect(enforcing).toHaveLength(2);
      expect(promptOnly).toHaveLength(2);
      // Only an adapter with a provider-enforced tool-restriction surface is
      // asked for the empty allowlist: Codex refuses any tool-list value, so
      // requesting one there would fail every control call before the model
      // ran, leaving the artifact's authored control envelope as the
      // isolation (DR-012).
      expect(enforcing.map((options) => options.allowedTools)).toEqual([
        [],
        [],
      ]);
      expect(promptOnly.map((options) => options.allowedTools)).toEqual([
        undefined,
        undefined,
      ]);
      // The substitution changes nothing else about either call.
      expect(promptOnly.map(withoutTools)).toEqual(enforcing.map(withoutTools));
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
      const executor = await configured({
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

  it('binds compiled execution to the pin-recorded runtime contract', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-config-contract-'));
    try {
      const pipelineDir = join(dir, 'pipeline');
      await mkdir(pipelineDir);
      const compiled = createConfiguredCompiledFactory(
        { agent: 'codex' },
        { adapterFactory: () => fakeAdapter('codex') },
      );
      // Each variant is its own installed engine package; the pin's link
      // target points into it (phase-execution-30; DR-028).
      const engine = async (
        name: string,
        options: Parameters<typeof writePlaybookEngineFixture>[1] = {},
      ): Promise<string> => {
        const fixture = await writePlaybookEngineFixture(
          join(dir, name),
          options,
        );
        return toPosix(relative(pipelineDir, fixture.linkTarget));
      };
      const choice = (
        provenance: string | undefined,
        locator = '../absent/node_modules/@sublang/playbook/src/runtime.ts',
      ): CompiledSelection =>
        ({
          phase: 'text2gears',
          pipelineDir,
          record: {
            artifact: { path: 'text2gears.slc/text2gears.playbook.ts' },
            linkTarget:
              provenance === undefined ? { locator } : { locator, provenance },
          },
        }) as unknown as CompiledSelection;
      const rejects = async (
        selection: CompiledSelection,
        reason: RegExp,
      ): Promise<void> => {
        await expect(compiled(selection)).rejects.toThrow(
          /^unsupported pinned Playbook runtime contract: /,
        );
        await expect(runtimeContractForPin(selection)).rejects.toThrow(reason);
      };

      // The exact historical maps decide without consulting the link target,
      // which here does not even exist (DR-028 retains them as recorded).
      expect(await runtimeContractForPin(choice(undefined))).toBe('legacy');
      expect(
        await runtimeContractForPin(choice('@sublang/playbook@0.9.0')),
      ).toBe('legacy');
      // Playbook 0.10 pins select the composed six-port profile (DR-011), and
      // so do 1.0.0 pins — the published release of that same generation —
      // 2.0.0 (DR-017), 3.1.0 (DR-018), and 4.0.0 (DR-020).
      for (const version of ['0.10.0', '1.0.0', '2.0.0', '3.1.0', '4.0.0']) {
        expect(
          await runtimeContractForPin(choice(`@sublang/playbook@${version}`)),
        ).toBe('composed-v2');
        expect(
          typeof (await compiled(choice(`@sublang/playbook@${version}`))).run,
        ).toBe('function');
      }
      expect(
        typeof (await compiled(choice('@sublang/playbook@0.9.0'))).run,
      ).toBe('function');

      // Every other provenance selects composed-v3 exactly when the link
      // target's installed engine declares RUNTIME_ABI 1 with artifact schema
      // 3 — whatever the release number says.
      const declaring = await engine('declaring', { version: '10.0.0' });
      const later = await engine('later', { version: '12.0.0' });
      for (const [version, locator] of [
        ['10.0.0', declaring],
        ['12.0.0', later],
        ['9.0.0', later],
        ['1.3.0', later],
      ]) {
        const selection = choice(`@sublang/playbook@${version}`, locator);
        expect(await runtimeContractForPin(selection)).toBe('composed-v3');
        expect(typeof (await compiled(selection)).run).toBe('function');
      }

      // Another ABI, a schema set without 3, or no declaration fails closed
      // naming the declaration; so does a link target outside an installed
      // engine or one whose engine cannot be resolved.
      await rejects(
        choice(
          '@sublang/playbook@12.0.0',
          await engine('abi', { runtimeAbi: 2 }),
        ),
        /@sublang\/playbook@10\.0\.0 declares RUNTIME_ABI 2 and SUPPORTED_ARTIFACT_SCHEMAS \[3\]; composed-v3 requires RUNTIME_ABI 1 and artifact schema 3/,
      );
      await rejects(
        choice(
          '@sublang/playbook@12.0.0',
          await engine('schemas', {
            version: '12.0.0',
            supportedArtifactSchemas: [2],
          }),
        ),
        /@sublang\/playbook@12\.0\.0 declares RUNTIME_ABI 1 and SUPPORTED_ARTIFACT_SCHEMAS \[2\]/,
      );
      await rejects(
        choice(
          '@sublang/playbook@1.3.0',
          await engine('bare', {
            version: '1.3.0',
            omitRuntimeAbi: true,
            omitSchemas: true,
          }),
        ),
        /@sublang\/playbook@1\.3\.0 declares no RUNTIME_ABI and no SUPPORTED_ARTIFACT_SCHEMAS/,
      );
      await rejects(
        choice(
          '@sublang/playbook@3.0.0',
          await engine('noexports', { version: '3.0.0', omitExports: true }),
        ),
        /@sublang\/playbook@3\.0\.0 at .* does not resolve @sublang\/playbook\/xstate-runtime/,
      );
      await writeFile(join(pipelineDir, 'linktarget.ts'), 'link target\n');
      for (const version of ['5.0.0', '6.0.0', '7.0.0', '8.0.0', '9.0.0']) {
        await rejects(
          choice(`@sublang/playbook@${version}`, 'linktarget.ts'),
          new RegExp(
            `^unsupported pinned Playbook runtime contract: @sublang/playbook@${version.replaceAll('.', '\\.')} \\(link target linktarget\\.ts is not inside an installed @sublang/playbook package\\)$`,
          ),
        );
      }
      await rejects(
        choice(
          '@sublang/playbook@4.1.0',
          await engine('local', { name: 'local-runtime' }),
        ),
        /is not inside an installed @sublang\/playbook package/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('constructs a declared schema-3 link target as composed-v3 and every mapped older pin as schema-1', async () => {
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
    // One roleless schema-3 artifact drives every selection: it accepts only
    // the exact `{ configuredOptions, hostCapabilities }` construction, so the
    // outcome witnesses which profile the pin actually bound. The link target
    // is an installed engine declaring the schema-3 contract (DR-028).
    const engine = await writePlaybookEngineFixture(dir, { version: '12.0.0' });
    const choice = (provenance: string): CompiledSelection =>
      ({
        phase: 'text2gears',
        pipelineDir: dir,
        record: {
          artifact: {
            path: toPosix(
              relative(dir, join(fixtures, 'phase-v3-fixture.mjs')),
            ),
          },
          linkTarget: {
            locator: toPosix(relative(dir, engine.linkTarget)),
            provenance,
          },
        },
      }) as unknown as CompiledSelection;
    const run = async (provenance: string, target: string) =>
      (await compiled(choice(provenance))).run(
        { kind: 'compile', definitionPath, source, target },
        new AbortController().signal,
      );

    try {
      for (const [provenance, target] of [
        ['@sublang/playbook@10.0.0', join(dir, 'schema-3-ten.ts')],
        ['@sublang/playbook@12.0.0', join(dir, 'schema-3-twelve.ts')],
      ]) {
        await expect(run(provenance, target)).resolves.toEqual({
          status: 'ok',
          diagnostics: [],
        });
        expect(await readFile(target, 'utf8')).toBe(
          'compiled-v3:hello schema 3',
        );
      }

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

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

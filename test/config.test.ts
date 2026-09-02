// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
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
  runtimeContractForPin,
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

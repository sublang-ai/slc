// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as runtime from '../src/index.js';
import {
  benchmarkCompile,
  parseArguments,
  validateArtifacts,
} from '../scripts/benchmark-compile.mjs';

const roots = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'slc-benchmark-'));
  roots.push(root);
  const pipelines = join(root, 'pipelines');
  const pipeline = join(pipelines, 'fixture');
  await mkdir(pipeline, { recursive: true });
  const definition = (source, target, extension) => `# fixture
## Formats
| Role | Format | Extension |
| --- | --- | --- |
| source | ${source} | .md |
| target | ${target} | ${extension} |
Write a complete target preserving the source.
`;
  await writeFile(
    join(pipeline, 'alpha2beta.md'),
    definition('alpha', 'beta', '.md'),
  );
  await writeFile(
    join(pipeline, 'beta2gamma.md'),
    definition('beta', 'gamma', '.txt'),
  );
  const source = join(root, 'example.md');
  await writeFile(source, 'PRIVATE SOURCE TEXT\n');
  const config = join(root, 'config.yaml');
  await writeFile(config, 'agent: claude-code\nreviewerAgent: codex\n');
  return {
    source,
    config,
    output: join(root, 'evidence'),
    model: 'fixture-model',
    pipeline: 'fixture',
    pipelinePaths: [pipelines],
    timeoutSeconds: 10,
  };
}

function adapter(seen, waitForAbort = false) {
  return {
    agent: 'claude-code',
    async isAvailable() {
      return true;
    },
    async *run(prompt, options) {
      seen.push(options.resume);
      if (waitForAbort) {
        if (!options.abortSignal.aborted)
          await new Promise((resolve) =>
            options.abortSignal.addEventListener('abort', resolve, {
              once: true,
            }),
          );
      } else {
        const target = /^- artifact to write: (.+)$/m.exec(prompt)?.[1];
        await writeFile(target, 'PRIVATE ARTIFACT TEXT\n');
      }
      yield {
        type: 'done',
        agent: 'claude-code',
        sessionId: 'fixture-session',
        timestamp: 1,
        payload: {
          status: waitForAbort ? 'interrupted' : 'success',
          result: 'PRIVATE AGENT RESPONSE',
          resumeToken: 'PRIVATE CONTINUATION',
          durationMs: 1,
          usage: {
            toolUses: 0,
            tokens: {
              coverage: 'complete',
              totals: { input: { total: 4 }, output: { total: 2 } },
            },
          },
        },
      };
    },
  };
}

async function validate({ result }) {
  const contents = await Promise.all(
    result.outputs.map((path) => readFile(path, 'utf8')),
  );
  return {
    ok:
      contents.length === 2 &&
      contents.every((text) => text === 'PRIVATE ARTIFACT TEXT\n'),
  };
}

describe('opt-in compilation benchmark', () => {
  it('records cold real pipeline calls and preserves privacy across repeated runs', async () => {
    const options = await fixture();
    const seen = [];
    const injected = {
      runtime,
      env: {},
      adapterFactory: () => adapter(seen),
      validate,
    };
    const first = await benchmarkCompile(options, injected);
    const second = await benchmarkCompile(options, injected);
    expect(first.summary.status).toBe('success');
    expect(second.evidence).not.toBe(first.evidence);
    expect(second.summary.source.sha256).toBe(first.summary.source.sha256);
    expect(first.summary.selection).toEqual({
      agent: 'claude-code',
      model: 'fixture-model',
      effort: undefined,
      fastMode: undefined,
    });
    expect(first.summary.phases.map((phase) => phase.name)).toEqual([
      'alpha2beta',
      'beta2gamma',
    ]);
    expect(first.summary.calls.map((call) => call.resumed)).toEqual([
      false,
      true,
    ]);
    expect(first.summary.calls[0].usage.tokens.totals.input.total).toBe(4);
    expect(first.summary.dependencies['@openai/codex-sdk']).toEqual(
      expect.any(String),
    );
    expect(
      first.summary.dependencies['@anthropic-ai/claude-agent-sdk'],
    ).toEqual(expect.any(String));
    expect(first.summary.validation).toMatchObject({
      ok: true,
      elapsedMs: expect.any(Number),
    });
    expect(first.summary.calls[0]).toMatchObject({
      elapsedMs: expect.any(Number),
      promptBytes: expect.any(Number),
      promptSha256: expect.any(String),
    });
    const summary = await readFile(first.summaryPath, 'utf8');
    const metrics = await readFile(first.summary.logs.metrics, 'utf8');
    expect(summary + metrics).not.toContain('PRIVATE ');
    expect(await readFile(first.summary.logs.diagnostics, 'utf8')).toContain(
      'PRIVATE AGENT RESPONSE',
    );
  });

  it('identifies changed compiled JavaScript without exposing its contents', async () => {
    const options = await fixture();
    const root = dirname(options.source);
    await mkdir(join(root, 'dist'));
    await symlink(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(root, 'node_modules'),
      'dir',
    );
    const compiled = join(root, 'dist/cli.js');
    await writeFile(compiled, 'PRIVATE COMPILER BYTES one');
    const injected = {
      root,
      runtime,
      env: {},
      adapterFactory: () => adapter([]),
      validate,
    };
    const first = await benchmarkCompile(options, injected);
    await writeFile(compiled, 'PRIVATE COMPILER BYTES two');
    const second = await benchmarkCompile(options, injected);
    expect(first.summary.status).toBe('success');
    expect(second.summary.status).toBe('success');
    expect(first.summary.compilerRuntime.files).toEqual([
      {
        name: 'cli.js',
        bytes: 26,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    expect(second.summary.compilerRuntime.sha256).not.toBe(
      first.summary.compilerRuntime.sha256,
    );
    expect(JSON.stringify(second.summary)).not.toContain('PRIVATE COMPILER');
  });

  it.each([undefined, 'minimal'])(
    'applies only the explicitly selected runtime check to supplied sources: %s',
    async (runtimeCheck) => {
      const options = await fixture();
      const seenProfiles = [];
      const result = await benchmarkCompile(
        { ...options, runtimeCheck },
        {
          runtime,
          env: {},
          adapterFactory: () => adapter([]),
          validate: async (inputs) => {
            seenProfiles.push(inputs.runtimeCheck);
            return validate(inputs);
          },
        },
      );
      expect(result.summary.status).toBe('success');
      expect(seenProfiles).toEqual([runtimeCheck]);
      expect(result.summary.runtimeCheck).toBe(runtimeCheck ?? null);
    },
  );

  it('omits only the inherited phase continuation in the explicit experiment', async () => {
    const options = await fixture();
    const seen = [];
    const result = await benchmarkCompile(
      { ...options, freshPhaseSessions: true },
      { runtime, env: {}, adapterFactory: () => adapter(seen), validate },
    );
    expect(result.summary.status).toBe('success');
    expect(seen).toEqual([undefined, undefined]);
    expect(result.summary.calls.map((call) => call.requestedResume)).toEqual([
      false,
      true,
    ]);
    expect(result.summary.calls.map((call) => call.resumed)).toEqual([
      false,
      false,
    ]);
  });

  it('cooperatively aborts an over-deadline run and retains failed evidence', async () => {
    const options = await fixture();
    const result = await benchmarkCompile(
      { ...options, timeoutSeconds: 0.25 },
      { runtime, env: {}, adapterFactory: () => adapter([], true), validate },
    );
    expect(result.summary).toMatchObject({
      status: 'failure',
      deadlineExceeded: true,
    });
    expect(result.summary.compile.ok).toBe(false);
    expect(result.summary.validation).toBeUndefined();
    expect(result.summary.calls[0].status).toBe('interrupted');
    expect(JSON.parse(await readFile(result.summaryPath, 'utf8')).status).toBe(
      'failure',
    );
  });

  it('loads the emitted entry and fails on an actual generated-suite assertion', async () => {
    const options = await fixture();
    const work = join(options.output, 'validation');
    const root = fileURLToPath(new URL('..', import.meta.url));
    const bundle = join(work, 'minimal.playbook');
    await mkdir(bundle, { recursive: true });
    await symlink(
      join(root, 'node_modules'),
      join(work, 'node_modules'),
      'dir',
    );
    await writeFile(
      join(work, 'minimal.ts'),
      'export default { createRuntime() {} };\n',
    );
    const suites = [
      'gears-fsm',
      'fsm.introspect',
      'prompt-contract',
      'fsm.coverage',
    ];
    for (const suite of suites) {
      await writeFile(
        join(bundle, `minimal.${suite}.test.ts`),
        "import { it, expect } from 'vitest'; it('artifact contract', () => expect(true).toBe(true));\n",
      );
    }
    const input = {
      result: { outputs: [join(work, 'minimal.ts')] },
      work,
      root,
      signal: new AbortController().signal,
      log: () => {},
    };
    expect(await validateArtifacts(input)).toMatchObject({
      ok: true,
      testFiles: 4,
    });
    await writeFile(
      join(bundle, 'minimal.prompt-contract.test.ts'),
      "import { it, expect } from 'vitest'; it('artifact drift', () => expect(false).toBe(true));\n",
    );
    expect(await validateArtifacts(input)).toMatchObject({
      ok: false,
      suite: { ok: false, code: 1 },
    });
  });

  it('rejects unattributable or unbounded measurements before adapter work', async () => {
    expect(() => parseArguments(['--source'])).toThrow('needs a value');
    await expect(benchmarkCompile({})).rejects.toThrow('--model is required');
    await expect(
      benchmarkCompile({ model: 'fixture', timeoutSeconds: 0 }),
    ).rejects.toThrow('--timeout-seconds');
  });
});

const FIXED_FSM = `export const machine = { config: { context: { audience: '' }, states: { write: {
  meta: { playbook: { stateId: 'write', role: 'writer' } },
  invoke: { src: 'player', input: ({ context }) => ({
    stateId: 'write', sourceItem: 'FIXED-1', role: 'writer',
    prompt: 'Write for <audience>.', audience: context.audience, result: { done: 'Written.' }
  }) }
} } } };
`;
const FAITHFUL_LINK = `export const _internal = { composePlayerPrompt: input => input.prompt.replaceAll('<audience>', input.audience) };
export default function createRuntime() { return { init: async()=>{}, handleBossInput: async()=>{}, dispose: async()=>{} }; }
`;

async function linkFixture() {
  const options = await fixture();
  const root = dirname(options.source);
  const pipeline = join(options.pipelinePaths[0], 'fixture');
  await rm(pipeline, { recursive: true });
  await mkdir(pipeline);
  await writeFile(
    join(pipeline, 'gears2fsm.md'),
    '## Formats\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | gears | .md |\n| target | fsm | .ts |\n',
  );
  await writeFile(
    join(pipeline, 'link.md'),
    '## Formats\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | fsm | .ts |\n| target | playbook | .ts |\n',
  );
  const source = join(root, 'fixed.fsm.ts');
  const linkTarget = join(root, 'runtime.ts');
  await writeFile(source, FIXED_FSM);
  await writeFile(linkTarget, 'export const runtime = true;\n');
  return { ...options, source, linkTarget };
}

function linkingAdapter(prompts) {
  const base = adapter([]);
  return {
    ...base,
    async *run(prompt) {
      prompts.push(prompt);
      const target = /^- artifact to write: (.+)$/m.exec(prompt)?.[1];
      await writeFile(target, FAITHFUL_LINK);
      yield {
        type: 'done',
        agent: 'claude-code',
        sessionId: 'fixed-link',
        timestamp: 1,
        payload: {
          status: 'success',
          result: 'Linked fixed FSM.',
          durationMs: 1,
          usage: { inputTokens: 10, outputTokens: 5, toolUses: 1 },
        },
      };
    },
  };
}

describe('fixed-FSM link-only benchmark', () => {
  it('runs one ordinary link in fresh workspaces and independently validates unchanged input', async () => {
    const options = await linkFixture();
    const prompts = [];
    const injected = {
      runtime,
      env: {},
      adapterFactory: () => linkingAdapter(prompts),
    };
    const first = await benchmarkCompile(options, injected);
    const second = await benchmarkCompile(options, injected);
    expect(
      first.summary,
      await readFile(first.summary.logs.diagnostics, 'utf8'),
    ).toMatchObject({
      scope: 'link',
      status: 'success',
      optimize: null,
      runtimeCheck: null,
      validation: {
        ok: true,
        sourceUnchanged: true,
        linkedContract: { ok: true },
      },
      linkTarget: {
        path: options.linkTarget,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(first.summary.invocation).toEqual([
      'fixture.link',
      first.summary.source.path,
      options.linkTarget,
    ]);
    expect(first.summary.phases.map((phase) => phase.name)).toEqual(['link']);
    expect(first.summary.calls).toHaveLength(1);
    expect(first.summary.calls[0]).toMatchObject({
      promptBytes: expect.any(Number),
      usage: { inputTokens: 10 },
    });
    expect(first.evidence).not.toBe(second.evidence);
    expect(await readFile(options.source, 'utf8')).toBe(FIXED_FSM);
    expect(await readFile(first.summary.source.path, 'utf8')).toBe(FIXED_FSM);
    expect(prompts).toHaveLength(2);
    expect(first.summary.validation).not.toHaveProperty('entryImport');
    expect(first.summary.validation).not.toHaveProperty('suite');
  });

  it('rejects linked prompt drift found by independent validation after phase acceptance', async () => {
    const options = await linkFixture();
    const result = await benchmarkCompile(options, {
      runtime: {
        ...runtime,
        async runSlc(...args) {
          const compiled = await runtime.runSlc(...args);
          expect(compiled.ok).toBe(true);
          await writeFile(
            compiled.outputs[0],
            FAITHFUL_LINK.replace(
              "input.prompt.replaceAll('<audience>', input.audience)",
              "'Dropped the original prompt.'",
            ),
          );
          return compiled;
        },
      },
      env: {},
      adapterFactory: () => linkingAdapter([]),
    });
    expect(result.summary).toMatchObject({
      scope: 'link',
      status: 'failure',
      compile: { ok: true },
      validation: {
        ok: false,
        sourceUnchanged: true,
        linkedContract: { ok: false },
      },
    });
    expect(await readFile(result.summary.logs.diagnostics, 'utf8')).toContain(
      'does not preserve the body line',
    );
  });

  it.each([
    { linkTarget: '/runtime.ts' },
    { source: '/source.md', linkTarget: '/runtime.ts' },
    { source: '/source.fsm.ts', linkTarget: '/runtime.ts', optimize: false },
    {
      source: '/source.fsm.ts',
      linkTarget: '/runtime.ts',
      runtimeCheck: 'minimal',
    },
  ])(
    'refuses invalid link-only selections before calls: %j',
    async (options) => {
      await expect(
        benchmarkCompile({ model: 'fixture', ...options }),
      ).rejects.toThrow(/requires explicit --source|not valid for link-only/);
    },
  );
});

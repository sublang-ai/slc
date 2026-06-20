// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentSelection } from '../src/config.js';
import { run, version, type SlcDeps } from '../src/index.js';
import {
  createInterpretedExecutor,
  type AgentClient,
} from '../src/interpreter.js';
import {
  createPipelineResolver,
  pipelineSearchRoots,
} from '../src/resolver.js';

const formats = (sf: string, se: string, tf: string, te: string): string =>
  `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${sf} | ${se} |
| target | ${tf} | ${te} |
`;

const linkDoc = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | A runner module. |
`;

/** A fake agent that writes the prompt's declared target, with optional faults. */
const makeAgent = (
  opts: {
    block?: boolean;
    skip?: boolean;
    error?: boolean;
    waitAbort?: boolean;
  } = {},
): { agent: AgentClient; calls: string[]; models: (string | undefined)[] } => {
  const calls: string[] = [];
  const models: (string | undefined)[] = [];
  const agent: AgentClient = {
    run: async ({ prompt, model, signal }) => {
      calls.push(prompt);
      models.push(model);
      if (opts.waitAbort) {
        await new Promise<void>((resolve) => {
          if (signal.aborted) return resolve();
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { status: 'error', text: 'aborted' };
      }
      if (opts.block)
        return { status: 'success', text: 'BLOCKED: the source is malformed' };
      if (opts.error) return { status: 'error', text: 'agent failed' };
      const match = /artifact to write: (.+)/.exec(prompt);
      if (match && !opts.skip) await writeFile(match[1].trim(), 'output\n');
      return { status: 'success', text: 'wrote the artifact' };
    },
  };
  return { agent, calls, models };
};

let root: string;
let pipelinesRoot: string;
let pipelineDir: string;
let srcDir: string;
let source: string;
let artDir: string;

/** SlcDeps with a fake resolver and an interpreted executor over a fake agent. */
const interpretedDeps = (
  agent: AgentClient,
  signal: AbortSignal,
  model?: string,
): SlcDeps => ({
  resolver: (reference) => (reference === 'playbook' ? [pipelineDir] : []),
  executor: createInterpretedExecutor({
    agent,
    config: model ? { model } : {},
  }),
  signal,
});

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slc-cli-'));
  pipelinesRoot = join(root, 'pipelines');
  pipelineDir = join(pipelinesRoot, 'playbook');
  srcDir = join(root, 'work');
  await mkdir(pipelineDir, { recursive: true });
  await mkdir(srcDir);
  await writeFile(
    join(pipelineDir, 'text2gears.md'),
    formats('text', '.md', 'gears', '.md'),
  );
  await writeFile(
    join(pipelineDir, 'gears2fsm.md'),
    formats('gears', '.md', 'fsm', '.ts'),
  );
  await writeFile(join(pipelineDir, 'link.md'), linkDoc);
  source = join(srcDir, 'onboarding.md');
  await writeFile(source, 'prose');
  artDir = join(srcDir, 'onboarding.playbook');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('conveniences (CLI-13, CLI-14)', () => {
  it('prints the version and exits 0 without building deps (CLI-13)', async () => {
    for (const flag of ['--version', '-v']) {
      const out: string[] = [];
      const err: string[] = [];
      const code = await run([flag], {
        env: {},
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t),
        buildDeps: () => {
          throw new Error('deps must not be built for --version');
        },
      });
      expect(code).toBe(0);
      expect(out.join('')).toContain(version());
      expect(err.join('')).toBe('');
    }
  });

  it('prints usage naming the forms and exits 0 without building deps (CLI-14)', async () => {
    for (const flag of ['--help', '-h']) {
      const out: string[] = [];
      const code = await run([flag], {
        env: {},
        stdout: (t) => out.push(t),
        buildDeps: () => {
          throw new Error('deps must not be built for --help');
        },
      });
      expect(code).toBe(0);
      expect(out.join('')).toMatch(/Usage:/);
      expect(out.join('')).toContain('SLC_AGENT');
    }
  });
});

describe('reporting (CLI-15, CLI-16)', () => {
  it('prints written paths including the -o path and exits 0 (CLI-15)', async () => {
    const { agent } = makeAgent();
    const out: string[] = [];
    const outPath = join(srcDir, 'custom.fsm.ts');
    const code = await run(['playbook', source, '-o', outPath], {
      env: {},
      stdout: (t) => out.push(t),
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });

    expect(code).toBe(0);
    const stdout = out.join('');
    expect(stdout).toContain(join(artDir, 'onboarding.gears.md'));
    expect(stdout).toContain(outPath);
    expect(await exists(outPath)).toBe(true);
  });

  it('reports a rejected run to stderr, nothing to stdout, non-zero (CLI-16)', async () => {
    const { agent } = makeAgent();
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['missing', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('missing');
  });

  it('reports a failed phase naming the phase and target (CLI-16)', async () => {
    const { agent } = makeAgent({ skip: true });
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['playbook', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    const report = err.join('');
    expect(report).toContain('text2gears');
    expect(report).toContain('onboarding.gears.md');
  });

  it('reports a BLOCKED phase to stderr with a non-zero exit (CLI-16)', async () => {
    const { agent } = makeAgent({ block: true });
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['playbook', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('BLOCKED');
  });
});

describe('process control (CLI-17)', () => {
  it('aborts the in-flight run on interrupt and exits non-zero without a success report', async () => {
    const { agent } = makeAgent({ waitAbort: true });
    const controller = new AbortController();
    const out: string[] = [];
    const pending = run(['playbook', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: () => {},
      signal: controller.signal,
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });
    controller.abort();
    const code = await pending;

    expect(code).not.toBe(0);
    expect(out.join('')).toBe('');
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(false);
  });
});

describe('configuration (CLI-18, CLI-19)', () => {
  it('refuses an unset SLC_AGENT to stderr, runs no phase, non-zero (CLI-18)', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['playbook', source], {
      env: { SLC_PIPELINE_PATH: pipelinesRoot },
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('SLC_AGENT');
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(false);
  });

  it('refuses an unsupported SLC_AGENT (CLI-18)', async () => {
    const err: string[] = [];
    const code = await run(['playbook', source], {
      env: { SLC_AGENT: 'gpt', SLC_PIPELINE_PATH: pipelinesRoot },
      stderr: (t) => err.push(t),
    });

    expect(code).toBe(1);
    expect(err.join('')).toContain('not a supported');
  });

  it('resolves via SLC_PIPELINE_PATH and interprets every phase with the configured model (CLI-19)', async () => {
    const { agent, calls, models } = makeAgent();
    const out: string[] = [];
    const code = await run(['playbook', source], {
      env: {
        SLC_PIPELINE_PATH: pipelinesRoot,
        SLC_AGENT: 'claude-code',
        SLC_MODEL: 'opus-x',
      },
      stdout: (t) => out.push(t),
      // Mirror production wiring (real resolver + real config selection),
      // faking only the agent transport so no real agent runs.
      buildDeps: ({ env, cwd, signal }) => {
        const selection = resolveAgentSelection(env);
        return {
          resolver: createPipelineResolver(
            pipelineSearchRoots(env.SLC_PIPELINE_PATH, cwd),
          ),
          executor: createInterpretedExecutor({
            agent,
            config: { model: selection.model, cwd },
          }),
          signal,
        };
      },
    });

    expect(code).toBe(0);
    expect(calls).toHaveLength(2); // every phase interpreted (CLI-8)
    expect(models).toEqual(['opus-x', 'opus-x']); // configured model reaches the agent
    expect(out.join('')).toContain(join(artDir, 'onboarding.fsm.ts'));
  });
});

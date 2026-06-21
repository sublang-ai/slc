// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAgentSelection, type AgentSelection } from '../src/config.js';
import { loadConfigFile } from '../src/config-file.js';
import {
  interruptSignal,
  resolveRunConfig,
  run,
  version,
  type DepsBuilder,
  type SlcDeps,
} from '../src/index.js';
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
      const help = out.join('');
      expect(help).toMatch(/Usage:/);
      expect(help).toContain('SLC_AGENT');
      // Reworded CLI-2: help names --config and the config file, not just env.
      expect(help).toContain('--config');
      expect(help).toContain('slc.config.yaml');
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
  it('aborts the in-flight run on a SIGINT interrupt through the shim wiring (CLI-17)', async () => {
    const { agent } = makeAgent({ waitAbort: true });
    // Drive cancellation through interruptSignal — the exact wiring cli.ts uses —
    // with a fake emitter, so a broken SIGINT handler fails this test.
    const signals = new EventEmitter();
    const { signal } = interruptSignal(signals);
    const out: string[] = [];
    const pending = run(['playbook', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: () => {},
      signal,
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });
    signals.emit('SIGINT');
    const code = await pending;

    expect(code).not.toBe(0);
    expect(out.join('')).toBe('');
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(false);
  });

  it('wires SIGINT and SIGTERM to abort and disposes the listeners (CLI-10)', () => {
    for (const sig of ['SIGINT', 'SIGTERM']) {
      const emitter = new EventEmitter();
      const { signal } = interruptSignal(emitter);
      expect(signal.aborted).toBe(false);
      emitter.emit(sig);
      expect(signal.aborted).toBe(true);
    }

    const emitter = new EventEmitter();
    const { dispose } = interruptSignal(emitter);
    expect(emitter.listenerCount('SIGINT')).toBe(1);
    expect(emitter.listenerCount('SIGTERM')).toBe(1);
    dispose();
    expect(emitter.listenerCount('SIGINT')).toBe(0);
    expect(emitter.listenerCount('SIGTERM')).toBe(0);
  });
});

describe('configuration (CLI-18, CLI-19)', () => {
  it('refuses an unset SLC_AGENT to stderr, runs no phase, non-zero (CLI-18)', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['playbook', source], {
      // Isolate config-file discovery (DR-006): no config under cwd or this
      // config home, so the run falls through to the (unset) environment.
      cwd: root,
      env: { SLC_PIPELINE_PATH: pipelinesRoot, XDG_CONFIG_HOME: root },
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
      cwd: root,
      env: {
        SLC_AGENT: 'gpt',
        SLC_PIPELINE_PATH: pipelinesRoot,
        XDG_CONFIG_HOME: root,
      },
      stderr: (t) => err.push(t),
    });

    expect(code).toBe(1);
    expect(err.join('')).toContain('not a supported');
  });

  it('resolves via SLC_PIPELINE_PATH and interprets every phase through the configured agent and model (CLI-19)', async () => {
    const { agent, calls, models } = makeAgent();
    // Transport registry keyed by agent id: the selected SLC_AGENT must pick it.
    const transports: Record<string, AgentClient> = { 'claude-code': agent };
    let chosenAgent: string | undefined;
    const out: string[] = [];
    const code = await run(['playbook', source], {
      env: {
        SLC_PIPELINE_PATH: pipelinesRoot,
        SLC_AGENT: 'claude-code',
        SLC_MODEL: 'opus-x',
      },
      stdout: (t) => out.push(t),
      // Mirror production wiring (real resolver + real config selection),
      // choosing the transport by the selected agent so SLC_AGENT is exercised.
      buildDeps: ({ env, cwd, signal }) => {
        const selection = resolveAgentSelection(env);
        chosenAgent = selection.agent;
        return {
          resolver: createPipelineResolver(
            pipelineSearchRoots(env.SLC_PIPELINE_PATH, cwd),
          ),
          executor: createInterpretedExecutor({
            agent: transports[selection.agent],
            config: { model: selection.model, cwd },
          }),
          signal,
        };
      },
    });

    expect(code).toBe(0);
    expect(chosenAgent).toBe('claude-code'); // SLC_AGENT drove the selection
    expect(calls).toHaveLength(2); // every phase interpreted (CLI-8)
    expect(models).toEqual(['opus-x', 'opus-x']); // configured model reaches the agent
    expect(out.join('')).toContain(join(artDir, 'onboarding.fsm.ts'));
  });
});

describe('--config flag (CLI-20)', () => {
  it('forwards --config to buildDeps and strips it before runSlc', async () => {
    const { agent } = makeAgent();
    const out: string[] = [];
    const outPath = join(srcDir, 'custom.fsm.ts');
    let seenConfigPath: string | undefined;
    const code = await run(
      ['--config', '/cfg/slc.yaml', 'playbook', source, '-o', outPath],
      {
        env: {},
        stdout: (t) => out.push(t),
        buildDeps: ({ configPath, signal }) => {
          seenConfigPath = configPath;
          return interpretedDeps(agent, signal);
        },
      },
    );

    expect(seenConfigPath).toBe('/cfg/slc.yaml');
    // Exit 0 with the expected output proves the flag was stripped before the
    // grammar parser saw 'playbook <source> -o <path>'.
    expect(code).toBe(0);
    expect(out.join('')).toContain(outPath);
  });

  it('reports a missing --config value and builds no deps', async () => {
    const { agent } = makeAgent();
    const err: string[] = [];
    let built = false;
    const code = await run(['--config'], {
      env: {},
      stderr: (t) => err.push(t),
      buildDeps: ({ signal }) => {
        built = true;
        return interpretedDeps(agent, signal);
      },
    });

    expect(code).toBe(1);
    expect(built).toBe(false);
    expect(err.join('')).toContain('--config');
  });
});

describe('config file (CLI-23, CLI-24, CLI-25, CLI-26, CLI-27)', () => {
  // buildDeps mirroring production config selection — the real loader and merge
  // and a real resolver — with a fake transport keyed by agent id, so no real
  // agent CLI runs. `configHome` is pinned to the test root for isolation.
  const configDeps =
    (
      transports: Record<string, AgentClient>,
      capture: { selection?: AgentSelection },
    ): DepsBuilder =>
    async ({ env, cwd, configPath, signal }) => {
      const file = await loadConfigFile({
        cwd,
        configPath,
        configHome: root,
        env,
      });
      const cfg = resolveRunConfig(env, file.config);
      capture.selection = cfg.selection;
      const transport = transports[cfg.selection.agent];
      if (!transport)
        throw new Error(`no transport for ${cfg.selection.agent}`);
      return {
        resolver: createPipelineResolver(
          pipelineSearchRoots(cfg.pipelinePath, cwd),
        ),
        executor: createInterpretedExecutor({
          agent: transport,
          config: { model: cfg.selection.model, cwd },
        }),
        signal,
      };
    };

  const writeConfig = (dir: string, content: string): Promise<void> =>
    writeFile(join(dir, 'slc.config.yaml'), content);

  it('runs from a config file alone with no environment (CLI-23)', async () => {
    const { agent, models } = makeAgent();
    await writeConfig(
      srcDir,
      `agent: claude-code\nmodel: cfg-model\npipelinePath:\n  - ${pipelinesRoot}\n`,
    );
    const capture: { selection?: AgentSelection } = {};
    const out: string[] = [];
    const code = await run(['playbook', source], {
      cwd: srcDir,
      env: {},
      stdout: (t) => out.push(t),
      buildDeps: configDeps({ 'claude-code': agent }, capture),
    });

    expect(code).toBe(0);
    expect(capture.selection).toEqual({
      agent: 'claude-code',
      model: 'cfg-model',
    });
    expect(models).toEqual(['cfg-model', 'cfg-model']);
    expect(out.join('')).toContain(join(artDir, 'onboarding.fsm.ts'));
  });

  it('lets the environment override the file per key (CLI-24)', async () => {
    const claude = makeAgent();
    const codex = makeAgent();
    // File names codex, cfg-model, and a non-existent path; the environment
    // names claude-code, env-model, and the real pipelines root.
    await writeConfig(
      srcDir,
      `agent: codex\nmodel: cfg-model\npipelinePath:\n  - ${join(root, 'nonexistent')}\n`,
    );
    const capture: { selection?: AgentSelection } = {};
    const out: string[] = [];
    const code = await run(['playbook', source], {
      cwd: srcDir,
      env: {
        SLC_AGENT: 'claude-code',
        SLC_MODEL: 'env-model',
        SLC_PIPELINE_PATH: pipelinesRoot,
      },
      stdout: (t) => out.push(t),
      buildDeps: configDeps(
        { 'claude-code': claude.agent, codex: codex.agent },
        capture,
      ),
    });

    // Exit 0 proves the environment's pipeline path resolved 'playbook'; the
    // file's non-existent path would have failed resolution.
    expect(code).toBe(0);
    expect(capture.selection).toEqual({
      agent: 'claude-code',
      model: 'env-model',
    });
    expect(claude.calls).toHaveLength(2);
    expect(codex.calls).toHaveLength(0);
    expect(claude.models).toEqual(['env-model', 'env-model']);
  });

  it('loads the --config file over a discovered cwd config (CLI-25)', async () => {
    const claude = makeAgent();
    const codex = makeAgent();
    await writeConfig(
      srcDir,
      `agent: codex\npipelinePath:\n  - ${pipelinesRoot}\n`,
    );
    const explicit = join(root, 'explicit.yaml');
    await writeFile(
      explicit,
      `agent: claude-code\npipelinePath:\n  - ${pipelinesRoot}\n`,
    );
    const capture: { selection?: AgentSelection } = {};
    const out: string[] = [];
    const code = await run(['--config', explicit, 'playbook', source], {
      cwd: srcDir,
      env: {},
      stdout: (t) => out.push(t),
      buildDeps: configDeps(
        { 'claude-code': claude.agent, codex: codex.agent },
        capture,
      ),
    });

    expect(code).toBe(0);
    expect(capture.selection?.agent).toBe('claude-code');
    expect(codex.calls).toHaveLength(0);
  });

  it('falls through to the environment on a discovery miss (CLI-26)', async () => {
    const { agent } = makeAgent();
    const capture: { selection?: AgentSelection } = {};
    const out: string[] = [];
    const code = await run(['playbook', source], {
      cwd: srcDir, // no slc.config.yaml present
      env: { SLC_AGENT: 'claude-code', SLC_PIPELINE_PATH: pipelinesRoot },
      stdout: (t) => out.push(t),
      buildDeps: configDeps({ 'claude-code': agent }, capture),
    });

    expect(code).toBe(0);
    expect(capture.selection?.agent).toBe('claude-code');
    expect(out.join('')).toContain(join(artDir, 'onboarding.fsm.ts'));
  });

  it('refuses an absent --config path to stderr, non-zero (CLI-26)', async () => {
    const err: string[] = [];
    const code = await run(
      ['--config', join(root, 'missing.yaml'), 'playbook', source],
      {
        cwd: srcDir,
        env: {
          SLC_AGENT: 'claude-code',
          SLC_PIPELINE_PATH: pipelinesRoot,
          XDG_CONFIG_HOME: root,
        },
        stderr: (t) => err.push(t),
      },
    );

    expect(code).toBe(1);
    expect(err.join('')).toContain('--config');
    expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(false);
  });

  for (const [label, content] of [
    ['an unknown key', 'agent: claude-code\nbogus: 1\n'],
    ['malformed YAML', 'agent: [unterminated\n'],
    ['a wrong-typed value', 'agent: 42\n'],
  ] as const) {
    it(`refuses a config with ${label}, non-zero (CLI-27)`, async () => {
      await writeConfig(srcDir, content);
      const err: string[] = [];
      const code = await run(['playbook', source], {
        cwd: srcDir,
        env: {
          SLC_AGENT: 'claude-code',
          SLC_PIPELINE_PATH: pipelinesRoot,
          XDG_CONFIG_HOME: root,
        },
        stderr: (t) => err.push(t),
      });

      expect(code).toBe(1);
      expect(err.join('')).not.toBe('');
      expect(await exists(join(artDir, 'onboarding.gears.md'))).toBe(false);
    });
  }
});

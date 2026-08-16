// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { EventEmitter } from 'node:events';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentAdapter } from '@sublang/cligent';

import {
  createConfiguredCompiledFactory,
  createConfiguredExecutor,
  resolveAgentSelection,
  type AgentSelection,
} from '../src/config.js';
import {
  loadConfigFile,
  MAX_STALL_TIMEOUT_SECONDS,
} from '../src/config-file.js';
import { hashFile } from '../src/hash.js';
import { hashTree } from '../src/pin-currency.js';
import {
  buildSlcDeps,
  interruptSignal,
  resolveRunConfig,
  run,
  version,
  type CompiledFactoryBuilder,
  type DepsBuilder,
  type ExecutorFactory,
  type SlcDeps,
} from '../src/index.js';
import {
  createInterpretedExecutor,
  type AgentClient,
} from '../src/interpreter.js';
import {
  PINS_FILE,
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  type PinRecord,
} from '../src/pins.js';
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

/**
 * SlcDeps with a fake resolver and an interpreted executor over a fake agent.
 * Anchors artifact placement at the fixture source directory by default so the
 * DR-014 CWD rule lands artifacts in `artDir` (`cwd` overridable per test).
 */
const interpretedDeps = (
  agent: AgentClient,
  signal: AbortSignal,
  cwd?: string,
): SlcDeps => ({
  resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
  executor: createInterpretedExecutor({ agent, config: {} }),
  cwd: cwd ?? srcDir,
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
  pipelineDir = join(pipelinesRoot, 'flow');
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
  artDir = join(srcDir, 'onboarding.flow');
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
      // DR-014: the full-run synopsis carries --no-optimize, the placement
      // paragraph anchors artifacts at the working directory, and -O states
      // that passes are the default.
      expect(help).toContain(
        'slc <pipeline> <source> [--normalize] [--no-optimize] [--link <target>] [--link-option name=value]...',
      );
      expect(help).toContain(
        'Artifacts land in the working directory (<cwd>/<basename>.<pipeline>/);',
      );
      expect(help).toContain(
        "-O, --optimize            run the pipeline's pass phases (the default)",
      );
      expect(help).toContain(
        '--no-optimize             run the chain without pass phases',
      );
      expect(help).toContain(
        '--rebuild                 recompile every step, ignoring recorded build history',
      );
    }
  });
});

describe('reporting (CLI-15, CLI-16)', () => {
  it('prints `up to date` for a fully reused repeat run (CLI-3, INCR-2)', async () => {
    const { agent } = makeAgent();
    const first = await run(['flow', source], {
      env: {},
      buildDeps: ({ signal }) => interpretedDeps(agent, signal),
    });
    expect(first).toBe(0);

    const { agent: secondAgent, calls } = makeAgent();
    const out: string[] = [];
    const code = await run(['flow', source], {
      env: {},
      stdout: (t) => out.push(t),
      buildDeps: ({ signal }) => interpretedDeps(secondAgent, signal),
    });

    expect(code).toBe(0);
    expect(calls).toHaveLength(0);
    expect(out.join('')).toBe('up to date\n');
  });

  it('prints written paths including the -o path and exits 0 (CLI-15)', async () => {
    const { agent } = makeAgent();
    const out: string[] = [];
    const outPath = join(srcDir, 'custom.fsm.ts');
    const code = await run(['flow', source, '-o', outPath], {
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

  it('places artifacts under the invocation cwd, not the source directory (PIPE-38)', async () => {
    const { agent } = makeAgent();
    const out: string[] = [];
    // Invoke from `root` while the source lives in `srcDir`: DR-014 anchors
    // the artifact directory at the working directory the bin passes down.
    const code = await run(['flow', source], {
      cwd: root,
      env: {},
      stdout: (t) => out.push(t),
      buildDeps: ({ cwd, signal }) => interpretedDeps(agent, signal, cwd),
    });

    expect(code).toBe(0);
    const cwdArtDir = join(root, 'onboarding.flow');
    expect(out.join('')).toContain(join(cwdArtDir, 'onboarding.fsm.ts'));
    expect(await exists(join(cwdArtDir, 'onboarding.fsm.ts'))).toBe(true);
    // The source's own directory stays unwritten — the out-of-tree property.
    expect(await exists(artDir)).toBe(false);
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
    const code = await run(['flow', source], {
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
    const code = await run(['flow', source], {
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

describe('progress (CLI-36, CLI-37)', () => {
  // interpretedDeps plus the bin's progress sink, mirroring buildSlcDeps's
  // wiring of io.progress into SlcDeps (CLI-35).
  const progressDeps: DepsBuilder = ({ signal, progress }) => ({
    ...interpretedDeps(agent().agent, signal),
    progress,
  });
  let current: ReturnType<typeof makeAgent>;
  const agent = (): ReturnType<typeof makeAgent> => current;

  beforeEach(() => {
    current = makeAgent();
  });

  it('writes start and finish lines with elapsed times in order (CLI-36)', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['flow', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: progressDeps,
    });

    expect(code).toBe(0);
    const lines = err
      .join('')
      .split('\n')
      .filter((line) => line !== '');
    expect(lines).toEqual([
      `→ text2gears (writing ${join(artDir, 'onboarding.gears.md')})`,
      expect.stringMatching(
        /^✓ text2gears wrote .+onboarding\.gears\.md \(\d+s\)$/,
      ) as unknown,
      `→ gears2fsm (writing ${join(artDir, 'onboarding.fsm.ts')})`,
      expect.stringMatching(
        /^✓ gears2fsm wrote .+onboarding\.fsm\.ts \(\d+s\)$/,
      ) as unknown,
      // The agents' end-of-run summaries still follow the live progress.
      'wrote the artifact',
      'wrote the artifact',
    ]);
    // Stdout stays reserved for the success report (CLI-3).
    expect(out.join('')).toContain(join(artDir, 'onboarding.fsm.ts'));
    expect(out.join('')).not.toContain('→');
  });

  it('renders progress while phases run, not buffered until the run settles (CLI-36)', async () => {
    // Liveness is the whole point of issue #4: a run that collects progress
    // and flushes it at the end produces identical final output, so assert
    // what stderr had already received at the moment each phase was still
    // executing. Buffering leaves these snapshots empty.
    const err: string[] = [];
    const seenDuringPhase: string[][] = [];
    const observing: AgentClient = {
      run: async ({ prompt }) => {
        seenDuringPhase.push([...err]);
        const target = /artifact to write: (.+)/.exec(prompt)?.[1].trim();
        if (target !== undefined) await writeFile(target, 'output\n');
        return { status: 'success', text: 'wrote the artifact' };
      },
    };

    const code = await run(['flow', source], {
      env: {},
      stdout: () => {},
      stderr: (t) => err.push(t),
      buildDeps: ({ signal, progress }) => ({
        ...interpretedDeps(observing, signal),
        progress,
      }),
    });

    expect(code).toBe(0);
    expect(seenDuringPhase).toHaveLength(2);
    // The first phase saw only its own start line.
    expect(seenDuringPhase[0].join('')).toBe(
      `→ text2gears (writing ${join(artDir, 'onboarding.gears.md')})\n`,
    );
    // The second saw the first phase's completion too — progress accumulates
    // as the run proceeds rather than appearing all at once at the end.
    const second = seenDuringPhase[1].join('');
    expect(second).toContain('✓ text2gears wrote');
    expect(second).toContain(
      `→ gears2fsm (writing ${join(artDir, 'onboarding.fsm.ts')})`,
    );
  });

  it('reports a failing phase with a ✗ line and keeps stdout empty (CLI-36, CLI-16)', async () => {
    current = makeAgent({ skip: true });
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['flow', source], {
      env: {},
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: progressDeps,
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    const report = err.join('');
    expect(report).toContain('→ text2gears');
    expect(report).toMatch(
      /✗ text2gears failed at .+onboarding\.gears\.md \(\d+s\)/,
    );
  });

  it('aborts a stalled agent call and reports the inactivity duration (CLI-37)', async () => {
    // A transport that yields one event and then stalls until aborted — the
    // measured issue-#4 failure mode (a live session waiting on the network).
    const stallingAdapter: AgentAdapter = {
      agent: 'claude-code',
      async isAvailable() {
        return true;
      },
      async *run(_prompt: string, options?: { abortSignal?: AbortSignal }) {
        yield {
          type: 'init',
          agent: 'claude-code',
          timestamp: 1,
          sessionId: 'stall',
          payload: { model: 'm', cwd: '.', tools: [] },
        } as never;
        await new Promise<void>((resolve) => {
          options?.abortSignal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      },
    };
    const out: string[] = [];
    const err: string[] = [];
    // Pre-create the user config so first-run seeding stays out of stderr.
    await mkdir(join(root, 'slc'), { recursive: true });
    await writeFile(join(root, 'slc', 'config.yaml'), 'agent: claude-code\n');
    const code = await run(['flow.text2gears', source], {
      env: {
        SLC_AGENT: 'claude-code',
        SLC_PIPELINE_PATH: pipelinesRoot,
        SLC_STALL_TIMEOUT: '0.05',
        XDG_CONFIG_HOME: root,
      },
      cwd: root,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: (io) =>
        buildSlcDeps(io, (selection, opts = {}) =>
          createConfiguredExecutor(selection, {
            ...opts,
            adapterFactory: () => stallingAdapter,
          }),
        ),
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    const report = err.join('');
    // The failure report names the phase, target, and the inactivity window.
    expect(report).toContain('text2gears');
    expect(report).toContain('onboarding.gears.md');
    expect(report).toContain('stalled');
  });
});

describe('stall timeout resolution (CLI-34, CLI-35)', () => {
  const env = { SLC_AGENT: 'claude-code' };

  it('defaults to 600 seconds', () => {
    expect(resolveRunConfig(env, {}).stallTimeoutMs).toBe(600_000);
  });

  it('takes the config-file value when the environment is silent', () => {
    expect(resolveRunConfig(env, { stallTimeout: 30 }).stallTimeoutMs).toBe(
      30_000,
    );
  });

  it('lets SLC_STALL_TIMEOUT override the file, with 0 disabling', () => {
    expect(
      resolveRunConfig({ ...env, SLC_STALL_TIMEOUT: '0' }, { stallTimeout: 30 })
        .stallTimeoutMs,
    ).toBe(0);
  });

  it('refuses a malformed SLC_STALL_TIMEOUT', () => {
    expect(() =>
      resolveRunConfig({ ...env, SLC_STALL_TIMEOUT: 'soon' }, {}),
    ).toThrow(/SLC_STALL_TIMEOUT/);
    expect(() =>
      resolveRunConfig({ ...env, SLC_STALL_TIMEOUT: '-1' }, {}),
    ).toThrow(/SLC_STALL_TIMEOUT/);
  });

  it('refuses a window Node would clamp to 1 ms rather than invert the watchdog', () => {
    // Above 2^31-1 ms Node silently clamps the delay, which would abort every
    // agent call immediately — the opposite of what the setting asks for.
    expect(
      resolveRunConfig(
        { ...env, SLC_STALL_TIMEOUT: String(MAX_STALL_TIMEOUT_SECONDS) },
        {},
      ).stallTimeoutMs,
    ).toBe(MAX_STALL_TIMEOUT_SECONDS * 1000);
    expect(() =>
      resolveRunConfig(
        { ...env, SLC_STALL_TIMEOUT: String(MAX_STALL_TIMEOUT_SECONDS + 1) },
        {},
      ),
    ).toThrow(/at most/);
    // The unit-confusion case: "3600000" meaning milliseconds, not seconds.
    expect(() =>
      resolveRunConfig({ ...env, SLC_STALL_TIMEOUT: '3600000' }, {}),
    ).toThrow(/at most/);
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
    const pending = run(['flow', source], {
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
  it('seeds the user config on a discovery miss and proceeds (CLI-29, CLI-30)', async () => {
    // Isolate discovery (DR-006): no config under cwd or this config home, so
    // the first run seeds `<home>/slc/config.yaml` (DR-015) and carries on
    // with the seeded claude-code selection.
    const seen: string[] = [];
    let selected = '';
    const deps = await buildSlcDeps(
      {
        env: { SLC_PIPELINE_PATH: pipelinesRoot, XDG_CONFIG_HOME: root },
        cwd: root,
        signal: new AbortController().signal,
        note: (t) => seen.push(t),
      },
      (selection) => {
        selected = selection.agent;
        return { run: async () => ({ status: 'ok', diagnostics: [] }) };
      },
    );

    expect(deps.cwd).toBe(root);
    expect(selected).toBe('claude-code');
    const seeded = join(root, 'slc', 'config.yaml');
    expect(await exists(seeded)).toBe(true);
    expect(await readFile(seeded, 'utf8')).toContain('agent: claude-code');
    expect(seen.join('')).toContain(seeded);
  });

  it('refuses an agent-less explicit --config to stderr, runs no phase (CLI-18)', async () => {
    const out: string[] = [];
    const err: string[] = [];
    await writeFile(join(root, 'agentless.yaml'), 'model: m1\n');
    const code = await run(
      ['--config', join(root, 'agentless.yaml'), 'flow', source],
      {
        cwd: root,
        env: { SLC_PIPELINE_PATH: pipelinesRoot, XDG_CONFIG_HOME: root },
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t),
      },
    );

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toContain('SLC_AGENT');
    // DR-014: with cwd at `root`, artifacts would land under it — none may.
    expect(
      await exists(join(root, 'onboarding.flow', 'onboarding.gears.md')),
    ).toBe(false);
  });

  it('refuses an unsupported SLC_AGENT (CLI-18)', async () => {
    const err: string[] = [];
    const code = await run(['flow', source], {
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
    const code = await run(['flow', source], {
      cwd: srcDir,
      env: {
        SLC_PIPELINE_PATH: pipelinesRoot,
        SLC_AGENT: 'claude-code',
        SLC_MODEL: 'opus-x',
      },
      stdout: (t) => out.push(t),
      // Mirror production wiring (real resolver + real config selection +
      // the DR-014 cwd anchor), choosing the transport by the selected agent
      // so SLC_AGENT is exercised.
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
          cwd,
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
      ['--config', '/cfg/slc.yaml', 'flow', source, '-o', outPath],
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
    // grammar parser saw 'flow <source> -o <path>'.
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
        cwd,
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
    const code = await run(['flow', source], {
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
    const code = await run(['flow', source], {
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

    // Exit 0 proves the environment's pipeline path resolved 'flow'; the
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
    const code = await run(['--config', explicit, 'flow', source], {
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
    const code = await run(['flow', source], {
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
      ['--config', join(root, 'missing.yaml'), 'flow', source],
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
      const code = await run(['flow', source], {
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

describe('buildSlcDeps executor construction (CLI-6, CLI-7)', () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'slc-deps-'));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('builds the interpreted executor with auto write-permissions so a non-interactive run can write its target (536efc2)', async () => {
    let captured: Parameters<ExecutorFactory>[1] | undefined;
    const stub: SlcDeps['executor'] = {
      run: async () => ({ status: 'ok', diagnostics: [] }),
    };
    const createExecutor: ExecutorFactory = (_selection, opts = {}) => {
      captured = opts;
      return stub;
    };

    const deps = await buildSlcDeps(
      {
        // Pin both config-discovery roots at the empty temp dir so no real
        // cwd/home `slc.config.yaml` is read: config falls through to env only.
        env: { SLC_AGENT: 'claude-code', XDG_CONFIG_HOME: cwd },
        cwd,
        signal: new AbortController().signal,
      },
      createExecutor,
    );

    // The fix under guard: without `permissions: { mode: 'auto' }` the agent
    // cannot write its artifact in a non-interactive run.
    expect(captured?.permissions).toEqual({ mode: 'auto' });
    expect(captured?.cwd).toBe(cwd);
    expect(deps.executor).toBe(stub);
  });

  it('supplies the compiled-execution factory with the same agent options (CLI-8)', async () => {
    let captured: Parameters<CompiledFactoryBuilder>[1] | undefined;
    const compiledFactory = (): SlcDeps['executor'] => ({
      run: async () => ({ status: 'ok', diagnostics: [] }),
    });
    const createCompiled: CompiledFactoryBuilder = (_selection, opts = {}) => {
      captured = opts;
      return compiledFactory;
    };

    const deps = await buildSlcDeps(
      {
        env: { SLC_AGENT: 'claude-code', XDG_CONFIG_HOME: cwd },
        cwd,
        signal: new AbortController().signal,
      },
      () => ({ run: async () => ({ status: 'ok', diagnostics: [] }) }),
      createCompiled,
    );

    // A current pin must find a compiled factory, or PHEXEC-27 fails it closed.
    expect(deps.compiled).toBe(compiledFactory);
    expect(captured?.permissions).toEqual({ mode: 'auto' });
    expect(captured?.cwd).toBe(cwd);
  });
});

// End to end through the bin: a current pin runs the pinned compiled `playbook`
// artifact via the production compiled factory — resolving the artifact against
// the pipeline directory — without interpreting the phase (CLI-28; PHEXEC-27).
describe('compiled execution through the bin (CLI-28)', () => {
  it('runs a current pinned artifact and writes its target', async () => {
    // A minimal compiled `playbook` artifact: parses the PHEXEC-29 seed and
    // writes the requested target from the requested source.
    const bundleDir = join(pipelineDir, 'text2gears.slc');
    await mkdir(bundleDir);
    await writeFile(
      join(bundleDir, 'text2gears.playbook.ts'),
      [
        "import { readFile, writeFile } from 'node:fs/promises';",
        'export default function createPlaybookRuntime() {',
        '  let ports;',
        '  return {',
        '    async init(value) { ports = value; },',
        '    async handleBossInput({ text }) {',
        // Emitted mid-turn: the host must stream it, not bank it (DR-019).
        "      await ports.emitStatus('Entered transform.');",
        "      const marker = 'Request: ';",
        '      const line = text.split(String.fromCharCode(10)).find((l) => l.startsWith(marker));',
        '      const { source, target } = JSON.parse(line.slice(marker.length));',
        "      await writeFile(target, `compiled:${(await readFile(source, 'utf8')).trim()}`);",
        '    },',
        '    async dispose() {},',
        '  };',
        '}',
        '',
      ].join('\n'),
    );
    for (const name of [
      'text2gears.fsm.ts',
      'text2gears.gears.md',
      'text2gears.gears-fsm.test.ts',
      'text2gears.fsm.introspect.test.ts',
      'text2gears.prompt-contract.test.ts',
      'text2gears.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(bundleDir, name), `fixture: ${name}\n`);
    }
    await writeFile(join(pipelineDir, 'linktarget.ts'), 'link target bytes\n');
    const record: PinRecord = {
      definition: {
        path: 'text2gears.md',
        hash: await hashFile(join(pipelineDir, 'text2gears.md')),
      },
      artifact: {
        path: 'text2gears.slc/text2gears.playbook.ts',
        hash: await hashFile(join(bundleDir, 'text2gears.playbook.ts')),
      },
      artifactBundle: {
        path: 'text2gears.slc',
        hash: await hashTree(bundleDir),
      },
      semanticInputs: [],
      externalInputs: [],
      runtimeDependencies: [],
      linkTarget: {
        kind: 'file',
        locator: 'linktarget.ts',
        identity: await hashFile(join(pipelineDir, 'linktarget.ts')),
      },
    };
    await writeFile(
      join(pipelineDir, PINS_FILE),
      JSON.stringify(
        {
          schema: PIN_SCHEMA,
          hashAlgorithm: PIN_HASH_ALGORITHM,
          pathBoundary: { path: '.' },
          pins: { text2gears: record },
        },
        null,
        2,
      ),
    );

    const interpretedRuns: string[] = [];
    const out: string[] = [];
    const err: string[] = [];
    // Pre-create the user config so first-run seeding (DR-015) stays out of
    // this test's stderr expectations.
    await mkdir(join(root, 'slc'), { recursive: true });
    await writeFile(join(root, 'slc', 'config.yaml'), 'agent: claude-code\n');
    const code = await run(['flow.text2gears', source], {
      env: {
        SLC_AGENT: 'claude-code',
        SLC_PIPELINE_PATH: pipelinesRoot,
        XDG_CONFIG_HOME: root,
      },
      cwd: root,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: (io) =>
        buildSlcDeps(
          io,
          // The interpreted executor must stay unused for the pinned phase.
          () => ({
            run: async (request) => {
              interpretedRuns.push(request.kind);
              return { status: 'error', diagnostics: ['must not interpret'] };
            },
          }),
          // The production factory, with adapter construction faked out so no
          // real agent CLI is touched (the fixture artifact calls no ports).
          (selection, opts = {}) =>
            createConfiguredCompiledFactory(selection, {
              ...opts,
              adapterFactory: () => ({}) as unknown as AgentAdapter,
            }),
        ),
    });

    expect(code).toBe(0);
    // DR-014: the run's cwd is `root`, not the source's directory, so the
    // artifact lands under `<root>/onboarding.flow/` (out-of-tree, PIPE-38).
    const target = join(root, 'onboarding.flow', 'onboarding.gears.md');
    // Stderr carries the in-run progress lines, including the compiled
    // runtime's own status streamed through the bin's sink rather than
    // drained into the end-of-run diagnostics (DR-019, CLI-32, CLI-35).
    const progressLines = err
      .join('')
      .split('\n')
      .filter((l) => l !== '');
    expect(progressLines).toEqual([
      `→ text2gears (writing ${target})`,
      '◇ Entered transform.',
      expect.stringMatching(/^✓ text2gears wrote .+ \(\d+s\)$/) as unknown,
    ]);
    expect(out.join('')).toContain(target);
    expect(interpretedRuns).toEqual([]);
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(target, 'utf8')).toBe('compiled:prose');
  });

  it('reports an unmapped pinned provenance through the phase-failure path (CLI-16, CLI-36)', async () => {
    // Selecting the compiled executor throws for an unmapped provenance
    // (PHEXEC-30) instead of returning a verdict. The run must still close its
    // progress line and name the phase and target, exactly as a stale pin
    // does — not strand a start line behind a bare message (CLI-4, CLI-32).
    const bundleDir = join(pipelineDir, 'text2gears.slc');
    await mkdir(bundleDir);
    await writeFile(
      join(bundleDir, 'text2gears.playbook.ts'),
      'export default function createPlaybookRuntime() {\n' +
        '  return { async init() {}, async handleBossInput() {}, async dispose() {} };\n' +
        '}\n',
    );
    // The pin must evaluate *current* — a stale one never reaches the factory.
    for (const name of [
      'text2gears.fsm.ts',
      'text2gears.gears.md',
      'text2gears.gears-fsm.test.ts',
      'text2gears.fsm.introspect.test.ts',
      'text2gears.prompt-contract.test.ts',
      'text2gears.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(bundleDir, name), `fixture: ${name}\n`);
    }
    await writeFile(join(pipelineDir, 'linktarget.ts'), 'link target bytes\n');
    const record: PinRecord = {
      definition: {
        path: 'text2gears.md',
        hash: await hashFile(join(pipelineDir, 'text2gears.md')),
      },
      artifact: {
        path: 'text2gears.slc/text2gears.playbook.ts',
        hash: await hashFile(join(bundleDir, 'text2gears.playbook.ts')),
      },
      artifactBundle: {
        path: 'text2gears.slc',
        hash: await hashTree(bundleDir),
      },
      semanticInputs: [],
      externalInputs: [],
      runtimeDependencies: [],
      linkTarget: {
        kind: 'file',
        locator: 'linktarget.ts',
        identity: await hashFile(join(pipelineDir, 'linktarget.ts')),
        // Never installed or reviewed here, so it stays fail-closed.
        provenance: '@sublang/playbook@1.3.0',
      },
    };
    await writeFile(
      join(pipelineDir, PINS_FILE),
      JSON.stringify(
        {
          schema: PIN_SCHEMA,
          hashAlgorithm: PIN_HASH_ALGORITHM,
          pathBoundary: { path: '.' },
          pins: { text2gears: record },
        },
        null,
        2,
      ),
    );

    const out: string[] = [];
    const err: string[] = [];
    await mkdir(join(root, 'slc'), { recursive: true });
    await writeFile(join(root, 'slc', 'config.yaml'), 'agent: claude-code\n');
    const code = await run(['flow.text2gears', source], {
      env: {
        SLC_AGENT: 'claude-code',
        SLC_PIPELINE_PATH: pipelinesRoot,
        XDG_CONFIG_HOME: root,
      },
      cwd: root,
      stdout: (t) => out.push(t),
      stderr: (t) => err.push(t),
      buildDeps: (io) =>
        buildSlcDeps(io, undefined, (selection, opts = {}) =>
          createConfiguredCompiledFactory(selection, {
            ...opts,
            adapterFactory: () => ({}) as unknown as AgentAdapter,
          }),
        ),
    });

    expect(code).toBe(1);
    expect(out.join('')).toBe('');
    const target = join(root, 'onboarding.flow', 'onboarding.gears.md');
    const lines = err
      .join('')
      .split('\n')
      .filter((l) => l !== '');
    // The start line is closed by a ✗ carrying the elapsed time...
    expect(lines[0]).toBe(`→ text2gears (writing ${target})`);
    expect(lines[1]).toMatch(
      /^✗ text2gears failed at .+onboarding\.gears\.md \(\d+s\)$/,
    );
    // ...and the report names the failing phase, its target, and the reason.
    expect(lines[2]).toBe(`slc: phase "text2gears" failed at "${target}"`);
    expect(lines[3]).toContain(
      'unsupported pinned Playbook runtime contract: @sublang/playbook@1.3.0',
    );
  });
});

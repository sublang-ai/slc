// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * The `slc` bin orchestrator (CLI package).
 *
 * `run` is the testable command-line entry: it short-circuits `--version` and
 * `--help` before touching any pipeline or agent (CLI-1, CLI-2, CLI-9), builds
 * the run dependencies from environment configuration (CLI-6, CLI-7, CLI-12),
 * invokes the injectable `runSlc` core under a cancellation signal (CLI-10), and
 * maps the result onto process streams and an exit code — produced artifact
 * paths to stdout on success, the failure report to stderr otherwise (CLI-3,
 * CLI-4, CLI-11). Every IO seam is injectable so the bin is integration-testable
 * without a real agent; the `cli.ts` shim supplies the process-backed defaults
 * and signal wiring. See specs/dev/cli.md and specs/user/cli.md.
 */

import {
  createConfiguredCompiledFactory,
  createConfiguredExecutor,
  resolveAgentSelection,
  type AgentSelection,
} from './config.js';
import { loadConfigFile, type FileConfig } from './config-file.js';
import {
  createPipelineResolver,
  pipelineSearchRoots,
  withReservedPipelines,
} from './resolver.js';
import { runSlc, type SlcDeps } from './runner.js';

/** The program name. */
export const name = 'slc';

/** Returns the slc version string. */
export function version(): string {
  return '0.0.0';
}

/** Builds run dependencies for a run; injected by tests to supply fakes. */
export type DepsBuilder = (io: {
  env: Record<string, string | undefined>;
  cwd: string;
  signal: AbortSignal;
  /** Explicit `--config <path>`, when given (CLI-20). */
  configPath?: string;
  /** Sink for host notes such as first-run config seeding (DR-015, CLI-30). */
  note?: (text: string) => void;
}) => SlcDeps | Promise<SlcDeps>;

/** Injectable IO and configuration for {@link run}; all fields default to the process. */
export interface RunOptions {
  env?: Record<string, string | undefined>;
  cwd?: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  /** Cancellation signal passed into `runSlc` (CLI-10). */
  signal?: AbortSignal;
  /** Overrides production dependency construction (CLI-6, CLI-7). */
  buildDeps?: DepsBuilder;
}

/** The executor factory {@link buildSlcDeps} uses; injected in tests. */
export type ExecutorFactory = typeof createConfiguredExecutor;

/** The compiled-execution factory builder {@link buildSlcDeps} uses; injected in tests. */
export type CompiledFactoryBuilder = typeof createConfiguredCompiledFactory;

/**
 * Builds the production {@link SlcDeps}: a pipeline resolver over the resolved
 * search roots (CLI-6) — with the reserved `slc` reference routed to the
 * meta-pipeline definitions `@sublang/playbook` provides (SELFHOST-2) — an
 * interpreted executor for the resolved agent/model (CLI-7), and the
 * compiled-execution factory a current pinned phase selects (CLI-8, PHEXEC-27).
 * Configuration is loaded from the config file (DR-006, CLI-20) and
 * then overridden per key by a non-blank environment variable, so existing
 * env-only runs are unchanged and the file fills any key the environment leaves
 * unset.
 *
 * @throws {import('./config-file.js').ConfigFileError} when an explicit
 *   `--config` path is absent or the file is malformed or invalid (CLI-21).
 * @throws {import('./config.js').ConfigError} when neither source supplies an
 *   agent, or the resolved agent is unsupported (CLI-12).
 */
export async function buildSlcDeps(
  { env, cwd, signal, configPath, note }: Parameters<DepsBuilder>[0],
  // Injectable so a test can capture the executor options — notably the
  // non-interactive write permission below — without constructing a real
  // adapter, the same seam pattern as `createConfiguredExecutor`'s
  // `adapterFactory`. Defaults to the production factories.
  createExecutor: ExecutorFactory = createConfiguredExecutor,
  createCompiled: CompiledFactoryBuilder = createConfiguredCompiledFactory,
): Promise<SlcDeps> {
  const file = await loadConfigFile({
    cwd,
    configPath,
    env,
    // First-run seeding (DR-015): name the created user config on stderr.
    onSeed: (path) => note?.(`slc: seeded ${path} (agent: claude-code)\n`),
  });
  const { selection, pipelinePath } = resolveRunConfig(env, file.config);
  const resolver = withReservedPipelines(
    createPipelineResolver(pipelineSearchRoots(pipelinePath, cwd)),
  );
  // Auto-accept the agents' file operations so a non-interactive `slc` run can
  // write its target artifact; the DR-003 generic checks still guard the
  // protected inputs (DR-004).
  const agentOpts = { cwd, permissions: { mode: 'auto' as const } };
  const executor = createExecutor(selection, agentOpts);
  const compiled = createCompiled(selection, agentOpts);
  return { resolver, executor, compiled, cwd, signal };
}

/** The cligent-invocation selection after merging environment over file (DR-006). */
export interface RunConfig {
  selection: AgentSelection;
  /** Search-root source: an `SLC_PIPELINE_PATH` string, the file's sequence, or undefined. */
  pipelinePath: string | string[] | undefined;
}

/**
 * Merges the environment over config-file values per key (DR-006, CLI-20): for
 * each key a non-blank environment variable wins, otherwise the file value,
 * otherwise the built-in default. The agent and model go through
 * {@link resolveAgentSelection} so the supported-agent check stays single-sourced
 * (CLI-7, CLI-12).
 */
export function resolveRunConfig(
  env: Record<string, string | undefined>,
  file: FileConfig,
): RunConfig {
  const selection = resolveAgentSelection({
    SLC_AGENT: nonBlank(env.SLC_AGENT) ?? file.agent,
    SLC_MODEL: nonBlank(env.SLC_MODEL) ?? file.model,
    SLC_EFFORT: nonBlank(env.SLC_EFFORT) ?? file.effort,
  });
  const pipelinePath = nonBlank(env.SLC_PIPELINE_PATH) ?? file.pipelinePath;
  return { selection, pipelinePath };
}

/** Returns `value` when set and not all-whitespace, else `undefined` (DR-006). */
function nonBlank(value: string | undefined): string | undefined {
  return value !== undefined && value.trim() !== '' ? value : undefined;
}

/** Usage text naming the documented invocation forms and configuration (CLI-2). */
export function usageText(): string {
  return [
    'Usage:',
    '  slc <pipeline>[.<phase>] <source> [-o <target>]',
    '  slc <pipeline> <source> [--normalize] [--no-optimize] [--link <target>] [--link-option name=value]...',
    '  slc <pipeline>.link <object>... <target> [-o <linked>] [--link-option name=value]...',
    '',
    'Artifacts land in the working directory (<cwd>/<basename>.<pipeline>/);',
    'an entry source with a foreign extension is normalized first, and the',
    'playbook pipeline links against the installed @sublang/playbook runtime',
    'when --link is omitted, also emitting the runnable <basename>.ts entry.',
    '',
    'Options:',
    '  -o <path>                 final output path override',
    '  --link <target>           link the full-pipeline output to <target>',
    '  --link-option name=value  pass an opaque option to the link phase',
    "  --normalize               rewrite raw input to the entry phase's source form first",
    "  -O, --optimize            run the pipeline's pass phases (the default)",
    '  --no-optimize             run the chain without pass phases',
    '  --config <path>           load configuration from <path> (disables discovery)',
    '  -v, --version             print version and exit',
    '  -h, --help                print this help and exit',
    '',
    'Configuration:',
    '  Config file (YAML), discovered in order, then overridden per key by the',
    '  environment variable below:',
    '    ./slc.config.yaml',
    '    ${XDG_CONFIG_HOME:-~/.config}/slc/config.yaml',
    '  Keys: agent, model, effort, pipelinePath.',
    '',
    '  SLC_AGENT          agent CLI: claude-code | codex | gemini | opencode',
    '  SLC_MODEL          optional model for the agent CLI',
    '  SLC_EFFORT         optional adapter-scoped reasoning effort (e.g. xhigh)',
    '  SLC_PIPELINE_PATH  search roots for <pipeline> references (default: cwd)',
    '',
  ].join('\n');
}

/**
 * Splits `--config <path>` out of argv, returning the path and the remaining
 * arguments for `runSlc` (CLI-20). `--config` is a bin-level flag, so it is
 * removed before the grammar parser, which rejects unknown options.
 *
 * @throws {Error} when `--config` is given without a following value.
 */
function extractConfigFlag(argv: readonly string[]): {
  configPath?: string;
  rest: string[];
} {
  const rest: string[] = [];
  let configPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('missing value for --config <path>');
      }
      configPath = value;
    } else {
      rest.push(argv[i]);
    }
  }
  return { configPath, rest };
}

/**
 * Runs the `slc` command line and returns a process exit code (CLI package).
 * Never rejects: configuration refusals and run failures are reported and
 * mapped to a non-zero code.
 */
export async function run(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<number> {
  const stdout = options.stdout ?? ((text) => void process.stdout.write(text));
  const stderr = options.stderr ?? ((text) => void process.stderr.write(text));

  // Conveniences short-circuit before any pipeline or agent work (CLI-1, CLI-2, CLI-9).
  if (hasFlag(argv, '--version', '-v')) {
    stdout(`${name} ${version()}\n`);
    return 0;
  }
  if (hasFlag(argv, '--help', '-h')) {
    stdout(usageText());
    return 0;
  }

  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const signal = options.signal ?? new AbortController().signal;

  let deps: SlcDeps;
  let rest: readonly string[];
  try {
    // `--config <path>` is a bin-level flag: strip it before runSlc, whose
    // grammar (parseInvocation) rejects unknown options (CLI-20).
    const extracted = extractConfigFlag(argv);
    rest = extracted.rest;
    deps = await (options.buildDeps ?? buildSlcDeps)({
      env,
      cwd,
      signal,
      configPath: extracted.configPath,
      note: stderr,
    });
  } catch (error) {
    // Configuration refusals — a bad `--config`, an invalid config file
    // (CLI-21), or an unset/unsupported agent (CLI-12) — fail the run.
    stderr(`${name}: ${messageOf(error)}\n`);
    return 1;
  }

  const result = await runSlc(rest, deps);

  if (result.ok) {
    if (result.outputs.length > 0) stdout(`${result.outputs.join('\n')}\n`);
    // Surface any ambiguity the agent resolved without polluting the path output.
    if (result.diagnostics.length > 0)
      stderr(`${result.diagnostics.join('\n')}\n`);
    return 0;
  }
  if (result.diagnostics.length > 0)
    stderr(`${result.diagnostics.join('\n')}\n`);
  return 1;
}

/**
 * Wires `SIGINT`/`SIGTERM` on `emitter` to abort a fresh controller, returning
 * its cancellation signal and a disposer that removes the listeners (CLI-10).
 * The `cli.ts` shim passes `process`; tests pass a fake emitter so the
 * interrupt-to-abort wiring is exercised without real signals.
 */
export function interruptSignal(emitter: {
  once(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onInterrupt = (): void => controller.abort();
  emitter.once('SIGINT', onInterrupt);
  emitter.once('SIGTERM', onInterrupt);
  return {
    signal: controller.signal,
    dispose: () => {
      emitter.removeListener('SIGINT', onInterrupt);
      emitter.removeListener('SIGTERM', onInterrupt);
    },
  };
}

/** True when argv contains any of the given exact flag tokens. */
function hasFlag(argv: readonly string[], ...flags: string[]): boolean {
  return argv.some((arg) => flags.includes(arg));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

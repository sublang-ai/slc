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

import { createConfiguredExecutor, resolveAgentSelection } from './config.js';
import { createPipelineResolver, pipelineSearchRoots } from './resolver.js';
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
}) => SlcDeps;

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

/**
 * Builds the production {@link SlcDeps}: a pipeline resolver over the
 * `SLC_PIPELINE_PATH` search roots (CLI-6) and an interpreted executor for the
 * configured agent/model (CLI-7).
 *
 * @throws {import('./config.js').ConfigError} when the agent is unset or
 *   unsupported (CLI-12).
 */
export const buildSlcDeps: DepsBuilder = ({ env, cwd, signal }) => {
  const resolver = createPipelineResolver(
    pipelineSearchRoots(env.SLC_PIPELINE_PATH, cwd),
  );
  const executor = createConfiguredExecutor(resolveAgentSelection(env), {
    cwd,
  });
  return { resolver, executor, signal };
};

/** Usage text naming the documented invocation forms and configuration (CLI-2). */
export function usageText(): string {
  return [
    'Usage:',
    '  slc <pipeline>[.<phase>] <source> [-o <target>]',
    '  slc <pipeline> <source> --link <target> [--link-option name=value]...',
    '  slc <pipeline>.link <object>... <target> [-o <linked>] [--link-option name=value]...',
    '',
    'Options:',
    '  -o <path>                final output path override',
    '  --link <target>          link the full-pipeline output to <target>',
    '  --link-option name=value  pass an opaque option to the link phase',
    '  -v, --version            print version and exit',
    '  -h, --help               print this help and exit',
    '',
    'Configuration (environment):',
    '  SLC_AGENT          agent CLI: claude-code | codex | gemini | opencode',
    '  SLC_MODEL          optional model for the agent CLI',
    '  SLC_PIPELINE_PATH  search roots for <pipeline> references (default: cwd)',
    '',
  ].join('\n');
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
  try {
    deps = (options.buildDeps ?? buildSlcDeps)({ env, cwd, signal });
  } catch (error) {
    // Configuration refusals (e.g. unset/unsupported agent, CLI-12) fail the run.
    stderr(`${name}: ${messageOf(error)}\n`);
    return 1;
  }

  const result = await runSlc(argv, deps);

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

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Public entry point for the SubLang Compiler (slc).
 *
 * This is a scaffold stub (IR-001 Task 1). Pipeline resolution, phase
 * execution, and linking arrive in later IR-001 tasks.
 */

export const name = 'slc';

/** Returns the slc version string. */
export function version(): string {
  return '0.0.0';
}

/**
 * Parses argv (without the node/script prefix) and returns a process exit code.
 *
 * Scaffold stub (IR-001 Task 1): only `--version`/`-v` is wired. Pipeline
 * invocation routing arrives in a later IR-001 task.
 */
export function run(argv: string[]): number {
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`slc ${version()}\n`);
    return 0;
  }
  process.stderr.write('slc: no command implemented yet\n');
  return 1;
}

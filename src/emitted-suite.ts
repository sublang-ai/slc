// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Host runner for emitted compilation-correctness suites (VERIFY-20).
 *
 * The runner invokes the Vitest CLI directly through `execFile`: no shell,
 * glob expansion, project-selected configuration, or implicit test discovery
 * participates. The caller supplies the complete ordered test inventory.
 */

import { execFile, type ExecFileException } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { EmittedFileBinding } from './emitted-imports.js';

const INVENTORY_ENV = 'SLC_EMITTED_SUITE_INCLUDE_V1';

/** The fixed configuration loaded by the emitted-suite Vitest subprocess. */
const ISOLATED_VITEST_CONFIG = Object.freeze({
  test: Object.freeze({
    allowOnly: false,
    environment: 'node',
    fileParallelism: false,
    globals: false,
    isolate: true,
    maxWorkers: 1,
    include: readExactIncludePatterns(),
    watch: false,
  }),
});

// The module is also its own explicit Vitest configuration. This keeps the
// acceptance-affecting configuration in the same identity-bearing file as the
// runner and works both from `src/*.ts` in repository tests and built `dist`.
export default ISOLATED_VITEST_CONFIG;

export interface EmittedSuiteCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<NodeJS.ProcessEnv>;
  readonly signal?: AbortSignal;
}

export interface EmittedSuiteCommandResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
  readonly aborted: boolean;
}

/** Injectable subprocess boundary; production uses {@link execFile}. */
export type EmittedSuiteCommandExecutor = (
  command: EmittedSuiteCommand,
) => Promise<EmittedSuiteCommandResult>;

export interface EmittedSuiteOptions {
  /** Absolute, normalized physical test paths, in the order to run them. */
  readonly testPaths: readonly string[];
  /** Absolute, normalized root and subprocess working directory. */
  readonly cwd: string;
  readonly signal?: AbortSignal;
  /** Test seam; production resolves the Vitest CLI from SLC's installation. */
  readonly vitestCliPath?: string;
  /** Test seam around the no-shell subprocess boundary. */
  readonly execute?: EmittedSuiteCommandExecutor;
}

export interface EmittedSuiteResult {
  readonly ok: boolean;
  readonly status: 'passed' | 'failed' | 'aborted';
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly diagnostics: readonly string[];
}

export interface MappedEmittedSuiteOptions {
  /** Exact logical-to-physical candidate and retained input inventory. */
  readonly inventory: readonly EmittedFileBinding[];
  /** Absolute logical ancestor shared by every inventory and test path. */
  readonly logicalRoot: string;
  /** Absolute logical test paths, in their required execution order. */
  readonly testPaths: readonly string[];
  /** Existing private candidate directory beneath the destination project. */
  readonly viewParent: string;
  readonly signal?: AbortSignal;
  /** Test seam; production resolves the Vitest CLI from SLC's installation. */
  readonly vitestCliPath?: string;
  /** Test seam around the no-shell subprocess boundary. */
  readonly execute?: EmittedSuiteCommandExecutor;
}

/**
 * Runs a mapped candidate suite from one private logical-layout mirror.
 *
 * Staged and retained bytes are copied into a fresh directory below the
 * caller-authorized candidate parent. Relative imports therefore resolve from
 * the same logical view used by the load-integrity checker, while canonical
 * inputs remain read-only. The private view is removed on every outcome.
 */
export async function runMappedEmittedSuite(
  options: MappedEmittedSuiteOptions,
): Promise<EmittedSuiteResult> {
  if (isAborted(options.signal)) return abortedBeforeStart();

  let prepared: PreparedSuiteView;
  try {
    prepared = await prepareSuiteView(options);
  } catch (error) {
    return failedWithoutProcess(
      `emitted verification view is invalid: ${messageOf(error)}`,
    );
  }

  let result: EmittedSuiteResult;
  try {
    result = await runEmittedSuite({
      cwd: prepared.root,
      testPaths: prepared.testPaths,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.vitestCliPath === undefined
        ? {}
        : { vitestCliPath: options.vitestCliPath }),
      ...(options.execute === undefined ? {} : { execute: options.execute }),
    });
  } catch (error) {
    result = failedWithoutProcess(
      `emitted verification suite failed unexpectedly: ${messageOf(error)}`,
    );
  }

  try {
    await removeSuiteView(prepared);
  } catch (error) {
    return {
      ...failedWithoutProcess(
        `emitted verification view cleanup failed: ${messageOf(error)}`,
      ),
      stdout: result.stdout,
      stderr: result.stderr,
      diagnostics: [
        ...result.diagnostics,
        `emitted verification view cleanup failed: ${messageOf(error)}`,
      ],
    };
  }
  return result;
}

/**
 * Runs exactly the supplied emitted tests with SLC's Vitest installation.
 *
 * Contract errors, subprocess failures, and cancellation are returned as a
 * structured result. No caller path is written by this facility.
 */
export async function runEmittedSuite(
  options: EmittedSuiteOptions,
): Promise<EmittedSuiteResult> {
  if (isAborted(options.signal)) return abortedBeforeStart();

  const invalid = await validateRequest(options.cwd, options.testPaths);
  if (invalid !== null) return failedWithoutProcess(invalid);
  if (isAborted(options.signal)) return abortedBeforeStart();

  let vitestCliPath: string;
  try {
    vitestCliPath = canonicalAbsolute(
      options.vitestCliPath ?? resolveInstalledVitestCli(),
      'Vitest CLI path',
    );
  } catch (error) {
    return failedWithoutProcess(messageOf(error));
  }

  const command: EmittedSuiteCommand = {
    executable: process.execPath,
    args: [
      vitestCliPath,
      'run',
      '--config',
      fileURLToPath(import.meta.url),
      '--root',
      options.cwd,
      '--no-color',
    ],
    cwd: options.cwd,
    env: {
      ...process.env,
      [INVENTORY_ENV]: JSON.stringify(
        options.testPaths.map((path) => exactIncludePattern(options.cwd, path)),
      ),
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };

  let executed: EmittedSuiteCommandResult;
  try {
    executed = await (options.execute ?? executeCommand)(command);
  } catch (error) {
    if (isAborted(options.signal)) {
      return {
        ...abortedBeforeStart(),
        diagnostics: ['emitted verification suite aborted', messageOf(error)],
      };
    }
    return failedWithoutProcess(
      `emitted verification suite could not start: ${messageOf(error)}`,
    );
  }

  if (executed.aborted || isAborted(options.signal)) {
    return {
      ok: false,
      status: 'aborted',
      exitCode: executed.exitCode,
      signal: executed.signal,
      stdout: executed.stdout,
      stderr: executed.stderr,
      diagnostics: failureDiagnostics(
        'emitted verification suite aborted',
        executed,
      ),
    };
  }
  if (executed.exitCode === 0 && executed.error === null) {
    return {
      ok: true,
      status: 'passed',
      exitCode: 0,
      signal: null,
      stdout: executed.stdout,
      stderr: executed.stderr,
      diagnostics: [],
    };
  }
  return {
    ok: false,
    status: 'failed',
    exitCode: executed.exitCode,
    signal: executed.signal,
    stdout: executed.stdout,
    stderr: executed.stderr,
    diagnostics: failureDiagnostics(
      'emitted verification suite failed',
      executed,
    ),
  };
}

interface PreparedSuiteView {
  readonly root: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly testPaths: readonly string[];
}

interface NormalizedBinding {
  readonly logicalPath: string;
  readonly physicalPath: string;
  readonly destination: string;
}

async function prepareSuiteView(
  options: MappedEmittedSuiteOptions,
): Promise<PreparedSuiteView> {
  const logicalRoot = canonicalAbsolute(options.logicalRoot, 'logical root');
  const viewParent = canonicalAbsolute(options.viewParent, 'view parent');
  const parentInfo = await lstat(viewParent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(`view parent is not a real directory: ${viewParent}`);
  }
  if (options.inventory.length === 0) {
    throw new Error('mapped emitted suite requires a non-empty inventory');
  }
  if (options.testPaths.length === 0) {
    throw new Error('mapped emitted suite requires a non-empty test inventory');
  }

  const logical = new Map<string, EmittedFileBinding>();
  for (const binding of options.inventory) {
    const logicalPath = canonicalAbsolute(binding.logicalPath, 'logical path');
    const physicalPath = canonicalAbsolute(
      binding.physicalPath,
      'physical path',
    );
    confinedLocator(logicalRoot, logicalPath);
    if (logical.has(logicalPath)) {
      throw new Error(`duplicate emitted logical path: ${logicalPath}`);
    }
    logical.set(logicalPath, { logicalPath, physicalPath });
  }

  const tests: string[] = [];
  const seenTests = new Set<string>();
  for (const path of options.testPaths) {
    const logicalPath = canonicalAbsolute(path, 'test path');
    confinedLocator(logicalRoot, logicalPath);
    if (!logical.has(logicalPath)) {
      throw new Error(`emitted test is absent from the inventory: ${path}`);
    }
    if (seenTests.has(logicalPath)) {
      throw new Error(`duplicate emitted verification test path: ${path}`);
    }
    seenTests.add(logicalPath);
    tests.push(logicalPath);
  }

  const root = await mkdtemp(join(viewParent, '.slc-verification-view-'));
  const rootInfo = await lstat(root, { bigint: true });
  const prepared: PreparedSuiteView = {
    root,
    device: rootInfo.dev,
    inode: rootInfo.ino,
    testPaths: [],
  };
  try {
    const normalized = normalizedMaterializations(logicalRoot, root, logical);
    for (const binding of normalized) {
      await mkdir(dirname(binding.destination), { recursive: true });
      const bytes = await readRegularFile(binding.physicalPath);
      await writeFile(binding.destination, bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    return {
      ...prepared,
      testPaths: tests.map((path) =>
        join(root, confinedLocator(logicalRoot, path)),
      ),
    };
  } catch (error) {
    await removeSuiteView(prepared);
    throw error;
  }
}

function normalizedMaterializations(
  logicalRoot: string,
  viewRoot: string,
  inventory: ReadonlyMap<string, EmittedFileBinding>,
): NormalizedBinding[] {
  const result: NormalizedBinding[] = [];
  const destinations = new Set<string>();
  for (const binding of inventory.values()) {
    if (isNodeNextRuntimeAlias(binding, inventory)) continue;
    const destination = join(
      viewRoot,
      confinedLocator(logicalRoot, binding.logicalPath),
    );
    if (destinations.has(destination)) {
      throw new Error(
        `emitted paths collide in the private view: ${destination}`,
      );
    }
    destinations.add(destination);
    result.push({ ...binding, destination });
  }
  return result;
}

function isNodeNextRuntimeAlias(
  binding: EmittedFileBinding,
  inventory: ReadonlyMap<string, EmittedFileBinding>,
): boolean {
  if (!binding.logicalPath.endsWith('.js')) return false;
  const sourceLogical = `${binding.logicalPath.slice(0, -3)}.ts`;
  const source = inventory.get(sourceLogical);
  return source?.physicalPath === binding.physicalPath;
}

function confinedLocator(root: string, path: string): string {
  const locator = relative(root, path);
  if (
    locator === '' ||
    isAbsolute(locator) ||
    locator === '..' ||
    locator.startsWith(`..${sep}`)
  ) {
    throw new Error(`emitted path escapes logical root: ${path}`);
  }
  return locator;
}

async function readRegularFile(path: string): Promise<Uint8Array> {
  const handle = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new Error(
        `emitted inventory source is not a regular file: ${path}`,
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function removeSuiteView(view: PreparedSuiteView): Promise<void> {
  const current = await lstat(view.root, { bigint: true });
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== view.device ||
    current.ino !== view.inode
  ) {
    throw new Error('private suite view changed identity');
  }
  await rm(view.root, { recursive: true });
}

/** Resolves the CLI from the Vitest package visible to SLC itself. */
export function resolveInstalledVitestCli(): string {
  const packageJson = fileURLToPath(import.meta.resolve('vitest/package.json'));
  return join(dirname(packageJson), 'vitest.mjs');
}

async function validateRequest(
  cwd: string,
  testPaths: readonly string[],
): Promise<string | null> {
  try {
    canonicalAbsolute(cwd, 'suite cwd');
  } catch (error) {
    return messageOf(error);
  }
  if (!(await resolvesToDirectory(cwd))) {
    return `emitted verification suite cwd is not a directory: ${cwd}`;
  }
  if (testPaths.length === 0) {
    return 'emitted verification suite requires a non-empty exact test inventory';
  }

  const seen = new Set<string>();
  for (const testPath of testPaths) {
    let canonical: string;
    try {
      canonical = canonicalAbsolute(testPath, 'test path');
      exactIncludePattern(cwd, canonical);
    } catch (error) {
      return messageOf(error);
    }
    if (seen.has(canonical)) {
      return `duplicate emitted verification test path: ${testPath}`;
    }
    seen.add(canonical);
    if (!(await resolvesToFile(testPath))) {
      return `emitted verification test is not a file: ${testPath}`;
    }
  }
  return null;
}

async function executeCommand(
  command: EmittedSuiteCommand,
): Promise<EmittedSuiteCommandResult> {
  return await new Promise((resolveResult) => {
    try {
      execFile(
        command.executable,
        command.args,
        {
          cwd: command.cwd,
          encoding: 'utf8',
          env: command.env,
          maxBuffer: 16 * 1024 * 1024,
          shell: false,
          windowsHide: true,
          ...(command.signal === undefined ? {} : { signal: command.signal }),
        },
        (error, stdout, stderr) => {
          resolveResult(commandResult(error, stdout, stderr, command.signal));
        },
      );
    } catch (error) {
      resolveResult({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: '',
        error: messageOf(error),
        aborted: command.signal?.aborted === true,
      });
    }
  });
}

function commandResult(
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
  signal: AbortSignal | undefined,
): EmittedSuiteCommandResult {
  if (error === null) {
    return {
      exitCode: 0,
      signal: null,
      stdout,
      stderr,
      error: null,
      aborted: false,
    };
  }
  return {
    exitCode: typeof error.code === 'number' ? error.code : null,
    signal: error.signal ?? null,
    stdout,
    stderr,
    error: error.message,
    aborted:
      signal?.aborted === true ||
      error.name === 'AbortError' ||
      error.code === 'ABORT_ERR',
  };
}

function failureDiagnostics(
  heading: string,
  result: EmittedSuiteCommandResult,
): string[] {
  const diagnostics = [heading];
  for (const detail of [result.stderr, result.stdout, result.error]) {
    const trimmed = detail?.trim();
    if (
      trimmed !== undefined &&
      trimmed !== '' &&
      !diagnostics.includes(trimmed)
    ) {
      diagnostics.push(trimmed);
    }
  }
  return diagnostics;
}

function failedWithoutProcess(diagnostic: string): EmittedSuiteResult {
  return {
    ok: false,
    status: 'failed',
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    diagnostics: [diagnostic],
  };
}

function abortedBeforeStart(): EmittedSuiteResult {
  return {
    ok: false,
    status: 'aborted',
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    diagnostics: ['emitted verification suite aborted'],
  };
}

function canonicalAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) returnInvalid(`${label} must be absolute: ${path}`);
  const canonical = resolve(path);
  if (canonical !== path) {
    returnInvalid(`${label} must be normalized: ${path}`);
  }
  return canonical;
}

function readExactIncludePatterns(): readonly string[] {
  const encoded = process.env[INVENTORY_ENV];
  if (encoded === undefined) return ['**/__slc_no_implicit_tests__'];
  const parsed: unknown = JSON.parse(encoded);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some((value) => typeof value !== 'string' || value.length === 0)
  ) {
    throw new Error('invalid emitted verification test inventory');
  }
  return Object.freeze([...parsed]);
}

function exactIncludePattern(cwd: string, path: string): string {
  const locator = relative(cwd, path);
  if (
    locator === '' ||
    isAbsolute(locator) ||
    locator === '..' ||
    locator.startsWith(`..${sep}`)
  ) {
    throw new Error(`emitted verification test escapes suite cwd: ${path}`);
  }
  return locator
    .split(sep)
    .join('/')
    .replace(
      /(?<!\\)([()[\]{}*?|]|^!|[!+@](?=\()|\\(?![()[\]{}!*+?@|]))/gu,
      '\\$&',
    );
}

function returnInvalid(message: string): never {
  throw new Error(message);
}

async function resolvesToFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function resolvesToDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

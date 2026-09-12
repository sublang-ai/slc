// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/** Source-owned acceptance check for the benchmark's minimal workflow. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MINIMAL_TASK =
  'Create change.txt containing exactly:\nbenchmark "Boss" task — unchanged\nCommit that change once.';

export async function checkMinimalRuntime({
  entry,
  signal = AbortSignal.timeout(30_000),
}) {
  const directory = mkdtempSync(join(tmpdir(), 'slc-benchmark-runtime-'));
  const workdir = join(directory, 'nested');
  const git = (cwd, ...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const commit = (cwd) =>
    git(
      cwd,
      '-c',
      'user.name=Benchmark Smoke',
      '-c',
      'user.email=smoke@sublang.ai',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'benchmark: synthetic change',
    );
  let runtime;
  let performingCalls = 0;
  let judgeCalls = 0;
  let performingFailure;
  const started = performance.now();
  try {
    signal.throwIfAborted();
    git(directory, 'init', '-q');
    writeFileSync(join(directory, 'ancestor.txt'), 'ancestor baseline\n');
    git(directory, 'add', 'ancestor.txt');
    commit(directory);
    const ancestorHead = git(directory, 'rev-parse', 'HEAD');
    mkdirSync(workdir);
    const registryEntry = (await import(pathToFileURL(resolve(entry)).href))
      .default;
    const require = createRequire(pathToFileURL(resolve(entry)));
    const { createWorktreeHostCapabilities } = await import(
      pathToFileURL(require.resolve('@sublang/playbook/host-capabilities')).href
    );
    runtime = registryEntry.createRuntime(
      { captainOptions: { cwd: workdir } },
      await createWorktreeHostCapabilities({
        cwd: workdir,
        playbookId: registryEntry.id,
        requiredRoleIds: registryEntry.requiredRoleIds,
        concurrentRoleSets: registryEntry.concurrentRoleSets,
      }),
    );
    const perform = async (prompt) => {
      try {
        signal.throwIfAborted();
        performingCalls++;
        assert.equal(
          performingCalls,
          1,
          'minimal workflow must perform exactly once',
        );
        assert(
          existsSync(join(workdir, '.git')),
          'workflow must initialize its own .git before the agent runs',
        );
        assert.equal(
          realpathSync(git(workdir, 'rev-parse', '--show-toplevel')),
          realpathSync(workdir),
          'workflow must use the nested repository root',
        );
        assert(
          prompt.includes(MINIMAL_TASK),
          'first performing prompt must contain the exact Boss task',
        );
        writeFileSync(
          join(workdir, 'change.txt'),
          'benchmark "Boss" task — unchanged\n',
        );
        git(workdir, 'add', 'change.txt');
        commit(workdir);
        return { status: 'ok', finalText: 'done' };
      } catch (error) {
        performingFailure ??= error;
        throw error;
      }
    };
    const sessionId = randomUUID();
    await runtime.init({
      sessionId,
      playbookId: registryEntry.id,
      rootSessionId: sessionId,
      depth: 0,
      ports: {
        callPlayer: async (_role, prompt) => perform(prompt),
        callCaptain: async (prompt) => perform(prompt),
        callJudge: async () => {
          assert.equal(
            performingCalls,
            1,
            'minimal entry must route the Boss task deterministically',
          );
          assert.equal(
            ++judgeCalls,
            1,
            'minimal workflow must classify only one performing result',
          );
          return '{"guard":"done"}';
        },
        callPlaybook: async () => {
          throw new Error('minimal workflow must not invoke a child playbook');
        },
        emitStatus: async () => {},
        emitTelemetry: async () => {},
      },
    });
    const result = await runtime.handleBossInput({
      text: MINIMAL_TASK,
      signal,
    });
    if (performingFailure) throw performingFailure;
    signal.throwIfAborted();
    assert.equal(
      performingCalls,
      1,
      'minimal workflow must perform exactly once',
    );
    assert.equal(
      result.outcome,
      'terminal',
      'minimal workflow must reach a terminal',
    );
    assert.equal(
      result.terminal?.kind,
      'success',
      'minimal workflow must reach a declared successful terminal',
    );
    assert.equal(
      git(workdir, 'rev-list', '--count', 'HEAD'),
      '1',
      'minimal workflow must commit exactly once',
    );
    assert.equal(
      git(workdir, 'show', 'HEAD:change.txt'),
      'benchmark "Boss" task — unchanged',
    );
    assert.equal(
      git(workdir, 'status', '--porcelain'),
      '',
      'nested repository must be clean',
    );
    assert.equal(
      git(directory, 'rev-parse', 'HEAD'),
      ancestorHead,
      'ancestor HEAD must remain unchanged',
    );
    assert.equal(
      git(directory, 'diff', '--name-only', 'HEAD'),
      '',
      'ancestor tracked files must remain unchanged',
    );
    return {
      ok: true,
      profile: 'minimal',
      performingCalls,
      judgeCalls,
      ownRepository: true,
      exactBossTask: true,
      commits: 1,
      terminalKind: result.terminal.kind,
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    try {
      await runtime?.dispose();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  try {
    const result = await checkMinimalRuntime({
      entry: process.argv[2],
      signal: controller.signal,
    });
    writeFileSync(process.argv[3], `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error.stack ?? error);
    if (process.argv[3])
      writeFileSync(
        process.argv[3],
        `${JSON.stringify({ ok: false, profile: 'minimal' })}\n`,
      );
    process.exitCode = 1;
  }
}

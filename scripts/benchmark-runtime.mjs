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
const QUOTED_MINIMAL_TASK = MINIMAL_TASK.split('\n')
  .map((line) => `> ${line}`)
  .join('\n');

/** The minimal profile supports one normal outcome without semantic payloads. */
function minimalJudgeReply(prompt) {
  if (prompt.startsWith('Classify the following Boss message')) {
    const section = prompt
      .split('Allowed JSON objects:\n')[1]
      ?.split('\nBoss message:')[0];
    assert(section, 'unsupported minimal-profile Boss-classifier prompt');
    const events = section
      .split('\n')
      .flatMap((line) => {
        const match = /^- (\{.*\})(?: \(.*\))?$/.exec(line.trim());
        if (!match) return [];
        return [JSON.parse(match[1])];
      })
      .filter(
        (event) =>
          ![
            'NO_ACTION',
            'BOSS_PAUSE',
            'BOSS_RESUME',
            'BOSS_INTERRUPT',
            'BOSS_REPLY',
          ].includes(event.type),
      );
    assert.equal(
      events.length,
      1,
      'minimal profile requires one unambiguous initial event',
    );
    return JSON.stringify(events[0]);
  }
  const outcomes = [
    ...prompt.matchAll(/^- `([A-Za-z_$][A-Za-z0-9_$]*)`(?: — ([^\n]*))?\n?/gm),
  ].filter((match) => match[1] !== 'needsBossReply');
  assert.equal(
    outcomes.length,
    1,
    'minimal profile requires one normal outcome',
  );
  const outcome = outcomes[0];
  const tail = prompt
    .slice(outcome.index + outcome[0].length)
    .split(/\n- `/)[0];
  const exact = /^ {2}Reply exactly: (.*)$/m.exec(tail);
  if (exact) {
    const reply = JSON.parse(exact[1]);
    assert.deepEqual(
      Object.keys(reply),
      ['guard'],
      'minimal profile supports no judge-authored payload fields',
    );
    assert.equal(reply.guard, outcome[1]);
    return JSON.stringify(reply);
  }
  assert(
    !/Output shall include|输出应包含/.test(outcome[2] ?? ''),
    'minimal profile supports no judge-authored payload fields',
  );
  return JSON.stringify({ guard: outcome[1] });
}

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
  let setupCaptainCalls = 0;
  let judgeCalls = 0;
  let performingFailure;
  let taskPresentation;
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
        taskPresentation = prompt.includes(MINIMAL_TASK)
          ? 'literal'
          : `\n${prompt}\n`.includes(`\n${QUOTED_MINIMAL_TASK}\n`)
            ? 'quoted'
            : undefined;
        assert(
          taskPresentation !== undefined,
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
        callCaptain: async (prompt) => {
          try {
            signal.throwIfAborted();
            assert.equal(
              performingCalls,
              0,
              'setup Captain must run before the delegated task',
            );
            assert.equal(
              ++setupCaptainCalls,
              1,
              'minimal profile supports one setup Captain call',
            );
            assert.match(
              prompt,
              /git/i,
              'setup Captain must receive the repository instruction',
            );
            assert.match(
              prompt,
              /init/i,
              'setup Captain must receive the initialization instruction',
            );
            assert.match(
              prompt,
              /(?:current|working) directory|cwd/i,
              'setup Captain must receive the working-directory scope',
            );
            assert.match(
              prompt,
              /\.git|root[^\n]*(?:git repository|repository)/i,
              'setup Captain must receive the own-repository condition',
            );
            git(workdir, 'init', '-q');
            return {
              status: 'ok',
              finalText:
                'Initialized the current directory as its own Git repository.',
            };
          } catch (error) {
            performingFailure ??= error;
            throw error;
          }
        },
        callJudge: async (prompt) => {
          try {
            signal.throwIfAborted();
            judgeCalls++;
            assert(
              judgeCalls <= 6,
              'minimal runtime exceeded its bounded synthetic judge budget',
            );
            return minimalJudgeReply(prompt);
          } catch (error) {
            performingFailure ??= error;
            throw error;
          }
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
      setupCaptainCalls,
      judgeCalls,
      ownRepository: true,
      exactBossTask: true,
      taskPresentation,
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

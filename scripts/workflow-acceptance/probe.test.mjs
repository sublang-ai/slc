// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runCodeScenario, codeCases } from './code.mjs';
import { runDevScenario, devCases } from './dev.mjs';
import { maintainedConfig } from './maintained.mjs';
import { governedReply, preserveRun } from './common.mjs';
import { maintainedDevProfile } from './maintained-dev.mjs';

const root = process.env.PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT;
assert(
  root,
  'Set PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT to the reviewed maintained fixture checkout',
);
const output = await mkdtemp(join(tmpdir(), 'code-dev-probe-tests-'));
const config = await maintainedConfig(root, 'code', output);
const direct = codeCases.find((row) => row.id === 'code-direct');

test('maintained commands execute every case from an escaped path and reject empty selections', async () => {
  const scripts = join(output, 'harness with spaces # and %');
  await cp(fileURLToPath(new URL('.', import.meta.url)), scripts, {
    recursive: true,
  });
  const exec = promisify(execFile);
  for (const [command, count] of [
    ['maintained.mjs', 18],
    ['maintained-dev.mjs', 24],
  ]) {
    const destination = join(output, command);
    const args = [join(scripts, command), root, destination];
    const { stdout } = await exec(process.execPath, args, { timeout: 120_000 });
    assert.equal(stdout.trim().split('\n').length, count);
    const summary = JSON.parse(
      await readFile(join(destination, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.results.length, count);
    assert(
      summary.results.every(
        (result) => result.status === 'passed' && result.artifactsUnchanged,
      ),
    );
    await assert.rejects(
      exec(process.execPath, [...args, 'no-such-case']),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /case filter matched no (CODE|DEV) cases/);
        return true;
      },
    );
  }
});

test('swapping Git effects cannot satisfy each case-specific receipt oracle', async () => {
  const effects = codeCases.filter((row) => row.expected === 'effect-rejected');
  for (const [index, scenario] of effects.entries()) {
    const result = await runCodeScenario(config, {
      ...scenario,
      id: `${scenario.id}-swapped`,
      effect: effects[(index + 1) % effects.length].effect,
    });
    assert.equal(result.status, 'failed');
    assert.match(result.error.message, /actual Git receipt classification/);
    assert.equal(result.artifactsUnchanged, true);
  }
});

test('real current host / maintained source positive control', async () => {
  const result = await runCodeScenario(config, { ...direct, id: 'positive' });
  assert.equal(result.status, 'passed');
  assert.equal(result.artifactsUnchanged, true);
  assert.equal(result.ownNestedGit, true);
  assert.equal(result.ownCommitCount, 1);
});

test('dropped literal task in actual transported prompt cannot pass', async () => {
  const construct = (registry, host, options) => {
    const runtime = config.construct(registry, host, options);
    return new Proxy(runtime, {
      get(target, name) {
        if (name === 'init')
          return (session) =>
            target.init({
              ...session,
              ports: {
                ...session.ports,
                callPlayer: (role, prompt, signal, callOptions) =>
                  session.ports.callPlayer(
                    role,
                    prompt.replace('Do not erase this last line.', ''),
                    signal,
                    callOptions,
                  ),
              },
            });
        const member = target[name];
        return typeof member === 'function' ? member.bind(target) : member;
      },
    });
  };
  const result = await runCodeScenario(
    { ...config, construct },
    { ...direct, id: 'dropped-task' },
  );
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /exact quoted relay missing/);
  assert.equal(result.artifactsUnchanged, true);
});

test('unknown semantic mapping is unsupported, never an invented Judge field', async () => {
  const profile = {
    ...config.profile,
    select: () => ({ guard: 'not-an-offered-outcome' }),
  };
  const result = await runCodeScenario(
    { ...config, profile },
    { ...direct, id: 'unknown-outcome' },
  );
  assert.equal(result.status, 'unsupported-profile');
  assert.equal(result.artifactsUnchanged, true);
});

test('uncorrelated child callback cannot satisfy a successful parent case', async () => {
  const profile = {
    ...config.profile,
    reviewResult: (...args) => ({
      ...config.profile.reviewResult(...args),
      childSessionId: 'different-child-session',
    }),
  };
  const result = await runCodeScenario(
    { ...config, profile },
    { ...direct, id: 'wrong-child-correlation' },
  );
  assert.equal(result.status, 'failed');
  assert.match(result.error.message, /child.*session|childSessionId/i);
  assert.equal(result.artifactsUnchanged, true);
});

test('changed protected input overrides an ordinary thrown failure', async () => {
  const path = join(output, 'protected-source.txt');
  await writeFile(path, 'original');
  const result = await preserveRun(
    { id: 'preservation-on-throw', paths: [path], output },
    async () => {
      await writeFile(path, 'changed');
      throw new Error('fixture execution failed');
    },
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.artifactsUnchanged, false);
  assert.equal(result.preservationFailure, true);
  assert.notEqual(result.before[0].sha256, result.after[0].sha256);
});

test('DEV profile selection receives actual Analyst finalText while maintained guard-only payload stays strict', async () => {
  const devOutput = await mkdtemp(join(tmpdir(), 'dev-finaltext-probe-'));
  const devConfig = await maintainedConfig(root, 'dev', devOutput);
  const selected = [];
  const profile = {
    ...maintainedDevProfile,
    select(semantic, context) {
      const reply = maintainedDevProfile.select(semantic, context);
      selected.push({ semantic, context, reply });
      return reply;
    },
  };
  const scenario = devCases.find((row) => row.id === 'dev-code');
  const result = await runDevScenario(
    { ...devConfig, profile },
    { ...scenario, id: 'dev-finaltext-context' },
  );
  assert.equal(result.status, 'passed');
  assert.equal(result.artifactsUnchanged, true);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].semantic, 'code');
  assert.deepEqual(selected[0].reply, { guard: 'code' });
  assert.deepEqual(Object.keys(selected[0].context), ['finalText']);
  assert.equal(
    selected[0].context.finalText,
    maintainedDevProfile.resultText('code'),
  );
});

test('governed replies accept only advertised finalText-derived semantic payload fields', () => {
  const finalText = 'The Analyst asks Boss for the missing deployment target.';
  const prompt = [
    'Judge the Analyst result.',
    '  Reply exactly: {"guard":"code","planningResult":<complete planning result>}',
    '  Reply exactly: {"guard":"needsBossReply","question":<verbatim final text>}',
  ].join('\n');
  assert.equal(
    governedReply(prompt, { guard: 'code', planningResult: finalText }).json,
    JSON.stringify({ guard: 'code', planningResult: finalText }),
  );
  assert.equal(
    governedReply(prompt, { guard: 'needsBossReply', question: finalText })
      .json,
    JSON.stringify({ guard: 'needsBossReply', question: finalText }),
  );
  assert.throws(
    () =>
      governedReply(prompt, {
        guard: 'code',
        planningResult: finalText,
        question: finalText,
      }),
    /fixture only supplies actually advertised fields/,
  );
});

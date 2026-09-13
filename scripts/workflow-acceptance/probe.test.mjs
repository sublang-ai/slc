// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCodeScenario, codeCases } from './code.mjs';
import { maintainedConfig } from './maintained.mjs';
import { preserveRun } from './common.mjs';

const root = process.env.PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT;
assert(
  root,
  'Set PLAYBOOK_ACCEPTANCE_FIXTURE_ROOT to the reviewed maintained fixture checkout',
);
const output = await mkdtemp(join(tmpdir(), 'code-dev-probe-tests-'));
const config = await maintainedConfig(root, 'code', output);
const direct = codeCases.find((row) => row.id === 'code-direct');

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

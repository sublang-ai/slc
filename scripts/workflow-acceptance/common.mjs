// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export class UnsupportedProfile extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsupportedProfile';
  }
}
export function supported(condition, message) {
  if (!condition) throw new UnsupportedProfile(message);
}
export async function identities(paths) {
  return Promise.all(
    [...new Set(paths)].map(async (path) => {
      const bytes = await readFile(path);
      return { path, bytes: bytes.length, sha256: hash(bytes) };
    }),
  );
}
export async function git(cwd, ...args) {
  return (
    await exec(
      'git',
      ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
      {
        cwd,
        encoding: 'utf8',
        timeout: 8000,
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
        },
      },
    )
  ).stdout.trim();
}
export async function commit(cwd, label) {
  await git(
    cwd,
    '-c',
    'user.name=Acceptance Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '--quiet',
    '-m',
    label,
  );
  return git(cwd, 'rev-parse', 'HEAD');
}
export async function nestedGit(output) {
  const root = await mkdtemp(join(output, 'repository-'));
  await git(root, 'init', '--quiet');
  await writeFile(join(root, 'ancestor.txt'), 'separate ancestor\n');
  await git(root, 'add', 'ancestor.txt');
  const ancestorHead = await commit(root, 'ancestor');
  const cwd = join(root, 'own-repository');
  await mkdir(cwd);
  await git(cwd, 'init', '--quiet');
  await writeFile(join(cwd, 'base.txt'), 'own baseline\n');
  await git(cwd, 'add', 'base.txt');
  const base = await commit(cwd, 'baseline');
  assert.equal(
    await realpath(await git(cwd, 'rev-parse', '--show-toplevel')),
    await realpath(cwd),
  );
  return { root, cwd, base, ancestorHead };
}
export async function assertRepositoryIsolation(repo) {
  assert.equal(
    await realpath(await git(repo.cwd, 'rev-parse', '--show-toplevel')),
    await realpath(repo.cwd),
  );
  assert.equal(await git(repo.root, 'rev-parse', 'HEAD'), repo.ancestorHead);
  assert.equal(
    await readFile(join(repo.root, 'ancestor.txt'), 'utf8'),
    'separate ancestor\n',
  );
}
export const quoted = (value) => value.replaceAll('\n', '\n> ');
export function assertRelay(prompt, label, value) {
  const expected = `> ${label}: ${quoted(value)}`;
  assert(prompt.includes(expected), `exact quoted relay missing: ${label}`);
  assert.equal(
    prompt.split(expected).length - 1,
    1,
    `relay duplicated: ${label}`,
  );
}
export function assertInstructions(prompt, instructions) {
  let start = 0;
  for (const block of instructions) {
    const position = prompt.indexOf(block, start);
    assert(position >= 0, 'source instruction block absent or out of order');
    start = position + block.length;
  }
}

// This parser consumes the actual shared-engine prompt grammar. Semantic field
// names come from the advertised reply template, never the proposed scenario.
// Unknown template grammar is unsupported, not repaired or guessed.
export function outcomeContracts(prompt) {
  const outcomes = [];
  for (const line of prompt.split('\n')) {
    const match = /^ {2}Reply exactly: (\{.*\})$/.exec(line);
    if (!match) continue;
    const member = /"((?:[^"\\]|\\.)+)"\s*:\s*("(?:[^"\\]|\\.)*"|<[^<>\n]*>)/gy;
    const body = match[1].slice(1, -1).trim();
    const fields = {};
    let cursor = 0;
    while (cursor < body.length) {
      member.lastIndex = cursor;
      const part = member.exec(body);
      supported(part !== null, 'unrecognized actual Judge reply template');
      const key = JSON.parse(`"${part[1]}"`);
      supported(!Object.hasOwn(fields, key), 'duplicate actual Judge field');
      fields[key] = part[2].startsWith('"')
        ? { literal: JSON.parse(part[2]) }
        : { semantic: true };
      cursor = member.lastIndex;
      if (cursor < body.length) {
        const separator = /^,\s*/.exec(body.slice(cursor));
        supported(separator !== null, 'unrecognized actual Judge separator');
        cursor += separator[0].length;
      }
    }
    supported(
      typeof fields.guard?.literal === 'string',
      'actual outcome has no literal guard',
    );
    outcomes.push({ guard: fields.guard.literal, fields });
  }
  supported(outcomes.length > 0, 'requires an actual governed Judge contract');
  supported(
    new Set(outcomes.map((x) => x.guard)).size === outcomes.length,
    'duplicate advertised outcome',
  );
  return outcomes;
}
export function governedReply(prompt, selected) {
  const outcomes = outcomeContracts(prompt);
  const contract = outcomes.find((outcome) => outcome.guard === selected.guard);
  supported(
    contract,
    `reviewed semantic mapping is not offered: ${selected.guard}`,
  );
  assert.deepEqual(
    Object.keys(selected).sort(),
    Object.keys(contract.fields).sort(),
    'fixture only supplies actually advertised fields',
  );
  for (const [key, field] of Object.entries(contract.fields)) {
    if (Object.hasOwn(field, 'literal'))
      assert.equal(selected[key], field.literal);
    else assert.equal(typeof selected[key], 'string');
  }
  return { json: JSON.stringify(selected), contracts: outcomes };
}
export function bossReply(prompt, pending) {
  supported(
    prompt.startsWith('Classify the following Boss message'),
    'unknown control prompt',
  );
  const section = prompt
    .split('Allowed JSON objects:\n')[1]
    ?.split('\nBoss message:')[0];
  supported(section, 'missing actual Boss classifier contract');
  const choices = section
    .split('\n')
    .flatMap((line) => {
      const m = /^- (\{.*\})(?: \(.*\))?$/.exec(line);
      return m ? [JSON.parse(m[1])] : [];
    })
    .filter((choice) => choice.type === 'BOSS_REPLY');
  supported(choices.length === 1, 'requires one actual Boss-reply choice');
  const reply = choices[0];
  for (const key of Object.keys(reply)) {
    supported(
      key === 'type' || key === 'questionId',
      `unsupported Boss classifier semantic field ${key}`,
    );
  }
  if (Object.hasOwn(reply, 'questionId')) {
    const id = /^Pending question id: (.+)$/m.exec(prompt)?.[1];
    assert.equal(id, pending.questionId);
    reply.questionId = id;
  }
  return JSON.stringify(reply);
}

export function session(registry, ports, identity) {
  const sessionId = randomUUID();
  return {
    sessionId,
    playbookId: registry.id,
    rootSessionId: sessionId,
    depth: 0,
    ports,
    roleBindings: Object.fromEntries(
      registry.requiredRoleIds.map((role) => [
        role,
        { playerId: `fixture-${role}`, promptIdentity: identity },
      ]),
    ),
  };
}

export async function preserveRun({ id, paths, output }, run) {
  await mkdir(output, { recursive: true });
  const before = await identities(paths);
  const started = performance.now();
  const diagnostics = { id, callbacks: [], judges: [], results: [] };
  let result;
  try {
    const evidence = await run(diagnostics);
    result = { id, status: 'passed', ...evidence };
  } catch (error) {
    result = {
      id,
      status:
        error instanceof UnsupportedProfile ? 'unsupported-profile' : 'failed',
      error: { name: error.name, message: error.message },
    };
    diagnostics.error = error.stack;
  } finally {
    const after = await Promise.all(
      before.map(async (old) => {
        try {
          return (await identities([old.path]))[0];
        } catch (error) {
          return { path: old.path, error: error.message };
        }
      }),
    );
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    result = {
      ...result,
      elapsedMs: performance.now() - started,
      artifactsUnchanged: unchanged,
      before,
      after,
    };
    if (!unchanged)
      result = { ...result, status: 'failed', preservationFailure: true };
    await writeFile(
      join(output, `${id}.diagnostics.json`),
      JSON.stringify(diagnostics, null, 2) + '\n',
    );
    await writeFile(
      join(output, `${id}.json`),
      JSON.stringify(result, null, 2) + '\n',
    );
  }
  return result;
}

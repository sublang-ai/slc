// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { selectCase } from '../scripts/phase-probe.mjs';
import {
  parseGearsItems,
  checkGearsResultContract,
  inspectGearsRoleContract,
} from '../src/verify.js';

const base = new URL(
  '../docs/performance/clarification-gears-corpus/',
  import.meta.url,
);
const manifestPath = fileURLToPath(new URL('manifest.json', base));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const oracles = JSON.parse(readFileSync(new URL('oracles.json', base), 'utf8'));
const readCase = (id) => readFileSync(selectCase(manifestPath, id).source);

test('the real phase recorder selects only exact direct-GEARS source identities', () => {
  assert.equal(manifest.cases.length, 3);
  for (const member of manifest.cases) {
    const selected = selectCase(manifestPath, member.id);
    assert.deepEqual(Object.keys(selected).sort(), [
      'caseId',
      'phase',
      'source',
      'sourceBytes',
      'sourceSha256',
    ]);
    assert.equal(selected.phase, 'playbook.gears2fsm');
    const bytes = readFileSync(selected.source);
    assert.equal(bytes.length, selected.sourceBytes);
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      selected.sourceSha256,
    );
  }
});

test('the mutant changes exactly one declared outcome and restoration recovers all original bytes', () => {
  const clean = readCase('gears-001');
  const mutant = readCase('gears-002');
  assert.deepEqual(readCase('gears-003'), clean);
  assert.equal(oracles.family.edits.length, 1);
  const edit = oracles.family.edits[0];
  const { startByte, endByteExclusive } = edit.baseRange;
  assert.equal(
    clean.subarray(startByte, endByteExclusive).toString(),
    edit.oldText,
  );
  assert.equal(
    mutant
      .subarray(edit.mutantRange.startByte, edit.mutantRange.endByteExclusive)
      .toString(),
    edit.newText,
  );
  assert.deepEqual(
    mutant,
    Buffer.concat([
      clean.subarray(0, startByte),
      Buffer.from(edit.newText),
      clean.subarray(endByteExclusive),
    ]),
  );
});

test('the unchanged real GEARS parser accepts every case with identical prompts and only the intended terminal conflict', () => {
  const parsed = manifest.cases.map(({ id }) => {
    const text = readCase(id).toString();
    assert.deepEqual(checkGearsResultContract(text), []);
    const roles = inspectGearsRoleContract(text);
    assert.deepEqual(roles.findings, []);
    assert.deepEqual(roles.roleIds, ['drafter', 'reviewer']);
    const items = parseGearsItems(text);
    assert.deepEqual(
      items.map((item) => item.actor),
      ['player', 'player', 'captain', 'captain'],
    );
    return items;
  });
  assert.deepEqual(parsed[2], parsed[0]);
  for (let i = 0; i < parsed[0].length; i++) {
    assert.equal(parsed[1][i].id, parsed[0][i].id);
    assert.equal(parsed[1][i].prompt, parsed[0][i].prompt);
    if (i !== 2) assert.deepEqual(parsed[1][i], parsed[0][i]);
  }
  assert.equal(parsed[0][2].result.done, oracles.family.edits[0].oldText);
  assert.equal(parsed[1][2].result.done, oracles.family.edits[0].newText);
});

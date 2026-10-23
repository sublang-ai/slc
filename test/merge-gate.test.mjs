// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// continuous-integration-12: the merge-gate audit (DR-060).

import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');
const workflow = parse(read('.github/workflows/ci.yml'));

describe('merge gate (continuous-integration-12)', () => {
  it('runs one run per pull-request head and never cancels a push (continuous-integration-9)', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push']);
    expect(workflow.on.push).toEqual({ branches: ['main'] });
    expect(workflow.on.pull_request).toBeNull();
    expect(workflow.concurrency).toEqual({
      group:
        'ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}',
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    });
  });

  it('holds the one quality job the merge rule requires (continuous-integration-8)', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['quality']);
    expect(workflow.jobs.quality.strategy).toBeUndefined();
  });

  it('refuses a conflict marker before pushing (continuous-integration-10)', () => {
    expect(JSON.parse(read('package.json')).scripts.prepush).toBe(
      'bash scripts/prepush.sh',
    );
    const dir = mkdtempSync(join(tmpdir(), 'slc-prepush-'));
    try {
      execFileSync('git', ['init', '-q', dir]);
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(
        join(dir, 'scripts/prepush.sh'),
        read('scripts/prepush.sh'),
      );
      writeFileSync(
        join(dir, 'left.ts'),
        [
          'const a = 1;',
          '<<<<<<< HEAD',
          'const b = 2;',
          '=======',
          'const b = 3;',
          '>>>>>>> origin/main',
          '',
        ].join('\n'),
      );
      execFileSync('git', ['-C', dir, 'add', '-A']);
      const run = spawnSync('bash', [join(dir, 'scripts/prepush.sh')], {
        encoding: 'utf8',
      });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toMatch(/conflict markers left in the tree/);
      expect(run.stderr).toMatch(/left\.ts:2:<<<<<<< HEAD/);
      expect(run.stdout).not.toMatch(/prepush: clean/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

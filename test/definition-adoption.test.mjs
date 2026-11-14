// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('definition adoption (self-hosting-12)', () => {
  it.each([
    ['^0.38.0', true],
    ['^0.38.0 || ^0.39.0', true],
    ['^0.38.0 || ^0.36.0', false],
    ['^0.36.0 || ^0.38.0', false],
    ['^0.38.0 || >=0.39.0', false],
    ['^0.38.0 ||', false],
    [undefined, false],
  ])(
    'checks every caret branch of %s before accepting definitions',
    (range, accepted) => {
      const dir = mkdtempSync(join(tmpdir(), 'slc-definition-adoption-'));
      try {
        mkdirSync(join(dir, 'scripts'));
        copyFileSync(
          join(root, 'scripts/verify-playbook-definitions.mjs'),
          join(dir, 'scripts/verify-playbook-definitions.mjs'),
        );
        copyFileSync(
          join(root, 'package-lock.json'),
          join(dir, 'package-lock.json'),
        );
        symlinkSync(
          join(root, 'node_modules'),
          join(dir, 'node_modules'),
          'dir',
        );
        symlinkSync(join(root, 'pipelines'), join(dir, 'pipelines'), 'dir');
        const manifest = JSON.parse(
          readFileSync(join(root, 'package.json'), 'utf8'),
        );
        manifest.dependencies['@sublang/cligent'] = range;
        writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
        const run = spawnSync(
          process.execPath,
          [join(dir, 'scripts/verify-playbook-definitions.mjs')],
          { encoding: 'utf8' },
        );
        if (accepted) {
          expect(run.stderr).toBe('');
          expect(run.status).toBe(0);
          expect(run.stdout).toContain('text2gears.md: matches');
          expect(run.stdout).toContain('prefix.md: matches');
        } else {
          expect(run.status).not.toBe(0);
          expect(run.stderr).toContain('every minimum at least 0.37.0');
          expect(run.stdout).toBe('');
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

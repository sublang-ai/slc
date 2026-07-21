// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const scratch = mkdtempSync(join(tmpdir(), 'slc-package-'));

try {
  const cache = join(scratch, 'npm-cache');
  const packs = join(scratch, 'packs');
  mkdirSync(packs);

  const packed = JSON.parse(
    execFileSync(
      'npm',
      [
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        packs,
        '--cache',
        cache,
      ],
      { cwd: repoRoot, encoding: 'utf8' },
    ),
  );
  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error('npm pack did not report exactly one tarball');
  }
  const report = packed[0];
  if (report.name !== manifest.name || report.version !== manifest.version) {
    throw new Error(
      `packed identity ${String(report.name)}@${String(report.version)} does not match package.json`,
    );
  }

  const paths = new Set(report.files.map((file) => file.path));
  for (const required of [
    'LICENSE',
    'README.md',
    'package.json',
    'dist/cli.js',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/verify.js',
    'dist/verify.d.ts',
    'dist/normalize.md',
    'dist/slc.config.template.yaml',
  ]) {
    if (!paths.has(required)) {
      throw new Error(`publishable tarball is missing ${required}`);
    }
  }
  for (const path of paths) {
    if (
      ['src/', 'test/', 'demo/', 'specs/', 'scripts/', '.github/'].some(
        (prefix) => path.startsWith(prefix),
      )
    ) {
      throw new Error(`publishable tarball contains development file ${path}`);
    }
  }

  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'slc-package-smoke', private: true, type: 'module' }, null, 2)}\n`,
  );
  const tarball = join(packs, report.filename);
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--cache',
      cache,
      tarball,
    ],
    { cwd: consumer, stdio: 'pipe' },
  );

  const bin = join(
    consumer,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'slc.cmd' : 'slc',
  );
  const reportedVersion = execFileSync(bin, ['--version'], {
    cwd: consumer,
    encoding: 'utf8',
  }).trim();
  if (reportedVersion !== `slc ${manifest.version}`) {
    throw new Error(
      `installed executable reported ${JSON.stringify(reportedVersion)}`,
    );
  }

  cpSync(
    join(repoRoot, 'demo', 'reference', 'workflow.ts'),
    join(consumer, 'workflow.ts'),
  );
  cpSync(
    join(repoRoot, 'demo', 'reference', 'workflow.playbook'),
    join(consumer, 'workflow.playbook'),
    { recursive: true },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "await import('@sublang/slc');",
        "await import('@sublang/slc/verify');",
        "const entry = (await import('./workflow.ts')).default;",
        "if (entry.id !== 'workflow') throw new Error('external entry did not load');",
      ].join('\n'),
    ],
    { cwd: consumer, stdio: 'pipe' },
  );

  console.log(
    `package smoke passed: ${manifest.name}@${manifest.version} (${paths.size} files)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

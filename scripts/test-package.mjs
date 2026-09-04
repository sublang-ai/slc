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
  // Exercise the quiescent schema-3 consumer lifecycle from the installed
  // project (release-18): import the committed reference entry through its
  // artifact-local dependencies, construct its runtime once with validated
  // configured options and exact live host capabilities, initialize one
  // causal-root session, and dispose it. No compiled Boss turn runs here —
  // SLC does not substitute for Playbook's governed repository and
  // effect-ledger protocol (DR-024); compiled-turn execution belongs to the
  // opt-in acceptance gate. This still proves the *published* dependency
  // closure resolves the shared engine beside the artifact, loads the
  // emitted entry, and honors the exact two-argument schema-3 boundary.
  mkdirSync(join(consumer, 'work'));
  writeFileSync(
    join(consumer, 'smoke.mjs'),
    [
      "import { join } from 'node:path';",
      "await import('@sublang/slc');",
      "await import('@sublang/slc/verify');",
      "const entry = (await import('./workflow.ts')).default;",
      "if (entry.id !== 'workflow') throw new Error('external entry did not load');",
      "const factory = (await import('./workflow.playbook/workflow.playbook.ts')).default;",
      'const profile = entry.runtimeProfile;',
      'if (',
      '  entry.artifactSchema !== 3 ||',
      "  profile?.kind !== 'shared-factory' ||",
      '  profile.compat !== factory.compat ||',
      '  profile.compat?.artifactSchema !== 3',
      ') {',
      "  throw new Error('installed entry does not advertise the shared-factory schema-3 runtime profile');",
      '}',
      'if (entry.createRuntime.length !== 2) {',
      "  throw new Error('installed entry does not separate configured options from host capabilities');",
      '}',
      "const workdir = join(process.cwd(), 'work');",
      'const governedUses = [];',
      'const failGoverned = (name) => async () => {',
      '  governedUses.push(name);',
      '  throw new Error(`${name} must not be used without a Boss turn`);',
      '};',
      'const runtime = entry.createRuntime(',
      '  { captainOptions: { cwd: workdir } },',
      '  {',
      '    repository: {',
      "      runExclusive: failGoverned('repository.runExclusive'),",
      "      runDeferred: failGoverned('repository.runDeferred'),",
      '    },',
      '    effectLedger: {',
      '      snapshot: () => ({',
      '        schemaVersion: 1,',
      '        revision: 0,',
      '        boundaries: [],',
      '        logicalOperations: [],',
      '      }),',
      "      writeAhead: failGoverned('effectLedger.writeAhead'),",
      '    },',
      '  },',
      ');',
      "if (typeof runtime.handleBossInput !== 'function' || typeof runtime.dispose !== 'function') {",
      "  throw new Error('constructed runtime is missing its required surface');",
      '}',
      'const callPortUses = [];',
      'const failCallPort = (name) => async () => {',
      '  callPortUses.push(name);',
      '  throw new Error(`${name} must not be used without a Boss turn`);',
      '};',
      "const sessionId = 'package-smoke';",
      'await runtime.init({',
      '  sessionId,',
      '  playbookId: entry.id,',
      '  rootSessionId: sessionId,',
      '  depth: 0,',
      '  ports: {',
      "    callPlayer: failCallPort('callPlayer'),",
      "    callCaptain: failCallPort('callCaptain'),",
      "    callJudge: failCallPort('callJudge'),",
      "    callPlaybook: failCallPort('callPlaybook'),",
      '    emitStatus: async () => {},',
      '    emitTelemetry: async () => {},',
      '  },',
      '});',
      'await runtime.dispose();',
      'if (callPortUses.length > 0 || governedUses.length > 0) {',
      "  throw new Error(`quiescent lifecycle used ${[...callPortUses, ...governedUses].join(', ')}`);",
      '}',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['smoke.mjs'], {
    cwd: consumer,
    stdio: 'pipe',
  });

  console.log(
    `package smoke passed: ${manifest.name}@${manifest.version} (${paths.size} files)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

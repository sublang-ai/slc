// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
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
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'slc-package-')));

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

  const tarball = join(packs, report.filename);
  const installArgs = [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--cache',
    cache,
    tarball,
  ];
  // A consumer installs no SLC devDependencies: npm must supply the required
  // peer even when the consumer names only the compiler (release-26).
  const standalone = join(scratch, 'standalone');
  mkdirSync(standalone);
  writeFileSync(
    join(standalone, 'package.json'),
    JSON.stringify({ name: 'slc-standalone-smoke', private: true }),
  );
  execFileSync('npm', installArgs, { cwd: standalone, stdio: 'pipe' });
  const standalonePackage = join(standalone, 'node_modules', '@sublang', 'slc');
  const installedManifest = JSON.parse(
    readFileSync(join(standalonePackage, 'package.json'), 'utf8'),
  );
  assert.equal(
    installedManifest.peerDependencies?.['@sublang/playbook'],
    `^${manifest.devDependencies['@sublang/playbook']}`,
  );
  assert.equal(
    installedManifest.dependencies?.['@sublang/playbook'],
    undefined,
  );
  assert.equal(
    installedManifest.optionalDependencies?.['@sublang/playbook'],
    undefined,
  );
  assert.notEqual(
    installedManifest.peerDependenciesMeta?.['@sublang/playbook']?.optional,
    true,
  );
  assert.equal(
    execFileSync(
      process.execPath,
      [join(standalonePackage, 'dist', 'cli.js'), '--version'],
      { cwd: standalone, encoding: 'utf8' },
    ).trim(),
    `slc ${manifest.version}`,
  );
  assert.ok(
    existsSync(join(standalone, 'node_modules', '@sublang', 'playbook')),
    'standalone npm installation must install the required Playbook peer',
  );

  const incompatible = join(scratch, 'incompatible');
  mkdirSync(incompatible);
  writeFileSync(
    join(incompatible, 'package.json'),
    JSON.stringify({
      name: 'slc-incompatible-peer-smoke',
      private: true,
      dependencies: { '@sublang/playbook': '17.11.0' },
    }),
  );
  const conflict = spawnSync('npm', installArgs, {
    cwd: incompatible,
    encoding: 'utf8',
  });
  assert.ifError(conflict.error);
  assert.notEqual(conflict.status, 0, 'incompatible explicit peer must fail');
  assert.match(conflict.stderr, /ERESOLVE/);
  assert.match(conflict.stderr, /peer @sublang\/playbook/);

  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify(
      {
        name: 'slc-package-smoke',
        private: true,
        type: 'module',
        dependencies: {
          '@sublang/playbook': manifest.devDependencies['@sublang/playbook'],
        },
      },
      null,
      2,
    )}\n`,
  );
  execFileSync('npm', installArgs, { cwd: consumer, stdio: 'pipe' });

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
    join(repoRoot, 'demo', 'reference', 'workflow.playbook'),
    join(consumer, 'workflow.playbook'),
    { recursive: true },
  );
  // Completion is an installed, credential-free public path: derive a fresh
  // entry from retained inputs, rather than copying the reference entry.
  const configHome = join(scratch, 'completion-config');
  const completed = execFileSync(
    bin,
    ['playbook', 'workflow.playbook/workflow.text.md', '--complete'],
    {
      cwd: consumer,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: join(scratch, 'completion-home'),
        XDG_CONFIG_HOME: configHome,
        SLC_AGENT: 'unused-unsupported-agent',
      },
    },
  );
  if (
    !completed.trim().split('\n').includes(join(consumer, 'workflow.ts')) ||
    existsSync(join(configHome, 'slc', 'config.yaml'))
  ) {
    throw new Error(
      'installed completion did not emit its entry without seeding configuration',
    );
  }
  // Exercise the quiescent schema-3 consumer lifecycle from the installed
  // project (release-18): import the freshly emitted entry through its
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
      "import assert from 'node:assert/strict';",
      "import { realpathSync } from 'node:fs';",
      "import { createRequire } from 'node:module';",
      "import { dirname, join } from 'node:path';",
      "const slc = await import('@sublang/slc');",
      "await import('@sublang/slc/verify');",
      'const consumerRequire = createRequire(import.meta.url);',
      "const compilerRequire = createRequire(consumerRequire.resolve('@sublang/slc'));",
      "const artifactRequire = createRequire(join(process.cwd(), 'workflow.playbook', 'workflow.playbook.ts'));",
      "const engine = '@sublang/playbook/xstate-runtime';",
      'const enginePath = realpathSync(consumerRequire.resolve(engine));',
      'assert.equal(realpathSync(compilerRequire.resolve(engine)), enginePath);',
      'assert.equal(realpathSync(artifactRequire.resolve(engine)), enginePath);',
      'assert.equal(',
      '  realpathSync(slc.reservedSlcPipelineDir()),',
      "  realpathSync(dirname(consumerRequire.resolve('@sublang/playbook/slc/link.md'))),",
      ');',
      'assert.equal(',
      '  realpathSync(slc.defaultPlaybookLinkTarget()),',
      "  realpathSync(join(dirname(consumerRequire.resolve('@sublang/playbook/runtime')), 'runtime.ts')),",
      ');',
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
      '  { cwd: workdir },',
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
    `package smoke passed: ${manifest.name}@${manifest.version} (${paths.size} files; automatic, shared, and incompatible Playbook peers)`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

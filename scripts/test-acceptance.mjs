// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Opt-in local release acceptance (RELEASE-17, RELEASE-18).
 *
 * Everything else in `release:check` is deterministic and agent-free. This
 * gate is the opposite on purpose: it packs the candidate, installs it into a
 * scratch consumer project, and drives the two things a user actually does —
 * compiling prose with a real coding agent, and running the compiled playbook
 * with real agents — through the *installed* executables.
 *
 * It spends real model calls and takes minutes, so it never runs in CI and is
 * not part of `release:check`. Invoke it deliberately before tagging:
 *
 *   npm run test:acceptance                  # compile, then run what it built
 *   npm run test:acceptance -- --compile-only  # stop after compiling
 *   npm run test:acceptance -- --run-only      # skip the compile and run the
 *                                              # committed reference instead
 *   npm run test:acceptance -- --keep          # also retain a *passing* run's
 *                                              # scratch tree; a failing run
 *                                              # always retains it
 *
 * The compile stage uses the maintainer's own slc agent configuration
 * (`~/.config/slc/config.yaml`, or `SLC_AGENT`/`SLC_MODEL`/`SLC_EFFORT`); the
 * run stage binds every role explicitly — `claude` unless `ACCEPTANCE_PLAYER`
 * / `ACCEPTANCE_CAPTAIN` name `<adapter>[:<model>][@<effort>]` specs — so the
 * maintainer's own `run.*` playbook config never changes what the gate tests.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = new Set(process.argv.slice(2));

const KNOWN_FLAGS = new Set(['--keep', '--compile-only', '--run-only']);

/** Refuses an invocation that would silently test nothing. */
function usage(message) {
  console.error(`test:acceptance: ${message}`);
  console.error(
    'usage: npm run test:acceptance -- [--compile-only | --run-only] [--keep]',
  );
  process.exit(1);
}

for (const arg of args) {
  if (!KNOWN_FLAGS.has(arg)) usage(`unknown option ${arg}`);
}
if (args.has('--compile-only') && args.has('--run-only')) {
  usage('--compile-only and --run-only are mutually exclusive');
}

const keep = args.has('--keep');
const runCompile = !args.has('--run-only');
const runWorkflow = !args.has('--compile-only');

/** The smallest workflow that still exercises normalize → GEARS → FSM → link. */
const MINIMAL_WORKFLOW = `Before work begins, ensure the current directory is the root of its own Git repository; if .git is absent there, initialize a repository there.
Use one agent to carry out the input task.
The agent modifies the code in the current directory as the task requires and commits the result to Git.
`;

const RUN_TASK =
  'There is a bug in the median function in sample.c: the result depends on element order, and even-length arrays are wrong too. Fix it.';

function step(label) {
  process.stdout.write(`\n── ${label}\n`);
}

function ok(label, detail = '') {
  console.log(`  [ok ] ${label}${detail === '' ? '' : ` — ${detail}`}`);
}

function fail(label, detail) {
  throw new Error(`${label}${detail === undefined ? '' : ` — ${detail}`}`);
}

/** The agent bound to any role the maintainer does not override. */
const DEFAULT_AGENT = 'claude';

/** The CLI each cligent adapter shorthand drives. */
const ADAPTER_CLI = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
};

/** The adapter of an `<adapter>[:<model>][@<effort>]` agent spec. */
function specAdapter(spec) {
  return spec.split('@')[0].split(':')[0];
}

/** The spec bound to every required role, overridable per run. */
function playerSpec() {
  return process.env.ACCEPTANCE_PLAYER ?? DEFAULT_AGENT;
}

/** The spec bound to the Captain, overridable per run. */
function captainSpec() {
  return process.env.ACCEPTANCE_CAPTAIN ?? DEFAULT_AGENT;
}

/**
 * The CLIs this run will actually invoke.
 *
 * The gate binds every role explicitly ({@link runStage}), so this is exactly
 * the set the run will invoke — the maintainer's own `run.*` playbook config
 * never participates, and the check cannot ask for an agent the run will not
 * use or miss one it will.
 */
function requiredAgentClis() {
  const adapters = new Set(
    [playerSpec(), captainSpec()].map((spec) => specAdapter(spec)),
  );
  return [...adapters].map((adapter) => {
    const cli = ADAPTER_CLI[adapter];
    if (cli === undefined) {
      fail(
        `unknown agent adapter "${adapter}"`,
        `expected one of ${Object.keys(ADAPTER_CLI).join(', ')}`,
      );
    }
    return cli;
  });
}

/** Fails with an actionable message rather than a confusing downstream error. */
function requirePrerequisites() {
  step('prerequisites');
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
  } catch {
    fail('git is required');
  }
  ok('git');

  if (runCompile) {
    const configured =
      process.env.SLC_AGENT ??
      (existsSync(
        join(
          process.env.XDG_CONFIG_HOME ??
            join(process.env.HOME ?? '', '.config'),
          'slc',
          'config.yaml',
        ),
      )
        ? 'config file'
        : undefined);
    if (configured === undefined) {
      fail(
        'the compile stage needs an slc agent',
        'set SLC_AGENT or create ~/.config/slc/config.yaml',
      );
    }
    ok('slc agent configured', configured);
  }

  for (const cli of runWorkflow ? requiredAgentClis() : []) {
    try {
      execFileSync('sh', ['-c', `command -v ${cli}`], { stdio: 'pipe' });
      ok(`${cli} CLI on PATH`);
    } catch {
      fail(`the run stage needs the ${cli} CLI installed and signed in`);
    }
  }
}

/** Packs the candidate and installs it, plus the playbook host, in a consumer. */
function installCandidate(scratch) {
  step('build, pack, and install the candidate');
  // `dist/` is generated and git-ignored, and packing runs with lifecycle
  // scripts disabled, so nothing else here would produce it: a clean checkout
  // would pack a tarball with no executable, and a stale one would test
  // yesterday's output. Build first so the tarball is always HEAD's.
  execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'pipe' });
  ok('built from the working tree');

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
  const tarball = join(packs, packed[0].filename);
  ok('packed', packed[0].filename);

  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'slc-acceptance', private: true, type: 'module' }, null, 2)}\n`,
  );
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
  ok('installed into a scratch consumer project');
  return consumer;
}

/** Resolves an installed package's bin path without assuming `.bin` linking. */
function installedBin(consumer, pkg, binName) {
  const root = join(consumer, 'node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const bin =
    typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (bin === undefined) fail(`${pkg} declares no ${binName} executable`);
  return join(root, bin);
}

function compileStage(consumer) {
  step('compile a minimal workflow with a real agent');
  const slc = installedBin(consumer, '@sublang/slc', 'slc');
  const source = join(consumer, 'minimal.txt');
  writeFileSync(source, MINIMAL_WORKFLOW);

  const started = Date.now();
  execFileSync(process.execPath, [slc, 'playbook', 'minimal.txt'], {
    cwd: consumer,
    stdio: 'inherit',
  });
  ok(
    'slc playbook exited zero',
    `${Math.round((Date.now() - started) / 1000)}s`,
  );

  const bundle = join(consumer, 'minimal.playbook');
  const entry = join(consumer, 'minimal.ts');
  if (!existsSync(bundle)) fail('compile produced no minimal.playbook/ bundle');
  if (!existsSync(entry)) fail('compile emitted no minimal.ts entry');
  const emitted = readdirSync(bundle);
  for (const required of [
    'minimal.text.md',
    'minimal.gears.md',
    'minimal.fsm.ts',
    'minimal.playbook.ts',
  ]) {
    if (!emitted.includes(required)) fail(`bundle is missing ${required}`);
  }
  ok('bundle and entry emitted', `${emitted.length} files`);

  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      [
        "const entry = (await import('./minimal.ts')).default;",
        "if (typeof entry.createRuntime !== 'function') {",
        "  throw new Error('emitted entry exposes no createRuntime');",
        '}',
      ].join('\n'),
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  ok('freshly compiled entry loads');

  return {
    label: 'freshly compiled',
    basename: 'minimal',
    entry,
    bundle,
  };
}

/** The committed reference set, used when `--run-only` skips the compile. */
function referenceSource() {
  return {
    label: 'committed reference',
    basename: 'workflow',
    entry: join(repoRoot, 'demo', 'reference', 'workflow.ts'),
    bundle: join(repoRoot, 'demo', 'reference', 'workflow.playbook'),
  };
}

/**
 * Runs a compiled playbook over the buggy sample with real agents.
 *
 * `source` names what to run: the artifacts the compile stage just produced
 * (the default, so the gate proves this compiler's own output executes), or
 * the committed reference set when `--run-only` skips the compile.
 */
function runStage(consumer, source) {
  step(`run the ${source.label} playbook with real agents`);
  const playbook = installedBin(consumer, '@sublang/playbook', 'playbook');

  const work = join(consumer, 'run');
  mkdirSync(work);
  cpSync(source.entry, join(work, `${source.basename}.ts`));
  cpSync(source.bundle, join(work, `${source.basename}.playbook`), {
    recursive: true,
  });
  cpSync(join(repoRoot, 'demo', 'sample.c'), join(work, 'sample.c'));

  const roles = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          `const entry = (await import('./${source.basename}.ts')).default;`,
          'process.stdout.write(JSON.stringify(entry.requiredRoleIds ?? []));',
        ].join('\n'),
      ],
      { cwd: work, encoding: 'utf8' },
    ),
  );
  if (roles.length === 0) fail('the entry under test declares no roles');
  ok('entry declares its required roles', roles.join(', '));

  // Bind every role explicitly rather than letting any stay unset: `playbook
  // run` resolves an unset role through the maintainer's own `run.player`,
  // `run.players`, and `run.captain` config before its built-in fallback, so
  // an implicit lineup would make both this run and the prerequisite check
  // depend on a personal file. Flags outrank that config, so the gate is the
  // same on every machine.
  const lineup = [];
  for (const role of roles) {
    lineup.push('--player', `${role}=${playerSpec()}`);
  }
  lineup.push('--captain', captainSpec());
  ok(
    'lineup bound explicitly',
    `players ${playerSpec()}, captain ${captainSpec()}`,
  );

  const started = Date.now();
  const stdout = execFileSync(
    process.execPath,
    [playbook, 'run', `./${source.basename}.ts`, RUN_TASK, ...lineup, '--json'],
    { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  ok(
    'playbook run exited zero',
    `${Math.round((Date.now() - started) / 1000)}s`,
  );

  const envelope = JSON.parse(stdout.slice(stdout.lastIndexOf('\n{') + 1));
  if (envelope.outcome !== 'terminal') {
    fail(
      'run did not reach a terminal outcome',
      JSON.stringify(envelope).slice(0, 200),
    );
  }
  ok('reached the terminal outcome');

  if (!existsSync(join(work, '.git'))) {
    fail('the scripted step did not initialize a repository');
  }
  ok('scripted step initialized the repository agent-free');

  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: work,
    encoding: 'utf8',
  }).trim();
  if (Number(commits) < 1) fail('the loop landed no commit');
  ok('reviewed commits landed', `${commits} commit(s)`);

  // Behavioral proof the loop actually fixed the bug, mirroring the demo
  // checker's median driver rather than trusting the agents' own report.
  const driver = join(consumer, 'driver.c');
  writeFileSync(
    driver,
    [
      '#include <stddef.h>',
      'double median(const double values[], size_t count);',
      'int main(void) {',
      '  const double odd[] = {3, 1, 2};',
      '  const double even[] = {4, 1, 3, 2};',
      '  if (median(odd, 3) != 2.0) return 1;',
      '  if (median(even, 4) != 2.5) return 1;',
      '  return 0;',
      '}',
      '',
    ].join('\n'),
  );
  const binary = join(consumer, 'median-check');
  try {
    execFileSync('cc', ['-o', binary, driver, join(work, 'sample.c')], {
      stdio: 'pipe',
    });
  } catch (error) {
    fail('the repaired sample.c does not compile', String(error).slice(0, 200));
  }
  execFileSync(binary, [], { stdio: 'pipe' });
  ok('median is actually fixed');
}

const scratch = mkdtempSync(join(tmpdir(), 'slc-acceptance-'));
let failed;
try {
  requirePrerequisites();
  const consumer = installCandidate(scratch);
  // Default to running exactly what this compiler just produced; the
  // committed reference is the fallback only when the compile was skipped.
  const compiled = runCompile ? compileStage(consumer) : referenceSource();
  if (runWorkflow) runStage(consumer, compiled);
  console.log(
    `\nacceptance passed (${[runCompile ? 'compile' : null, runWorkflow ? 'run' : null].filter(Boolean).join(' + ')})`,
  );
} catch (error) {
  failed = error;
  console.error(
    `\nacceptance FAILED: ${error instanceof Error ? error.message : error}`,
  );
} finally {
  // A failed run's evidence *is* the scratch tree — the compiled bundle, the
  // agents' commits, the repaired sample — so it is never deleted on failure.
  // A passing run leaves nothing behind unless `--keep` asks it to.
  if (failed !== undefined || keep) {
    console.log(`scratch retained at ${scratch}`);
  } else {
    rmSync(scratch, { recursive: true, force: true });
  }
}
if (failed !== undefined) process.exitCode = 1;

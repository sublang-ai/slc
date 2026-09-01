// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// Reference checker for the committed English and Chinese demo artifacts.
// One checker serves both language flows: `node check.mjs en` validates the
// English set (workflow.*), `node check.mjs zh` the Chinese set
// (workflow.zh.*). Each stage prints its verdict; any failure exits 1.

import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const LANGS = {
  en: { basename: 'workflow', players: ['Coder', 'Reviewer'] },
  zh: { basename: 'workflow.zh', players: ['编码者', '审查者'] },
};

const lang = process.argv[2] ?? 'en';
const profile = LANGS[lang];
if (profile === undefined) {
  console.error(`usage: node check.mjs [${Object.keys(LANGS).join('|')}]`);
  process.exit(1);
}
const { basename, players } = profile;
const bundle = join(here, `${basename}.playbook`);
const entry = join(here, `${basename}.ts`);

// The optimize pass rewrites the Git check into an agent-free script (demo
// READMEs, DR-013): present in the optimized gears and its FSM, absent from the
// raw gears. The pass chooses the shell spelling of the guard - `[ -e .git ]`
// and `test -e .git` are both correct - so match the semantics it must carry,
// a conditional guard around `git init`, rather than one compile's phrasing.
const SCRIPT_PATTERN = /(?:\[ *-e +\.git *\]|test +-e +\.git) *\|\| *git init/;

let failures = 0;

function report(stage, ok, detail = '') {
  console.log(`${ok ? 'ok' : 'FAIL'}: ${stage}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

// Stage 1 — the committed artifact set is complete.
const expected = [
  entry,
  join(bundle, `${basename}.text.md`),
  join(bundle, `${basename}.gears.raw.md`),
  join(bundle, `${basename}.gears.md`),
  join(bundle, `${basename}.fsm.ts`),
  join(bundle, `${basename}.playbook.ts`),
  join(bundle, `${basename}.gears-fsm.test.ts`),
  join(bundle, `${basename}.fsm.introspect.test.ts`),
  join(bundle, `${basename}.prompt-contract.test.ts`),
  join(bundle, `${basename}.fsm.coverage.test.ts`),
  join(bundle, '.slc-verify'),
];
const missing = [];
for (const path of expected) {
  try {
    await access(path);
  } catch {
    missing.push(path);
  }
}
report('artifact set complete', missing.length === 0, missing.join(', '));
if (missing.length > 0) {
  console.error(`\n${failures} failing stage(s) for ${lang}`);
  process.exit(1);
}

// Stage 2 — the entry declares the documented players verbatim, and the
// normalized text declares the same names.
const entrySource = await readFile(entry, 'utf8');
report(
  'entry declares the documented players',
  players.every((player) => entrySource.includes(`'${player}'`)),
  players.join(', '),
);
const text = await readFile(join(bundle, `${basename}.text.md`), 'utf8');
report(
  'normalized text declares the players',
  players.every((player) => text.includes(player)),
);

// Stage 3 — the optimized Git check is the canonical agent-free script,
// byte-identical in gears and FSM, and absent from the raw gears.
const gears = await readFile(join(bundle, `${basename}.gears.md`), 'utf8');
const rawGears = await readFile(
  join(bundle, `${basename}.gears.raw.md`),
  'utf8',
);
const fsm = await readFile(join(bundle, `${basename}.fsm.ts`), 'utf8');
report(
  'optimized gears carries the script item',
  gears
    .split('\n')
    .some((line) => line.startsWith('> ') && SCRIPT_PATTERN.test(line)),
);
report('FSM carries the same script command', SCRIPT_PATTERN.test(fsm));
report('raw gears predates the optimization', !SCRIPT_PATTERN.test(rawGears));

// Stage 4 — import and drive the emitted entry over fake host ports. This
// exercises the same entry/runtime boundary `playbook run` consumes without
// calling real agents: the nested working directory gets its own repository,
// resolved role ids reach the host in their documented form, and a clean
// review reaches the terminal outcome.
const smokeRoot = await mkdtemp(join(tmpdir(), 'slc-demo-smoke-'));
try {
  await execFileAsync('git', ['init', '-q'], { cwd: smokeRoot });
  const workdir = join(smokeRoot, 'nested');
  await mkdir(workdir);
  const loaded = await import(pathToFileURL(entry).href);
  const registryEntry = loaded.default;
  const seenPlayers = [];
  const playerPrompts = [];
  // The linked artifact declares its textual Boss entry event (`entryEvent`),
  // so a fresh Boss turn enters deterministically with the exact task text and
  // spends no judge call; the primed replies are only the per-state result
  // guards — the Coder's single completion guard, then the clean review.
  const judgeReplies = ['{"guard":"done"}', '{"guard":"clean"}'];
  // A schema-3 entry takes configured options plus live host capabilities. The
  // demo smoke supplies a real repository capability so the optimize pass's
  // agent-free `git init` script actually runs against the scratch worktree,
  // and a minimal in-memory effect ledger. Both mirror the engine's contract
  // rather than failing closed, because stage 4 asserts the script's effect.
  // SLC's own host-capability implementation drives the governed script
  // against the scratch worktree, so this smoke exercises real behavior rather
  // than a harness-local reimplementation of the engine contract.
  // SLC's own host-capability implementation drives the governed player
  // boundary against the scratch worktree, so this smoke exercises real
  // behavior rather than a harness-local reimplementation of the engine
  // contract.
  const { worktreeHostCapabilities, observeGitWorktree, classifyGitChange } =
    await import(
      pathToFileURL(join(repoRoot, 'dist/host-capabilities.js')).href
    );
  const gitObserve = (args) =>
    execFileSync('git', args, {
      cwd: workdir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  const runtime = registryEntry.createRuntime(
    { captainOptions: { cwd: workdir } },
    worktreeHostCapabilities({
      playbookId: basename,
      classify: (baseline, after, context) =>
        classifyGitChange({
          baseline,
          after,
          dispositions: context.dispositions,
          run: gitObserve,
        }),
      // A real status-derived projection: an empty one would assert a clean
      // worktree and let an uncommitted change pass as `unchanged`.
      observe: () =>
        observeGitWorktree({
          worktree: workdir,
          gitDir: join(workdir, '.git'),
          run: gitObserve,
        }),
    }),
  );
  const sessionId = randomUUID();
  await runtime.init({
    sessionId,
    playbookId: basename,
    rootSessionId: sessionId,
    depth: 0,
    ports: {
      callPlayer: async (playerId, prompt) => {
        seenPlayers.push(playerId);
        playerPrompts.push(prompt);
        // The Coder's state is governed with a `one-descendant-commit`
        // repository disposition, so the stand-in must actually commit: the
        // boundary this smoke exercises exists to classify that commit, and a
        // player that only returns text leaves the outcome unresolved.
        if (seenPlayers.length === 1) {
          const git = (...args) =>
            execFileSync('git', args, { cwd: workdir, stdio: 'ignore' });
          await writeFile(join(workdir, 'change.txt'), 'demo change\n', 'utf8');
          git('add', '-A');
          git(
            '-c',
            'user.name=Demo Smoke',
            '-c',
            'user.email=smoke@sublang.ai',
            'commit',
            '-m',
            'demo: smoke change',
          );
        }
        return { status: 'ok', finalText: 'done' };
      },
      callCaptain: async () => {
        throw new Error('demo workflow unexpectedly called Captain');
      },
      callJudge: async () => {
        const reply = judgeReplies.shift();
        if (reply === undefined) throw new Error('unexpected judge call');
        return reply;
      },
      callPlaybook: async () => {
        throw new Error('demo workflow unexpectedly called a playbook');
      },
      emitStatus: async () => {},
      emitTelemetry: async () => {},
    },
  });
  const result = await runtime.handleBossInput({
    text: 'smoke task',
    signal: new AbortController().signal,
  });
  await runtime.dispose();
  if (result.outcome !== 'terminal')
    console.error('  DEBUG outcome:', JSON.stringify(result).slice(0, 400));
  report('entry/runtime smoke reaches terminal', result.outcome === 'terminal');
  report(
    'entry maps runtime role ids to documented players',
    JSON.stringify(seenPlayers) === JSON.stringify(players),
    seenPlayers.join(', '),
  );
  // A workflow whose machine never delivers the Boss task to its first
  // player is unusable however cleanly it reaches terminal: the coder would
  // have to ask what the task is. Two zh compiles shipped exactly that —
  // intent gating entry but absent from every prompt — so the smoke pins
  // task delivery, not just termination.
  report(
    'first player prompt carries the Boss task text',
    playerPrompts.length > 0 && playerPrompts[0].includes('smoke task'),
    playerPrompts[0]?.slice(0, 120),
  );
  try {
    await access(join(workdir, '.git'));
    report('script initializes a nested repository root', true);
  } catch {
    report('script initializes a nested repository root', false);
  }
} catch (error) {
  report('entry/runtime smoke', false, String(error));
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}

// Stage 5 — the emitted verification suites pass at the destination.
try {
  await execFileAsync('npx', ['vitest', 'run', bundle], { cwd: repoRoot });
  report('emitted verification suites pass', true);
} catch (error) {
  report(
    'emitted verification suites pass',
    false,
    error.stderr?.split('\n').slice(-8).join('\n') ?? String(error),
  );
}

// Stage 6 — the independent compilation-correctness review has no findings.
try {
  const { stdout } = await execFileAsync(
    'node',
    [join(repoRoot, 'scripts', 'verify-artifacts.mjs'), bundle, basename],
    { cwd: repoRoot },
  );
  report(
    'independent artifact review has no findings',
    stdout.includes('PASS: no findings'),
  );
} catch (error) {
  report(
    'independent artifact review has no findings',
    false,
    error.stdout?.split('\n').slice(-4).join('\n') ?? String(error),
  );
}

if (failures > 0) {
  console.error(`\n${failures} failing stage(s) for ${lang}`);
  process.exit(1);
}
console.log(`\nall stages pass for ${lang}`);

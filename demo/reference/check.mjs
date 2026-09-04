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

// `players` are the display names the READMEs and the normalized text carry;
// `roles` are the canonical lowercase local role ids the compiled machine's
// delegated states name and the emitted entry declares (DR-024). A Chinese
// name has no ASCII lowercase form, so the two coincide there.
const LANGS = {
  en: {
    basename: 'workflow',
    players: ['Coder', 'Reviewer'],
    roles: ['coder', 'reviewer'],
  },
  zh: {
    basename: 'workflow.zh',
    players: ['编码者', '审查者'],
    roles: ['编码者', '审查者'],
  },
};

const lang = process.argv[2] ?? 'en';
const profile = LANGS[lang];
if (profile === undefined) {
  console.error(`usage: node check.mjs [${Object.keys(LANGS).join('|')}]`);
  process.exit(1);
}
const { basename, players, roles } = profile;
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

// Stage 2 — the entry declares the canonical role ids of the documented
// players, and the normalized text declares those players by name.
const entrySource = await readFile(entry, 'utf8');
report(
  'entry declares the canonical role ids',
  roles.every((role) => entrySource.includes(`'${role}'`)),
  roles.join(', '),
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
  // demo smoke constructs them through the installed engine's published
  // `@sublang/playbook/host-capabilities` facade (DR-028; Playbook DR-046) —
  // the same implementation `playbook run` uses — rather than a harness-local
  // copy of the engine contract, so stage 4 exercises real governed behavior:
  // the facade binds the governed worktree lazily, so the nested directory
  // that is not yet a repository observes as the null HEAD, the workflow's own
  // `git init` script classifies as `unchanged`, and the Coder's root commit
  // classifies as `one-descendant-commit`.
  const { createWorktreeHostCapabilities } =
    await import('@sublang/playbook/host-capabilities');
  // Governed boundaries carry the runtime's local role ids, and the entry
  // declares exactly those ids, so the capabilities take them as emitted
  // (self-hosting-15).
  const runtime = registryEntry.createRuntime(
    { captainOptions: { cwd: workdir } },
    await createWorktreeHostCapabilities({
      cwd: workdir,
      playbookId: registryEntry.id,
      requiredRoleIds: registryEntry.requiredRoleIds,
      concurrentRoleSets: registryEntry.concurrentRoleSets,
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
    'entry hands the host its declared role ids',
    JSON.stringify(seenPlayers) === JSON.stringify(roles),
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

// Stage 5 — the installed Playbook host accepts the emitted entry through its
// own registry validation. Stage 4 constructs the runtime directly, so it can
// never see a manifest field only the host reads: an entry advertising a
// `runtimeProfile` the host refuses passed every other stage. `--list` is the
// host's deterministic catalog path — it validates the configuration, loads
// the registry module, and prints the catalog before any readiness, adapter,
// or session work — so this stage spends no model call and needs no adapter
// SDK. `--no-provision` keeps it from writing engine links beside the
// committed artifacts, which resolve the engine from this repository's own
// install. Every home the host resolves points inside the scratch tree, so
// the check reads, writes, and relocates nothing under the invoking user's
// home. The host binds a canonical local role id in any script, so both
// references are listed under their own id and neither language is asserted
// through a refusal.
const PLACEHOLDER_PLAYER = 'reference.player';
const hostRoot = join(repoRoot, 'node_modules', '@sublang', 'playbook');
const hostScratch = await mkdtemp(join(tmpdir(), 'slc-demo-host-'));
try {
  const hostManifest = JSON.parse(
    await readFile(join(hostRoot, 'package.json'), 'utf8'),
  );
  const hostBin = join(
    hostRoot,
    typeof hostManifest.bin === 'string'
      ? hostManifest.bin
      : hostManifest.bin.playbook,
  );
  const homes = {
    SPEX_HOME: join(hostScratch, 'spex-home'),
    XDG_STATE_HOME: join(hostScratch, 'state-home'),
    XDG_CONFIG_HOME: join(hostScratch, 'config-home'),
  };
  const configPath = join(homes.SPEX_HOME, 'playbook', 'playbook.config.yaml');
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    [
      'captain:',
      '  adapter: claude',
      'players:',
      `  ${PLACEHOLDER_PLAYER}:`,
      '    adapter: claude',
      'playbooks:',
      `  ${basename}:`,
      `    from: ${JSON.stringify(entry)}`,
      '    roles:',
      ...roles.map(
        (role) => `      ${JSON.stringify(role)}: ${PLACEHOLDER_PLAYER}`,
      ),
      '',
    ].join('\n'),
    'utf8',
  );
  let listed;
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [hostBin, '--list', '--no-provision'],
      { cwd: hostScratch, env: { ...process.env, ...homes } },
    );
    listed = { ok: true, stdout, stderr: '' };
  } catch (error) {
    listed = {
      ok: false,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error),
    };
  }
  report(
    'installed host validates and lists the entry',
    listed.ok && listed.stdout.includes(`/${basename}  ${basename}  —  `),
    (listed.ok ? listed.stdout : listed.stderr).trim().split('\n')[0],
  );
} catch (error) {
  report('installed host registry validation', false, String(error));
} finally {
  await rm(hostScratch, { recursive: true, force: true });
}

// Stage 6 — the emitted verification suites pass at the destination.
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

// Stage 7 — the independent compilation-correctness review has no findings.
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

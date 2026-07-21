// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
//
// Reference checker for the committed demo artifacts (IR-015).
// One checker serves both language flows: `node check.mjs en` validates the
// English set (workflow.*), `node check.mjs zh` the Chinese set
// (workflow.zh.*). Each stage prints its verdict; any failure exits 1.

import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

// The optimize pass rewrites the Git check into this exact agent-free
// script (demo READMEs, DR-013): present in the optimized gears and its
// FSM, absent from the raw gears.
const SCRIPT_COMMAND = '[ -e .git ] || git init';

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
  gears.includes(`> ${SCRIPT_COMMAND}`),
);
report('FSM carries the same script command', fsm.includes(SCRIPT_COMMAND));
report(
  'raw gears predates the optimization',
  !rawGears.includes(SCRIPT_COMMAND),
);

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
  const judgeReplies = ['{"guard":"done"}', '{"guard":"clean"}'];
  const runtime = registryEntry.createRuntime({
    captainOptions: { cwd: workdir },
  });
  const sessionId = `demo-${lang}-smoke`;
  await runtime.init({
    sessionId,
    playbookId: basename,
    rootSessionId: sessionId,
    depth: 0,
    ports: {
      callPlayer: async (playerId) => {
        seenPlayers.push(playerId);
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
  report('entry/runtime smoke reaches terminal', result.outcome === 'terminal');
  report(
    'entry maps runtime role ids to documented players',
    JSON.stringify(seenPlayers) === JSON.stringify(players),
    seenPlayers.join(', '),
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

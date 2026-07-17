// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Comprehensive acceptance checker for the demo (IR-012).
 *
 * Static stages (always run) validate the compiled playbook:
 *   1. the full artifact set exists (normalized source, raw + optimized
 *      GEARS, FSM, linked runtime, emitted verification bundle);
 *   2. the optimized GEARS carries the agent-free script item with recorded
 *      provenance;
 *   3. the FSM realizes it as a `script` actor state (introspected with slc's
 *      own verifier) and the linked runtime executes it without any agent
 *      port;
 *   4. the script command really performs the non-LLM Git operation:
 *      initializes a bare directory, passes through an existing repository;
 *   5. the emitted verification tests pass.
 *
 * Run-evidence stages (with --run-dir <dir>, produced by demo/run.sh)
 * validate a real two-agent run:
 *   6. the one-shot run reached a terminal outcome (exit code + JSON
 *      envelope);
 *   7. the scripted Git step executed agent-free during the run (status
 *      line), and the loop's states were traversed to `done`;
 *   8. the demo repository ends fixed: commits exist and `node test.js`
 *      passes.
 *
 * Usage: node demo/check.mjs [--run-dir <dir>]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(demoDir, '..');
const artDir = join(demoDir, 'workflow.playbook');

const failures = [];
let checks = 0;
function check(label, ok, detail = '') {
  checks += 1;
  const status = ok ? 'ok ' : 'FAIL';
  console.log(
    `  [${status}] ${label}${ok || detail === '' ? '' : ` — ${detail}`}`,
  );
  if (!ok) failures.push(label);
}

function readArtifact(name) {
  return readFileSync(join(artDir, name), 'utf8');
}

// ---------------------------------------------------------------- stage 1
console.log('1. compiled artifact set');
const expected = [
  'workflow.text.md',
  'workflow.gears.raw.md',
  'workflow.gears.md',
  'workflow.fsm.ts',
  'workflow.playbook.ts',
  'workflow.gears-fsm.test.ts',
  'workflow.fsm.introspect.test.ts',
  'workflow.prompt-contract.test.ts',
  'workflow.fsm.coverage.test.ts',
];
for (const name of expected) {
  check(`artifact ${name}`, existsSync(join(artDir, name)));
}
check(
  'normalized source surfaces the Git precondition',
  /git/i.test(readArtifact('workflow.text.md')),
);

// ---------------------------------------------------------------- stage 2
console.log('2. optimized GEARS');
const gears = readArtifact('workflow.gears.md');
const rawGears = readArtifact('workflow.gears.raw.md');
check('script item present', /Captain shall run\s*:/.test(gears));
check(
  'script item is optimizer-introduced (absent from raw GEARS)',
  !/Captain shall run\s*:/.test(rawGears),
);
check('optimization provenance recorded', /## Optimizations/.test(gears));

// ---------------------------------------------------------------- stage 3
console.log('3. FSM script state and agent-free linkage');
const verify = await import(join(repoRoot, 'dist', 'verify.js'));
const fsm = await verify.loadFsmModule(join(artDir, 'workflow.fsm.ts'));
const machine =
  fsm.default ?? fsm.machine ?? fsm.workflowMachine ?? Object.values(fsm)[0];
const scriptStates = verify.enumerateScriptStates(machine.config);
check('exactly one script state', scriptStates.length === 1);
const scriptState = scriptStates[0] ?? { command: '', stateId: '' };
check(
  'script state runs the Git check/init command',
  /git/.test(scriptState.command),
  scriptState.command,
);
check(
  'script state carries no binding findings',
  (scriptState.bindingFindings ?? []).length === 0,
  (scriptState.bindingFindings ?? []).join('; '),
);
const conformance = verify.checkGearsFsmConformance(gears, machine.config);
check(
  'GEARS↔FSM conformance clean',
  conformance.length === 0,
  conformance.join('; '),
);

// ---------------------------------------------------------------- stage 4
console.log('4. the non-LLM Git operation, standalone');
{
  const bare = mkdtempSync(join(tmpdir(), 'slc-demo-bare-'));
  const ranBare = spawnSync('sh', ['-c', scriptState.command], { cwd: bare });
  check(
    'initializes a non-repository directory (exit 0)',
    ranBare.status === 0,
  );
  check('.git created', existsSync(join(bare, '.git')));
  rmSync(bare, { recursive: true, force: true });

  const repo = mkdtempSync(join(tmpdir(), 'slc-demo-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const ranRepo = spawnSync('sh', ['-c', scriptState.command], { cwd: repo });
  check('passes through an existing repository (exit 0)', ranRepo.status === 0);
  rmSync(repo, { recursive: true, force: true });
}

// ---------------------------------------------------------------- stage 5
console.log('5. emitted verification tests');
{
  const vitest = spawnSync(
    'npx',
    ['vitest', 'run', '--root', repoRoot, 'demo/workflow.playbook'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  check(
    'emitted verification suite passes',
    vitest.status === 0,
    (vitest.stdout + vitest.stderr)
      .split('\n')
      .filter((l) => l.includes('FAIL'))
      .join('; '),
  );
}

// ---------------------------------------------------------- run evidence
const runDirFlag = process.argv.indexOf('--run-dir');
if (runDirFlag !== -1) {
  const runDir = resolve(process.argv[runDirFlag + 1]);

  console.log('6. one-shot run outcome');
  const exitCode = readFileSync(join(runDir, 'run.exit'), 'utf8').trim();
  check(
    'playbook run exited 0 (terminal)',
    exitCode === '0',
    `exit=${exitCode}`,
  );
  const envelope = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  check(
    "JSON envelope outcome is 'terminal'",
    envelope.outcome === 'terminal',
    JSON.stringify(envelope).slice(0, 200),
  );

  console.log('7. run traversal: scripted Git step and the review loop');
  const log = readFileSync(join(runDir, 'run.log'), 'utf8');
  check(
    'scripted step executed agent-free during the run',
    new RegExp(`Executed script for ${scriptState.stateId} \\(exit 0\\)`).test(
      log,
    ),
  );
  const entered = [...log.matchAll(/Entered ([\w$][\w$.]*)/g)].map((m) => m[1]);
  check(
    'workflow states traversed (script → work → review states seen)',
    entered.length >= 3,
    entered.join(' → '),
  );

  console.log('8. repository end-state');
  const commits = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    cwd: runDir,
    encoding: 'utf8',
  }).trim();
  check(
    'at least one commit landed',
    Number(commits) >= 1,
    `commits=${commits}`,
  );
  const fixed = spawnSync(process.execPath, ['test.js'], { cwd: runDir });
  check(
    'the median bug is actually fixed (node test.js passes)',
    fixed.status === 0,
  );
}

console.log(
  `\n${failures.length === 0 ? 'PASS' : 'FAIL'}: ${checks - failures.length}/${checks} checks passed`,
);
if (failures.length > 0) {
  for (const failure of failures) console.error(`  failed: ${failure}`);
  process.exit(1);
}

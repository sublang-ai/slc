// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// Standalone review of a compiled `playbook` artifact directory: runs the four
// DR-009 compilation-correctness checks (conformance incl. Boss-reply coverage,
// introspection summary, prompt contract incl. composition when the linked
// module exposes its composer, and transition coverage) and prints findings.
// The review half of the build-and-review flow (DR-005, DR-007); run
// `npm run build` first.
//
//   node scripts/verify-artifacts.mjs <artifactDir> <basename>

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  capturePromptContract,
  checkFsmCoverage,
  checkGearsFsmConformance,
  checkPromptComposition,
  findMachineConfig,
  loadFsmModule,
  pinIntrospection,
} from '../dist/verify.js';

const [dir, basename] = process.argv.slice(2);
if (!dir || !basename) {
  console.error(
    'usage: node scripts/verify-artifacts.mjs <artifactDir> <basename>',
  );
  process.exit(2);
}
const artifactDir = resolve(dir);
const findings = [];
const section = (title) => console.log(`\n== ${title}`);

const gears = readFileSync(join(artifactDir, `${basename}.gears.md`), 'utf8');
const fsmPath = join(artifactDir, `${basename}.fsm.ts`);
const fsm = await loadFsmModule(fsmPath);
const config = findMachineConfig(fsm);

section('gears↔fsm conformance');
const conformance = checkGearsFsmConformance(gears, config);
findings.push(...conformance.map((f) => `conformance: ${f}`));
console.log(conformance.length === 0 ? 'ok' : conformance.join('\n'));

section('introspection');
const pins = pinIntrospection(config);
console.log(
  `captain states: ${pins.captain.length}; quiescent: ${pins.quiescent
    .map((s) => s.state + (s.final ? '(final)' : ''))
    .join(', ')}; initial: ${pins.initial}`,
);
console.log(
  `root events: ${Object.keys(pins.rootOn).join(', ') || '(none)'}; interrupt targets: ${pins.interruptTargets.length}`,
);
for (const state of pins.captain) {
  console.log(
    `  ${state.state} [${state.sourceItem} -> ${state.player}] results: ${state.resultKeys.join('/')} onDone: ${state.onDone.length} onError: ${state.onError.length}`,
  );
}

section('prompt contract');
const rows = capturePromptContract(config);
for (const row of rows) {
  console.log(
    `  ${row.state}: reads [${row.reads.join(', ')}] placeholders [${row.placeholders.join(', ')}]`,
  );
}
const linkedPath = join(artifactDir, `${basename}.playbook.ts`);
if (existsSync(linkedPath)) {
  try {
    const linked = await loadFsmModule(linkedPath);
    const compose = linked._internal?.composePlayerPrompt;
    if (typeof compose === 'function') {
      const composition = checkPromptComposition({ config, compose });
      findings.push(...composition.map((f) => `composition: ${f}`));
      console.log(
        composition.length === 0 ? 'composition ok' : composition.join('\n'),
      );
    } else {
      console.log('linked module exposes no _internal.composePlayerPrompt');
    }
  } catch (error) {
    findings.push(`linked module failed to import: ${error.message}`);
    console.log(`linked module failed to import: ${error.message}`);
  }
} else {
  console.log('no linked module beside the artifacts');
}

section('transition coverage');
const coverage = await checkFsmCoverage(fsm, {
  sourceText: readFileSync(fsmPath, 'utf8'),
});
findings.push(...coverage.map((f) => `coverage: ${f}`));
console.log(coverage.length === 0 ? 'ok' : coverage.join('\n'));

section('verdict');
if (findings.length === 0) {
  console.log('PASS: no findings');
} else {
  console.log(`FAIL: ${findings.length} finding(s)`);
  process.exit(1);
}

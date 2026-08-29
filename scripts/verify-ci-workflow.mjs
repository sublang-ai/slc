// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// continuous-integration-6: audit the committed push/pull-request quality job
// and the repository inputs that make its gates complete and reproducible.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

const repoRoot = new URL('../', import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, repoRoot), 'utf8');
const [
  workflowSource,
  manifestSource,
  lockSource,
  pinsSource,
  vitestSource,
  equivalenceSource,
  verificationSource,
  coverageSource,
] = await Promise.all([
  readProjectFile('.github/workflows/ci.yml'),
  readProjectFile('package.json'),
  readProjectFile('package-lock.json'),
  readProjectFile('pipelines/playbook/slc.pins.json'),
  readProjectFile('vitest.config.ts'),
  readProjectFile('test/equivalence.acceptance.test.ts'),
  readProjectFile('test/verify.test.ts'),
  readProjectFile('test/verify-coverage.test.ts'),
]);

const workflow = parse(workflowSource);
const manifest = JSON.parse(manifestSource);
const lock = JSON.parse(lockSource);
const pins = JSON.parse(pinsSource);

assert.equal(workflow.on.push, null, 'CI must run on every push');
assert.equal(
  workflow.on.pull_request,
  null,
  'CI must run on every pull request',
);
assert.equal(
  workflow.defaults?.run?.['working-directory'],
  undefined,
  'CI commands must run from the repository root',
);

const quality = workflow.jobs?.quality;
assert.ok(quality, 'CI is missing the quality job');
assert.equal(quality.if, undefined, 'quality must run unconditionally');
assert.equal(
  quality.needs,
  undefined,
  'quality must not depend on a skippable prerequisite job',
);
assert.equal(
  quality['continue-on-error'],
  undefined,
  'quality must fail the workflow',
);
assert.equal(
  quality.defaults?.run?.['working-directory'],
  undefined,
  'quality commands must run from the repository root',
);
assert.equal(quality['runs-on'], 'ubuntu-latest');
assert.ok(
  Number.isInteger(quality['timeout-minutes']) &&
    quality['timeout-minutes'] > 0,
  'quality needs a positive timeout',
);

const steps = quality.steps;
assert.ok(Array.isArray(steps), 'quality has no steps');
const step = (name) => {
  const matches = steps.filter((candidate) => candidate.name === name);
  assert.equal(matches.length, 1, `quality needs exactly one ${name} step`);
  return matches[0];
};

const orderedSteps = [
  'Check out repository',
  'Set up Node.js',
  'Install locked dependencies',
  'Verify CI workflow',
  'Verify vendored Playbook definitions',
  'Verify release workflow',
  'Check formatting',
  'Lint',
  'Build',
  'Test',
  'Verify English demo reference',
  'Review compiled meta-phase artifacts',
  'Verify reproducible current pins',
  'Verify publishable package',
];
assert.equal(
  steps.length,
  orderedSteps.length,
  'quality contains an unaudited step',
);
let previousStep = -1;
for (const name of orderedSteps) {
  const index = steps.findIndex((candidate) => candidate.name === name);
  assert.ok(index > previousStep, `${name} is out of quality-gate order`);
  previousStep = index;

  const candidate = step(name);
  assert.equal(
    candidate['continue-on-error'],
    undefined,
    `${name} must fail the quality job`,
  );
  assert.equal(
    candidate.background,
    undefined,
    `${name} must finish before the next quality gate`,
  );
  assert.equal(candidate.if, undefined, `${name} must run unconditionally`);
  assert.equal(
    candidate['working-directory'],
    undefined,
    `${name} must run from the repository root`,
  );
}

const checkout = step('Check out repository');
assert.equal(checkout.uses, 'actions/checkout@v6');
assert.equal(
  checkout.with,
  undefined,
  'CI checkout must not select a sibling repository or mutable ref',
);

const setup = step('Set up Node.js');
assert.equal(setup.uses, 'actions/setup-node@v6');
assert.deepEqual(setup.with, { 'node-version': 24, cache: 'npm' });
const minimumEngine = manifest.engines?.node?.match(/^>=(\d+)(?:\.(\d+))?$/);
assert.ok(minimumEngine, 'package Node.js engine must be a simple minimum');
const configuredNode = String(setup.with['node-version']).match(
  /^(\d+)(?:\.(\d+))?$/,
);
assert.ok(configuredNode, 'CI Node.js version must be numeric');
const configured = [Number(configuredNode[1]), Number(configuredNode[2] ?? 0)];
const minimum = [Number(minimumEngine[1]), Number(minimumEngine[2] ?? 0)];
assert.ok(
  configured[0] > minimum[0] ||
    (configured[0] === minimum[0] && configured[1] >= minimum[1]),
  'CI Node.js version does not satisfy the package engine',
);

const exactCommands = new Map([
  ['Install locked dependencies', 'npm ci'],
  ['Verify CI workflow', 'node scripts/verify-ci-workflow.mjs'],
  ['Verify vendored Playbook definitions', 'npm run verify:definitions'],
  ['Verify release workflow', 'npm run verify:release'],
  ['Check formatting', 'npm run format:check'],
  ['Lint', 'npm run lint'],
  ['Build', 'npm run build'],
  ['Test', 'npm test'],
  ['Verify English demo reference', 'node demo/reference/check.mjs en'],
  ['Verify publishable package', 'npm run test:package'],
]);
for (const [name, command] of exactCommands) {
  assert.equal(step(name).run, command);
}

assert.deepEqual(
  step('Review compiled meta-phase artifacts')
    .run.trim()
    .split('\n')
    .map((line) => line.trim()),
  [
    'node scripts/verify-artifacts.mjs pipelines/playbook/text2gears.slc text2gears',
    'node scripts/verify-artifacts.mjs pipelines/playbook/gears2fsm.slc gears2fsm',
    'node scripts/verify-artifacts.mjs pipelines/playbook/link.slc link',
  ],
);
assert.deepEqual(
  step('Verify reproducible current pins')
    .run.trim()
    .split('\n')
    .map((line) => line.trim()),
  [
    'node scripts/generate-pins.mjs',
    'git diff --exit-code -- pipelines/playbook/slc.pins.json',
  ],
);

const exactScripts = new Map([
  ['format:check', 'prettier --check .'],
  ['lint', 'eslint .'],
  [
    'build',
    'rm -rf dist && tsc && cp src/normalize.md src/slc.config.template.yaml dist/',
  ],
  ['test', 'vitest run'],
  ['verify:definitions', 'node scripts/verify-playbook-definitions.mjs'],
  ['verify:release', 'node scripts/verify-release-workflow.mjs'],
  ['test:package', 'node scripts/test-package.mjs'],
]);
for (const [name, command] of exactScripts) {
  assert.equal(manifest.scripts[name], command, `${name} is not the full gate`);
}
const excludeBlock = vitestSource.match(/exclude:\s*\[([\s\S]*?)\]/);
assert.ok(excludeBlock, 'Vitest config needs an explicit exclusion list');
const excludeLiterals = [...excludeBlock[1].matchAll(/(['"])(.*?)\1/g)];
const excludeResidue = excludeLiterals
  .reduce((source, match) => source.replace(match[0], ''), excludeBlock[1])
  .replace(/[\s,]/g, '');
assert.equal(
  excludeResidue,
  '',
  'Vitest exclusions must be auditable static string globs',
);
assert.deepEqual(
  excludeLiterals.map((match) => match[2]),
  [
    '**/node_modules/**',
    'dist/**',
    '.scratch/**',
    'demo/workflow.playbook/**',
    'demo/workflow.zh.playbook/**',
  ],
  'Vitest exclusions must keep committed pipeline bundles discoverable',
);
assert.doesNotMatch(
  vitestSource,
  /^\s*(?:root|dir|include|includeSource|namePattern|testNamePattern)\s*:/m,
  'the full suite must not narrow test discovery',
);

const bundles = ['text2gears', 'gears2fsm', 'link'];
const generatedTestSuffixes = [
  'gears-fsm.test.ts',
  'fsm.introspect.test.ts',
  'prompt-contract.test.ts',
  'fsm.coverage.test.ts',
];
const generatedTests = bundles.flatMap((bundle) =>
  generatedTestSuffixes.map(
    (suffix) => `pipelines/playbook/${bundle}.slc/${bundle}.${suffix}`,
  ),
);
const generatedSources = await Promise.all(generatedTests.map(readProjectFile));
const disabledTest =
  /\b(?:describe|suite|it|test)\s*\.\s*(?:skip|skipIf|runIf|todo|only)\b|\b(?:skip|todo)\s*:\s*true/;
const requireActiveTests = (source, label) => {
  assert.doesNotMatch(source, disabledTest, `${label} disables required tests`);
};
for (let index = 0; index < generatedSources.length; index += 1) {
  requireActiveTests(generatedSources[index], generatedTests[index]);
  assert.match(
    generatedSources[index],
    /\bit\s*\(/,
    `${generatedTests[index]} has no executable assertion`,
  );
  assert.match(
    generatedSources[index],
    /\bexpect\s*\(/,
    `${generatedTests[index]} has no executable expectation`,
  );
}

requireActiveTests(equivalenceSource, 'runtime-profile fixture');
requireActiveTests(verificationSource, 'structured-verification fixture');
requireActiveTests(coverageSource, 'structured-coverage fixture');
assert.match(
  equivalenceSource,
  /\['legacy', 'session-v1', 'composed-v2'\] as const/,
  'full-suite runtime-profile coverage is missing',
);
assert.match(
  verificationSource,
  /const structuredConfig = \(\): MachineConfigLike =>/,
  'full-suite structured verification is missing',
);
assert.match(
  coverageSource,
  /two-region structured machine with branch-local Boss-reply waits/i,
  'full-suite structured transition coverage is missing',
);

assert.equal(manifest.dependencies?.['@sublang/playbook'], '^4.0.0');
const lockedPlaybook = lock.packages?.['node_modules/@sublang/playbook'];
assert.equal(lockedPlaybook?.version, '4.0.0');
assert.equal(
  lockedPlaybook.link,
  undefined,
  'Playbook must be a registry package, not a linked sibling',
);
const playbookArchive = new URL(lockedPlaybook.resolved);
assert.equal(playbookArchive.protocol, 'https:');
assert.ok(
  playbookArchive.pathname.endsWith('/playbook-4.0.0.tgz'),
  'Playbook lock does not resolve the 4.0.0 registry archive',
);
assert.match(
  lockedPlaybook.integrity,
  /^sha512-[A-Za-z0-9+/]+={0,2}$/,
  'Playbook registry archive has no SHA-512 integrity',
);
assert.deepEqual(Object.keys(pins.pins).sort(), bundles.slice().sort());
for (const bundle of bundles) {
  const pin = pins.pins[bundle];
  assert.equal(pin.linkTarget?.provenance, '@sublang/playbook@4.0.0');
  assert.ok(
    pin.runtimeDependencies?.some(
      (dependency) => dependency.provenance === '@sublang/playbook@4.0.0',
    ),
    `${bundle} pin is missing Playbook 4.0.0 runtime provenance`,
  );
}

console.log('CI repository contract preserves every required quality gate');

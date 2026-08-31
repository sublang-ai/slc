// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// continuous-integration-6: audit the committed push/pull-request quality job
// and the repository inputs that make its gates complete and reproducible.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
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
  consumerSource,
  configSource,
  compiledExecutorSource,
] = await Promise.all([
  readProjectFile('.github/workflows/ci.yml'),
  readProjectFile('package.json'),
  readProjectFile('package-lock.json'),
  readProjectFile('pipelines/playbook/slc.pins.json'),
  readProjectFile('vitest.config.ts'),
  readProjectFile('test/equivalence.acceptance.test.ts'),
  readProjectFile('test/verify.test.ts'),
  readProjectFile('test/verify-coverage.test.ts'),
  readProjectFile('test/schema-3-consumer.test.ts'),
  readProjectFile('test/config.test.ts'),
  readProjectFile('test/compiled-executor.test.ts'),
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
const handwrittenFixtureTests = [
  'test/equivalence.acceptance.test.ts',
  'test/verify.test.ts',
  'test/verify-coverage.test.ts',
  'test/schema-3-consumer.test.ts',
  'test/config.test.ts',
  'test/compiled-executor.test.ts',
];
const requiredTestFiles = [...generatedTests, ...handwrittenFixtureTests];

const parseTypeScript = (source, filename) =>
  ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
const staticPropertyName = (property, label) => {
  assert.ok(
    ts.isPropertyAssignment(property),
    `${label} must use static property assignments`,
  );
  const name = property.name;
  assert.ok(
    ts.isIdentifier(name) ||
      ts.isStringLiteral(name) ||
      ts.isNoSubstitutionTemplateLiteral(name),
    `${label} has an unauditable property name`,
  );
  return name.text;
};
const staticProperties = (object, label) => {
  const entries = object.properties.map((property) => [
    staticPropertyName(property, label),
    property.initializer,
  ]);
  assert.equal(
    new Set(entries.map(([name]) => name)).size,
    entries.length,
    `${label} has a duplicate property`,
  );
  return new Map(entries);
};

const vitestSyntax = parseTypeScript(vitestSource, 'vitest.config.ts');
const defaultExports = vitestSyntax.statements.filter(ts.isExportAssignment);
assert.equal(
  defaultExports.length,
  1,
  'Vitest config needs one default export',
);
const configCall = defaultExports[0].expression;
assert.ok(
  ts.isCallExpression(configCall) &&
    ts.isIdentifier(configCall.expression) &&
    configCall.expression.text === 'defineConfig',
  'Vitest config must call defineConfig directly',
);
assert.equal(configCall.arguments.length, 1);
const configObject = configCall.arguments[0];
assert.ok(
  ts.isObjectLiteralExpression(configObject),
  'Vitest config must use an auditable object literal',
);
const configProperties = staticProperties(configObject, 'Vitest config');
assert.equal(
  configProperties.get('root'),
  undefined,
  'Vitest root must remain the repository root',
);
const testObject = configProperties.get('test');
assert.ok(
  testObject && ts.isObjectLiteralExpression(testObject),
  'Vitest test config must use an auditable object literal',
);
const testProperties = staticProperties(testObject, 'Vitest test config');
for (const property of [
  'root',
  'dir',
  'include',
  'namePattern',
  'testNamePattern',
  'projects',
  'shard',
  'tagsFilter',
]) {
  assert.equal(
    testProperties.get(property),
    undefined,
    `Vitest test.${property} must not narrow test discovery`,
  );
}
const excludeArray = testProperties.get('exclude');
assert.ok(
  !excludeArray || ts.isArrayLiteralExpression(excludeArray),
  'Vitest exclusions must be an auditable array literal',
);
const exclusions = (excludeArray?.elements ?? []).map((element) => {
  assert.ok(
    ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element),
    'Vitest exclusions must be static string globs',
  );
  assert.doesNotMatch(
    element.text,
    /^!/,
    'Vitest exclusions must not use unauditable negation',
  );
  return element.text;
});
for (const requiredTestFile of requiredTestFiles) {
  const candidates = [
    requiredTestFile,
    `./${requiredTestFile}`,
    fileURLToPath(new URL(requiredTestFile, repoRoot)),
  ];
  const excludingGlob = exclusions.find((glob) =>
    candidates.some((candidate) => matchesGlob(candidate, glob)),
  );
  assert.equal(
    excludingGlob,
    undefined,
    `${requiredTestFile} is excluded from the full suite by ${String(excludingGlob)}`,
  );
}

const allowOnly = testProperties.get('allowOnly');
assert.ok(
  !allowOnly || allowOnly.kind === ts.SyntaxKind.FalseKeyword,
  'Vitest test.allowOnly must not permit focused tests in CI',
);

const generatedSources = await Promise.all(generatedTests.map(readProjectFile));
const disabledTest =
  /\b(?:describe|suite|it|test)\s*\.\s*(?:skip|skipIf|runIf|todo|only)\b|\b(?:skip|todo)\s*:\s*true/;
const requireActiveTests = (source, label) => {
  assert.doesNotMatch(source, disabledTest, `${label} disables required tests`);
};
const testCalls = (syntax) => {
  const matches = [];
  const collect = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['it', 'test'].includes(node.expression.text)
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(syntax);
  return matches;
};
const conditionalRegistration = (node) =>
  ts.isIfStatement(node) ||
  ts.isConditionalExpression(node) ||
  ts.isForStatement(node) ||
  ts.isForInStatement(node) ||
  ts.isForOfStatement(node) ||
  ts.isWhileStatement(node) ||
  ts.isDoStatement(node) ||
  ts.isSwitchStatement(node) ||
  (ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind));
const requireActiveTestCall = (testCall, label) => {
  assert.ok(
    [2, 3].includes(testCall.arguments.length),
    `${label} test must use an auditable callback`,
  );
  const title = testCall.arguments[0];
  assert.ok(
    ts.isStringLiteralLike(title),
    `${label} test needs a static title`,
  );
  const callback = testCall.arguments[1];
  assert.ok(
    ts.isArrowFunction(callback) || ts.isFunctionExpression(callback),
    `${label} test has no auditable implementation: ${title.text}`,
  );
  assert.equal(
    callback.parameters.length,
    0,
    `${label} test must not accept a runtime skip context: ${title.text}`,
  );

  let hasExpectation = false;
  const findExpectation = (node) => {
    if (
      node !== callback &&
      (ts.isFunctionLike(node) ||
        ts.isIfStatement(node) ||
        ts.isConditionalExpression(node) ||
        ts.isSwitchStatement(node) ||
        (ts.isBinaryExpression(node) &&
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(node.operatorToken.kind)))
    ) {
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'expect'
    ) {
      hasExpectation = true;
    }
    ts.forEachChild(node, findExpectation);
  };
  findExpectation(callback);
  assert.ok(hasExpectation, `${label} test has no expectation: ${title.text}`);

  for (let ancestor = testCall.parent; ancestor; ancestor = ancestor.parent) {
    assert.ok(
      !conditionalRegistration(ancestor),
      `${label} test is conditionally registered: ${title.text}`,
    );
    if (ts.isArrowFunction(ancestor) || ts.isFunctionExpression(ancestor)) {
      const suiteCall = ancestor.parent;
      assert.ok(
        ts.isCallExpression(suiteCall) &&
          ts.isIdentifier(suiteCall.expression) &&
          ['describe', 'suite'].includes(suiteCall.expression.text) &&
          suiteCall.arguments.length === 2 &&
          suiteCall.arguments[1] === ancestor &&
          ts.isStringLiteralLike(suiteCall.arguments[0]),
        `${label} test must belong to an active static suite: ${title.text}`,
      );
    }
  }
};
for (let index = 0; index < generatedSources.length; index += 1) {
  const label = generatedTests[index];
  const source = generatedSources[index];
  requireActiveTests(source, label);
  const calls = testCalls(parseTypeScript(source, label));
  assert.ok(calls.length > 0, `${label} has no executable assertion`);
  for (const call of calls) requireActiveTestCall(call, label);
}

const requireTestCase = (source, label, title) => {
  const syntax = parseTypeScript(source, label);
  const matches = testCalls(syntax).filter(
    (testCall) =>
      ts.isStringLiteralLike(testCall.arguments[0]) &&
      testCall.arguments[0].text === title,
  );
  assert.equal(matches.length, 1, `${label} must retain active test: ${title}`);
  requireActiveTestCall(matches[0], label);
};
for (const title of [
  'accepts each matching exact runtime contract profile',
  'distinguishes unmarked legacy and session-v1 init boundaries',
  'supplies the exact six-port composed-v2 probe boundary',
  'recognizes shared and bespoke composed-v3 registries',
  'initializes but does not drive a role-bearing composed-v3 registry',
  'compares matching nonempty validated schema-3 option slices',
]) {
  requireTestCase(equivalenceSource, 'runtime-profile fixture', title);
}
for (const title of [
  'maps nested parallel captain work and a playbook actor',
  'adds recursive topology and playbook bindings only for a structured machine',
  'captures prompt contracts from nested parallel leaves',
  'validates schema-3 Roles and concurrent role sets',
  'accepts a controller decision state without needsBossReply',
  'resolves schema-3 prompt identity through the canonical role',
]) {
  requireTestCase(verificationSource, 'structured-verification fixture', title);
}
requireTestCase(
  coverageSource,
  'structured-coverage fixture',
  'drives explicit player leaves by entering their parallel parent',
);
for (const title of [
  'rejects a repeated canonical role in a parallel group',
  'drives every controller action without a Boss-reply wait',
]) {
  requireTestCase(coverageSource, 'schema-3 coverage fixture', title);
}
for (const title of [
  'exposes canonical roles, concurrency, immutable compat, and empty options (self-hosting-14, self-hosting-15, self-hosting-16)',
  'initializes and disposes a causal root against exact live capabilities without governed effects (release-18)',
  'plans configured-registry slash-command invocation without positional or removed run inputs (self-hosting-14, release-18)',
]) {
  requireTestCase(consumerSource, 'schema-3 consumer fixture', title);
}
requireTestCase(
  configSource,
  'provenance-selection fixture',
  'binds compiled execution to the pin-recorded runtime contract',
);
requireTestCase(
  compiledExecutorSource,
  'composed-v3 phase-host fixture',
  'constructs and drives the exact roleless composed-v3 phase-host boundary',
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

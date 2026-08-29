// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

const repoRoot = new URL('../', import.meta.url);
const readProjectFile = (path) => readFile(new URL(path, repoRoot), 'utf8');
const [workflowSource, manifestSource, changelog, acceptanceSource] =
  await Promise.all([
    readProjectFile('.github/workflows/release.yml'),
    readProjectFile('package.json'),
    readProjectFile('CHANGELOG.md'),
    readProjectFile('scripts/test-acceptance.mjs'),
  ]);
const workflow = parse(workflowSource);
const manifest = JSON.parse(manifestSource);
const releaseJob = workflow.jobs.release;
const steps = releaseJob.steps;
const jobs = Object.values(workflow.jobs);
const allSteps = jobs.flatMap((job) => job.steps ?? []);
const registryCredential =
  /(?:NODE_AUTH_TOKEN|NPM_(?:BOOTSTRAP_)?TOKEN|_authToken|npm_config_.*auth)/i;
const coreSemver = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;

const step = (name) => {
  const match = steps.find((candidate) => candidate.name === name);
  assert.ok(match, `release workflow is missing the ${name} step`);
  return match;
};

const orderedSteps = [
  'Check out repository',
  'Set up Node.js',
  'Verify tag matches package version',
  'Require passing CI for this commit',
  'Upgrade npm for trusted publishing',
  'Install locked dependencies',
  'Run release checks',
  'Extract release notes',
  'Detect an already published version',
  'Publish to npm with trusted OIDC',
  'Skip the already published version',
  'Create GitHub release',
];
let previousStep = -1;
for (const name of orderedSteps) {
  const index = steps.findIndex((candidate) => candidate.name === name);
  assert.ok(index > previousStep, `${name} is out of release-process order`);
  previousStep = index;
}

// The repository version and changelog are one current SemVer release unit
// (release-1, release-3, release-4, release-5).
assert.match(manifest.version, coreSemver);
assert.match(
  changelog,
  /\[Keep a Changelog\]\(https:\/\/keepachangelog\.com\/en\/1\.1\.0\/\)/,
);
assert.match(
  changelog,
  /\[Semantic Versioning\]\(https:\/\/semver\.org\/spec\/v2\.0\.0\.html\)/,
);

const changelogSections = [
  ...changelog.matchAll(
    /^## \[(Unreleased|(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\](?: - (\d{4}-\d{2}-\d{2}))?$/gm,
  ),
];
assert.ok(changelogSections.length >= 2, 'changelog has no released version');
assert.equal(changelogSections[0][1], 'Unreleased');
assert.equal(changelogSections[0][2], undefined);
assert.equal(changelogSections[1][1], manifest.version);
assert.match(changelogSections[1][2] ?? '', /^\d{4}-\d{2}-\d{2}$/);

const sectionBody = (index) => {
  const section = changelogSections[index];
  const next = changelogSections[index + 1];
  return changelog.slice(
    section.index + section[0].length,
    next?.index ?? changelog.length,
  );
};
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(sectionBody(0).trim(), '', 'Unreleased must be empty for a tag');
}

const changelogGroups = [
  'Added',
  'Changed',
  'Deprecated',
  'Removed',
  'Fixed',
  'Security',
];
for (let index = 0; index < changelogSections.length; index += 1) {
  const body = sectionBody(index);
  const groups = [...body.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
  assert.ok(
    groups.length > 0 || (index === 0 && body.trim() === ''),
    `${changelogSections[index][1]} has no change groups`,
  );
  let priorGroup = -1;
  for (const group of groups) {
    const groupIndex = changelogGroups.indexOf(group);
    assert.notEqual(groupIndex, -1, `unsupported changelog group ${group}`);
    assert.ok(
      groupIndex > priorGroup,
      `${changelogSections[index][1]} changelog groups are out of order`,
    );
    priorGroup = groupIndex;
  }
}

const comparisonLinks = new Map(
  [...changelog.matchAll(/^\[([^\]]+)\]: (\S+)$/gm)].map((match) => [
    match[1],
    match[2],
  ]),
);
const repositoryUrl = 'https://github.com/sublang-ai/slc';
assert.equal(
  comparisonLinks.get('Unreleased'),
  `${repositoryUrl}/compare/v${manifest.version}...HEAD`,
);
for (let index = 1; index < changelogSections.length; index += 1) {
  const version = changelogSections[index][1];
  const priorVersion = changelogSections[index + 1]?.[1];
  assert.equal(
    comparisonLinks.get(version),
    priorVersion === undefined
      ? `${repositoryUrl}/releases/tag/v${version}`
      : `${repositoryUrl}/compare/v${priorVersion}...v${version}`,
  );
}

// A tag is the only release trigger, and the workflow validates and processes
// it through the complete release path (release-6, release-7).
assert.deepEqual(workflow.on.push.tags, ['v[0-9]*']);
const tagCheck = step('Verify tag matches package version');
assert.ok(tagCheck.run.includes('^v[0-9]+\\.[0-9]+\\.[0-9]+$'));
assert.match(tagCheck.run, /require\('\.\/package\.json'\)\.version/);
assert.match(tagCheck.run, /GITHUB_REF_NAME/);

const ciGate = step('Require passing CI for this commit');
assert.match(ciGate.run, /actions\/workflows\/ci\.yml\/runs/);
assert.match(ciGate.run, /head_sha=\$\{SHA\}/);
assert.match(ciGate.run, /event=push/);
assert.match(ciGate.run, /branch=main/);
const pollLoop = ciGate.run.match(
  /for attempt in \$\(seq 1 ([1-9][0-9]*)\); do\n([\s\S]*?)\n\s*done/,
);
assert.ok(pollLoop, 'CI gate needs a bounded poll loop');
const [, pollBound, pollBody] = pollLoop;
assert.match(
  pollBody,
  /if \[ "\$conclusion" = "success" \]; then\s+echo "CI passed for \$\{SHA\}\."\s+break\s+fi\s+echo "::error::CI concluded '\$\{conclusion\}' for \$\{SHA\}"\s+exit 1/,
);
const timeoutGuard = pollBody.match(
  /if \[ "\$attempt" = ([1-9][0-9]*) \]; then([\s\S]*?)\n\s*fi/,
);
assert.ok(timeoutGuard, 'CI gate needs a fail-closed timeout');
assert.equal(
  timeoutGuard[1],
  pollBound,
  'CI poll and timeout bounds must match',
);
assert.match(timeoutGuard[2], /^\s*exit 1\s*$/m);
assert.equal(step('Install locked dependencies').run, 'npm ci');
assert.equal(step('Run release checks').run, 'npm run release:check');

const notes = step('Extract release notes');
assert.match(notes.run, /GITHUB_REF_NAME#v/);
assert.ok(notes.run.includes('awk -v ver="$VERSION"'));
assert.ok(notes.run.includes('$0 == "## [" ver "]"'));
assert.ok(notes.run.includes('index($0, "## [" ver "] -")'));
assert.ok(notes.run.includes('/^## \\[/ { if (found) exit;'));
assert.ok(notes.run.includes('found { print }'));
assert.match(notes.run, /CHANGELOG\.md/);
assert.match(notes.run, /> \/tmp\/release-notes\.md/);
assert.ok(notes.run.includes("grep -q '[^[:space:]]' /tmp/release-notes.md"));
const notesGuard = notes.run.match(
  /if ! \[ -s \/tmp\/release-notes\.md \][\s\S]*?; then([\s\S]*?)\n\s*fi/,
);
assert.ok(notesGuard, 'release notes need a nonempty-output guard');
assert.match(notesGuard[1], /\bexit 1\b/);

// Manual and tag publication share one complete credential-free gate, while
// a compiler-changing release can invoke the separate live acceptance entry
// (release-12, release-13, release-19).
assert.equal(manifest.scripts.prepublishOnly, 'npm run release:check');
const releaseChecks = manifest.scripts['release:check'].split(' && ');
const requiredReleaseChecks = [
  'npm run format:check',
  'npm run lint',
  'npm run build',
  'npm test',
  'npm run verify:definitions',
  'npm run verify:release',
  'npm run verify:artifacts',
  'npm run verify:pins',
  'npm run verify:demo',
  'npm run test:package',
];
let priorReleaseCheck = -1;
for (const required of requiredReleaseChecks) {
  const index = releaseChecks.indexOf(required, priorReleaseCheck + 1);
  assert.ok(
    index > priorReleaseCheck,
    `${required} is missing or out of order`,
  );
  priorReleaseCheck = index;
}
assert.equal(
  manifest.scripts['test:acceptance'],
  'node scripts/test-acceptance.mjs',
);
assert.doesNotMatch(manifest.scripts['release:check'], /test:acceptance/);
assert.match(acceptanceSource, /npm run test:acceptance/);
assert.deepEqual(manifest.scripts.build.split(' && ').slice(0, 2), [
  'rm -rf dist',
  'tsc',
]);

assert.equal(workflow.permissions['id-token'], 'write');
assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), registryCredential);

// Publication is trusted OIDC only (release-8): the detection step decides
// idempotently whether the tagged version still needs publishing, and no
// static registry credential exists anywhere in the workflow.
const detection = step('Detect an already published version');
assert.equal(detection.id, 'npm_version');
assert.match(detection.run, /npm view/);
assert.match(detection.run, /E404/);
assert.match(detection.run, /::error::/);

const trusted = step('Publish to npm with trusted OIDC');
assert.equal(trusted.if, "steps.npm_version.outputs.published == 'false'");
assert.equal(
  trusted.run,
  'npm publish --ignore-scripts --provenance --access public',
);
assert.equal(trusted.env, undefined);

const skip = step('Skip the already published version');
assert.equal(skip.if, "steps.npm_version.outputs.published == 'true'");
assert.doesNotMatch(skip.run ?? '', /npm publish/);

const githubRelease = step('Create GitHub release');
assert.match(
  githubRelease.run,
  /if gh release view[\s\S]+?then[\s\S]+?else\s+gh release create/,
);
assert.match(githubRelease.run, /--notes-file \/tmp\/release-notes\.md/);

const githubCreateSteps = allSteps.flatMap((candidate) =>
  [...(candidate.run ?? '').matchAll(/(?:^|\n)\s*gh release create\b/g)].map(
    () => candidate.name,
  ),
);
assert.deepEqual(
  githubCreateSteps,
  ['Create GitHub release'],
  'only the guarded GitHub release step may create a release',
);

const serialized = JSON.stringify(workflow);
assert.equal(
  serialized.match(/\$\{\{\s*secrets\./g),
  null,
  'the release workflow must reference no Actions secrets',
);

const publishSteps = allSteps.flatMap((candidate) =>
  [...(candidate.run ?? '').matchAll(/(?:^|\n)\s*npm publish\b/g)].map(
    () => candidate.name,
  ),
);
assert.deepEqual(
  publishSteps,
  ['Publish to npm with trusted OIDC'],
  'only the trusted step may publish',
);

for (const job of jobs) {
  assert.doesNotMatch(JSON.stringify(job.env ?? {}), registryCredential);
}

for (const candidate of allSteps) {
  assert.doesNotMatch(
    JSON.stringify(candidate),
    registryCredential,
    `${candidate.name} must not receive static registry credentials`,
  );
}

console.log('release repository contract preserves trusted-only publication');

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parse } from 'yaml';

const workflowPath = new URL(
  '../.github/workflows/release.yml',
  import.meta.url,
);
const workflow = parse(await readFile(workflowPath, 'utf8'));
const releaseJob = workflow.jobs.release;
const steps = releaseJob.steps;
const jobs = Object.values(workflow.jobs);
const allSteps = jobs.flatMap((job) => job.steps ?? []);
const registryCredential =
  /(?:NODE_AUTH_TOKEN|NPM_(?:BOOTSTRAP_)?TOKEN|_authToken|npm_config_.*auth)/i;

const step = (name) => {
  const match = steps.find((candidate) => candidate.name === name);
  assert.ok(match, `release workflow is missing the ${name} step`);
  return match;
};

assert.equal(workflow.permissions['id-token'], 'write');
assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), registryCredential);

// Publication is trusted OIDC only (RELEASE-8): the detection step decides
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

console.log('release workflow preserves trusted-only publication');

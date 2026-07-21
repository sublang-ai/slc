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

const detection = step('Detect first npm publication');
assert.equal(detection.id, 'npm_package');
assert.match(detection.run, /npm view/);
assert.match(detection.run, /E404/);

const trusted = step('Publish to npm with trusted OIDC');
assert.equal(trusted.if, "steps.npm_package.outputs.exists == 'true'");
assert.equal(
  trusted.run,
  'npm publish --ignore-scripts --provenance --access public',
);
assert.equal(trusted.env, undefined);

const bootstrap = step('Bootstrap the first npm publication');
assert.equal(bootstrap.if, "steps.npm_package.outputs.exists == 'false'");
assert.equal(
  bootstrap.env.NODE_AUTH_TOKEN,
  '${{ secrets.NPM_BOOTSTRAP_TOKEN }}',
);
assert.match(bootstrap.run, /NPM_BOOTSTRAP_TOKEN with bypass 2FA/);
assert.match(
  bootstrap.run,
  /npm publish --ignore-scripts --provenance --access public/,
);

const serialized = JSON.stringify(workflow);
assert.equal(
  serialized.match(/\$\{\{\s*secrets\./g)?.length,
  1,
  "the bootstrap step must contain the workflow's only Actions secret",
);

const publishSteps = allSteps.flatMap((candidate) =>
  [...(candidate.run ?? '').matchAll(/(?:^|\n)\s*npm publish\b/g)].map(
    () => candidate.name,
  ),
);
assert.deepEqual(
  publishSteps,
  ['Publish to npm with trusted OIDC', 'Bootstrap the first npm publication'],
  'only the trusted and bootstrap steps may publish',
);

for (const job of jobs) {
  assert.doesNotMatch(JSON.stringify(job.env ?? {}), registryCredential);
}

for (const candidate of allSteps) {
  if (candidate === bootstrap) continue;
  assert.doesNotMatch(
    JSON.stringify(candidate),
    registryCredential,
    `${candidate.name} must not receive static registry credentials`,
  );
}

console.log('release workflow preserves trusted/bootstrap publication');

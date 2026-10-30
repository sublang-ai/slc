// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// continuous-integration-4 / self-hosting-11: prove that the definitions
// vendored for compiled pin selection carry the locked Playbook release's
// normative content byte-identically. The expected release is the one the
// dependency lock resolves — adopting a release raises the manifest and lock,
// re-synchronizes the definitions, and needs no edit here (DR-028). SLC-owned
// pin-input declarations live in the slc.pin-inputs.json sidecar (DR-026),
// not inside the definitions.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipelineDir = join(repoRoot, 'pipelines', 'playbook');
const definitions = ['text2gears', 'gears2fsm', 'link', 'optimize', 'prefix'];

const rootPackage = readJson(join(repoRoot, 'package.json'));
const lock = readJson(join(repoRoot, 'package-lock.json'));
const declaredPlaybook = rootPackage.devDependencies?.['@sublang/playbook'];
const playbookPeer = rootPackage.peerDependencies?.['@sublang/playbook'];
const lockedPlaybook =
  lock.packages?.['node_modules/@sublang/playbook']?.version;
const declaredCligent = rootPackage.dependencies?.['@sublang/cligent'];
const cligentFloor = /^\^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  .exec(typeof declaredCligent === 'string' ? declaredCligent : '')
  ?.slice(1)
  .map(Number);
if (
  !cligentFloor ||
  (cligentFloor[0] === 0 &&
    (cligentFloor[1] < 36 || (cligentFloor[1] === 36 && cligentFloor[2] < 1)))
) {
  throw new Error(
    `cannot verify definitions: @sublang/cligent must declare a caret minimum of at least 0.36.1 (declared ${String(declaredCligent)})`,
  );
}

if (
  typeof lockedPlaybook !== 'string' ||
  !/^\d+\.\d+\.\d+$/.test(lockedPlaybook) ||
  declaredPlaybook !== lockedPlaybook ||
  playbookPeer !== `^${lockedPlaybook}` ||
  rootPackage.dependencies?.['@sublang/playbook'] !== undefined ||
  rootPackage.optionalDependencies?.['@sublang/playbook'] !== undefined ||
  rootPackage.peerDependenciesMeta?.['@sublang/playbook']?.optional === true
) {
  throw new Error(
    `cannot verify definitions: @sublang/playbook must have an exact development release matching the lock and only its required caret peer for consumers (development ${String(declaredPlaybook)}, peer ${String(playbookPeer)}, locked ${String(lockedPlaybook)})`,
  );
}
const expectedPlaybookVersion = lockedPlaybook;

const firstDefinitionPath = fileURLToPath(
  import.meta.resolve('@sublang/playbook/slc/text2gears.md'),
);
const playbookRoot = dirname(dirname(firstDefinitionPath));
const installedPlaybook = readJson(join(playbookRoot, 'package.json'));
if (installedPlaybook.version !== expectedPlaybookVersion) {
  throw new Error(
    `cannot verify definitions: installed @sublang/playbook is ${String(installedPlaybook.version)}, expected the locked ${expectedPlaybookVersion}`,
  );
}

let failed = false;
const publishedInputs = readJson(
  join(playbookRoot, 'slc', 'slc.pin-inputs.json'),
);
const localInputs = readJson(join(pipelineDir, 'slc.pin-inputs.json'));
const files = new Set([
  ...definitions.map((name) => `${name}.md`),
  ...Object.values(publishedInputs.closures).flat(),
]);
for (const filename of files) {
  const upstream = readFileSync(join(playbookRoot, 'slc', filename), 'utf8');
  const vendored = readFileSync(join(pipelineDir, filename), 'utf8');
  if (vendored === upstream) {
    console.log(
      `${filename}: matches @sublang/playbook@${expectedPlaybookVersion}`,
    );
  } else {
    failed = true;
    console.error(
      `${filename}: differs from installed @sublang/playbook@${expectedPlaybookVersion}${firstDifference(upstream, vendored)}`,
    );
  }
}

for (const [phase, inputs] of Object.entries(publishedInputs.closures)) {
  const local = new Set(
    (localInputs.closures[phase] ?? []).map((input) =>
      resolve(pipelineDir, input),
    ),
  );
  for (const input of inputs) {
    if (!local.has(resolve(pipelineDir, input))) {
      failed = true;
      console.error(`${phase}: missing vendored semantic input ${input}`);
    }
  }
}

if (failed) process.exitCode = 1;

function firstDifference(expected, actual) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const count = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < count; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return ` at line ${index + 1} (expected ${JSON.stringify(expectedLines[index] ?? '<end of file>')}, received ${JSON.stringify(actualLines[index] ?? '<end of file>')})`;
    }
  }
  return '';
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

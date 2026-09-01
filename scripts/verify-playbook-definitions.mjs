// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// continuous-integration-4 / self-hosting-11: prove that the definitions
// vendored for compiled pin selection carry the immutable Playbook 10.0.0
// normative content byte-identically. SLC-owned pin-input declarations live
// in the slc.pin-inputs.json sidecar (DR-026), not inside the definitions.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedPlaybookVersion = '10.0.0';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipelineDir = join(repoRoot, 'pipelines', 'playbook');
const definitions = ['text2gears', 'gears2fsm', 'link', 'optimize'];

const rootPackage = readJson(join(repoRoot, 'package.json'));
const lock = readJson(join(repoRoot, 'package-lock.json'));
const declaredPlaybook = rootPackage.dependencies?.['@sublang/playbook'];
const lockedPlaybook =
  lock.packages?.['node_modules/@sublang/playbook']?.version;

if (
  declaredPlaybook !== `^${expectedPlaybookVersion}` ||
  lockedPlaybook !== expectedPlaybookVersion
) {
  throw new Error(
    `cannot verify definitions: @sublang/playbook must be declared as ^${expectedPlaybookVersion} and locked to ${expectedPlaybookVersion} (declared ${String(declaredPlaybook)}, locked ${String(lockedPlaybook)})`,
  );
}

const firstDefinitionPath = fileURLToPath(
  import.meta.resolve('@sublang/playbook/slc/text2gears.md'),
);
const playbookRoot = dirname(dirname(firstDefinitionPath));
const installedPlaybook = readJson(join(playbookRoot, 'package.json'));
if (installedPlaybook.version !== expectedPlaybookVersion) {
  throw new Error(
    `cannot verify definitions: installed @sublang/playbook is ${String(installedPlaybook.version)}, expected ${expectedPlaybookVersion}`,
  );
}

let failed = false;
for (const name of definitions) {
  const filename = `${name}.md`;
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

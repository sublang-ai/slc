// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// CI-4 / SELFHOST-11: prove that the definitions vendored for compiled pin
// selection carry the immutable Playbook 2.0.0 normative content. SLC adds
// only its explicit Pin Inputs, whose exact lists are part of the pin closure.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedPlaybookVersion = '2.0.0';
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipelineDir = join(repoRoot, 'pipelines', 'playbook');

const pinInputs = {
  text2gears: [
    '../../node_modules/@sublang/spex/scaffold/specs/meta.md',
    '../../node_modules/@sublang/spex/scaffold/i18n/zh/specs/meta.md',
    '../../package-lock.json',
  ],
  gears2fsm: ['text2gears.md', 'link.md', '../../package-lock.json'],
  link: ['text2gears.md', 'gears2fsm.md', '../../package-lock.json'],
  optimize: ['text2gears.md', 'gears2fsm.md', '../../package-lock.json'],
};

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
for (const [name, expectedInputs] of Object.entries(pinInputs)) {
  const filename = `${name}.md`;
  const upstreamPath = join(playbookRoot, 'slc', filename);
  const vendoredPath = join(pipelineDir, filename);
  const upstream = readFileSync(upstreamPath, 'utf8');
  const vendored = readFileSync(vendoredPath, 'utf8');

  try {
    const { normative, inputs } = withoutPinInputs(vendored, vendoredPath);
    const expectedSection = `${expectedInputs.map((input) => `- \`${input}\``).join('\n')}\n`;
    if (inputs !== expectedSection) {
      throw new Error(
        `unexpected Pin Inputs${firstDifference(expectedSection, inputs)}`,
      );
    }
    if (normative !== upstream) {
      throw new Error(
        `normative content differs from installed @sublang/playbook@${expectedPlaybookVersion}${firstDifference(upstream, normative)}`,
      );
    }
    console.log(
      `${filename}: matches @sublang/playbook@${expectedPlaybookVersion}`,
    );
  } catch (error) {
    failed = true;
    console.error(`${filename}: ${errorMessage(error)}`);
  }
}

if (failed) process.exitCode = 1;

function withoutPinInputs(source, path) {
  const marker = '\n## Pin Inputs\n\n';
  const sectionStart = source.indexOf(marker);
  if (sectionStart === -1) {
    throw new Error(`missing one explicit ## Pin Inputs section in ${path}`);
  }
  if (source.indexOf(marker, sectionStart + marker.length) !== -1) {
    throw new Error(`multiple ## Pin Inputs sections in ${path}`);
  }

  const sectionEnd = source.indexOf('\n## ', sectionStart + marker.length);
  if (sectionEnd === -1) {
    throw new Error(`## Pin Inputs must precede another level-two section`);
  }

  return {
    inputs: source.slice(sectionStart + marker.length, sectionEnd),
    normative: source.slice(0, sectionStart) + source.slice(sectionEnd),
  };
}

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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

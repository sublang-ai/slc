// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// The explicit build-and-review pin step (PIN-15; DR-005, DR-007): after the
// compiled meta-phase artifacts under pipelines/playbook/<phase>.slc/ are
// built and reviewed, this records pipelines/playbook/slc.pins.json pinning
// the playbook pipeline's phases (and the reserved link) to them, then
// re-validates that every pin reads back current. Run `npm run build` first.
//
//   node scripts/generate-pins.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

import { evaluatePins } from '../dist/pin-currency.js';
import { generatePinRecord, writePinFile } from '../dist/pin-generate.js';
import { resolveRuntimePackage } from '../dist/runtime-package.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipelineDir = join(repoRoot, 'pipelines', 'playbook');
// The artifacts are linked against the installed runtime contract, which sits
// outside the pipeline directory; the recorded boundary widens to the repo
// root so its identity can be pinned (PIN-15).
const boundary = { boundary: '../..' };

const expectedPlaybookVersion = '0.9.0';
const expectedXstateVersion = '5.32.4';
const rootPackage = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf8'),
);
const lock = JSON.parse(
  readFileSync(join(repoRoot, 'package-lock.json'), 'utf8'),
);
const declaredPlaybook = rootPackage.dependencies?.['@sublang/playbook'];
const lockedPlaybook =
  lock.packages?.['node_modules/@sublang/playbook']?.version;
const declaredXstate = rootPackage.dependencies?.xstate;
const lockedXstate = lock.packages?.['node_modules/xstate']?.version;
if (
  declaredPlaybook !== `^${expectedPlaybookVersion}` ||
  lockedPlaybook !== expectedPlaybookVersion
) {
  throw new Error(
    `refusing to generate pins: @sublang/playbook must be declared as ^${expectedPlaybookVersion} and locked to ${expectedPlaybookVersion} (declared ${String(declaredPlaybook)}, locked ${String(lockedPlaybook)})`,
  );
}
if (
  declaredXstate !== `^${expectedXstateVersion}` ||
  lockedXstate !== expectedXstateVersion
) {
  throw new Error(
    `refusing to generate pins: xstate must be declared as ^${expectedXstateVersion} and locked to ${expectedXstateVersion} (declared ${String(declaredXstate)}, locked ${String(lockedXstate)})`,
  );
}

const pins = {};
for (const phase of ['text2gears', 'gears2fsm', 'link']) {
  const artifact = `${phase}.slc/${phase}.playbook.ts`;
  const artifactPath = join(pipelineDir, artifact);
  const playbookPackage = resolveRuntimePackage(
    artifactPath,
    '@sublang/playbook/runtime',
  );
  const xstatePackage = resolveRuntimePackage(artifactPath, 'xstate');
  if (playbookPackage.version !== lockedPlaybook) {
    throw new Error(
      `refusing to generate ${phase} pin: resolved @sublang/playbook ${playbookPackage.version} differs from lock ${String(lockedPlaybook)}`,
    );
  }
  if (xstatePackage.version !== lockedXstate) {
    throw new Error(
      `refusing to generate ${phase} pin: resolved xstate ${xstatePackage.version} differs from lock ${String(lockedXstate)}`,
    );
  }
  const playbookRuntime = join(playbookPackage.root, 'src', 'runtime.ts');
  pins[phase] = await generatePinRecord(
    pipelineDir,
    {
      definition: `${phase}.md`,
      artifact,
      artifactBundle: `${phase}.slc`,
      linkTarget: {
        kind: 'file',
        locator: toPosix(relative(pipelineDir, playbookRuntime)),
        provenance: `@sublang/playbook@${playbookPackage.version}`,
      },
      runtimeDependencies: [
        {
          kind: 'package',
          locator: toPosix(relative(pipelineDir, xstatePackage.root)),
          provenance: `xstate@${xstatePackage.version}`,
          specifier: 'xstate',
        },
      ],
      producer: { pipeline: 'slc' },
    },
    boundary,
  );
}

const path = await writePinFile(pipelineDir, pins, boundary);
console.log(`wrote ${path}`);

const result = await evaluatePins(pipelineDir);
let ok = true;
for (const [phase, verdict] of Object.entries(result.verdicts ?? {})) {
  console.log(
    `${phase}: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`,
  );
  if (verdict.status !== 'current') ok = false;
}
if (!ok || result.malformed) {
  console.error(result.malformed ?? 'generated pins are not current');
  process.exit(1);
}

function toPosix(path) {
  return path.split(sep).join('/');
}

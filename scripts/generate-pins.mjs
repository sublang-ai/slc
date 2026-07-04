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
import { join } from 'node:path';

import { evaluatePins } from '../dist/pin-currency.js';
import { generatePinRecord, writePinFile } from '../dist/pin-generate.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipelineDir = join(repoRoot, 'pipelines', 'playbook');
// The artifacts are linked against the installed runtime contract, which sits
// outside the pipeline directory; the recorded boundary widens to the repo
// root so its identity can be pinned (PIN-15).
const boundary = { boundary: '../..' };

const playbookVersion = JSON.parse(
  readFileSync(
    join(repoRoot, 'node_modules/@sublang/playbook/package.json'),
    'utf8',
  ),
).version;

const pins = {};
for (const phase of ['text2gears', 'gears2fsm', 'link']) {
  pins[phase] = await generatePinRecord(
    pipelineDir,
    {
      definition: `${phase}.md`,
      artifact: `${phase}.slc/${phase}.playbook.ts`,
      linkTarget: {
        kind: 'file',
        locator: '../../node_modules/@sublang/playbook/src/runtime.ts',
        provenance: `@sublang/playbook@${playbookVersion}`,
      },
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
  console.log(`${phase}: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`);
  if (verdict.status !== 'current') ok = false;
}
if (!ok || result.malformed) {
  console.error(result.malformed ?? 'generated pins are not current');
  process.exit(1);
}

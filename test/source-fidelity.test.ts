// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PhaseExecutor } from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
  type AgentRunRequest,
} from '../src/interpreter.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const textToGears = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | text | .md |
| target | gears | .md |
`;

const SOURCE = `Coder carries out the work.

At the start of the phase, Captain shall relay the following instruction:

\`\`\`markdown
Do the work exactly as authored.
\`\`\`
`;

const CONSERVANT = `# case: Fixture

### CASE-1

When the phase starts, Captain shall prompt Coder:

> Do the work exactly as authored.
`;

const INVENTED = `${CONSERVANT}> Also do something the Source never asked for.
`;

const INVENTED_FINDING =
  'CASE-1: prompt line is not an authored fragment: "Also do something the Source never asked for."';

describe('text-to-GEARS Source-fidelity gate (phase-execution-51, phase-execution-52)', () => {
  let root: string;
  let pipelineDir: string;
  let workDir: string;
  let source: string;
  let target: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-source-fidelity-'));
    pipelineDir = join(root, 'pipeline');
    workDir = join(root, 'work');
    await mkdir(pipelineDir);
    await mkdir(workDir);
    await writeFile(join(pipelineDir, 'text2gears.md'), textToGears);
    source = join(workDir, 'case.md');
    await writeFile(source, SOURCE);
    target = join(workDir, 'case.flow', 'case.gears.md');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor, reference = 'flow'): SlcDeps => ({
    resolver: (name) => (name === reference ? [pipelineDir] : []),
    executor,
    cwd: workDir,
  });

  /** A phase executor that writes one fixed artifact and reports success. */
  const writing = (content: string): PhaseExecutor => ({
    async run(request) {
      if (request.kind !== 'compile')
        throw new Error('unexpected link request');
      await writeFile(request.target, content);
      return { status: 'ok', diagnostics: [] };
    },
  });

  it('fails an unreviewed phase closed with the findings as its diagnostic', async () => {
    const result = await runSlc(['flow', source], deps(writing(INVENTED)));

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain(
      `slc: phase "text2gears" failed at "${target}"`,
    );
    expect(result.diagnostics.join('\n')).toContain(INVENTED_FINDING);
    // The gate reports; it does not repair or delete the rejected artifact.
    expect(await readFile(target, 'utf8')).toBe(INVENTED);
  });

  it('accepts a target that conserves every authored fragment', async () => {
    const result = await runSlc(['flow', source], deps(writing(CONSERVANT)));

    expect(result).toMatchObject({ ok: true, outputs: [target] });
  });

  it('leaves the reserved slc meta-pipeline ungated', async () => {
    const metaTarget = join(workDir, 'case.slc', 'case.gears.md');
    const result = await runSlc(
      ['slc', source],
      deps(writing(INVENTED), 'slc'),
    );

    expect(result).toMatchObject({ ok: true, outputs: [metaTarget] });
  });

  it('relays a finding to the Coder in place of the Reviewer call, then reviews the repair', async () => {
    const writes = [INVENTED, CONSERVANT];
    const coderCalls: AgentRunRequest[] = [];
    const coder: AgentClient = {
      async run(request) {
        coderCalls.push(request);
        const content = writes.shift();
        if (content === undefined) throw new Error('unexpected Coder call');
        await writeFile(target, content);
        return coderCalls.length === 1
          ? { status: 'success', text: 'wrote the gears' }
          : {
              status: 'success',
              text: JSON.stringify({
                dispositions: [
                  {
                    finding: 1,
                    decision: 'accept',
                    reason: 'dropped the invented line',
                  },
                ],
                result: 'conserved the gears',
              }),
            };
      },
    };
    const reviewerCalls: AgentRunRequest[] = [];
    const reviewer: AgentClient = {
      async run(request) {
        reviewerCalls.push(request);
        return { status: 'success', text: 'NO_FINDINGS' };
      },
    };
    const executor = createInterpretedExecutor({
      agent: createReviewingAgent({ coder, reviewer: () => reviewer }),
    });

    const result = await runSlc(['flow', source], deps(executor));

    expect(result).toMatchObject({ ok: true, outputs: [target] });
    expect(coderCalls).toHaveLength(2);
    expect(coderCalls[1].prompt).toContain(`FINDINGS:\n1. ${INVENTED_FINDING}`);
    // The Reviewer judged only the repaired artifact.
    expect(reviewerCalls).toHaveLength(1);
    expect(await readFile(target, 'utf8')).toBe(CONSERVANT);
  });
});

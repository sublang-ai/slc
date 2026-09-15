// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { PhaseExecutor } from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
  type AgentRunRequest,
} from '../src/interpreter.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';
import { runSlc } from '../src/runner.js';
import {
  checkGearsActorContract,
  checkGearsFsmConformance,
  checkGearsResultContract,
  parseGearsItems,
} from '../src/verify.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const advice =
  'use exact `Captain shall call playbook ...:` and preserve sequencing in When/While or continuation prose';
const kdavz2Malformed = `# dev

### DEV-5

When the planning result is code via pull request or decide then code via pull request, Captain shall first call playbook \`branch\`:

> Prepare the branch.
`;
const canonical = `# dev

### DEV-5

When the planning result is code via pull request or decide then code via pull request, Captain shall call playbook \`branch\`:

> Prepare the branch.
`;

const pipelineFormats = (source: string, target: string, extension: string) =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${source} | ${extension} |\n| target | ${target} | ${target === 'fsm' ? '.ts' : '.md'} |\n`;

function fsmSource(): string {
  return `import { createMachine } from 'xstate';
export const machine = createMachine({
  initial: 'callBranch',
  states: {
    callBranch: {
      tags: 'playbook.suspended',
      meta: { playbook: { stateId: 'callBranch' } },
      invoke: {
        src: 'playbook',
        input: () => ({ stateId: 'callBranch', sourceItem: 'DEV-5', playbookId: 'branch', text: 'Prepare the branch.' }),
        onDone: 'done',
        onError: 'failed',
      },
    },
    failed: { tags: 'playbook.parked', meta: { playbook: { stateId: 'failed' } }, on: {BOSS_REPLY: {target: 'callBranch', guard: ({event}) => typeof event.answer === 'string' && event.answer.trim() !== ''}} },
    done: { type: 'final', meta: { playbook: { stateId: 'done', description: 'The branch is prepared.', terminal: 'success' } } },
  },
});
`;
}

describe('GEARS actor contract diagnostics', () => {
  it('reports the actual Kdavz2 DEV-5 near miss without changing parser classification', () => {
    expect(checkGearsActorContract(kdavz2Malformed)).toEqual([
      `GEARS item DEV-5: "Captain shall first call playbook" is not a valid nested-playbook acting clause; ${advice}`,
    ]);
    expect(checkGearsResultContract(kdavz2Malformed)).toEqual([]);
    expect(parseGearsItems(kdavz2Malformed)[0]).toMatchObject({
      id: 'DEV-5',
      actor: 'captain',
      player: 'Captain',
    });
    expect(parseGearsItems(kdavz2Malformed)[0]).not.toHaveProperty(
      'playbookId',
    );
  });

  it('covers all four literal and dynamic near-miss words while accepting controls', () => {
    const malformed = ['first', 'then', 'next', 'finally']
      .flatMap((word, index) => [
        `### LIT-${index}\nWhen ready, Captain shall ${word} call playbook \`review\`:\n\n> Review it.`,
        `### DYN-${index}\nWhen ready, Captain shall ${word} call playbook selected by \`nextPlaybookId\`:\n\n> <nextPlaybookInput>`,
      ])
      .join('\n\n');
    const findings = checkGearsActorContract(malformed);
    expect(findings).toHaveLength(8);
    for (const word of ['first', 'then', 'next', 'finally']) {
      expect(findings.join('\n')).toContain(
        `Captain shall ${word} call playbook`,
      );
    }

    const controls = `# controls

### CANON-LITERAL
When ready, Captain shall call playbook \`review\`:

> Review it.

### CANON-DYNAMIC
When ready, Captain shall call playbook selected by \`nextPlaybookId\`:

> <nextPlaybookInput>

### DIRECT-CAPTAIN
When ready, Captain shall first inspect the plan:

> Inspect the plan.

### QUOTED-LITERAL
When ready, Captain shall prompt Coder:

> Write the literal words Captain shall first call playbook \`review\`.

### RESULT-PROSE
When ready, Captain shall inspect the plan:

> Inspect the plan.

Results:
- \`done\`: The prose says Captain shall first call playbook in a control result description.
`;
    expect(checkGearsActorContract(controls)).toEqual([]);
  });

  it('includes the actor diagnostic in GEARS-FSM conformance', () => {
    expect(
      checkGearsFsmConformance(kdavz2Malformed, {
        initial: 'work',
        states: {
          work: {
            meta: { playbook: { stateId: 'work' } },
            invoke: {
              src: 'captain',
              input: {
                stateId: 'work',
                sourceItem: 'DEV-5',
                prompt: 'Prepare the branch.',
                result: { needsBossReply: 'Output shall include `question`.' },
              },
              onDone: 'done',
              onError: 'failed',
            },
          },
          failed: { tags: 'playbook.parked' },
          done: { type: 'final' },
        },
      }).join('\n'),
    ).toContain(advice);
  });

  it('rejects supplied malformed GEARS before executor work and preserves the source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-gears-actor-source-'));
    try {
      await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
      const pipeline = join(root, 'pipeline');
      await mkdir(pipeline);
      await writeFile(
        join(pipeline, 'gears2fsm.md'),
        pipelineFormats('gears', 'fsm', '.md'),
      );
      const source = join(root, 'dev.gears.md');
      await writeFile(source, kdavz2Malformed);
      let calls = 0;
      const executor: PhaseExecutor = {
        async run() {
          calls += 1;
          throw new Error('executor must not run');
        },
      };

      const result = await runSlc(['flow.gears2fsm', source], {
        cwd: root,
        resolver: () => [pipeline],
        executor,
      });

      expect(result.ok).toBe(false);
      expect(calls).toBe(0);
      expect(result.diagnostics.join('\n')).toContain(advice);
      expect(await readFile(source, 'utf8')).toBe(kdavz2Malformed);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('repairs a produced malformed actor clause with the same Coder before the consumer phase executes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-gears-actor-producer-'));
    try {
      await symlink(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
      const pipeline = join(root, 'pipeline');
      await mkdir(pipeline);
      await writeFile(
        join(pipeline, 'text2gears.md'),
        pipelineFormats('text', 'gears', '.md'),
      );
      await writeFile(
        join(pipeline, 'gears2fsm.md'),
        pipelineFormats('gears', 'fsm', '.md'),
      );
      const source = join(root, 'dev.md');
      await writeFile(
        source,
        'The DEV workflow prepares a branch through a nested playbook.\n',
      );
      const gearsTarget = join(root, 'dev.slc', 'dev.gears.md');
      const fsmTarget = join(root, 'dev.slc', 'dev.fsm.ts');
      const calls: AgentRunRequest[] = [];
      const coder: AgentClient = {
        async run(request) {
          calls.push(request);
          if (calls.length === 1) {
            await writeFile(gearsTarget, kdavz2Malformed);
            return { status: 'success', text: 'wrote malformed GEARS' };
          }
          if (request.prompt.includes('FINDINGS:')) {
            await writeFile(gearsTarget, canonical);
            return {
              status: 'success',
              text: JSON.stringify({
                dispositions: [
                  {
                    finding: 1,
                    decision: 'accept',
                    reason: 'used the canonical nested playbook clause',
                  },
                ],
                result: 'corrected GEARS',
              }),
            };
          }
          await writeFile(fsmTarget, fsmSource());
          return { status: 'success', text: 'wrote FSM' };
        },
      };

      const result = await runSlc(['slc', source], {
        cwd: root,
        resolver: (name) => (name === 'slc' ? [pipeline] : []),
        executor: createInterpretedExecutor({
          agent: createReviewingAgent({ coder }),
        }),
        noBuildHistory: true,
      });

      expect(result.ok, result.diagnostics.join('\n')).toBe(true);
      expect(calls).toHaveLength(3);
      expect(calls[1].prompt).toContain(advice);
      expect(await readFile(source, 'utf8')).toBe(
        'The DEV workflow prepares a branch through a nested playbook.\n',
      );
      expect(await readFile(gearsTarget, 'utf8')).toBe(canonical);
      expect(await readFile(fsmTarget, 'utf8')).toBe(fsmSource());
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});

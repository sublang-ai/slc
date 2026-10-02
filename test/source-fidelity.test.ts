// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCompiledExecutor } from '../src/compiled-executor.js';
import type { PhaseExecutor } from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
  type AgentRunRequest,
} from '../src/interpreter.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import { checkSourceGearsContract } from '../src/verify-source.js';

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

  describe.each([
    {
      language: 'English',
      narrative:
        'After implementation, Coder verifies the committed product without changing files.',
      derived:
        'Verify the whole committed product and report the actual result.\nChange no file.',
      literal:
        'Release the verified archive locally.\nRecord the exact rollback identity.',
      extra: 'Publish it to an unrelated service.',
    },
    {
      language: 'Chinese',
      narrative: '实现完成后，Coder 验证已提交的产品，不修改文件。',
      derived: '验证完整的已提交产品并报告实际结果。\n不要修改任何文件。',
      literal: '在本地部署已验证的归档。\n记录准确的回滚标识。',
      extra: '发布到无关的服务。',
    },
  ])(
    '$language mixed narrative/literal Source (DR-055)',
    ({ narrative, derived, literal, extra }) => {
      const mixedSource = `${narrative}\n\nReleaseOwner follows this complete instruction:\n\n\`\`\`markdown\n${literal}\n\`\`\`\n`;
      const mixedGears = `# case: Fixture\n\n### CASE-1\n\nWhen implementation finishes, Captain shall prompt Coder:\n\n${derived
        .split('\n')
        .map((line) => `> ${line}`)
        .join(
          '\n',
        )}\n\n### CASE-2\n\nWhen verification succeeds, Captain shall prompt ReleaseOwner:\n\n${literal
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')}\n`;

      it('accepts narrative-derived instructions beside the unchanged complete literal', async () => {
        await writeFile(source, mixedSource);
        let calls = 0;
        const executor = writing(mixedGears);
        const result = await runSlc(
          ['flow', source],
          deps({
            async run(request, signal) {
              calls++;
              return executor.run(request, signal);
            },
          }),
        );

        expect(result).toMatchObject({ ok: true, outputs: [target] });
        expect(calls).toBe(1);
        expect(await readFile(source, 'utf8')).toBe(mixedSource);
        expect(await readFile(target, 'utf8')).toBe(mixedGears);
      });

      it('refuses a foreign line added to the item carrying the complete literal', async () => {
        await writeFile(source, mixedSource);
        const changed = `${mixedGears}> ${extra}\n`;
        const result = await runSlc(['flow', source], deps(writing(changed)));

        expect(result.ok).toBe(false);
        expect(result.diagnostics.join('\n')).toContain(
          `CASE-2: prompt line is not an authored fragment: ${JSON.stringify(extra)}`,
        );
        expect(await readFile(source, 'utf8')).toBe(mixedSource);
        expect(await readFile(target, 'utf8')).toBe(changed);
      });

      it('refuses a changed complete literal even when its item becomes fragment-free', async () => {
        await writeFile(source, mixedSource);
        const changed = mixedGears.replace(literal.split('\n')[0], extra);
        const result = await runSlc(['flow', source], deps(writing(changed)));

        expect(result.ok).toBe(false);
        expect(result.diagnostics.join('\n')).toContain(
          'source instruction fragment at line 5 was dropped or changed',
        );
        expect(result.diagnostics.join('\n')).not.toContain(
          'prompt line is not an authored fragment',
        );
        expect(await readFile(source, 'utf8')).toBe(mixedSource);
        expect(await readFile(target, 'utf8')).toBe(changed);
      });
    },
  );

  it('leaves the reserved slc meta-pipeline ungated', async () => {
    const metaTarget = join(workDir, 'case.slc', 'case.gears.md');
    const result = await runSlc(
      ['slc', source],
      deps(writing(INVENTED), 'slc'),
    );

    expect(result).toMatchObject({ ok: true, outputs: [metaTarget] });
  });

  /** A Coder that writes the queued artifacts, correcting on the second call. */
  const queuedCoder = (
    writes: string[],
    calls: AgentRunRequest[],
    artifact: string,
  ): AgentClient => ({
    async run(request) {
      calls.push(request);
      const content = writes.shift();
      if (content === undefined) throw new Error('unexpected Coder call');
      await writeFile(artifact, content);
      return calls.length === 1
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
  });

  const cleanReviewer = (calls: AgentRunRequest[]): AgentClient => ({
    async run(request) {
      calls.push(request);
      return { status: 'success', text: 'NO_FINDINGS' };
    },
  });

  it('relays a finding to the Coder in place of the Reviewer call, then reviews the repair', async () => {
    const coderCalls: AgentRunRequest[] = [];
    const reviewerCalls: AgentRunRequest[] = [];
    const reviewer = cleanReviewer(reviewerCalls);
    const executor = createInterpretedExecutor({
      agent: createReviewingAgent({
        coder: queuedCoder([INVENTED, CONSERVANT], coderCalls, target),
        reviewer: () => reviewer,
      }),
    });

    const result = await runSlc(['flow', source], deps(executor));

    expect(result).toMatchObject({ ok: true, outputs: [target] });
    expect(coderCalls).toHaveLength(2);
    expect(coderCalls[1].prompt).toContain(`FINDINGS:\n1. ${INVENTED_FINDING}`);
    // The Reviewer judged only the repaired artifact.
    expect(reviewerCalls).toHaveLength(1);
    expect(await readFile(target, 'utf8')).toBe(CONSERVANT);
  });

  it.each([false, true])(
    'relays a finding through a compiled performing Captain call (independent Reviewer=%s)',
    async (reviewed) => {
      const compiledTarget = join(workDir, 'compiled.gears.md');
      const definitionPath = join(pipelineDir, 'text2gears.md');
      const state = {
        value: 'done',
        activeStateIds: ['done'],
        tags: [],
        status: 'done',
        quiescent: true,
        stateId: 'done',
      };
      // A roleless schema-3 artifact performs through one direct Captain call:
      // the same call the reviewed transport wraps in production.
      let ports: {
        callCaptain: (
          prompt: string,
          signal: AbortSignal,
          options: { visibility: 'visible'; resume: false },
        ) => Promise<{ status: string; finalText?: string; error?: string }>;
      };
      const factory = () => ({
        async init(session: { ports: typeof ports }) {
          ports = session.ports;
        },
        async handleBossInput({
          signal,
        }: {
          text: string;
          signal: AbortSignal;
        }) {
          const captain = await ports.callCaptain(
            'Compile the Source into GEARS.',
            signal,
            { visibility: 'visible', resume: false },
          );
          return captain.status === 'ok'
            ? { outcome: 'terminal', state, stateDescription: 'compiled' }
            : { outcome: 'failed', state, error: captain.error };
        },
        async dispose() {},
      });
      Object.defineProperty(factory, 'compat', {
        value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
        enumerable: true,
        writable: false,
        configurable: false,
      });

      const coderCalls: AgentRunRequest[] = [];
      const reviewerCalls: AgentRunRequest[] = [];
      const reviewer = cleanReviewer(reviewerCalls);
      const captainTransport = createReviewingAgent({
        coder: queuedCoder([INVENTED, CONSERVANT], coderCalls, compiledTarget),
        ...(reviewed ? { reviewer: () => reviewer } : {}),
      });
      const executor = createCompiledExecutor({
        artifactPath: 'ignored',
        runRoot: workDir,
        runtimeContract: 'composed-v3',
        player: captainTransport,
        judge: captainTransport,
        loadFactory: async () => factory as never,
      });

      const result = await executor.run(
        {
          kind: 'compile',
          definitionPath,
          source,
          target: compiledTarget,
          mechanicalReview: async () =>
            checkSourceGearsContract(
              await readFile(source, 'utf8'),
              await readFile(compiledTarget, 'utf8'),
            ),
        },
        new AbortController().signal,
      );

      expect(result.status).toBe('ok');
      expect(coderCalls).toHaveLength(2);
      expect(coderCalls[1].prompt).toContain(
        `FINDINGS:\n1. ${INVENTED_FINDING}`,
      );
      expect(reviewerCalls).toHaveLength(reviewed ? 1 : 0);
      expect(await readFile(compiledTarget, 'utf8')).toBe(CONSERVANT);
    },
  );
});

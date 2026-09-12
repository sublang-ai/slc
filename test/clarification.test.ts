// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { run } from '../src/app.js';
import { loadBuildHistory } from '../src/build-history.js';
import { createCompiledExecutor } from '../src/compiled-executor.js';
import { runPhase, type ExecuteRequest } from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
  type AgentRunRequest,
} from '../src/interpreter.js';
import type {
  CompatiblePlaybookPorts,
  CompatiblePlaybookRuntimeFactory,
} from '../src/playbook-contract.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const questions = [
  {
    id: 'recipient',
    question: 'Who should receive the result?',
    reason: 'Delivery cannot be compiled without a recipient.',
    evidence: 'The source says "Send the result" but names no recipient.',
    choices: ['The requester', 'The team'],
  },
];
const report = `CLARIFICATION: ${JSON.stringify({ questions })}`;
const formats = (
  name: string,
  from: string,
  to: string,
  ext = '.md',
) => `# Phase ${name}

## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${from} | .md |
| target | ${to} | ${ext} |
`;
const link = `${formats('link', 'final', 'run', '.ts')}
## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | A runtime module. |
`;

describe('stateless source clarification integration (clarification-9, clarification-10)', () => {
  let root: string;
  let pipeline: string;
  let source: string;
  let definition: string;
  let target: string;
  let request: ExecuteRequest;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-clarification-'));
    pipeline = join(root, 'pipeline');
    await mkdir(pipeline);
    definition = join(pipeline, 'text2middle.md');
    source = join(root, 'case.md');
    target = join(root, 'target.md');
    await writeFile(definition, formats('text2middle', 'text', 'middle'));
    await writeFile(
      join(pipeline, 'middle2final.md'),
      formats('middle2final', 'middle', 'final'),
    );
    await writeFile(join(pipeline, 'link.md'), link);
    await writeFile(join(root, 'runtime.ts'), 'export {};');
    await writeFile(source, 'Send the result. MISSING recipient.');
    request = { kind: 'compile', definitionPath: definition, source, target };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (agent: AgentClient): SlcDeps => ({
    cwd: root,
    resolver: () => [pipeline],
    executor: createInterpretedExecutor({ agent, config: { cwd: root } }),
  });

  it.each(['normalize', 'text2middle', 'middle2final', 'link'])(
    'stops at %s, reports the original source, and compiles after editing it',
    async (stoppingPhase) => {
      if (stoppingPhase === 'normalize') {
        source = join(root, 'case.txt');
        await writeFile(source, 'Send the result. MISSING recipient.');
      }
      const calls: string[] = [];
      const agent: AgentClient = {
        async run({ prompt }) {
          const phase = prompt.match(/^# Phase (\S+)/m)?.[1] ?? 'normalize';
          calls.push(phase);
          expect(prompt).toContain(
            'Source clarification (noninteractive compiler protocol)',
          );
          const input =
            prompt.match(/^- source to read: (.+)$/m)?.[1] ??
            prompt.match(/^- object artifacts to read, in order: (.+)$/m)![1];
          const output = prompt.match(/^- artifact to write: (.+)$/m)![1];
          const text = await readFile(input, 'utf8');
          if (phase === stoppingPhase && text.includes('MISSING')) {
            // Work begun before discovering the question remains inspectable,
            // but must never count as an accepted output or activate history.
            await writeFile(output, 'unaccepted draft');
            return {
              status: 'success',
              text: `I found an unresolved choice.\n${report}`,
            };
          }
          await writeFile(output, text);
          return { status: 'success', text: 'complete' };
        },
      };
      const args = ['flow', source, '--link', join(root, 'runtime.ts')];
      const result = await runSlc(args, deps(agent));
      expect(result).toMatchObject({
        ok: false,
        outcome: 'clarification-required',
        clarification: {
          schema: 'sublang.slc.clarification.v1',
          phase: stoppingPhase,
          sources: [source],
          questions,
        },
      });
      expect(calls.at(-1)).toBe(stoppingPhase);
      expect(result.outputs).not.toContain(result.clarification!.target);
      expect(result.diagnostics.join('\n')).toContain(
        'Then run the same command again.',
      );
      expect(result.diagnostics.join('\n')).not.toContain('resume from');
      expect(await readFile(source, 'utf8')).toContain('MISSING');
      const artDir = join(root, 'case.flow');
      expect(await loadBuildHistory(artDir)).toBeNull();
      expect(
        (await readdir(artDir)).some((file) =>
          /clarification|pending|answers/.test(file),
        ),
      ).toBe(false);

      await writeFile(source, 'Send the result to the requester.');
      calls.length = 0;
      const completed = await runSlc(args, deps(agent));
      expect(completed.ok).toBe(true);
      expect(completed.clarification).toBeUndefined();
      expect(calls).toEqual(
        stoppingPhase === 'normalize'
          ? ['normalize', 'text2middle', 'middle2final', 'link']
          : ['text2middle', 'middle2final', 'link'],
      );
      expect(await loadBuildHistory(artDir)).not.toBeNull();
    },
  );

  it('writes human and JSON diagnostics to stderr with exit 2 and no stdout', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(['flow', source], {
      cwd: root,
      env: {},
      buildDeps: () =>
        deps({
          async run() {
            return { status: 'success', text: report };
          },
        }),
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
    expect(code).toBe(2);
    expect(out).toEqual([]);
    const json = err
      .join('')
      .split('\n')
      .find((line) => line.startsWith('SLC_CLARIFICATION: '))!;
    expect(JSON.parse(json.slice('SLC_CLARIFICATION: '.length))).toMatchObject({
      sources: [source],
      questions,
    });
    expect(err.join('')).toContain('Who should receive the result?');
  });

  it.each([
    'CLARIFICATION: not JSON',
    `CLARIFICATION: ${JSON.stringify({ questions: [] })}`,
    `CLARIFICATION: ${JSON.stringify({ questions: [...questions, ...questions] })}`,
    `CLARIFICATION: ${JSON.stringify({ questions: [{ ...questions[0], evidence: '' }] })}`,
    `CLARIFICATION: ${JSON.stringify({ questions: [{ ...questions[0], extra: true }] })}`,
    `CLARIFICATION: ${JSON.stringify({ questions: [{ ...questions[0], choices: ['same', 'same'] }] })}`,
    `${report}\ntrailing prose`,
    `${report}\n${report}`,
  ])('fails malformed reports without review: %s', async (text) => {
    let reviews = 0;
    const agent = createReviewingAgent({
      coder: {
        async run() {
          return { status: 'success', text };
        },
      },
      reviewer: () => {
        reviews++;
        throw new Error('must not review');
      },
    });
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.clarification).toBeUndefined();
    expect(result.diagnostics.join('\n')).toContain('malformed CLARIFICATION');
    expect(reviews).toBe(0);
  });

  it.each(['source', 'definition', 'target-alias'])(
    'keeps %s violations as hard errors even when clarification is valid',
    async (violation) => {
      const result = await runPhase({
        request,
        phase: 'text2middle',
        targetExt: '.md',
        executor: createInterpretedExecutor({
          agent: {
            async run() {
              if (violation === 'target-alias') await symlink(source, target);
              else
                await writeFile(
                  violation === 'source' ? source : definition,
                  'mutated',
                );
              return { status: 'success', text: report };
            },
          },
        }),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.clarification).toBeUndefined();
        expect(result.report.reasons.join()).toMatch(/changed|symbolic link/);
      }
    },
  );

  it('recognizes a clarification found during reviewed correction after drafting output', async () => {
    let coders = 0;
    let reviewers = 0;
    const agent = createReviewingAgent({
      coder: {
        async run() {
          coders++;
          if (coders === 1) {
            await writeFile(target, 'unaccepted draft');
            return { status: 'success', text: 'drafted' };
          }
          return {
            status: 'success',
            text: JSON.stringify({
              dispositions: [
                {
                  finding: 1,
                  decision: 'accept',
                  reason: 'The source author must supply the recipient.',
                },
              ],
              result: report,
            }),
          };
        },
      },
      reviewer: () => ({
        async run() {
          reviewers++;
          return {
            status: 'success',
            text: 'FINDINGS:\n1. The output invents a recipient.',
          };
        },
      }),
    });
    const result = await runPhase({
      request,
      phase: 'text2middle',
      targetExt: '.md',
      executor: createInterpretedExecutor({ agent }),
    });
    expect(result).toMatchObject({ ok: false, clarification: questions });
    expect(coders).toBe(2);
    expect(reviewers).toBe(1);
  });

  it('bypasses mechanical review when the initial response asks for clarification', async () => {
    let checks = 0;
    const agent = createReviewingAgent({
      coder: {
        async run() {
          return { status: 'success', text: report };
        },
      },
      reviewer: () => {
        throw new Error('must not create reviewer');
      },
    });
    const result = await runPhase({
      request: {
        ...request,
        mechanicalReview: async () => {
          checks++;
          return ['must not run'];
        },
      },
      phase: 'text2middle',
      targetExt: '.md',
      executor: createInterpretedExecutor({ agent }),
    });
    expect(result).toMatchObject({ ok: false, clarification: questions });
    expect(checks).toBe(0);
  });

  it('keeps a later phase mutation of the original source a hard failure', async () => {
    let calls = 0;
    const agent: AgentClient = {
      async run({ prompt }) {
        calls++;
        if (calls === 1) {
          const output = prompt.match(/^- artifact to write: (.+)$/m)![1];
          await writeFile(output, 'accepted intermediate');
          return { status: 'success', text: 'complete' };
        }
        await writeFile(source, 'modified original');
        return { status: 'success', text: report };
      },
    };
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(false);
    expect(result.clarification).toBeUndefined();
    expect(result.diagnostics.join()).toContain(
      `protected path "${source}" changed`,
    );
  });

  it.each(['legacy', 'composed-v2', 'composed-v3'] as const)(
    'stops compiled %s performing work and disposes without another agent call',
    async (contract) => {
      const calls: AgentRunRequest[] = [];
      let disposed = false;
      let ports: CompatiblePlaybookPorts;
      const factory = () => ({
        async init(value: unknown) {
          ports = (
            contract === 'legacy' ? value : (value as { ports: unknown }).ports
          ) as CompatiblePlaybookPorts;
        },
        async handleBossInput({ signal }: { signal: AbortSignal }) {
          if (contract === 'legacy')
            await ports.callPlayer('coder', 'Transform.', signal);
          else {
            // Identical marker text from a control call is not a source ask.
            await ports.callCaptain('Route only.', signal, {
              visibility: 'hidden',
              resume: false,
              allowedTools: [],
            });
            await ports.callCaptain('Transform.', signal, {
              visibility: 'visible',
              resume: false,
            });
          }
          await ports.callJudge('Must not run.', signal);
        },
        async dispose() {
          disposed = true;
        },
      });
      Object.defineProperty(factory, 'compat', {
        value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
        enumerable: true,
      });
      const agent: AgentClient = {
        async run(call) {
          calls.push(call);
          return { status: 'success', text: report };
        },
      };
      const result = await createCompiledExecutor({
        artifactPath: join(root, 'fixture.ts'),
        runRoot: root,
        runtimeContract: contract,
        player: agent,
        judge: agent,
        loadFactory: async () => factory as CompatiblePlaybookRuntimeFactory,
      }).run(request, new AbortController().signal);
      expect(result).toMatchObject({ status: 'clarification', questions });
      expect(calls).toHaveLength(contract === 'legacy' ? 1 : 2);
      expect(calls.at(-1)!.prompt).toContain(
        'Source clarification (noninteractive compiler protocol)',
      );
      if (contract !== 'legacy') expect(calls[0].prompt).toBe('Route only.');
      expect(disposed).toBe(true);
    },
  );

  it.each(['captain', 'judge'])(
    'does not dispatch a %s call already queued behind clarifying work',
    async (queued) => {
      let calls = 0;
      let ports: CompatiblePlaybookPorts;
      const factory = () => ({
        async init(value: unknown) {
          ports = (value as { ports: CompatiblePlaybookPorts }).ports;
        },
        async handleBossInput({ signal }: { signal: AbortSignal }) {
          await Promise.all([
            ports.callCaptain('Transform.', signal, {
              visibility: 'visible',
              resume: false,
            }),
            queued === 'captain'
              ? ports.callCaptain('Queued control.', signal, {
                  visibility: 'hidden',
                  resume: false,
                  allowedTools: [],
                })
              : ports.callJudge('Queued judge.', signal),
          ]);
        },
        async dispose() {},
      });
      const agent: AgentClient = {
        async run() {
          calls++;
          await Promise.resolve();
          return { status: 'success', text: report };
        },
      };
      const result = await createCompiledExecutor({
        artifactPath: join(root, 'fixture.ts'),
        runRoot: root,
        runtimeContract: 'composed-v2',
        player: agent,
        judge: agent,
        loadFactory: async () => factory as CompatiblePlaybookRuntimeFactory,
      }).run(request, new AbortController().signal);
      expect(result).toMatchObject({ status: 'clarification', questions });
      expect(calls).toBe(1);
    },
  );

  it('propagates a question through the committed phase and installed Playbook engine', async () => {
    const calls: AgentRunRequest[] = [];
    const agent: AgentClient = {
      async run(call) {
        calls.push(call);
        return { status: 'success', text: report };
      },
    };
    const realDefinition = fileURLToPath(
      new URL('../pipelines/playbook/text2gears.md', import.meta.url),
    );
    const realArtifact = fileURLToPath(
      new URL(
        '../pipelines/playbook/text2gears.slc/text2gears.playbook.ts',
        import.meta.url,
      ),
    );
    const result = await runPhase({
      request: { ...request, definitionPath: realDefinition },
      phase: 'text2gears',
      targetExt: '.md',
      executor: createCompiledExecutor({
        artifactPath: realArtifact,
        runRoot: root,
        runtimeContract: 'composed-v3',
        player: agent,
        judge: agent,
      }),
    });
    expect(result).toMatchObject({ ok: false, clarification: questions });
    expect(calls).toHaveLength(1);
    expect(await readFile(source, 'utf8')).toBe(
      'Send the result. MISSING recipient.',
    );
  });

  it.each(['cancel', 'dispose', 'runtime', 'malformed'])(
    'does not downgrade compiled %s failure to clarification',
    async (failure) => {
      const controller = new AbortController();
      let ports: CompatiblePlaybookPorts;
      const factory = () => ({
        async init(value: unknown) {
          ports = value as CompatiblePlaybookPorts;
        },
        async handleBossInput({ signal }: { signal: AbortSignal }) {
          try {
            await ports.callPlayer('coder', 'Transform.', signal);
          } catch (error) {
            if (failure === 'runtime')
              throw new Error('independent runtime failure', { cause: error });
            throw error;
          }
        },
        async dispose() {
          if (failure === 'dispose') throw new Error('disposal failed');
          if (failure === 'cancel') controller.abort();
        },
      });
      const agent: AgentClient = {
        async run() {
          return {
            status: 'success',
            text: failure === 'malformed' ? 'CLARIFICATION: invalid' : report,
          };
        },
      };
      const result = await createCompiledExecutor({
        artifactPath: join(root, 'fixture.ts'),
        runRoot: root,
        player: agent,
        judge: agent,
        loadFactory: async () => factory as CompatiblePlaybookRuntimeFactory,
      }).run(request, controller.signal);
      expect(result.status).toBe('error');
      expect(result.diagnostics.join()).toMatch(
        /aborted|disposal|runtime failure|malformed CLARIFICATION/,
      );
    },
  );
});

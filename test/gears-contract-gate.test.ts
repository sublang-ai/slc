// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createConfiguredExecutor,
  type AdapterFactory,
} from '../src/config.js';
import type { PhaseExecutor } from '../src/execution.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import {
  checkGearsFsmConformance,
  checkGearsResultContract,
  parseGearsItems,
} from '../src/verify.js';

const LOOP = 'Repeat the workflow at most twice until the review is clean.';
const SOURCE = `${LOOP}\n\n\`\`\`markdown\nDo the work exactly as authored.\n\`\`\`\n`;
const GEARS =
  '# Task\n\n### TASK-1\n\nWhen work starts, Captain shall act:\n\n> Do the work exactly as authored.\n\nResults:\n- `done`: The work completed.\n';
const MALFORMED = `${GEARS}\n${LOOP}\n`;
// Move the complete loop obligation into its result metadata; never drop it.
const REPAIRED = GEARS.replace(
  'The work completed.',
  `The work completed. ${LOOP}`,
);
const FINDING = `GEARS item TASK-1: malformed Results entry ${JSON.stringify(LOOP)}`;
const definition = (name: string, from: string, to: string) =>
  `# Phase ${name}\n\n## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${from} | .md |\n| target | ${to} | .md |\n`;
const envelope = (result: string) =>
  JSON.stringify({
    dispositions: [
      {
        finding: 1,
        decision: 'accept',
        reason:
          'Preserved the complete loop obligation in the result description.',
      },
    ],
    result,
  });
const question =
  'CLARIFICATION: ' +
  JSON.stringify({
    questions: [
      {
        id: 'loop-limit',
        question: 'What happens when the loop limit is reached?',
        reason: 'The terminal behavior is unspecified.',
        evidence: LOOP,
      },
    ],
  });

describe('GEARS result-contract producer and consumer boundaries (DR-035)', () => {
  let root: string;
  let pipeline: string;
  let source: string;
  const calls: string[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-gears-contract-'));
    pipeline = join(root, 'pipeline');
    await mkdir(pipeline);
    await writeFile(
      join(pipeline, 'text2gears.md'),
      definition('text2gears', 'text', 'gears'),
    );
    await writeFile(
      join(pipeline, 'gears2output.md'),
      definition('gears2output', 'gears', 'output'),
    );
    source = join(root, 'task.md');
    await writeFile(source, SOURCE);
    calls.length = 0;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const deps = (executor: PhaseExecutor): SlcDeps => ({
    cwd: root,
    resolver: () => [pipeline],
    executor,
  });
  const writing = (gears: string): PhaseExecutor => ({
    async run(request) {
      if (request.kind !== 'compile') throw new Error('unexpected link');
      calls.push(basename(request.definitionPath, '.md'));
      await writeFile(request.target, gears);
      return { status: 'ok' };
    },
  });

  const configured = (
    brokenPhase: string,
    opts: { persistent?: boolean; clarification?: boolean } = {},
  ) => {
    const byPhase = new Map<string, number>();
    const factory: AdapterFactory = (agent) => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(prompt) {
        const phase = prompt.match(/^# Phase (\S+)/m)![1];
        const target = prompt.match(/^- artifact to write: (.+)$/m)![1];
        const occurrence = (byPhase.get(phase) ?? 0) + 1;
        byPhase.set(phase, occurrence);
        calls.push(phase);
        const isBroken = phase === brokenPhase;
        if (isBroken && occurrence > 1) expect(prompt).toContain(FINDING);
        if (phase === 'gears2output') {
          const input = prompt.match(/^- source to read: (.+)$/m)![1];
          const content = await readFile(input, 'utf8');
          expect(checkGearsResultContract(content)).toEqual([]);
          expect(parseGearsItems(content)[0].result?.done).toContain(LOOP);
        }
        await writeFile(
          target,
          isBroken && (occurrence === 1 || opts.persistent)
            ? MALFORMED
            : REPAIRED,
        );
        const result =
          isBroken && opts.clarification && occurrence > 1
            ? envelope(question)
            : occurrence === 1
              ? 'Wrote the artifact.'
              : envelope(
                  'Repaired the representation without dropping the loop.',
                );
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: `session-${phase}`,
          payload: {
            status: 'success',
            result,
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as never;
      },
    });
    return createConfiguredExecutor(
      { agent: 'codex' },
      { cwd: root, adapterFactory: factory },
    );
  };

  it.each(['text2gears', 'optimize'])(
    'repairs %s before its consumer and preserves the loop obligation',
    async (brokenPhase) => {
      if (brokenPhase === 'optimize')
        await writeFile(
          join(pipeline, 'optimize.md'),
          definition('optimize', 'gears', 'gears'),
        );
      const result = await runSlc(
        ['flow', source],
        deps(configured(brokenPhase)),
      );
      expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
        ok: true,
      });
      expect(calls).toEqual(
        brokenPhase === 'optimize'
          ? ['text2gears', 'optimize', 'optimize', 'gears2output']
          : ['text2gears', 'text2gears', 'gears2output'],
      );
      expect(await readFile(source, 'utf8')).toBe(SOURCE);
    },
  );

  it('stops after two failed producer corrections without calling a consumer', async () => {
    const result = await runSlc(
      ['flow', source],
      deps(configured('text2gears', { persistent: true })),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain(FINDING);
    expect(calls).toEqual(['text2gears', 'text2gears', 'text2gears']);
  });

  it('checks normalization when the entry format itself is GEARS', async () => {
    await rm(join(pipeline, 'text2gears.md'));
    const raw = join(root, 'task.txt');
    await writeFile(raw, SOURCE);
    const result = await runSlc(['flow', raw], deps(writing(MALFORMED)));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain(FINDING);
    expect(calls).toEqual(['normalize']);
    expect(await readFile(raw, 'utf8')).toBe(SOURCE);
  });

  it.each(['flow', 'slc'])(
    'rechecks custom executors in the %s pipeline',
    async (name) => {
      const result = await runSlc([name, source], deps(writing(MALFORMED)));
      expect(result.ok).toBe(false);
      expect(result.diagnostics.join('\n')).toContain(FINDING);
      expect(calls).toEqual(['text2gears']);
    },
  );

  it.each(['flow', 'slc'])(
    'accepts valid roleless work in the %s pipeline',
    async (name) => {
      const result = await runSlc([name, source], deps(writing(REPAIRED)));
      expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
        ok: true,
      });
      expect(calls).toEqual(['text2gears', 'gears2output']);
    },
  );

  it.each(['gears2output', 'optimize'])(
    'rejects malformed supplied GEARS before selecting %s execution',
    async (phase) => {
      if (phase === 'optimize')
        await writeFile(
          join(pipeline, 'optimize.md'),
          definition('optimize', 'gears', 'gears'),
        );
      const input = join(root, 'task.gears.md');
      await writeFile(input, MALFORMED);
      let selections = 0;
      const runtime: SlcDeps = {
        cwd: root,
        resolver: () => [pipeline],
        get executor() {
          selections++;
          return writing(REPAIRED);
        },
      };
      const result = await runSlc([`flow.${phase}`, input], runtime);
      expect(result.ok).toBe(false);
      expect(result.outcome).toBeUndefined();
      expect(result.diagnostics.join('\n')).toContain(
        `invalid GEARS source: ${input}`,
      );
      expect(result.diagnostics.join('\n')).toContain(FINDING);
      expect(selections).toBe(0);
      expect(calls).toHaveLength(0);
      expect(await readFile(input, 'utf8')).toBe(MALFORMED);
    },
  );

  it('keeps Source-fidelity findings alongside result syntax findings', async () => {
    const result = await runSlc(
      ['flow', source],
      deps(
        writing(
          MALFORMED.replace(
            'Do the work exactly as authored.',
            'Invented instruction.',
          ),
        ),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain(
      'prompt line is not an authored fragment',
    );
    expect(result.diagnostics.join('\n')).toContain(FINDING);
  });

  it('stops immediately when a producer correction asks for source clarification', async () => {
    const result = await runSlc(
      ['flow', source],
      deps(configured('text2gears', { clarification: true, persistent: true })),
    );
    expect(result).toMatchObject({
      ok: false,
      outcome: 'clarification-required',
      clarification: { sources: [source] },
    });
    expect(calls).toEqual(['text2gears', 'text2gears']);
    expect(await readFile(source, 'utf8')).toBe(SOURCE);
  });

  it.each([
    MALFORMED,
    GEARS.replace('Results:', 'Results'),
    GEARS.replace('- `done`: The work completed.\n', ''),
    `${GEARS}- \`done\`: Duplicate.\n`,
    `${GEARS}- \`needsBossReply\`: Forbidden.\n`,
    GEARS.replace('Captain shall act:', 'Captain shall call playbook `child`:'),
    GEARS.replace('Captain shall act:', 'Captain shall run:'),
    GEARS.replace('Results:', 'Intervening prose.\n\nResults:'),
  ])(
    'reports the same parser findings through conformance and the real producer boundary',
    async (content) => {
      const findings = checkGearsResultContract(content);
      expect(findings.length).toBeGreaterThan(0);
      const conformance = checkGearsFsmConformance(content, { states: {} });
      const result = await runSlc(['flow', source], deps(writing(content)));
      expect(result.ok).toBe(false);
      for (const finding of findings) {
        expect(conformance).toContain(finding);
        expect(result.diagnostics.join('\n')).toContain(finding);
      }
    },
  );

  it.each([
    GEARS.split('\nResults:')[0],
    `${REPAIRED}\n## Notes\n\nOrdinary prose outside the item.\n`,
  ])('accepts omitted Results and prose outside an item', async (content) => {
    expect(checkGearsResultContract(content)).toEqual([]);
    const result = await runSlc(['flow', source], deps(writing(content)));
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
      ok: true,
    });
  });
});

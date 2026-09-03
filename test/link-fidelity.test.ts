// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PhaseExecutor } from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
  type AgentRunRequest,
} from '../src/interpreter.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import { checkLinkedModuleContract } from '../src/verify.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sdlc = join(
  repoRoot,
  'node_modules',
  '@sublang',
  'playbook',
  'reference',
  'sdlc',
);

/** A schema-3 machine with one delegated `coder` leaf whose prompt names both models. */
const FSM_FIXTURE = [
  'export const machine = {',
  '  config: {',
  '    states: {',
  '      draft: {',
  "        meta: { playbook: { stateId: 'draft', role: 'coder' } },",
  '        invoke: {',
  "          src: 'player',",
  '          input: ({ context }: { context: Record<string, unknown> }) => ({',
  "            stateId: 'draft',",
  "            sourceItem: 'X-1',",
  "            role: 'coder',",
  "            prompt: 'Draft for <audience> as <coder-llm>.',",
  "            result: { done: 'the draft is written' },",
  '            audience: context.audience,',
  '          }),',
  '        },',
  '      },',
  '    },',
  '  },',
  '};',
  '',
].join('\n');

/** A linked module whose player composer resolves `<coder-llm>` from `role`. */
const linkedModule = (role: string): string =>
  [
    'const compose = (',
    '  input: { prompt: string; audience: string },',
    '  promptIdentity: (roleId: string) => string,',
    '): string =>',
    '  input.prompt',
    "    .replaceAll('<audience>', input.audience)",
    `    .replaceAll('<coder-llm>', promptIdentity('${role}'));`,
    'export const _internal = { composePlayerPrompt: compose };',
    'export default function createPlaybookRuntime() {',
    '  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };',
    '}',
    '',
  ].join('\n');

const CONFORMANT = linkedModule('coder');
/** `reviewer` is declared by no state of {@link FSM_FIXTURE}. */
const WRONG_ROLE = linkedModule('reviewer');

const WRONG_ROLE_FINDING =
  'draft: composePlayerPrompt threw on an ordinary turn: ' +
  'prompt identity lookup used undeclared role "reviewer"; ' +
  'the artifact declares ["coder"]';

/** The same machine with a second `reviewer` leaf, so both roles are declared. */
const TWO_ROLE_FSM_FIXTURE = FSM_FIXTURE.replace(
  '    },\n  },\n};',
  [
    '      review: {',
    "        meta: { playbook: { stateId: 'review', role: 'reviewer' } },",
    '        invoke: {',
    "          src: 'player',",
    '          input: ({ context }: { context: Record<string, unknown> }) => ({',
    "            stateId: 'review',",
    "            sourceItem: 'X-2',",
    "            role: 'reviewer',",
    "            prompt: 'Review for <audience>.',",
    "            result: { done: 'the review is written' },",
    '            audience: context.audience,',
    '          }),',
    '        },',
    '      },',
    '    },',
    '  },',
    '};',
  ].join('\n'),
);

describe('linked-module contract checks (verification-27, verification-28)', () => {
  // The maintained bundles ship both their TypeScript sources and the built
  // JavaScript beside them; Node refuses to strip types under node_modules, so
  // the checks address the built pair.
  it.each(['code', 'review', 'decide', 'dev'])(
    'reports no finding for the maintained %s bundle',
    async (name) => {
      const dir = join(sdlc, `${name}.playbook`);
      expect(
        await checkLinkedModuleContract({
          linkedPath: join(dir, `${name}.playbook.js`),
          fsmPath: join(dir, `${name}.fsm.js`),
        }),
      ).toEqual([]);
    },
  );

  it('reports no finding for this repository’s own compiled meta bundles', async () => {
    for (const name of ['text2gears', 'gears2fsm', 'link']) {
      const dir = join(repoRoot, 'pipelines', 'playbook', `${name}.slc`);
      expect(
        await checkLinkedModuleContract({
          linkedPath: join(dir, `${name}.playbook.ts`),
          fsmPath: join(dir, `${name}.fsm.ts`),
        }),
      ).toEqual([]);
    }
  });

  it('names an undeclared role a composer resolved its identity from', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-link-contract-'));
    try {
      await writeFile(join(dir, 'case.fsm.ts'), FSM_FIXTURE);
      const linkedPath = join(dir, 'case.playbook.ts');
      await writeFile(linkedPath, CONFORMANT);
      expect(
        await checkLinkedModuleContract({
          linkedPath,
          fsmPath: join(dir, 'case.fsm.ts'),
        }),
      ).toEqual([]);

      await writeFile(linkedPath, WRONG_ROLE);
      expect(
        await checkLinkedModuleContract({
          linkedPath,
          fsmPath: join(dir, 'case.fsm.ts'),
        }),
      ).toEqual([WRONG_ROLE_FINDING]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts one declared role’s prompt naming another declared role’s identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-link-contract-peer-'));
    try {
      const fsmPath = join(dir, 'case.fsm.ts');
      const linkedPath = join(dir, 'case.playbook.ts');
      await writeFile(fsmPath, TWO_ROLE_FSM_FIXTURE);
      // The `coder` state's prompt names the declared `reviewer` identity.
      await writeFile(linkedPath, WRONG_ROLE);
      expect(await checkLinkedModuleContract({ linkedPath, fsmPath })).toEqual(
        [],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports an unimportable module as a finding rather than an error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-link-contract-load-'));
    try {
      await writeFile(join(dir, 'case.fsm.ts'), FSM_FIXTURE);
      await writeFile(
        join(dir, 'case.playbook.ts'),
        "import { nothing } from './absent-sibling.js';\nexport const _internal = { composePlayerPrompt: () => nothing };\n",
      );

      const findings = await checkLinkedModuleContract({
        linkedPath: join(dir, 'case.playbook.ts'),
        fsmPath: join(dir, 'case.fsm.ts'),
      });

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain('linked module could not be imported:');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('degrades to no finding wherever emission degrades', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-link-contract-absent-'));
    const linkedPath = join(dir, 'case.playbook.ts');
    const fsmPath = join(dir, 'case.fsm.ts');
    try {
      // No linked module and no FSM beside it.
      expect(await checkLinkedModuleContract({ linkedPath, fsmPath })).toEqual(
        [],
      );

      // A module exposing no composer for the actor the machine invokes.
      await writeFile(fsmPath, FSM_FIXTURE);
      await writeFile(
        linkedPath,
        'export default function createPlaybookRuntime() { return {}; }\n',
      );
      expect(await checkLinkedModuleContract({ linkedPath, fsmPath })).toEqual(
        [],
      );

      // An FSM the checks cannot derive from.
      await writeFile(fsmPath, 'not a module {{{\n');
      await writeFile(linkedPath, CONFORMANT);
      expect(await checkLinkedModuleContract({ linkedPath, fsmPath })).toEqual(
        [],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const linkDoc = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | playbook | .ts |
`;

const phaseDoc = (
  sf: string,
  se: string,
  tf: string,
  te: string,
): string => `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${sf} | ${se} |
| target | ${tf} | ${te} |
`;

describe('playbook link-fidelity gate (phase-execution-53, phase-execution-54)', () => {
  let root: string;
  let pipelineDir: string;
  let workDir: string;
  let artDir: string;
  let object: string;
  let linkTarget: string;
  let linked: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-link-fidelity-'));
    pipelineDir = join(root, 'pipeline');
    workDir = join(root, 'work');
    artDir = join(workDir, 'case.flow');
    await mkdir(pipelineDir);
    await mkdir(artDir, { recursive: true });
    await writeFile(
      join(pipelineDir, 'text2gears.md'),
      phaseDoc('text', '.md', 'gears', '.md'),
    );
    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      phaseDoc('gears', '.md', 'fsm', '.ts'),
    );
    await writeFile(join(pipelineDir, 'link.md'), linkDoc);
    object = join(artDir, 'case.fsm.ts');
    await writeFile(object, FSM_FIXTURE);
    linkTarget = join(workDir, 'engine.ts');
    await writeFile(linkTarget, 'export const engine = 1;\n');
    linked = join(artDir, 'case.playbook.ts');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor): SlcDeps => ({
    resolver: (name) => (name === 'flow' ? [pipelineDir] : []),
    executor,
    cwd: workDir,
  });

  /** A phase executor that writes one fixed linked module and reports success. */
  const writing = (content: string): PhaseExecutor => ({
    async run(request) {
      if (request.kind !== 'link')
        throw new Error('unexpected compile request');
      await writeFile(request.linked, content);
      return { status: 'ok', diagnostics: [] };
    },
  });

  it('fails an unreviewed link closed with the findings as its diagnostic', async () => {
    const result = await runSlc(
      ['flow.link', object, linkTarget],
      deps(writing(WRONG_ROLE)),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain(
      `slc: phase "link" failed at "${linked}"`,
    );
    expect(result.diagnostics.join('\n')).toContain(WRONG_ROLE_FINDING);
    // The gate reports; it does not repair or delete the rejected module.
    expect(await readFile(linked, 'utf8')).toBe(WRONG_ROLE);
  });

  it('accepts a linked module that honors the link contract', async () => {
    const result = await runSlc(
      ['flow.link', object, linkTarget],
      deps(writing(CONFORMANT)),
    );

    expect(result).toMatchObject({ ok: true, outputs: [linked] });
  });

  /** A Coder that writes the queued modules, correcting on the second call. */
  const queuedCoder = (
    writes: string[],
    calls: AgentRunRequest[],
  ): AgentClient => ({
    async run(request) {
      calls.push(request);
      const content = writes.shift();
      if (content === undefined) throw new Error('unexpected Coder call');
      await writeFile(linked, content);
      return calls.length === 1
        ? { status: 'success', text: 'wrote the linked module' }
        : {
            status: 'success',
            text: JSON.stringify({
              dispositions: [
                {
                  finding: 1,
                  decision: 'accept',
                  reason: 'resolved the identity from the state’s own role',
                },
              ],
              result: 'linked the module',
            }),
          };
    },
  });

  it('relays a finding to the Coder in place of the Reviewer call, then reviews the repair', async () => {
    const coderCalls: AgentRunRequest[] = [];
    const reviewerCalls: AgentRunRequest[] = [];
    const reviewer: AgentClient = {
      async run(request) {
        reviewerCalls.push(request);
        return { status: 'success', text: 'NO_FINDINGS' };
      },
    };
    const executor = createInterpretedExecutor({
      agent: createReviewingAgent({
        coder: queuedCoder([WRONG_ROLE, CONFORMANT], coderCalls),
        reviewer: () => reviewer,
      }),
    });

    const result = await runSlc(
      ['flow.link', object, linkTarget],
      deps(executor),
    );

    expect(result).toMatchObject({ ok: true, outputs: [linked] });
    expect(coderCalls).toHaveLength(2);
    expect(coderCalls[1].prompt).toContain(
      `FINDINGS:\n1. ${WRONG_ROLE_FINDING}`,
    );
    // The Reviewer judged only the repaired module.
    expect(reviewerCalls).toHaveLength(1);
    expect(await readFile(linked, 'utf8')).toBe(CONFORMANT);
  });
});

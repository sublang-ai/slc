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

async function prepareTempProject(dir: string): Promise<void> {
  await writeFile(join(dir, 'package.json'), '{"type":"module"}\n');
  await symlink(join(repoRoot, 'node_modules'), join(dir, 'node_modules'));
}

const playerState = (
  stateId: string,
  role: string,
  sourceItem: string,
  prompt: string,
) => `      ${stateId}: {
        meta: { playbook: { stateId: '${stateId}', role: '${role}' } },
        invoke: {
          src: 'player',
          input: ({ context }: { context: Record<string, unknown> }) => ({
            stateId: '${stateId}',
            sourceItem: '${sourceItem}',
            role: '${role}',
            prompt: '${prompt}',
            result: {
              done: 'the draft is written. Output shall include \`response: <final response>\`.',
              needsBossReply: 'The agent must ask Boss. Output shall include \`question: <question>\`.',
            },
            audience: context.audience,
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }),
          onDone: [
            { guard: ({ event }: any) => event.output?.guard === 'needsBossReply', target: 'awaitBossReply' },
            { guard: ({ event }: any) => event.output?.guard === 'done', target: 'done' },
          ],
          onError: 'failed',
        },
      },`;

const fsmFixture = (
  extraStates = '',
): string => `import { fromPromise, setup } from 'xstate';
export const machine = setup({
  actors: { player: fromPromise(async () => ({ guard: 'done', response: 'fixture response' })) },
}).createMachine({
  context: ({ input }: { input?: { audience?: string } }) => ({ audience: input?.audience ?? '', pendingBossQuestion: undefined, bossReply: undefined }),
  initial: 'draft',
  states: {
${playerState('draft', 'coder', 'X-1', 'Draft for <audience> as <coder-llm>.')}${extraStates}
    awaitBossReply: {
      tags: 'playbook.parked',
      on: { BOSS_REPLY: { target: 'draft', guard: ({ event }: any) => typeof event.answer === 'string' && event.answer.trim().length > 0 } },
    },
    failed: {
      tags: 'playbook.parked',
      meta: { playbook: { stateId: 'failed' } },
      on: { BOSS_REPLY: { target: 'draft', guard: ({ event }: any) => typeof event.answer === 'string' && event.answer.trim().length > 0 } },
    },
    done: { type: 'final', meta: { playbook: { stateId: 'done', terminal: 'success' } } },
  },
});
`;

/** A schema-3 machine with one delegated `coder` leaf whose prompt names both models. */
const FSM_FIXTURE = fsmFixture();

/** A linked module whose player composer resolves `<coder-llm>` from `role`. */
const linkedModule = (role: string): string =>
  [
    'const continuationPrefix = (input: { pendingBossQuestion?: { question?: string }; bossReply?: string }, resuming?: boolean): string => {',
    "  if (typeof input.bossReply !== 'string') return '';",
    '  if (resuming === true) return `Continue the same task using Boss’s reply below.\n\nBoss reply:\n${input.bossReply}\n\n`;',
    "  return `Continue the same task using Boss’s reply below.\n\nYour previous question:\n${input.pendingBossQuestion?.question ?? ''}\n\nBoss reply:\n${input.bossReply}\n\n`;",
    '};',
    'const compose = (',
    '  input: { prompt: string; audience: string; pendingBossQuestion?: { question?: string }; bossReply?: string },',
    '  promptIdentity: (roleId: string) => string,',
    '  resuming?: boolean,',
    '): string =>',
    '  continuationPrefix(input, resuming) + input.prompt.replace(/<audience>|<coder-llm>/g, token =>',
    `    token === '<audience>' ? input.audience : promptIdentity('${role}'));`,
    'export const _internal = { composePlayerPrompt: compose };',
    'export default function createPlaybookRuntime() {',
    '  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };',
    '}',
    '',
  ].join('\n');

const CONFORMANT = linkedModule('coder');
const QUOTED_RELAY = CONFORMANT.replace(
  '? input.audience :',
  "? input.audience.replace(/\\n/g, '\\n> ') :",
);
const CRLF_NORMALIZED_RELAY = CONFORMANT.replace(
  '? input.audience :',
  "? input.audience.replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\n> ') :",
);
/** `reviewer` is declared by no state of {@link FSM_FIXTURE}. */
const WRONG_ROLE = linkedModule('reviewer');

const WRONG_ROLE_FINDING =
  'draft: composePlayerPrompt threw on an ordinary turn: ' +
  'prompt identity lookup used undeclared role "reviewer"; ' +
  'the artifact declares ["coder"]';
const WRONG_ROLE_CONTINUATION_FINDING =
  'draft: composePlayerPrompt threw on a continuation turn: ' +
  'prompt identity lookup used undeclared role "reviewer"; ' +
  'the artifact declares ["coder"]';

/** The same machine with a second `reviewer` leaf, so both roles are declared. */
const TWO_ROLE_FSM_FIXTURE = fsmFixture(
  `
${playerState('review', 'reviewer', 'X-2', 'Review for <audience>.')}`,
);

describe('linked-module contract checks (verification-27, verification-28)', () => {
  // The maintained bundles ship both their TypeScript sources and the built
  // JavaScript beside them; Node refuses to strip types under node_modules, so
  // the checks address the built pair.
  it.each(['code', 'review', 'decide'])(
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

  it('reports published DEV’s helper-export defect and accepts its actual runtime composer', async () => {
    const published = join(sdlc, 'dev.playbook');
    const linkedPath = join(published, 'dev.playbook.js');
    const fsmPath = join(published, 'dev.fsm.js');
    // Playbook 13.2 exposes a private (input, resuming) helper through _internal,
    // although its runtimeSpec correctly uses (input, identity, resuming).
    // Keep the raw finding until the upstream export correction is published;
    // do not teach the production checker to guess a function's signature.
    expect(await checkLinkedModuleContract({ linkedPath, fsmPath })).toEqual([
      'planAnalysis: a continuation turn lacks the "Your previous question:" block',
      'planAnalysis: a continuation turn does not preserve the exact ordered Boss question/reply blocks',
    ]);

    const dir = await mkdtemp(join(tmpdir(), 'slc-dev-runtime-composer-'));
    try {
      const source = await readFile(linkedPath, 'utf8');
      await writeFile(join(dir, 'package.json'), '{"type":"module"}\n');
      await symlink(join(repoRoot, 'node_modules'), join(dir, 'node_modules'));
      await writeFile(join(dir, 'dev.fsm.js'), await readFile(fsmPath));
      // Expose the actual function object passed to the real runtime factory.
      // This private instrumentation changes no runtime implementation or source.
      await writeFile(
        join(dir, 'dev.playbook.js'),
        `${source}\n_internal.composePlayerPrompt = runtimeSpec.composePlayerPrompt;\n`,
      );
      expect(
        await checkLinkedModuleContract({
          linkedPath: join(dir, 'dev.playbook.js'),
          fsmPath: join(dir, 'dev.fsm.js'),
        }),
      ).toEqual([]);
      expect(await readFile(linkedPath, 'utf8')).toBe(source);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

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
      await prepareTempProject(dir);
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
      ).toEqual([WRONG_ROLE_FINDING, WRONG_ROLE_CONTINUATION_FINDING]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts one declared role’s prompt naming another declared role’s identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slc-link-contract-peer-'));
    try {
      await prepareTempProject(dir);
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
      await prepareTempProject(dir);
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
      await prepareTempProject(dir);
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
    await prepareTempProject(root);
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
              dispositions: [...request.prompt.matchAll(/^([0-9]+)\. /gm)].map(
                ([, finding]) => ({
                  finding: Number(finding),
                  decision: 'accept',
                  reason: 'resolved the linked fixture finding',
                }),
              ),
              result: 'linked the module',
            }),
          };
    },
  });

  it.each([
    {
      label: 'unquoted',
      draft: CONFORMANT,
      expectedDetail: undefined,
    },
    {
      label: 'CRLF-normalizing',
      draft: CRLF_NORMALIZED_RELAY,
      expectedDetail: 'expected "\\r\\n> third-0", actual "\\n> third-0"',
    },
  ])(
    'repairs a $label literal multiline relay with the same Coder before accepting the link (verification-42)',
    async ({ draft, expectedDetail }) => {
      const originalFsm = FSM_FIXTURE.replace(
        'Draft for <audience> as <coder-llm>.',
        'Draft as <coder-llm>.\\n> Request: <audience>',
      );
      await writeFile(object, originalFsm);
      const coderCalls: AgentRunRequest[] = [];
      const result = await runSlc(
        ['flow.link', object, linkTarget],
        deps(
          createInterpretedExecutor({
            agent: createReviewingAgent({
              coder: queuedCoder([draft, QUOTED_RELAY], coderCalls),
            }),
          }),
        ),
      );
      expect(result, result.diagnostics.join('\n')).toMatchObject({
        ok: true,
        outputs: [linked],
      });
      expect(coderCalls).toHaveLength(2);
      expect(coderCalls[1].prompt).toContain(
        'FINDINGS:\n1. draft: prompt composition does not preserve multiline quoted-relay text',
      );
      expect(
        coderCalls[1].prompt.match(
          /draft: prompt composition does not preserve multiline quoted-relay text/g,
        ),
      ).toHaveLength(1);
      if (expectedDetail !== undefined)
        expect(coderCalls[1].prompt).toContain(expectedDetail);
      expect(await readFile(object, 'utf8')).toBe(originalFsm);
      expect(await readFile(linked, 'utf8')).toBe(QUOTED_RELAY);
    },
  );

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

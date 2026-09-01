// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadBuildHistory } from '../src/build-history.js';
import type {
  ExecuteRequest,
  ExecutorResult,
  PhaseExecutor,
} from '../src/execution.js';
import {
  createInterpretedExecutor,
  type AgentClient,
} from '../src/interpreter.js';
import { createReviewingAgent } from '../src/reviewing-agent.js';
import { PIN_INPUTS_FILE, PIN_INPUTS_SCHEMA } from '../src/pin-inputs.js';
import { PINS_FILE, PIN_HASH_ALGORITHM, PIN_SCHEMA } from '../src/pins.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const phase = (
  source: string,
  sourceExt: string,
  target: string,
  targetExt: string,
): string => `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${source} | ${sourceExt} |
| target | ${target} | ${targetExt} |
`;

const linkPhase = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | final | .md |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | A runtime module. |

Options:

| Name | Meaning |
| --- | --- |
| seed | Fixture seed. |
`;

const pinInputs = (closures: Record<string, string[]>): string =>
  `${JSON.stringify({ schema: PIN_INPUTS_SCHEMA, closures }, null, 2)}\n`;

describe('success-only incremental runner (incremental-compilation-18..25, incremental-compilation-27..33)', () => {
  let root: string;
  let pipelineDir: string;
  let workDir: string;
  let source: string;
  let artDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-incremental-'));
    pipelineDir = join(root, 'pipeline');
    workDir = join(root, 'work');
    await mkdir(pipelineDir);
    await mkdir(workDir);
    await writeFile(
      join(pipelineDir, 'text2middle.md'),
      phase('text', '.md', 'middle', '.md'),
    );
    await writeFile(
      join(pipelineDir, 'middle2final.md'),
      phase('middle', '.md', 'final', '.md'),
    );
    source = join(workDir, 'case.md');
    artDir = join(workDir, 'case.flow');
    await writeFile(source, 'source one\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor): SlcDeps => ({
    resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
    executor,
    cwd: workDir,
  });

  const fake = (
    calls: ExecuteRequest[],
    run: (request: ExecuteRequest) => Promise<ExecutorResult> = async (
      request,
    ) => {
      const target =
        request.kind === 'compile' ? request.target : request.linked;
      await writeFile(
        target,
        target.endsWith('.middle.md') ? 'middle\n' : 'final\n',
      );
      return { status: 'ok', diagnostics: [] };
    },
  ): PhaseExecutor => ({
    async run(request) {
      calls.push(request);
      return run(request);
    },
  });

  const exists = async (path: string): Promise<boolean> =>
    access(path).then(
      () => true,
      () => false,
    );

  it('publishes one complete build after the first successful run', async () => {
    const calls: ExecuteRequest[] = [];
    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(1);
    expect(history?.manifest.steps.map((step) => step.name)).toEqual([
      'text2middle',
      'middle2final',
    ]);
    expect(await readFile(join(history!.dir, 'outputs', '0'), 'utf8')).toBe(
      'middle\n',
    );
    expect(await readFile(join(history!.dir, 'outputs', '1'), 'utf8')).toBe(
      'final\n',
    );
  });

  it('reuses every phase and preserves a manual final refinement', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const final = join(artDir, 'case.final.md');
    await writeFile(final, 'reviewed final\n');
    let coderCalls = 0;
    let reviewerClients = 0;
    const coder: AgentClient = {
      async run() {
        coderCalls++;
        throw new Error('Reuse must not enter the reviewed executor');
      },
    };
    const reviewedExecutor = createInterpretedExecutor({
      agent: createReviewingAgent({
        coder,
        reviewer: () => {
          reviewerClients++;
          throw new Error('Reuse must not construct a Reviewer');
        },
      }),
    });

    const result = await runSlc(['flow', source], deps(reviewedExecutor));

    expect(result).toMatchObject({ ok: true, outcome: 'up-to-date' });
    expect(result.outputs).toEqual([]);
    expect(coderCalls).toBe(0);
    expect(reviewerClients).toBe(0);
    expect(await readFile(final, 'utf8')).toBe('reviewed final\n');
    expect((await loadBuildHistory(artDir))?.build).toBe(1);
  });

  it('updates a changed phase and stops when its output converges', async () => {
    await runSlc(['flow', source], deps(fake([])));
    await writeFile(source, 'source two\n');
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request.kind).toBe('compile');
    if (request.kind === 'compile') {
      expect(request.update?.priorInput).toContain('/.slc/builds/1/source');
      expect(request.update?.diff).toContain('-source one');
      expect(request.update?.diff).toContain('+source two');
    }
    expect(result.outputs).toEqual([join(artDir, 'case.middle.md')]);
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('reuses a refined producer and updates its consumer from recorded input', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const middle = join(artDir, 'case.middle.md');
    const final = join(artDir, 'case.final.md');
    await writeFile(middle, 'reviewed middle\n');
    const calls: ExecuteRequest[] = [];
    let priorOutput = '';

    const result = await runSlc(
      ['flow', source],
      deps(
        fake(calls, async (request) => {
          const target =
            request.kind === 'compile' ? request.target : request.linked;
          priorOutput = await readFile(target, 'utf8');
          await writeFile(target, 'updated final\n');
          return { status: 'ok', diagnostics: [] };
        }),
      ),
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request.kind).toBe('compile');
    if (request.kind === 'compile') {
      expect(request.source).toBe(middle);
      expect(request.update?.priorInput).toContain('/.slc/builds/1/outputs/0');
      expect(request.update?.diff).toContain('-middle');
      expect(request.update?.diff).toContain('+reviewed middle');
    }
    expect(priorOutput).toBe('final\n');
    expect(await readFile(middle, 'utf8')).toBe('reviewed middle\n');
    expect(await readFile(final, 'utf8')).toBe('updated final\n');
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('treats one corrupt active-build copy as whole-build absence', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const first = await loadBuildHistory(artDir);
    await writeFile(join(first!.dir, 'outputs', '1'), 'corrupt copy\n');
    expect(await loadBuildHistory(artDir)).toBeNull();
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    const fresh = await loadBuildHistory(artDir);
    expect(fresh?.build).toBe(2);
    expect(fresh?.manifest.steps).toHaveLength(2);
    expect(await readFile(join(fresh!.dir, 'outputs', '0'), 'utf8')).toBe(
      'middle\n',
    );
    expect(await readFile(join(fresh!.dir, 'outputs', '1'), 'utf8')).toBe(
      'final\n',
    );
  });

  it('keeps malformed history diagnostic-only when it blocks recording', async () => {
    await mkdir(artDir);
    await writeFile(join(artDir, '.slc'), 'not a directory\n');
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(result.diagnostics.join('\n')).toContain(
      'slc: build history not recorded:',
    );
    expect(await loadBuildHistory(artDir)).toBeNull();
  });

  it('includes definition and declared Pin Input bytes in compile identity', async () => {
    const references = join(pipelineDir, 'references');
    const grammar = join(references, 'grammar.md');
    const definition = join(pipelineDir, 'text2middle.md');
    await mkdir(references);
    await writeFile(grammar, 'grammar one\n');
    await writeFile(
      definition,
      `${phase('text', '.md', 'middle', '.md')}\nDefinition rule one.\n\n## Pin Inputs\n\n- \`references/grammar.md\`\n`,
    );
    await runSlc(['flow', source], deps(fake([])));

    await writeFile(
      definition,
      `${phase('text', '.md', 'middle', '.md')}\nDefinition rule two.\n\n## Pin Inputs\n\n- \`references/grammar.md\`\n`,
    );
    const definitionCalls: ExecuteRequest[] = [];
    await runSlc(['flow', source], deps(fake(definitionCalls)));
    expect(definitionCalls).toHaveLength(1);
    expect(definitionCalls[0]).toMatchObject({
      kind: 'compile',
      update: expect.any(Object) as object,
    });

    await writeFile(grammar, 'grammar two\n');
    const grammarCalls: ExecuteRequest[] = [];
    await runSlc(['flow', source], deps(fake(grammarCalls)));
    expect(grammarCalls).toHaveLength(1);
    expect(grammarCalls[0]).toMatchObject({
      kind: 'compile',
      update: expect.any(Object) as object,
    });
    expect((await loadBuildHistory(artDir))?.build).toBe(3);
  });

  it('uses a flattened sidecar closure for locator identity, exact bytes, Update, and input protection (incremental-compilation-30..31, phase-execution-40)', async () => {
    const references = join(pipelineDir, 'references');
    const grammar = join(references, 'grammar.md');
    const replacement = join(references, 'replacement.md');
    await mkdir(references);
    await writeFile(grammar, 'grammar one\n');
    await writeFile(replacement, 'grammar one\n');
    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      pinInputs({ text2middle: ['references/grammar.md'] }),
    );
    await runSlc(['flow', source], deps(fake([])));

    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      pinInputs({ text2middle: ['references/replacement.md'] }),
    );
    const relocatedCalls: ExecuteRequest[] = [];
    const relocated = await runSlc(
      ['flow', source],
      deps(fake(relocatedCalls)),
    );

    expect(relocated.ok).toBe(true);
    expect(relocatedCalls).toHaveLength(1);
    expect(relocatedCalls[0]).toMatchObject({
      kind: 'compile',
      definitionPath: join(pipelineDir, 'text2middle.md'),
      update: expect.any(Object) as object,
    });
    expect((await loadBuildHistory(artDir))?.build).toBe(2);

    await writeFile(replacement, 'grammar two\n');
    const changedCalls: ExecuteRequest[] = [];
    const changed = await runSlc(['flow', source], deps(fake(changedCalls)));

    expect(changed.ok).toBe(true);
    expect(changedCalls).toHaveLength(1);
    expect(changedCalls[0]).toMatchObject({
      kind: 'compile',
      definitionPath: join(pipelineDir, 'text2middle.md'),
      update: expect.any(Object) as object,
    });
    expect((await loadBuildHistory(artDir))?.build).toBe(3);

    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      pinInputs({
        text2middle: ['references/replacement.md'],
        middle2final: ['references/replacement.md'],
      }),
    );
    const protectedCalls: ExecuteRequest[] = [];
    const protectedResult = await runSlc(
      ['flow.middle2final', join(artDir, 'case.middle.md'), '-o', replacement],
      deps(fake(protectedCalls)),
    );
    expect(protectedResult.ok).toBe(false);
    expect(protectedResult.diagnostics.join('\n')).toContain(
      'aliases protected input',
    );
    expect(protectedCalls).toHaveLength(0);
    expect(await readFile(replacement, 'utf8')).toBe('grammar two\n');
  });

  it('treats sidecar closure order as non-semantic (incremental-compilation-32)', async () => {
    const references = join(pipelineDir, 'references');
    await mkdir(references);
    await writeFile(join(references, 'a.md'), 'grammar a\n');
    await writeFile(join(references, 'b.md'), 'grammar b\n');
    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      pinInputs({
        text2middle: ['references/a.md', 'references/b.md'],
      }),
    );
    await runSlc(['flow', source], deps(fake([])));

    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      pinInputs({
        text2middle: ['references/b.md', 'references/a.md'],
      }),
    );
    const calls: ExecuteRequest[] = [];
    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('up-to-date');
    expect(calls).toHaveLength(0);
    expect((await loadBuildHistory(artDir))?.build).toBe(1);
  });

  it('ignores sidecar presentation and well-formed unrelated entries for identity (incremental-compilation-33)', async () => {
    const references = join(pipelineDir, 'references');
    await mkdir(references);
    await writeFile(join(references, 'a.md'), 'grammar a\n');
    await writeFile(join(references, 'b.md'), 'grammar b\n');
    const sidecar = join(pipelineDir, PIN_INPUTS_FILE);
    await writeFile(sidecar, pinInputs({ text2middle: ['references/a.md'] }));
    await runSlc(['flow', source], deps(fake([])));

    await writeFile(
      sidecar,
      JSON.stringify({
        schema: PIN_INPUTS_SCHEMA,
        closures: { text2middle: ['references/a.md'] },
      }),
    );
    const presentationCalls: ExecuteRequest[] = [];
    const presentation = await runSlc(
      ['flow', source],
      deps(fake(presentationCalls)),
    );

    expect(presentation).toMatchObject({ ok: true, outcome: 'up-to-date' });
    expect(presentationCalls).toHaveLength(0);
    expect((await loadBuildHistory(artDir))?.build).toBe(1);

    await writeFile(
      sidecar,
      JSON.stringify({
        schema: PIN_INPUTS_SCHEMA,
        closures: {
          text2middle: ['references/a.md'],
          unused: ['references/b.md'],
        },
      }),
    );
    const unrelatedCalls: ExecuteRequest[] = [];
    const unrelated = await runSlc(
      ['flow', source],
      deps(fake(unrelatedCalls)),
    );

    expect(unrelated).toMatchObject({ ok: true, outcome: 'up-to-date' });
    expect(unrelatedCalls).toHaveLength(0);
    expect((await loadBuildHistory(artDir))?.build).toBe(1);
  });

  it('selects the runtime sidecar boundary from the pin index (incremental-compilation-29, pinning-22)', async () => {
    await writeFile(join(root, 'outside.final.md'), 'outside input\n');
    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      pinInputs({ middle2final: ['../outside.final.md'] }),
    );
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(['flow', source], deps(fake(calls)));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    expect(result.diagnostics.join('\n')).toContain(
      'slc: build history not recorded:',
    );
    expect(await loadBuildHistory(artDir)).toBeNull();

    await writeFile(
      join(pipelineDir, PINS_FILE),
      JSON.stringify({
        schema: PIN_SCHEMA,
        hashAlgorithm: PIN_HASH_ALGORITHM,
        pathBoundary: { path: '..' },
        pins: {},
      }),
    );
    const widenedCalls: ExecuteRequest[] = [];
    const widened = await runSlc(['flow', source], deps(fake(widenedCalls)));

    expect(widened.ok).toBe(true);
    expect(widenedCalls).toHaveLength(2);
    expect(widened.diagnostics.join('\n')).not.toContain(
      'slc: build history not recorded:',
    );
    expect((await loadBuildHistory(artDir))?.build).toBe(1);

    const reuseCalls: ExecuteRequest[] = [];
    const reused = await runSlc(['flow', source], deps(fake(reuseCalls)));
    expect(reused).toMatchObject({ ok: true, outcome: 'up-to-date' });
    expect(reuseCalls).toHaveLength(0);

    const protectionCalls: ExecuteRequest[] = [];
    const protectedResult = await runSlc(
      [
        'flow.middle2final',
        join(artDir, 'case.middle.md'),
        '-o',
        join(root, 'outside.final.md'),
      ],
      deps(fake(protectionCalls)),
    );
    expect(protectedResult.ok).toBe(false);
    expect(protectedResult.diagnostics.join('\n')).toContain(
      'aliases protected input',
    );
    expect(protectionCalls).toHaveLength(0);
    expect(await readFile(join(root, 'outside.final.md'), 'utf8')).toBe(
      'outside input\n',
    );
  });

  it.each([
    ['escapes the local boundary', '../outside.md'],
    ['is missing', 'references/missing.md'],
  ])(
    'runs ordinarily when a declared Pin Input %s',
    async (_label, citation) => {
      await writeFile(
        join(pipelineDir, 'text2middle.md'),
        `${phase('text', '.md', 'middle', '.md')}\n## Pin Inputs\n\n- \`${citation}\`\n`,
      );
      const calls: ExecuteRequest[] = [];

      const result = await runSlc(['flow', source], deps(fake(calls)));

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(2);
      expect(
        calls.every(
          (request) =>
            request.kind !== 'compile' || request.update === undefined,
        ),
      ).toBe(true);
      expect(result.diagnostics.join('\n')).toContain(
        'slc: build history not recorded:',
      );
      expect(await loadBuildHistory(artDir)).toBeNull();
    },
  );

  const incompleteProtectionCases: Array<
    [label: string, inlineCitations: string[], sidecar?: string]
  > = [
    [
      'inline member after an invalid locator',
      ['../outside.md', 'references/protected.md'],
    ],
    [
      'sidecar member after an invalid locator',
      [],
      pinInputs({
        middle2final: ['../outside.md', 'references/protected.md'],
      }),
    ],
    [
      'inline member despite a structurally invalid sidecar',
      ['references/protected.md'],
      '{ not JSON',
    ],
  ];

  it.each(incompleteProtectionCases)(
    'protects a valid %s (phase-execution-40, phase-execution-50)',
    async (_label, inlineCitations, sidecar) => {
      const references = join(pipelineDir, 'references');
      const protectedInput = join(references, 'protected.md');
      const middle = join(workDir, 'case.middle.md');
      await mkdir(references);
      await writeFile(protectedInput, 'protected input\n');
      await writeFile(middle, 'middle input\n');
      await writeFile(
        join(pipelineDir, 'middle2final.md'),
        `${phase('middle', '.md', 'final', '.md')}${
          inlineCitations.length === 0
            ? ''
            : `\n## Pin Inputs\n\n${inlineCitations
                .map((citation) => `- \`${citation}\``)
                .join('\n')}\n`
        }`,
      );
      if (sidecar !== undefined) {
        await writeFile(join(pipelineDir, PIN_INPUTS_FILE), sidecar);
      }
      const calls: ExecuteRequest[] = [];

      const result = await runSlc(
        ['flow.middle2final', middle, '-o', protectedInput],
        deps(fake(calls)),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.join('\n')).toContain(
        'aliases protected input',
      );
      expect(calls).toHaveLength(0);
      expect(await readFile(protectedInput, 'utf8')).toBe('protected input\n');
    },
  );

  it('includes an explicit normalization reference in compile identity', async () => {
    await runSlc(['flow', source, '--normalize'], deps(fake([])));
    await writeFile(
      join(pipelineDir, 'text2middle.md'),
      `${phase('text', '.md', 'middle', '.md')}\nCurrent definition rule.\n`,
    );
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(
      ['flow', source, '--normalize'],
      deps(fake(calls)),
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    const normalize = calls[0];
    expect(normalize.kind).toBe('compile');
    if (normalize.kind === 'compile') {
      expect(normalize.references).toEqual([
        join(pipelineDir, 'text2middle.md'),
      ]);
      expect(normalize.update).toBeDefined();
    }
    expect(calls[1]).toMatchObject({
      kind: 'compile',
      update: expect.any(Object) as object,
    });
  });

  it('includes link-target content and ordered options in link identity', async () => {
    const target = join(workDir, 'runtime.ts');
    await writeFile(join(pipelineDir, 'link.md'), linkPhase);
    await writeFile(target, 'runtime one\n');
    const args = [
      'flow',
      source,
      '--link',
      target,
      '--link-option',
      'seed=one',
    ];
    await runSlc(args, deps(fake([])));

    await writeFile(target, 'runtime two\n');
    const targetCalls: ExecuteRequest[] = [];
    await runSlc(args, deps(fake(targetCalls)));
    expect(targetCalls).toHaveLength(1);
    expect(targetCalls[0]).toMatchObject({
      kind: 'link',
      options: [{ name: 'seed', value: 'one' }],
    });

    const optionCalls: ExecuteRequest[] = [];
    await runSlc([...args.slice(0, -1), 'seed=two'], deps(fake(optionCalls)));
    expect(optionCalls).toHaveLength(1);
    expect(optionCalls[0]).toMatchObject({
      kind: 'link',
      options: [{ name: 'seed', value: 'two' }],
    });
    expect((await loadBuildHistory(artDir))?.build).toBe(3);
  });

  it('leaves no marker after failure and retries every phase ordinarily', async () => {
    await runSlc(['flow', source], deps(fake([])));
    await writeFile(source, 'source two\n');
    const failedCalls: ExecuteRequest[] = [];
    let markerSeenByExecutor = true;
    const failed = await runSlc(
      ['flow', source],
      deps(
        fake(failedCalls, async (request) => {
          markerSeenByExecutor = await exists(join(artDir, '.slc', 'latest'));
          const target =
            request.kind === 'compile' ? request.target : request.linked;
          await writeFile(target, 'rejected\n');
          return { status: 'error', diagnostics: ['fixture failure'] };
        }),
      ),
    );

    expect(failed.ok).toBe(false);
    expect(failedCalls).toHaveLength(1);
    expect(markerSeenByExecutor).toBe(false);
    expect(await exists(join(artDir, '.slc', 'latest'))).toBe(false);
    expect(await exists(join(artDir, '.slc', 'builds', '1'))).toBe(true);

    const retryCalls: ExecuteRequest[] = [];
    const retry = await runSlc(['flow', source], deps(fake(retryCalls)));
    expect(retry.ok).toBe(true);
    expect(retryCalls).toHaveLength(2);
    expect(
      retryCalls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('makes --rebuild ordinary and publishes a new complete build', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(
      ['flow', source, '--rebuild'],
      deps(fake(calls)),
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(
      calls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    expect((await loadBuildHistory(artDir))?.build).toBe(2);
  });

  it('invalidates a snapshot before an excluded run writes one of its targets', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const calls: ExecuteRequest[] = [];

    const result = await runSlc(
      ['flow.text2middle', source],
      deps(
        fake(calls, async (request) => {
          const target =
            request.kind === 'compile' ? request.target : request.linked;
          await writeFile(target, 'rejected partial output\n');
          return { status: 'error', diagnostics: ['fixture failure'] };
        }),
      ),
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(await exists(join(artDir, '.slc', 'latest'))).toBe(false);

    const retryCalls: ExecuteRequest[] = [];
    const retry = await runSlc(['flow', source], deps(fake(retryCalls)));
    expect(retry.ok).toBe(true);
    expect(retryCalls).toHaveLength(2);
    expect(
      retryCalls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
  });

  it('keeps every excluded form outside history when no recorded target is overwritten', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const marker = join(artDir, '.slc', 'latest');
    const sibling = join(artDir, 'case.unrecorded.md');
    const calls: ExecuteRequest[] = [];

    const phaseResult = await runSlc(
      ['flow.middle2final', join(artDir, 'case.middle.md'), '-o', sibling],
      deps(fake(calls)),
    );
    expect(phaseResult.ok).toBe(true);

    await writeFile(
      join(pipelineDir, 'optimize.md'),
      phase('middle', '.md', 'middle', '.md'),
    );
    const passResult = await runSlc(
      ['flow.optimize', join(artDir, 'case.middle.md')],
      deps(fake(calls)),
    );
    expect(passResult.ok).toBe(true);

    const runtime = join(workDir, 'runtime.ts');
    await writeFile(join(pipelineDir, 'link.md'), linkPhase);
    await writeFile(runtime, 'export default {};\n');
    const directResult = await runSlc(
      [
        'flow.link',
        join(artDir, 'case.final.md'),
        runtime,
        '-o',
        join(artDir, 'case.direct.ts'),
      ],
      deps(fake(calls)),
    );
    expect(directResult.ok).toBe(true);

    const otherSource = join(workDir, 'other.md');
    await writeFile(otherSource, 'other source\n');
    const outputResult = await runSlc(
      ['flow', otherSource, '-o', join(workDir, 'other-output.md')],
      deps(fake(calls)),
    );
    expect(outputResult.ok).toBe(true);
    expect(await exists(join(workDir, 'other.flow', '.slc'))).toBe(false);

    const reservedResult = await runSlc(['slc', source], {
      ...deps(fake(calls)),
      resolver: (reference) =>
        reference === 'flow' || reference === 'slc' ? [pipelineDir] : [],
    });
    expect(reservedResult.ok).toBe(true);
    expect(await exists(join(workDir, 'case.slc', '.slc'))).toBe(false);

    expect(calls).toHaveLength(9);
    expect(
      calls.every(
        (request) => request.kind !== 'compile' || request.update === undefined,
      ),
    ).toBe(true);
    expect(await exists(marker)).toBe(true);
    expect((await loadBuildHistory(artDir))?.build).toBe(1);
  });

  it('delays excluded-run invalidation until a later recorded target', async () => {
    await runSlc(['flow', source], deps(fake([])));
    const marker = join(artDir, '.slc', 'latest');
    const output = join(artDir, 'case.unrecorded-final.md');
    const calls: ExecuteRequest[] = [];
    const markerSeen: boolean[] = [];

    const result = await runSlc(
      ['flow', source, '--normalize', '-o', output],
      deps(
        fake(calls, async (request) => {
          markerSeen.push(await exists(marker));
          const target =
            request.kind === 'compile' ? request.target : request.linked;
          await writeFile(
            target,
            target.endsWith('.middle.md') ? 'middle\n' : 'final\n',
          );
          return { status: 'ok', diagnostics: [] };
        }),
      ),
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(markerSeen).toEqual([true, false, false]);
    expect(await exists(marker)).toBe(false);
  });
});

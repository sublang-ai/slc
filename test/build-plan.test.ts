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
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BuildPlanError,
  identifyBuildPlan,
  planFullBuild,
  type BuildIdentityContext,
  type FullBuildTopology,
} from '../src/build-plan.js';
import { hashFile } from '../src/hash.js';
import type { Invocation } from '../src/invocation.js';
import { loadLinkFile } from '../src/link.js';
import { generatePinRecord, writePinFile } from '../src/pin-generate.js';
import { loadPipeline, type Pipeline } from '../src/pipeline.js';

const formatDoc = (
  source: string,
  sourceExt: string,
  target: string,
  targetExt: string,
  rest = '',
): string =>
  [
    '# Fixture',
    '',
    '## Formats',
    '',
    '| Role | Format | Extension |',
    '| --- | --- | --- |',
    `| source | ${source} | ${sourceExt} |`,
    `| target | ${target} | ${targetExt} |`,
    rest,
  ].join('\n');

const packages = (fullLink: boolean, slcVersion = '0.3.0') => [
  { role: 'slc' as const, name: '@sublang/slc', version: slcVersion },
  { role: 'pipeline' as const, name: 'fixture', version: null },
  ...(fullLink
    ? [
        {
          role: 'link-runtime' as const,
          name: '@fixture/runtime',
          version: '1.0.0',
        },
      ]
    : []),
];

describe('canonical build planning (INCR-7, INCR-10)', () => {
  let root: string;
  let pipelineDir: string;
  let workDir: string;
  let source: string;
  let runtime: string;
  let generator: string;
  let checker: string;
  let pipeline: Pipeline;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-plan-'));
    pipelineDir = join(root, 'pipelines', 'fixture');
    workDir = join(root, 'work');
    await mkdir(join(pipelineDir, 'refs'), { recursive: true });
    await mkdir(workDir);

    await writeFile(
      join(pipelineDir, 'text2gears.md'),
      formatDoc(
        'text',
        '.md',
        'gears',
        '.md',
        '\n## Pin Inputs\n\n- `refs/rules.md`\n',
      ),
    );
    await writeFile(
      join(pipelineDir, 'refs', 'rules.md'),
      '## Pin Inputs\n\n- `refs/data.json`\n',
    );
    await writeFile(join(pipelineDir, 'refs', 'data.json'), '{"rule":1}\n');
    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      formatDoc('gears', '.md', 'fsm', '.ts', '\n## Pin Inputs\n'),
    );
    await writeFile(
      join(pipelineDir, 'a-opt.md'),
      formatDoc('gears', '.md', 'gears', '.md', '\n## Pin Inputs\n'),
    );
    await writeFile(
      join(pipelineDir, 'z-opt.md'),
      formatDoc('gears', '.md', 'gears', '.md', '\n## Pin Inputs\n'),
    );
    await writeFile(
      join(pipelineDir, 'link.md'),
      formatDoc(
        'fsm',
        '.ts',
        'run',
        '.ts',
        [
          '',
          '## Pin Inputs',
          '',
          '## Link Targets',
          '',
          '| Target form | Meaning |',
          '| --- | --- |',
          '| `<path>.ts` | Runtime module. |',
        ].join('\n'),
      ),
    );
    source = join(workDir, 'workflow.txt');
    runtime = join(root, 'runtime.ts');
    generator = join(root, 'tools', 'entry-generator.ts');
    checker = join(root, 'tools', 'verifier.ts');
    await mkdir(dirname(generator), { recursive: true });
    await writeFile(source, 'raw source\n');
    await writeFile(runtime, 'export const runtime = 1;\n');
    await writeFile(generator, 'export const generator = 1;\n');
    await writeFile(checker, 'export const checker = 1;\n');
    pipeline = await loadPipeline(pipelineDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fullInvocation = (): Extract<Invocation, { kind: 'full' }> => ({
    kind: 'full',
    pipeline: 'fixture',
    source,
    output: null,
    optimize: false,
    noOptimize: false,
    normalize: false,
  });

  const linkInvocation = (
    optionValue = '7',
  ): Extract<Invocation, { kind: 'full-link' }> => ({
    kind: 'full-link',
    pipeline: 'fixture',
    source,
    linkTarget: runtime,
    output: null,
    options: [
      { name: 'seed', value: optionValue },
      { name: 'mode', value: 'safe' },
    ],
    optimize: false,
    noOptimize: false,
    normalize: false,
  });

  const topology = async (
    invocation: Extract<Invocation, { kind: 'full' | 'full-link' }>,
  ): Promise<FullBuildTopology> =>
    planFullBuild({
      invocation,
      pipeline,
      cwd: workDir,
      ...(invocation.kind === 'full-link'
        ? { link: await loadLinkFile(join(pipelineDir, 'link.md')) }
        : {}),
    });

  const identityContext = (
    fullLink: boolean,
    overrides: Partial<BuildIdentityContext> = {},
  ): BuildIdentityContext => ({
    interpretedExecutor: {
      kind: 'value',
      value: 'sublang.slc.interpreted-executor.v1:fixture',
    },
    compiledExecutor: {
      kind: 'value',
      value: 'sublang.slc.compiled-host.v1:fixture',
    },
    compiledProfile: () => 'fixture-v1',
    packages: packages(fullLink),
    compatibility: [
      { name: 'artifact-schema', value: '1', currentness: 'gate' },
      { name: 'compiler-note', value: 'fixture', currentness: 'provenance' },
    ],
    deterministic: {
      components: [
        {
          id: 'checker:verification',
          kind: 'checker',
          source: { kind: 'file', path: checker },
        },
        {
          id: 'generator:entry',
          kind: 'generator',
          source: { kind: 'file', path: generator },
        },
      ],
      products: [
        {
          id: 'entry:workflow',
          kind: 'entry',
          path: join(workDir, 'workflow.ts'),
          inputs: ['generator:entry'],
        },
        {
          id: 'verification:workflow',
          kind: 'verification',
          path: join(workDir, 'workflow.fixture', 'workflow.verify.test.ts'),
          inputs: ['checker:verification'],
        },
      ],
    },
    ...overrides,
  });

  it('extracts normalize, phase, sorted pass, and link topology without writes', async () => {
    const planned = await topology(linkInvocation());

    expect(planned.steps.map((step) => step.id)).toEqual([
      'normalize:000000',
      'phase:000000',
      'pass:000000',
      'pass:000001',
      'phase:000001',
      'link:000000',
    ]);
    expect(
      planned.steps.map((step) =>
        step.request.kind === 'compile'
          ? step.request.target
          : step.request.linked,
      ),
    ).toEqual([
      join(workDir, 'workflow.fixture', 'workflow.text.md'),
      join(workDir, 'workflow.fixture', 'workflow.gears.raw.md'),
      join(workDir, 'workflow.fixture', 'workflow.gears.opt1.md'),
      join(workDir, 'workflow.fixture', 'workflow.gears.md'),
      join(workDir, 'workflow.fixture', 'workflow.fsm.ts'),
      join(workDir, 'workflow.fixture', 'workflow.run.ts'),
    ]);
    expect(planned.invocation).toMatchObject({
      kind: 'full-link',
      normalize: true,
      optimize: true,
      link: { options: linkInvocation().options },
    });
    const link = planned.steps.at(-1)?.request;
    expect(link?.kind).toBe('link');
    if (link?.kind === 'link') {
      expect(link.objects).toEqual([
        join(workDir, 'workflow.fixture', 'workflow.fsm.ts'),
      ]);
      expect(link.options).toEqual(linkInvocation().options);
    }
    await expect(access(planned.artifactDir)).rejects.toThrow();
  });

  it('identifies exact inputs, open/closed closures, products, and provenance', async () => {
    const planned = await identifyBuildPlan(
      await topology(linkInvocation()),
      identityContext(true),
    );

    expect(planned.plan.steps.map((step) => step.inputClosure)).toEqual([
      'open',
      'closed',
      'closed',
      'closed',
      'closed',
      'closed',
    ]);
    expect(planned.plan.inputs.map((input) => input.id)).toEqual(
      [...planned.plan.inputs.map((input) => input.id)].sort(),
    );
    const normalizeInputs = planned.plan.steps[0].inputs.map((id) =>
      planned.plan.inputs.find((input) => input.id === id),
    );
    expect(
      normalizeInputs.some(
        (input) =>
          input?.kind === 'semantic-input' &&
          input.locator?.endsWith('/text2gears.md'),
      ),
    ).toBe(true);
    expect(
      normalizeInputs
        .filter((input) => input?.kind === 'semantic-input')
        .map((input) => input?.locator),
    ).toEqual(
      expect.arrayContaining([
        '../../pipelines/fixture/refs/data.json',
        '../../pipelines/fixture/refs/rules.md',
      ]),
    );
    const textStep = planned.plan.steps[1];
    expect(
      textStep.inputs
        .map((id) => planned.plan.inputs.find((input) => input.id === id))
        .filter((input) => input?.kind === 'semantic-input')
        .map((input) => input?.locator),
    ).toEqual([
      '../../pipelines/fixture/refs/data.json',
      '../../pipelines/fixture/refs/rules.md',
    ]);
    expect(planned.plan.invocation.link?.target).toBe('../../runtime.ts');
    expect(
      planned.plan.inputs.find((input) => input.kind === 'link-target'),
    ).toMatchObject({ locator: '../../runtime.ts', value: null });
    expect(planned.plan.deterministicInputs).toEqual([
      'checker:verification',
      'generator:entry',
    ]);
    expect(planned.products.map((product) => product.kind)).toContain('entry');
    expect(planned.provenance.packages.map((pkg) => pkg.role)).toEqual([
      'slc',
      'pipeline',
      'link-runtime',
    ]);
    expect(
      planned.provenance.compatibility.find(
        (value) => value.name === 'artifact-schema',
      )?.input,
    ).toMatch(/^compatibility:/);
    expect(
      planned.selections.every((value) => value.kind === 'interpreted'),
    ).toBe(true);
  });

  it('changes identity for semantic inputs and currentness gates, not source or version provenance', async () => {
    const build = async (
      invocation = linkInvocation(),
      context = identityContext(true),
    ) => identifyBuildPlan(await topology(invocation), context);
    const baseline = (await build()).plan.identity;

    await writeFile(source, 'different source bytes\n');
    expect((await build()).plan.identity).toBe(baseline);

    expect(
      (
        await build(
          linkInvocation(),
          identityContext(true, { packages: packages(true, '99.0.0') }),
        )
      ).plan.identity,
    ).toBe(baseline);
    expect(
      (
        await build(
          linkInvocation(),
          identityContext(true, {
            compatibility: [
              {
                name: 'artifact-schema',
                value: '1',
                currentness: 'gate',
              },
              {
                name: 'compiler-note',
                value: 'changed provenance',
                currentness: 'provenance',
              },
            ],
          }),
        )
      ).plan.identity,
    ).toBe(baseline);
    expect(
      (
        await build(
          linkInvocation(),
          identityContext(true, {
            compatibility: [
              {
                name: 'aaa-earlier-note',
                value: 'added provenance',
                currentness: 'provenance',
              },
              {
                name: 'artifact-schema',
                value: '1',
                currentness: 'gate',
              },
              {
                name: 'compiler-note',
                value: 'fixture',
                currentness: 'provenance',
              },
            ],
          }),
        )
      ).plan.identity,
    ).toBe(baseline);

    await writeFile(join(pipelineDir, 'refs', 'data.json'), '{"rule":2}\n');
    expect((await build()).plan.identity).not.toBe(baseline);
    await writeFile(join(pipelineDir, 'refs', 'data.json'), '{"rule":1}\n');

    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      `${await readFile(join(pipelineDir, 'gears2fsm.md'), 'utf8')}\nchanged\n`,
    );
    expect((await build()).plan.identity).not.toBe(baseline);
  });

  it('binds executor, link target/options, deterministic tools, and compatibility gates', async () => {
    const baseTopology = await topology(linkInvocation());
    const baseline = (
      await identifyBuildPlan(baseTopology, identityContext(true))
    ).plan.identity;

    expect(
      (
        await identifyBuildPlan(
          baseTopology,
          identityContext(true, {
            interpretedExecutor: {
              kind: 'value',
              value: 'different executor',
            },
          }),
        )
      ).plan.identity,
    ).not.toBe(baseline);
    expect(
      (
        await identifyBuildPlan(
          await topology(linkInvocation('8')),
          identityContext(true),
        )
      ).plan.identity,
    ).not.toBe(baseline);

    await writeFile(runtime, 'export const runtime = 2;\n');
    expect(
      (await identifyBuildPlan(baseTopology, identityContext(true))).plan
        .identity,
    ).not.toBe(baseline);
    await writeFile(runtime, 'export const runtime = 1;\n');

    await writeFile(generator, 'export const generator = 2;\n');
    expect(
      (await identifyBuildPlan(baseTopology, identityContext(true))).plan
        .identity,
    ).not.toBe(baseline);
    await writeFile(generator, 'export const generator = 1;\n');

    expect(
      (
        await identifyBuildPlan(
          baseTopology,
          identityContext(true, {
            compatibility: [
              {
                name: 'artifact-schema',
                value: '2',
                currentness: 'gate',
              },
              {
                name: 'compiler-note',
                value: 'fixture',
                currentness: 'provenance',
              },
            ],
          }),
        )
      ).plan.identity,
    ).not.toBe(baseline);
    expect(
      (
        await identifyBuildPlan(
          baseTopology,
          identityContext(true, {
            compatibility: [
              {
                name: 'renamed-artifact-schema',
                value: '1',
                currentness: 'gate',
              },
              {
                name: 'compiler-note',
                value: 'fixture',
                currentness: 'provenance',
              },
            ],
          }),
        )
      ).plan.identity,
    ).not.toBe(baseline);
  });

  it('canonicalizes descriptor order and supports a value-backed package target', async () => {
    const base = identityContext(true);
    const first = await identifyBuildPlan(
      await topology(linkInvocation()),
      base,
    );
    const reversed = await identifyBuildPlan(await topology(linkInvocation()), {
      ...base,
      packages: [...base.packages].reverse(),
      compatibility: [...(base.compatibility ?? [])].reverse(),
      deterministic: {
        components: [...(base.deterministic?.components ?? [])].reverse(),
        products: [...(base.deterministic?.products ?? [])].reverse(),
      },
      linkTarget: {
        kind: 'value',
        value: '@fixture/runtime/contract',
      },
    });
    const valueTarget = reversed.plan.inputs.find(
      (input) => input.kind === 'link-target',
    );
    expect(valueTarget).toMatchObject({
      locator: null,
      value: '@fixture/runtime/contract',
    });

    const reversedFileTarget = await identifyBuildPlan(
      await topology(linkInvocation()),
      {
        ...base,
        packages: [...base.packages].reverse(),
        compatibility: [...(base.compatibility ?? [])].reverse(),
        deterministic: {
          components: [...(base.deterministic?.components ?? [])].reverse(),
          products: [...(base.deterministic?.products ?? [])].reverse(),
        },
      },
    );
    expect(reversedFileTarget.plan.identity).toBe(first.plan.identity);
  });

  it('selects a current compiled pin and fails closed after it becomes stale', async () => {
    const bundle = join(pipelineDir, 'text2gears.slc');
    await mkdir(bundle);
    const artifact = join(bundle, 'text2gears.playbook.ts');
    await writeFile(
      artifact,
      'export default function createPlaybookRuntime() { return {}; }\n',
    );
    for (const name of [
      'text2gears.fsm.ts',
      'text2gears.gears.md',
      'text2gears.gears-fsm.test.ts',
      'text2gears.fsm.introspect.test.ts',
      'text2gears.prompt-contract.test.ts',
      'text2gears.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(bundle, name), `${name}\n`);
    }
    const pinTarget = join(pipelineDir, 'pin-runtime.ts');
    await writeFile(pinTarget, 'pin runtime\n');
    const record = await generatePinRecord(pipelineDir, {
      definition: 'text2gears.md',
      artifact: 'text2gears.slc/text2gears.playbook.ts',
      artifactBundle: 'text2gears.slc',
      linkTarget: { kind: 'file', locator: 'pin-runtime.ts' },
      externalInputs: [
        { name: 'fixture', identity: await hashFile(pinTarget) },
      ],
    });
    const passBundle = join(pipelineDir, 'a-opt.slc');
    await mkdir(passBundle);
    await writeFile(
      join(passBundle, 'a-opt.playbook.ts'),
      'export default function createPlaybookRuntime() { return {}; }\n',
    );
    for (const name of [
      'a-opt.fsm.ts',
      'a-opt.gears.md',
      'a-opt.gears-fsm.test.ts',
      'a-opt.fsm.introspect.test.ts',
      'a-opt.prompt-contract.test.ts',
      'a-opt.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(passBundle, name), `${name}\n`);
    }
    const passRecord = await generatePinRecord(pipelineDir, {
      definition: 'a-opt.md',
      artifact: 'a-opt.slc/a-opt.playbook.ts',
      artifactBundle: 'a-opt.slc',
      linkTarget: { kind: 'file', locator: 'pin-runtime.ts' },
    });
    await writeFile(
      join(pipelineDir, 'normalize.md'),
      formatDoc('gears', '.md', 'gears', '.md', '\n## Pin Inputs\n'),
    );
    const normalizePassBundle = join(pipelineDir, 'normalize.slc');
    await mkdir(normalizePassBundle);
    await writeFile(
      join(normalizePassBundle, 'normalize.playbook.ts'),
      'export default function createPlaybookRuntime() { return {}; }\n',
    );
    for (const name of [
      'normalize.fsm.ts',
      'normalize.gears.md',
      'normalize.gears-fsm.test.ts',
      'normalize.fsm.introspect.test.ts',
      'normalize.prompt-contract.test.ts',
      'normalize.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(normalizePassBundle, name), `${name}\n`);
    }
    const normalizePassRecord = await generatePinRecord(pipelineDir, {
      definition: 'normalize.md',
      artifact: 'normalize.slc/normalize.playbook.ts',
      artifactBundle: 'normalize.slc',
      linkTarget: { kind: 'file', locator: 'pin-runtime.ts' },
    });
    await writePinFile(pipelineDir, {
      text2gears: record,
      'a-opt': passRecord,
      normalize: normalizePassRecord,
    });
    await writeFile(join(root, 'pipelines', 'shared.md'), 'shared input\n');
    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      formatDoc(
        'gears',
        '.md',
        'fsm',
        '.ts',
        '\n## Pin Inputs\n\n- `../shared.md`\n',
      ),
    );
    pipeline = await loadPipeline(pipelineDir);

    const planned = await identifyBuildPlan(
      await topology(fullInvocation()),
      identityContext(false, {
        deterministic: undefined,
        compatibility: [],
      }),
    );
    const selected = planned.selections.find(
      (selection) => selection.stepId === 'phase:000000',
    );
    expect(selected).toMatchObject({ kind: 'compiled', profile: 'fixture-v1' });
    expect(
      planned.selections.find(
        (selection) => selection.stepId === 'pass:000000',
      ),
    ).toMatchObject({ kind: 'compiled', profile: 'fixture-v1' });
    const builtInNormalize = planned.plan.steps.find(
      (step) => step.kind === 'normalize',
    );
    const pinnedNormalizePass = planned.plan.steps.find(
      (step) => step.kind === 'pass' && step.name === 'normalize',
    );
    expect(
      planned.selections.find(
        (selection) => selection.stepId === builtInNormalize?.id,
      ),
    ).toEqual({ stepId: builtInNormalize?.id, kind: 'interpreted' });
    expect(
      planned.selections.find(
        (selection) => selection.stepId === pinnedNormalizePass?.id,
      ),
    ).toMatchObject({ kind: 'compiled', profile: 'fixture-v1' });
    const executor = planned.plan.inputs.find(
      (input) => input.id === 'executor:phase.000000',
    );
    expect(executor?.value).toContain('sublang.slc.compiled-executor.v1');
    expect(executor?.value).toContain(record.artifactBundle.hash);

    const changedHost = await identifyBuildPlan(
      await topology(fullInvocation()),
      identityContext(false, {
        compiledExecutor: {
          kind: 'value',
          value: 'sublang.slc.compiled-host.v1:other-agent-model',
        },
        deterministic: undefined,
        compatibility: [],
      }),
    );
    expect(changedHost.plan.identity).not.toBe(planned.plan.identity);

    record.linkTarget.provenance = 'provenance-only@99';
    await writePinFile(pipelineDir, {
      text2gears: record,
      'a-opt': passRecord,
      normalize: normalizePassRecord,
    });
    const changedProvenance = await identifyBuildPlan(
      await topology(fullInvocation()),
      identityContext(false, {
        deterministic: undefined,
        compatibility: [],
      }),
    );
    expect(changedProvenance.plan.identity).toBe(planned.plan.identity);

    await writeFile(artifact, 'changed after review\n');
    await expect(
      identifyBuildPlan(
        await topology(fullInvocation()),
        identityContext(false, {
          deterministic: undefined,
          compatibility: [],
        }),
      ),
    ).rejects.toMatchObject<Partial<BuildPlanError>>({ code: 'pin-invalid' });
  });

  it('fails identification for a missing declared semantic input', async () => {
    await rm(join(pipelineDir, 'refs', 'data.json'));
    await expect(
      identifyBuildPlan(
        await topology(fullInvocation()),
        identityContext(false, {
          deterministic: undefined,
          compatibility: [],
        }),
      ),
    ).rejects.toThrow(/ENOENT|no such file/i);
  });
});

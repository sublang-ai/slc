// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILD_RECORD_FILE,
  SOURCE_SNAPSHOT_FILE,
  decodeBuildRecord,
  encodeBuildRecord,
  encodeReadLocator,
  planIdentity,
  stepInputKey,
  type BuildRecord,
  type ProductRecord,
} from '../src/build-record.js';
import {
  identifyBuildPlan,
  planFullBuild,
  type BuildIdentityContext,
  type CanonicalBuildPlan,
  type DeterministicProduct,
  type FullBuildTopology,
} from '../src/build-plan.js';
import type {
  ExecuteRequest,
  ExecutorResult,
  PhaseExecutor,
} from '../src/execution.js';
import { hashBytes, hashFile } from '../src/hash.js';
import type { Invocation } from '../src/invocation.js';
import { classifyLineage } from '../src/lineage-classification.js';
import { loadLinkFile } from '../src/link.js';
import { generatePinRecord, writePinFile } from '../src/pin-generate.js';
import { PINS_FILE } from '../src/pins.js';
import { loadPipeline } from '../src/pipeline.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import type { WorkspaceRecord } from '../src/workspace.js';

const phaseDoc = (
  source: string,
  sourceExt: string,
  target: string,
  targetExt: string,
  semanticInput?: string,
  closed = true,
): string =>
  [
    '# Fixture phase',
    '',
    '## Formats',
    '',
    '| Role | Format | Extension |',
    '| --- | --- | --- |',
    `| source | ${source} | ${sourceExt} |`,
    `| target | ${target} | ${targetExt} |`,
    '',
    ...(closed
      ? [
          '## Pin Inputs',
          '',
          ...(semanticInput === undefined ? [] : [`- \`${semanticInput}\``]),
          '',
        ]
      : []),
  ].join('\n');

const linkDoc = (sourceFormat = 'out'): string =>
  [
    '# Fixture link',
    '',
    '## Formats',
    '',
    '| Role | Format | Extension |',
    '| --- | --- | --- |',
    `| source | ${sourceFormat} | .ts |`,
    '| target | run | .ts |',
    '',
    '## Pin Inputs',
    '',
    '## Link Targets',
    '',
    '| Target form | Meaning |',
    '| --- | --- |',
    '| `<path>.ts` | Fixture runtime. |',
    '',
  ].join('\n');

interface RecordingExecutor extends PhaseExecutor {
  calls: Array<{ request: ExecuteRequest; workspace: WorkspaceRecord }>;
}

async function fingerprint(path: string, base = path): Promise<string[]> {
  const info = await lstat(path);
  const name = relative(base, path) || '.';
  if (info.isSymbolicLink()) return [`${name}:symlink:${await readlink(path)}`];
  if (info.isFile()) {
    return [`${name}:file:${hashBytes(await readFile(path))}`];
  }
  if (!info.isDirectory()) return [`${name}:other:${info.mode}`];
  const result = [`${name}:directory`];
  for (const entry of (await readdir(path)).sort()) {
    result.push(...(await fingerprint(join(path, entry), base)));
  }
  return result;
}

describe('existing lineage classification (INCR-6, INCR-9, INCR-11)', () => {
  let root: string;
  let workDir: string;
  let pipelineDir: string;
  let sourcePath: string;
  let runtimePath: string;
  let artifactDir: string;
  let definitionPath: string;
  let semanticInputPath: string;
  let executorIdentity: string;
  let executorIdentityTree: string | undefined;
  let gateValue: string;
  let provenanceValue: string;
  let packageVersion: string;
  let linkOption: string;
  let compiledFactories: number;
  let performing: RecordingExecutor;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-lineage-classification-'));
    workDir = join(root, 'work');
    pipelineDir = join(root, 'pipeline');
    sourcePath = join(workDir, 'workflow.md');
    runtimePath = join(root, 'runtime.ts');
    artifactDir = join(workDir, 'workflow.flow');
    definitionPath = join(pipelineDir, 'mid2out.md');
    semanticInputPath = join(pipelineDir, 'refs', 'shared.md');
    executorIdentity = 'fixture-interpreter-v1';
    executorIdentityTree = undefined;
    gateValue = 'gate-v1';
    provenanceValue = 'provenance-v1';
    packageVersion = '1.0.0';
    linkOption = 'one';
    compiledFactories = 0;

    await Promise.all([
      mkdir(workDir),
      mkdir(join(pipelineDir, 'refs'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(pipelineDir, 'text2mid.md'),
        phaseDoc('text', '.md', 'mid', '.md'),
      ),
      writeFile(
        definitionPath,
        phaseDoc('mid', '.md', 'out', '.ts', 'refs/shared.md'),
      ),
      writeFile(join(pipelineDir, 'link.md'), linkDoc()),
      writeFile(semanticInputPath, 'shared input\n'),
      writeFile(sourcePath, 'source bytes\n'),
      writeFile(runtimePath, 'export const runtime = true;\n'),
    ]);

    const calls: RecordingExecutor['calls'] = [];
    performing = {
      calls,
      async run(
        request: ExecuteRequest,
        workspace: WorkspaceRecord,
      ): Promise<ExecutorResult> {
        calls.push({ request, workspace });
        const primary = workspace.reads.find((read) =>
          request.kind === 'compile'
            ? read.role === 'source'
            : read.role === 'object:0',
        );
        if (primary === undefined) {
          return { status: 'error', diagnostics: ['missing fixture input'] };
        }
        const input = await readFile(primary.physicalPath, 'utf8');
        await writeFile(
          workspace.write.physicalPath,
          `${basename(request.definitionPath, '.md')}:${input}`,
        );
        return { status: 'ok', diagnostics: [] };
      },
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const identity = (
    topology: FullBuildTopology,
    deterministic?: BuildIdentityContext['deterministic'],
  ): BuildIdentityContext => ({
    interpretedExecutor:
      executorIdentityTree === undefined
        ? { kind: 'value', value: executorIdentity }
        : { kind: 'tree', path: executorIdentityTree },
    compiledExecutor: { kind: 'value', value: 'fixture-compiled-host-v1' },
    compiledProfile: () => 'fixture-v1',
    packages: [
      {
        role: 'slc',
        name: '@sublang/slc',
        version: packageVersion,
      },
      {
        role: 'pipeline',
        name: 'lineage-classification-fixture',
        version: null,
      },
      ...(topology.invocation.kind === 'full-link'
        ? [
            {
              role: 'link-runtime' as const,
              name: 'fixture-runtime',
              version: null,
            },
          ]
        : []),
    ],
    compatibility: [
      { name: 'fixture-gate', value: gateValue, currentness: 'gate' },
      {
        name: 'fixture-provenance',
        value: provenanceValue,
        currentness: 'provenance',
      },
    ],
    ...(deterministic === undefined ? {} : { deterministic }),
  });

  const argv = (): string[] => [
    'flow',
    sourcePath,
    '--link',
    runtimePath,
    '--link-option',
    `mode=${linkOption}`,
  ];

  const invocation = (): Extract<Invocation, { kind: 'full-link' }> => ({
    kind: 'full-link',
    pipeline: 'flow',
    source: sourcePath,
    linkTarget: runtimePath,
    output: null,
    options: [{ name: 'mode', value: linkOption }],
    optimize: false,
    noOptimize: false,
    normalize: false,
  });

  const topology = async (): Promise<FullBuildTopology> => {
    const pipeline = await loadPipeline(pipelineDir);
    return planFullBuild({
      invocation: invocation(),
      pipeline,
      cwd: workDir,
      link: await loadLinkFile(pipeline.linkFile as string),
    });
  };

  const currentPlan = async (
    deterministic?: BuildIdentityContext['deterministic'],
  ): Promise<CanonicalBuildPlan> => {
    const planned = await topology();
    return identifyBuildPlan(planned, identity(planned, deterministic));
  };

  const deps = (): SlcDeps => ({
    resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
    executor: performing,
    compiled: () => {
      compiledFactories++;
      return performing;
    },
    buildIdentity: identity,
    cwd: workDir,
  });

  const seed = async (): Promise<void> => {
    const result = await runSlc(argv(), deps());
    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    performing.calls.length = 0;
    compiledFactories = 0;
  };

  const classify = async (
    deterministic?: BuildIdentityContext['deterministic'],
  ) => {
    const plan = await currentPlan(deterministic);
    return classifyLineage(plan);
  };

  const readRecord = async (): Promise<BuildRecord> =>
    decodeBuildRecord(await readFile(join(artifactDir, BUILD_RECORD_FILE)));

  const writeRecord = async (record: BuildRecord): Promise<void> => {
    await writeFile(
      join(artifactDir, BUILD_RECORD_FILE),
      encodeBuildRecord(record),
    );
  };

  const adoptRecord = async (onlyFirst = false): Promise<void> => {
    const record = await readRecord();
    for (const [index, step] of record.plan.steps.entries()) {
      if (!onlyFirst || index === 0) step.origin = 'user-adopted';
      step.trace = null;
    }
    await writeRecord(record);
  };

  const expectReadOnly = async <T>(action: () => Promise<T>): Promise<T> => {
    const before = await fingerprint(root);
    const calls = performing.calls.length;
    const factories = compiledFactories;
    const result = await action();
    expect(await fingerprint(root)).toEqual(before);
    expect(performing.calls).toHaveLength(calls);
    expect(compiledFactories).toBe(factories);
    return result;
  };

  const semanticProductPath = async (index = 0): Promise<string> => {
    const record = await readRecord();
    const product = record.products.filter(
      (candidate) => candidate.kind === 'semantic',
    )[index] as ProductRecord;
    return resolve(artifactDir, ...product.path.split('/'));
  };

  const driftTopology = async (): Promise<void> => {
    const changedDefinitionPath = join(pipelineDir, 'mid2result.md');
    await writeFile(
      changedDefinitionPath,
      phaseDoc('mid', '.md', 'result', '.ts', 'refs/shared.md'),
    );
    await rm(definitionPath);
    definitionPath = changedDefinitionPath;
    await writeFile(join(pipelineDir, 'link.md'), linkDoc('result'));
  };

  it('classifies absent, closed-current, and open-current lineages without writes', async () => {
    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'cold',
    });

    await seed();
    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'current',
      wholeLineageReusable: true,
      openStepIds: [],
    });

    await rm(artifactDir, { recursive: true });
    await writeFile(
      join(pipelineDir, 'text2mid.md'),
      phaseDoc('text', '.md', 'mid', '.md', undefined, false),
    );
    await seed();
    const open = await expectReadOnly(() => classify());
    expect(open).toMatchObject({
      state: 'current',
      wholeLineageReusable: false,
    });
    expect(open.state === 'current' ? open.openStepIds : []).toContain(
      'phase:000000',
    );
  });

  it.each([
    {
      name: 'source bytes',
      mutate: async () => writeFile(sourcePath, 'changed source\n'),
    },
    {
      name: 'definition identity',
      mutate: async () =>
        writeFile(
          definitionPath,
          (await readFile(definitionPath, 'utf8')).replace(
            '# Fixture phase',
            '# Changed fixture phase',
          ),
        ),
    },
    {
      name: 'declared semantic input',
      mutate: async () =>
        writeFile(semanticInputPath, 'changed shared input\n'),
    },
    {
      name: 'executor identity',
      mutate: async () => {
        executorIdentity = 'fixture-interpreter-v2';
      },
    },
    {
      name: 'link option',
      mutate: async () => {
        linkOption = 'two';
      },
    },
    {
      name: 'compatibility gate',
      mutate: async () => {
        gateValue = 'gate-v2';
      },
    },
    {
      name: 'ordered semantic topology',
      mutate: driftTopology,
    },
  ])(
    'selects ordinary dirty planning for non-adopted $name drift',
    async ({ mutate }) => {
      await seed();
      await mutate();

      const result = await expectReadOnly(() => classify());

      expect(result.state).toBe('dirty-input');
      if (result.state === 'dirty-input') {
        expect(result.ordinaryDirtySteps.length).toBeGreaterThan(0);
      }
    },
  );

  it('does not make package or compatibility provenance part of currentness', async () => {
    await seed();
    packageVersion = '99.0.0';
    provenanceValue = 'provenance-v2';

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'current',
      wholeLineageReusable: true,
    });
  });

  it.each([
    {
      name: 'normalize flag without a normalization step',
      mutate: async (record: BuildRecord) => {
        record.plan.invocation.normalize = true;
      },
    },
    {
      name: 'pass step while optimization is disabled',
      prepare: async () => {
        await writeFile(
          join(pipelineDir, 'optimize.md'),
          phaseDoc('out', '.ts', 'out', '.ts'),
        );
      },
      mutate: async (record: BuildRecord) => {
        record.plan.invocation.optimize = false;
      },
    },
    {
      name: 'full-link topology without a phase',
      mutate: async (record: BuildRecord) => {
        const link = record.plan.steps.at(
          -1,
        ) as BuildRecord['plan']['steps'][number];
        const linkProduct = record.products.find(
          (product) => product.id === link.target.product,
        ) as ProductRecord;
        const retainedInputs = new Set([
          ...link.inputs,
          ...record.plan.inputs
            .filter((input) => input.kind === 'compatibility')
            .map((input) => input.id),
        ]);
        record.plan.inputs = record.plan.inputs.filter((input) =>
          retainedInputs.has(input.id),
        );
        record.plan.steps = [
          {
            ...link,
            inputKey: stepInputKey(link.id, [
              { kind: 'source', hash: record.source.hash },
            ]),
          },
        ];
        record.products = [linkProduct];
      },
    },
  ])('rejects recorded $name as incompatible', async ({ prepare, mutate }) => {
    await prepare?.();
    await seed();
    const record = await readRecord();
    await mutate(record);
    record.plan.identity = planIdentity(record.plan);
    await writeRecord(record);

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'incompatible',
      recovery: ['rebuild'],
    });
  });

  it('observes an exact locator-backed tree and rejects drift or nested links', async () => {
    executorIdentityTree = join(root, 'executor-tree');
    await mkdir(join(executorIdentityTree, 'nested'), { recursive: true });
    const implementation = join(executorIdentityTree, 'nested', 'host.js');
    await writeFile(implementation, 'export const host = 1;\n');
    await seed();

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'current',
    });

    await writeFile(implementation, 'export const host = 2;\n');
    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'dirty-input',
    });

    await rm(implementation);
    await symlink(sourcePath, implementation);
    await expect(classify()).rejects.toThrow(/symbolic link/i);
  });

  it('uses whole-lineage adoption only when every step is user-adopted', async () => {
    await seed();
    await adoptRecord(true);
    await writeFile(sourcePath, 'changed source\n');

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'dirty-input',
    });
  });

  it('rejects adopted source drift but permits compatible identity re-attestation', async () => {
    await seed();
    await adoptRecord();
    await writeFile(sourcePath, 'changed source\n');
    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'automatic-conflict',
      recovery: ['rebuild'],
    });

    await writeFile(sourcePath, 'source bytes\n');
    executorIdentity = 'fixture-interpreter-v2';
    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'adoption-eligible-conflict',
      recovery: ['adopt', 'rebuild'],
    });
  });

  it.each(['adopted', 'managed-drift'] as const)(
    'makes $mode topology drift rebuild-only incompatible',
    async (mode) => {
      await seed();
      if (mode === 'adopted') await adoptRecord();
      else await writeFile(await semanticProductPath(1), 'manual refinement\n');
      await driftTopology();

      expect(await expectReadOnly(() => classify())).toMatchObject({
        state: 'incompatible',
        recovery: ['rebuild'],
      });
    },
  );

  it('classifies safe semantic refinement for adoption and lets product conflict dominate dirty input', async () => {
    await seed();
    const product = await semanticProductPath(1);
    await writeFile(product, 'manual semantic refinement\n');

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'adoption-eligible-conflict',
      recovery: ['adopt', 'rebuild'],
    });

    await writeFile(sourcePath, 'changed source too\n');
    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'automatic-conflict',
      recovery: ['rebuild'],
    });
  });

  const deterministicBaseline = async (): Promise<{
    deterministic: NonNullable<BuildIdentityContext['deterministic']>;
    path: string;
  }> => {
    const path = join(artifactDir, 'workflow.fixture.verify.ts');
    await writeFile(path, 'generated verification\n');
    const product: DeterministicProduct = {
      id: 'verification:fixture',
      kind: 'verification',
      path,
      inputs: ['checker:fixture', 'generator:fixture'],
    };
    const deterministic = {
      components: [
        {
          id: 'checker:fixture',
          kind: 'checker' as const,
          source: { kind: 'value' as const, value: 'checker-v1' },
        },
        {
          id: 'generator:fixture',
          kind: 'generator' as const,
          source: { kind: 'value' as const, value: 'generator-v1' },
        },
      ],
      products: [product],
    };
    const plan = await currentPlan(deterministic);
    const record = await readRecord();
    const oldSteps = new Map(record.plan.steps.map((step) => [step.id, step]));
    record.plan = {
      identity: plan.plan.identity,
      pipeline: plan.plan.pipeline,
      invocation: plan.plan.invocation,
      inputs: plan.plan.inputs.map((input) => ({ ...input })),
      deterministicInputs: [...plan.plan.deterministicInputs],
      steps: plan.plan.steps.map((step) => {
        const old = oldSteps.get(
          step.id,
        ) as BuildRecord['plan']['steps'][number];
        return {
          id: step.id,
          kind: step.kind,
          name: step.name,
          source: {
            format: step.source.format,
            ext: step.source.ext,
          },
          target: {
            format: step.target.format,
            ext: step.target.ext,
            path: step.target.path,
            product: step.target.product,
          },
          inputKey: old.inputKey,
          inputs: [...step.inputs],
          inputClosure: step.inputClosure,
          origin: old.origin,
          trace: old.trace,
        };
      }),
    };
    record.products.push({
      id: product.id,
      kind: product.kind,
      path: (
        plan.products.find(
          (item) => item.id === product.id,
        ) as DeterministicProduct
      ).path,
      hash: await hashFile(path),
      inputs: [...product.inputs].sort(),
    });
    record.products.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    record.provenance = {
      packages: plan.provenance.packages.map((item) => ({ ...item })),
      compatibility: plan.provenance.compatibility.map((item) => ({ ...item })),
    };
    await writeRecord(record);
    return { deterministic, path };
  };

  const currentOnlyDeterministic = (path: string) => ({
    components: [
      {
        id: 'generator:new-verifier',
        kind: 'generator' as const,
        source: { kind: 'value' as const, value: 'generator-v1' },
      },
    ],
    products: [
      {
        id: 'verification:new-verifier',
        kind: 'verification' as const,
        path,
        inputs: ['generator:new-verifier'],
      },
    ],
  });

  it.each(['missing', 'changed'] as const)(
    'keeps a safe %s deterministic derivative adoption-eligible',
    async (mode) => {
      await seed();
      const { deterministic, path } = await deterministicBaseline();
      if (mode === 'missing') await rm(path);
      else await writeFile(path, 'locally changed verification\n');

      expect(await expectReadOnly(() => classify(deterministic))).toMatchObject(
        {
          state: 'adoption-eligible-conflict',
          recovery: ['adopt', 'rebuild'],
        },
      );
    },
  );

  it('keeps deterministic-only identity drift out of ordinary semantic steps', async () => {
    await seed();
    const { deterministic } = await deterministicBaseline();
    const changed = {
      ...deterministic,
      components: deterministic.components.map((component) =>
        component.id === 'generator:fixture'
          ? {
              ...component,
              source: { kind: 'value' as const, value: 'generator-v2' },
            }
          : component,
      ),
    };

    expect(await expectReadOnly(() => classify(changed))).toMatchObject({
      state: 'dirty-input',
      ordinaryDirtySteps: [],
    });
  });

  it.each(['absent', 'regular'] as const)(
    'treats a safe %s current-only deterministic destination as input drift',
    async (state) => {
      await seed();
      const destination = join(artifactDir, 'workflow.new.verify.ts');
      if (state === 'regular') {
        await writeFile(destination, 'preexisting safe file\n');
      }

      expect(
        await expectReadOnly(() =>
          classify(currentOnlyDeterministic(destination)),
        ),
      ).toMatchObject({
        state: 'dirty-input',
        ordinaryDirtySteps: [],
      });
    },
  );

  it('rejects an unsafe current-only deterministic destination', async () => {
    await seed();
    const destination = join(artifactDir, 'workflow.new.verify.ts');
    const outside = join(root, 'outside-current-only.ts');
    await writeFile(outside, 'outside\n');
    await symlink(outside, destination);

    expect(
      await expectReadOnly(() =>
        classify(currentOnlyDeterministic(destination)),
      ),
    ).toMatchObject({ state: 'incompatible', recovery: ['rebuild'] });
  });

  it.each(['entry', 'verification'] as const)(
    'rejects a forged built-in-looking %s product without its topology',
    async (kind) => {
      await seed();
      const record = await readRecord();
      const definitions =
        kind === 'entry'
          ? ([
              ['checker:load-integrity', 'checker'],
              ['generator:entry', 'generator'],
            ] as const)
          : ([
              ['checker:load-integrity', 'checker'],
              ['checker:verification', 'checker'],
              ['generator:verification', 'generator'],
            ] as const);
      for (const [id, inputKind] of definitions) {
        const value = `${id}-fixture`;
        record.plan.inputs.push({
          id,
          kind: inputKind,
          locator: null,
          value,
          identity: hashBytes(new TextEncoder().encode(value)),
        });
      }
      record.plan.inputs.sort((left, right) =>
        Buffer.compare(Buffer.from(left.id), Buffer.from(right.id)),
      );
      record.plan.deterministicInputs = definitions.map(([id]) => id).sort();
      const path =
        kind === 'entry' ? '../workflow.ts' : 'workflow.gears-fsm.test.ts';
      const physical = resolve(artifactDir, ...path.split('/'));
      await writeFile(physical, 'forged derivative\n');
      record.products.push({
        id:
          kind === 'entry'
            ? 'entry:workflow'
            : 'verification:test.gears-fsm.test.ts',
        kind,
        path,
        hash: await hashFile(physical),
        inputs: definitions.map(([id]) => id).sort(),
      });
      record.products.sort((left, right) =>
        Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
      );
      record.plan.identity = planIdentity(record.plan);
      await writeRecord(record);

      expect(await expectReadOnly(() => classify())).toMatchObject({
        state: 'incompatible',
        recovery: ['rebuild'],
      });
    },
  );

  it('rejects a reserved playbook topology with an incomplete built-in derivative set', async () => {
    await seed();
    const planned = await currentPlan();
    const record = await readRecord();
    const [gears, fsm, link] = record.plan.steps;
    if (gears === undefined || fsm === undefined || link === undefined) {
      throw new Error('fixture does not have two phases and a link');
    }
    gears.name = 'text2gears';
    gears.source = { format: 'text', ext: '.md' };
    gears.target = {
      format: 'gears',
      ext: '.md',
      path: 'workflow.gears.md',
      product: gears.target.product,
    };
    fsm.name = 'gears2fsm';
    fsm.source = { format: 'gears', ext: '.md' };
    fsm.target = {
      format: 'fsm',
      ext: '.ts',
      path: 'workflow.fsm.ts',
      product: fsm.target.product,
    };
    link.source = { format: 'fsm', ext: '.ts' };
    link.target = {
      format: 'playbook',
      ext: '.ts',
      path: 'workflow.playbook.ts',
      product: link.target.product,
    };
    for (const step of record.plan.steps) {
      const product = record.products.find(
        (candidate) => candidate.id === step.target.product,
      ) as ProductRecord;
      product.path = step.target.path;
    }
    record.products.sort((left, right) =>
      Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)),
    );
    record.plan.pipeline = 'playbook';
    record.plan.identity = planIdentity(record.plan);
    await writeRecord(record);

    const playbookArtifactDir = join(workDir, 'workflow.playbook');
    await rename(artifactDir, playbookArtifactDir);
    artifactDir = playbookArtifactDir;
    const syntheticPlan: CanonicalBuildPlan = {
      ...planned,
      topology: {
        ...planned.topology,
        artifactDir: playbookArtifactDir,
        pipelineName: 'playbook',
      },
      plan: { ...planned.plan, pipeline: 'playbook' },
    };

    const result = await expectReadOnly(() => classifyLineage(syntheticPlan));
    expect(result).toMatchObject({
      state: 'incompatible',
      recovery: ['rebuild'],
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'record-inventory-invalid',
          detail: expect.stringMatching(/reserved deterministic inventory/),
        }),
      ]),
    );
  });

  it.each([
    {
      name: 'malformed record',
      mutate: async () =>
        writeFile(join(artifactDir, BUILD_RECORD_FILE), '{not json\n'),
    },
    {
      name: 'orphaned record',
      mutate: async () => rm(join(artifactDir, SOURCE_SNAPSHOT_FILE)),
    },
    {
      name: 'symbolic-link metadata',
      mutate: async () => {
        const snapshot = join(artifactDir, SOURCE_SNAPSHOT_FILE);
        const outside = join(root, 'outside.snapshot');
        await copyFile(snapshot, outside);
        await rm(snapshot);
        await symlink(outside, snapshot);
      },
    },
    {
      name: 'inconsistent snapshot',
      mutate: async () =>
        writeFile(join(artifactDir, SOURCE_SNAPSHOT_FILE), 'other snapshot\n'),
    },
    {
      name: 'other source locator',
      mutate: async () => {
        const other = join(workDir, 'other.md');
        await copyFile(sourcePath, other);
        const record = await readRecord();
        record.source.locator = encodeReadLocator(artifactDir, other);
        await writeRecord(record);
      },
    },
    {
      name: 'missing semantic product',
      mutate: async () => rm(await semanticProductPath()),
    },
    {
      name: 'wrong-typed semantic product',
      mutate: async () => {
        const product = await semanticProductPath();
        await rm(product);
        await mkdir(product);
      },
    },
    {
      name: 'symbolic-link semantic product',
      mutate: async () => {
        const product = await semanticProductPath();
        const outside = join(root, 'outside.product');
        await copyFile(product, outside);
        await rm(product);
        await symlink(outside, product);
      },
    },
  ])(
    'classifies $name as rebuild-only incompatible state',
    async ({ mutate }) => {
      await seed();
      await mutate();

      expect(await expectReadOnly(() => classify())).toMatchObject({
        state: 'incompatible',
        recovery: ['rebuild'],
      });
    },
  );

  it('rejects an internally consistent but arbitrary recorded semantic path', async () => {
    await seed();
    const record = await readRecord();
    const product = record.products.find(
      (candidate) => candidate.id === record.plan.steps[0].target.product,
    ) as ProductRecord;
    const original = resolve(artifactDir, ...product.path.split('/'));
    const arbitrary = join(artifactDir, 'arbitrary-safe.md');
    await copyFile(original, arbitrary);
    product.path = 'arbitrary-safe.md';
    record.plan.steps[0].target.path = product.path;
    record.plan.identity = planIdentity(record.plan);
    record.products.sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
    await writeRecord(record);

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'incompatible',
      recovery: ['rebuild'],
    });
  });

  it('rejects internally consistent noncanonical stable step and product IDs', async () => {
    await seed();
    const record = await readRecord();
    const first = record.plan.steps[0];
    const oldProduct = first.target.product;
    const product = record.products.find(
      (candidate) => candidate.id === oldProduct,
    ) as ProductRecord;
    first.id = 'phase:999999';
    first.target.product = 'semantic:phase.999999';
    product.id = first.target.product;
    for (const [index, step] of record.plan.steps.entries()) {
      step.inputKey = stepInputKey(step.id, [
        index === 0
          ? { kind: 'source', hash: record.source.hash }
          : {
              kind: 'product',
              product: record.plan.steps[index - 1].target.product,
              hash: (
                record.products.find(
                  (candidate) =>
                    candidate.id ===
                    record.plan.steps[index - 1].target.product,
                ) as ProductRecord
              ).hash,
            },
      ]);
    }
    record.plan.identity = planIdentity(record.plan);
    await writeRecord(record);

    expect(await expectReadOnly(() => classify())).toMatchObject({
      state: 'incompatible',
      recovery: ['rebuild'],
    });
  });

  it('formats only the recovery choices valid for each automatic conflict', async () => {
    await seed();
    await writeFile(await semanticProductPath(1), 'manual refinement\n');
    const before = await fingerprint(root);

    const adoptable = await runSlc(argv(), deps());

    expect(adoptable.ok).toBe(false);
    expect(adoptable.outputs).toEqual([]);
    expect(adoptable.diagnostics.join('\n')).toContain('--adopt');
    expect(adoptable.diagnostics.join('\n')).toContain('--rebuild');
    expect(await fingerprint(root)).toEqual(before);
    expect(performing.calls).toHaveLength(0);

    await writeFile(sourcePath, 'changed source\n');
    const beforeRebuildOnly = await fingerprint(root);
    const rebuildOnly = await runSlc(argv(), deps());
    expect(rebuildOnly.ok).toBe(false);
    expect(rebuildOnly.diagnostics.join('\n')).toContain('--rebuild');
    expect(rebuildOnly.diagnostics.join('\n')).not.toContain('--adopt');
    expect(await fingerprint(root)).toEqual(beforeRebuildOnly);
    expect(performing.calls).toHaveLength(0);
  });

  const installCurrentPin = async (): Promise<string> => {
    const bundle = join(pipelineDir, 'mid2out.slc');
    await mkdir(bundle);
    const artifact = join(bundle, 'mid2out.playbook.ts');
    await writeFile(
      artifact,
      'export default function createPlaybookRuntime() { return {}; }\n',
    );
    for (const file of [
      'mid2out.fsm.ts',
      'mid2out.gears.md',
      'mid2out.gears-fsm.test.ts',
      'mid2out.fsm.introspect.test.ts',
      'mid2out.prompt-contract.test.ts',
      'mid2out.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(bundle, file), `${file}\n`);
    }
    const pinRuntime = join(pipelineDir, 'pin-runtime.ts');
    await writeFile(pinRuntime, 'pin runtime\n');
    const record = await generatePinRecord(pipelineDir, {
      definition: 'mid2out.md',
      artifact: 'mid2out.slc/mid2out.playbook.ts',
      artifactBundle: 'mid2out.slc',
      linkTarget: { kind: 'file', locator: 'pin-runtime.ts' },
    });
    await writePinFile(pipelineDir, { mid2out: record });
    return artifact;
  };

  it('reports a stale pin before a malformed lineage and performs no work', async () => {
    await seed();
    const artifact = await installCurrentPin();
    await writeFile(artifact, 'changed after review\n');
    await writeFile(join(artifactDir, BUILD_RECORD_FILE), '{malformed\n');
    const before = await fingerprint(root);

    const result = await runSlc(argv(), deps());

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toMatch(/pin.*stale|pin.*current/i);
    expect(result.diagnostics.join('\n')).toMatch(/build.*review/i);
    expect(result.diagnostics.join('\n')).not.toContain('--adopt');
    expect(result.diagnostics.join('\n')).not.toContain('--rebuild');
    expect(await fingerprint(root)).toEqual(before);
    expect(performing.calls).toHaveLength(0);
    expect(compiledFactories).toBe(0);
  });

  it('reports a malformed pin before an orphaned lineage and performs no work', async () => {
    await seed();
    await writeFile(join(pipelineDir, PINS_FILE), '{malformed\n');
    await rm(join(artifactDir, SOURCE_SNAPSHOT_FILE));
    const before = await fingerprint(root);

    const result = await runSlc(argv(), deps());

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toMatch(
      /pin.*(parse|json|malformed)/i,
    );
    expect(result.diagnostics.join('\n')).toMatch(/build.*review/i);
    expect(result.diagnostics.join('\n')).not.toContain('--adopt');
    expect(result.diagnostics.join('\n')).not.toContain('--rebuild');
    expect(await fingerprint(root)).toEqual(before);
    expect(performing.calls).toHaveLength(0);
    expect(compiledFactories).toBe(0);
  });
});

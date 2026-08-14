// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  identifyBuildPlan,
  planFullBuild,
  type BuildIdentityContext,
  type FullBuildTopology,
} from '../src/build-plan.js';
import {
  bindDeterministicDerivatives,
  describeDeterministicDerivatives,
  emitDeterministicDerivatives,
  ENTRY_GENERATOR_ID,
  identifyDeterministicDerivatives,
  LOAD_INTEGRITY_CHECKER_ID,
  type DeterministicDerivativeDescription,
  type DeterministicSemanticBindings,
  VERIFICATION_CHECKER_ID,
  VERIFICATION_GENERATOR_ID,
  VERIFICATION_TEST_FILES,
} from '../src/deterministic-derivatives.js';
import { checkEmittedLoadIntegrity } from '../src/emitted-imports.js';
import { runMappedEmittedSuite } from '../src/emitted-suite.js';
import type { Invocation } from '../src/invocation.js';
import { loadLinkFile, type LinkPhase } from '../src/link.js';
import { loadPipeline, type Pipeline } from '../src/pipeline.js';
import {
  VERIFIER_SUPPORT_DIR,
  VERIFIER_SUPPORT_FILES,
} from '../src/verify-support.js';

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

describe('deterministic derivative planning', () => {
  let root: string;
  let workDir: string;
  let source: string;
  let runtime: string;
  let pipeline: Pipeline;
  let link: LinkPhase;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-deterministic-derivatives-'));
    const pipelineDir = join(root, 'pipeline');
    workDir = join(root, 'work');
    source = join(workDir, 'workflow.md');
    runtime = join(root, 'runtime.ts');
    await mkdir(pipelineDir);
    await mkdir(workDir);
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await symlink(
      dirname(fileURLToPath(import.meta.resolve('xstate/package.json'))),
      join(root, 'node_modules', 'xstate'),
      'dir',
    );
    await writeFile(
      join(pipelineDir, 'text2gears.md'),
      formatDoc('text', '.md', 'gears', '.md', '\n## Pin Inputs\n'),
    );
    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      formatDoc('gears', '.md', 'fsm', '.ts', '\n## Pin Inputs\n'),
    );
    await writeFile(
      join(pipelineDir, 'link.md'),
      formatDoc('fsm', '.ts', 'playbook', '.ts', '\n## Pin Inputs\n'),
    );
    await writeFile(source, '# Workflow\n\nDo the work.\n');
    await writeFile(runtime, 'export default function runtime() {}\n');
    pipeline = await loadPipeline(pipelineDir);
    link = await loadLinkFile(join(pipelineDir, 'link.md'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fullInvocation = (
    pipelineName: string,
    output: string | null = null,
  ): Extract<Invocation, { kind: 'full' }> => ({
    kind: 'full',
    pipeline: pipelineName,
    source,
    output,
    optimize: false,
    noOptimize: true,
    normalize: false,
  });

  const linkInvocation = (
    pipelineName: string,
    output: string | null = null,
  ): Extract<Invocation, { kind: 'full-link' }> => ({
    kind: 'full-link',
    pipeline: pipelineName,
    source,
    linkTarget: runtime,
    output,
    options: [],
    optimize: false,
    noOptimize: true,
    normalize: false,
  });

  const topology = (
    invocation: Extract<Invocation, { kind: 'full' | 'full-link' }>,
  ): FullBuildTopology =>
    planFullBuild({
      invocation,
      pipeline,
      cwd: workDir,
      ...(invocation.kind === 'full-link' ? { link } : {}),
    });

  const candidateInputs = async (
    description: DeterministicDerivativeDescription,
    invalidFsm = false,
  ): Promise<{
    bindings: ReturnType<typeof bindDeterministicDerivatives>;
    candidateRoot: string;
    semantic: DeterministicSemanticBindings;
  }> => {
    const verification = description.verification;
    if (verification === undefined || description.entry === undefined) {
      throw new Error('fixture requires full-link Playbook derivatives');
    }
    const candidateRoot = join(root, 'candidate-products');
    const semanticRoot = join(root, 'candidate-semantic');
    await mkdir(candidateRoot);
    await mkdir(semanticRoot);
    const textPath = join(semanticRoot, 'source.md');
    const gearsPath = join(semanticRoot, 'gears.md');
    const fsmPath = join(semanticRoot, 'fsm.ts');
    const linkedPath = join(semanticRoot, 'linked.ts');
    await writeFile(textPath, '# Workflow\n\nDo the work.\n');
    await writeFile(gearsPath, 'Players:\n\n- Writer\n\n## Behaviors\n');
    await writeFile(
      fsmPath,
      invalidFsm
        ? 'not valid TypeScript {{{\n'
        : [
            "import { setup } from 'xstate';",
            'export const machine = setup({}).createMachine({',
            "  id: 'workflow',",
            "  initial: 'awaitBossReply',",
            '  states: {',
            '    awaitBossReply: {',
            "      on: { BOSS_REPLY: { target: 'done' } },",
            '    },',
            "    done: { type: 'final' },",
            '  },',
            '});',
            '',
          ].join('\n'),
    );
    await writeFile(
      linkedPath,
      'export default function createPlaybookRuntime() { return {}; }\n',
    );

    return {
      bindings: bindDeterministicDerivatives(description, (id) =>
        join(candidateRoot, encodeURIComponent(id)),
      ),
      candidateRoot,
      semantic: {
        text: { logicalPath: source, physicalPath: textPath },
        gears: {
          logicalPath: verification.gearsPath,
          physicalPath: gearsPath,
        },
        fsm: {
          logicalPath: verification.fsmPath,
          physicalPath: fsmPath,
        },
        linked: {
          logicalPath: verification.linkedPath as string,
          physicalPath: linkedPath,
        },
      },
    };
  };

  it('describes the exact six support, four test, and optional entry products', () => {
    const planned = topology(linkInvocation('playbook'));
    const description = describeDeterministicDerivatives(planned);
    const artifactDir = join(workDir, 'workflow.playbook');
    const verificationInputs = [
      VERIFICATION_CHECKER_ID,
      VERIFICATION_GENERATOR_ID,
    ];
    const testInputs = [
      LOAD_INTEGRITY_CHECKER_ID,
      VERIFICATION_CHECKER_ID,
      VERIFICATION_GENERATOR_ID,
    ];

    expect(description.products).toEqual([
      ...VERIFIER_SUPPORT_FILES.map((file) => ({
        id: `verification:support.${file}`,
        kind: 'verification',
        path: join(artifactDir, VERIFIER_SUPPORT_DIR, file),
        inputs: verificationInputs,
      })),
      ...VERIFICATION_TEST_FILES.map((file) => ({
        id: `verification:test.${file}`,
        kind: 'verification',
        path: join(artifactDir, `workflow.${file}`),
        inputs: testInputs,
      })),
      {
        id: 'entry:workflow',
        kind: 'entry',
        path: join(workDir, 'workflow.ts'),
        inputs: [LOAD_INTEGRITY_CHECKER_ID, ENTRY_GENERATOR_ID],
      },
    ]);
    expect(description.verification).toEqual({
      artifactDir,
      gearsPath: join(artifactDir, 'workflow.gears.md'),
      fsmPath: join(artifactDir, 'workflow.fsm.ts'),
      linkedPath: join(artifactDir, 'workflow.playbook.ts'),
      support: VERIFIER_SUPPORT_FILES.map((file) => ({
        productId: `verification:support.${file}`,
        file,
        logicalPath: join(artifactDir, VERIFIER_SUPPORT_DIR, file),
      })),
      tests: VERIFICATION_TEST_FILES.map((file) => ({
        productId: `verification:test.${file}`,
        file,
        logicalPath: join(artifactDir, `workflow.${file}`),
      })),
    });
    expect(description.entry).toEqual({
      productId: 'entry:workflow',
      logicalPath: join(workDir, 'workflow.ts'),
      logicalBundlePath: artifactDir,
      logicalTextPath: source,
    });
  });

  it('matches reserved-pipeline full/full-link applicability without giving slc an entry', () => {
    expect(
      describeDeterministicDerivatives(topology(fullInvocation('playbook')))
        .products,
    ).toHaveLength(10);
    expect(
      describeDeterministicDerivatives(topology(linkInvocation('playbook')))
        .products,
    ).toHaveLength(11);
    for (const invocation of [fullInvocation('slc'), linkInvocation('slc')]) {
      const description = describeDeterministicDerivatives(
        topology(invocation),
      );
      expect(description.products).toHaveLength(10);
      expect(description.entry).toBeUndefined();
    }
    for (const invocation of [
      fullInvocation('fixture'),
      linkInvocation('fixture'),
    ]) {
      expect(
        describeDeterministicDerivatives(topology(invocation)).products,
      ).toEqual([]);
    }
  });

  it('preserves canonical -o behavior for verification and entry applicability', () => {
    const relocatedFsm = join(root, 'relocated.fsm.ts');
    expect(
      describeDeterministicDerivatives(
        topology(fullInvocation('playbook', relocatedFsm)),
      ).products,
    ).toEqual([]);

    const relocatedLinked = join(root, 'relocated.playbook.ts');
    const description = describeDeterministicDerivatives(
      topology(linkInvocation('playbook', relocatedLinked)),
    );
    expect(description.products).toHaveLength(10);
    expect(description.entry).toBeUndefined();
    expect(description.verification).toBeDefined();
  });

  it('binds different staging layouts without changing logical products or identities', () => {
    const description = describeDeterministicDerivatives(
      topology(linkInvocation('playbook')),
    );
    const original = structuredClone(description.products);
    const first = bindDeterministicDerivatives(description, (id) =>
      join(root, 'candidate-a', encodeURIComponent(id)),
    );
    const second = bindDeterministicDerivatives(description, (id) =>
      join(root, 'candidate-b', encodeURIComponent(id)),
    );

    expect(first.map(({ id, logicalPath }) => ({ id, logicalPath }))).toEqual(
      second.map(({ id, logicalPath }) => ({ id, logicalPath })),
    );
    expect(first.map((item) => item.physicalPath)).not.toEqual(
      second.map((item) => item.physicalPath),
    );
    expect(description.products).toEqual(original);
  });

  it('rejects two deterministic products bound to one physical path', () => {
    const description = describeDeterministicDerivatives(
      topology(linkInvocation('playbook')),
    );
    expect(() =>
      bindDeterministicDerivatives(description, () =>
        join(root, 'candidate', 'shared'),
      ),
    ).toThrow(/deterministic products share physical path/u);
  });

  it('rejects a logically misbound entry source before writing candidates', async () => {
    const description = describeDeterministicDerivatives(
      topology(linkInvocation('playbook')),
    );
    const { bindings, semantic } = await candidateInputs(description);
    await expect(
      emitDeterministicDerivatives({
        description,
        bindings,
        semantic: {
          ...semantic,
          text: {
            ...(semantic.text as NonNullable<typeof semantic.text>),
            logicalPath: join(root, 'different-source.md'),
          },
        },
      }),
    ).rejects.toThrow(/text input is logically misbound/u);
    for (const binding of bindings) {
      await expect(access(binding.physicalPath)).rejects.toThrow();
    }
  });

  it('feeds asynchronous deterministic identities into the canonical plan only by logical product', async () => {
    const plannedTopology = topology(linkInvocation('playbook'));
    const deterministic =
      await identifyDeterministicDerivatives(plannedTopology);
    expect(deterministic).toBeDefined();
    if (deterministic === undefined) throw new Error('missing derivatives');
    const context: BuildIdentityContext = {
      interpretedExecutor: {
        kind: 'value',
        value: 'sublang.slc.interpreted-executor.v1:fixture',
      },
      compiledExecutor: {
        kind: 'value',
        value: 'sublang.slc.compiled-host.v1:fixture',
      },
      compiledProfile: () => 'fixture-v1',
      packages: [
        { role: 'slc', name: '@sublang/slc', version: '0.3.0' },
        { role: 'pipeline', name: '@sublang/playbook', version: '4.0.0' },
        {
          role: 'link-runtime',
          name: '@sublang/playbook',
          version: '4.0.0',
        },
      ],
      deterministic,
    };
    const first = await identifyBuildPlan(plannedTopology, context);

    bindDeterministicDerivatives(
      describeDeterministicDerivatives(plannedTopology),
      (id) => join(root, 'unrelated-staging-layout', encodeURIComponent(id)),
    );
    const second = await identifyBuildPlan(plannedTopology, context);

    expect(first.plan.identity).toBe(second.plan.identity);
    expect(first.plan.deterministicInputs).toEqual([
      LOAD_INTEGRITY_CHECKER_ID,
      VERIFICATION_CHECKER_ID,
      ENTRY_GENERATOR_ID,
      VERIFICATION_GENERATOR_ID,
    ]);
    expect(
      first.products.filter(
        (product) =>
          product.kind === 'entry' || product.kind === 'verification',
      ),
    ).toHaveLength(11);
    expect(
      first.products.find((product) => product.kind === 'entry'),
    ).toMatchObject({ id: 'entry:workflow', path: '../workflow.ts' });
    expect(
      first.products
        .filter((product) => product.kind === 'verification')
        .map((product) => product.path),
    ).toEqual(
      expect.arrayContaining([
        '.slc-verify/hash.js',
        'workflow.gears-fsm.test.ts',
        'workflow.fsm.introspect.test.ts',
        'workflow.prompt-contract.test.ts',
        'workflow.fsm.coverage.test.ts',
      ]),
    );
  });

  it('emits the complete inventory into a candidate layout with mapped load integrity', async () => {
    const plannedTopology = topology(linkInvocation('playbook'));
    const description = describeDeterministicDerivatives(plannedTopology);
    const verification = description.verification;
    const entry = description.entry;
    if (verification === undefined || entry === undefined) {
      throw new Error('missing full-link derivatives');
    }
    const { bindings, candidateRoot, semantic } =
      await candidateInputs(description);

    const result = await emitDeterministicDerivatives({
      description,
      bindings,
      semantic,
    });

    expect(result.failures).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    expect(result.written).toEqual(bindings);
    expect(result.written.map(({ id }) => id)).toEqual(
      description.products.map(({ id }) => id),
    );
    await expect(access(plannedTopology.artifactDir)).rejects.toThrow();
    await expect(access(entry.logicalPath)).rejects.toThrow();
    for (const product of result.written) {
      const content = await readFile(product.physicalPath, 'utf8');
      expect(content).not.toContain(candidateRoot);
      expect(content).not.toContain(join(root, 'candidate-semantic'));
    }

    const fsmRuntimePath = verification.fsmPath.replace(/\.ts$/u, '.js');
    const linkedRuntimePath = (verification.linkedPath as string).replace(
      /\.ts$/u,
      '.js',
    );
    const inventory = [
      ...bindings.map(({ logicalPath, physicalPath }) => ({
        logicalPath,
        physicalPath,
      })),
      {
        logicalPath: verification.gearsPath,
        physicalPath: semantic.gears.physicalPath,
      },
      {
        logicalPath: verification.fsmPath,
        physicalPath: semantic.fsm.physicalPath,
      },
      {
        logicalPath: fsmRuntimePath,
        physicalPath: semantic.fsm.physicalPath,
      },
      {
        logicalPath: verification.linkedPath as string,
        physicalPath: (semantic.linked as NonNullable<typeof semantic.linked>)
          .physicalPath,
      },
      {
        logicalPath: linkedRuntimePath,
        physicalPath: (semantic.linked as NonNullable<typeof semantic.linked>)
          .physicalPath,
      },
    ];
    await expect(
      checkEmittedLoadIntegrity({
        inventory,
        modules: [
          entry.logicalPath,
          ...verification.tests.map(({ logicalPath }) => logicalPath),
        ],
      }),
    ).resolves.toEqual([]);
    const suite = await runMappedEmittedSuite({
      inventory,
      logicalRoot: workDir,
      testPaths: verification.tests.map(({ logicalPath }) => logicalPath),
      viewParent: candidateRoot,
    });
    expect(suite.ok, suite.diagnostics.join('\n')).toBe(true);
  });

  it('aggregates independent derivation failures without mutating canonical paths', async () => {
    const plannedTopology = topology(linkInvocation('playbook'));
    const description = describeDeterministicDerivatives(plannedTopology);
    const entry = description.entry;
    if (entry === undefined) throw new Error('missing entry derivative');
    const { bindings, semantic } = await candidateInputs(description, true);

    const result = await emitDeterministicDerivatives({
      description,
      bindings,
      semantic,
    });

    expect(result.failures.map(({ productId }) => productId)).toEqual([
      'verification:test.fsm.introspect.test.ts',
      'verification:test.prompt-contract.test.ts',
      'verification:test.fsm.coverage.test.ts',
    ]);
    expect(result.written.map(({ id }) => id)).toEqual([
      ...VERIFIER_SUPPORT_FILES.map((file) => `verification:support.${file}`),
      'verification:test.gears-fsm.test.ts',
      'entry:workflow',
    ]);
    await expect(access(plannedTopology.artifactDir)).rejects.toThrow();
    await expect(access(entry.logicalPath)).rejects.toThrow();
  });

  it('reports every settled support write by its actual product outcome', async () => {
    const description = describeDeterministicDerivatives(
      topology(linkInvocation('playbook')),
    );
    const verification = description.verification;
    if (verification === undefined) throw new Error('missing verification');
    const { bindings, semantic } = await candidateInputs(description);
    const blocker = join(root, 'support-blocker');
    await writeFile(blocker, 'not a directory\n');
    const failedId = verification.support[0].productId;
    const rebound = bindings.map((binding) =>
      binding.id === failedId
        ? { ...binding, physicalPath: join(blocker, 'hash.js') }
        : binding,
    );

    const result = await emitDeterministicDerivatives({
      description,
      bindings: rebound,
      semantic,
    });

    expect(
      result.failures.filter(({ productId }) =>
        productId.startsWith('verification:support.'),
      ),
    ).toEqual([expect.objectContaining({ productId: failedId })]);
    expect(
      result.written
        .filter(({ id }) => id.startsWith('verification:support.'))
        .map(({ id }) => id),
    ).toEqual(verification.support.slice(1).map(({ productId }) => productId));
  });
});

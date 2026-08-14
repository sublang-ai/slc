// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILD_RECORD_FILE,
  SOURCE_SNAPSHOT_FILE,
  canonicalJson,
  decodeBuildRecord,
  type ProductRecord,
} from '../src/build-record.js';
import type {
  BuildIdentityContext,
  FullBuildTopology,
} from '../src/build-plan.js';
import type {
  ExecuteRequest,
  ExecutorResult,
  PhaseExecutor,
} from '../src/execution.js';
import { hashBytes, hashFile } from '../src/hash.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import type { WorkspaceRecord } from '../src/workspace.js';

const formatDoc = (
  source: string,
  sourceExt: string,
  target: string,
  targetExt: string,
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
    '## Pin Inputs',
    '',
  ].join('\n');

const linkDoc = [
  '# Fixture link',
  '',
  '## Formats',
  '',
  '| Role | Format | Extension |',
  '| --- | --- | --- |',
  '| source | out | .ts |',
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

interface ObservedCall {
  readonly request: ExecuteRequest;
  readonly workspace: WorkspaceRecord;
  readonly canonicalWriteExisted: boolean;
  readonly input: string;
}

interface FixtureExecutor extends PhaseExecutor {
  readonly calls: ObservedCall[];
}

type LineageDeps = SlcDeps & {
  buildIdentity(
    topology: FullBuildTopology,
  ): BuildIdentityContext | Promise<BuildIdentityContext>;
};

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const identityContext = (
  topology: FullBuildTopology,
): BuildIdentityContext => ({
  interpretedExecutor: {
    kind: 'value',
    value: 'sublang.slc.interpreted-executor.v1:cold-lineage-fixture',
  },
  compiledExecutor: {
    kind: 'value',
    value: 'sublang.slc.compiled-host.v1:cold-lineage-fixture',
  },
  compiledProfile: () => 'fixture-v1',
  packages: [
    { role: 'slc', name: '@sublang/slc', version: '0.3.0-test' },
    { role: 'pipeline', name: 'cold-lineage-fixture', version: null },
    ...(topology.invocation.kind === 'full-link'
      ? [
          {
            role: 'link-runtime' as const,
            name: 'cold-lineage-runtime-fixture',
            version: null,
          },
        ]
      : []),
  ],
  compatibility: [],
});

const expectedInputKey = (
  stepId: string,
  operand:
    | { kind: 'source'; hash: string }
    | { kind: 'product'; product: string; hash: string },
): string =>
  hashBytes(new TextEncoder().encode(canonicalJson([stepId, [operand]])));

describe('cold build lineage (INCR-7, INCR-8, INCR-20, INCR-31)', () => {
  let root: string;
  let workDir: string;
  let pipelineDir: string;
  let sourcePath: string;
  let runtimePath: string;
  let artifactDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-cold-lineage-'));
    workDir = join(root, 'work');
    pipelineDir = join(root, 'pipeline');
    sourcePath = join(workDir, 'workflow.md');
    runtimePath = join(root, 'runtime.ts');
    artifactDir = join(workDir, 'workflow.flow');
    await Promise.all([
      mkdir(workDir),
      mkdir(join(pipelineDir, 'refs'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        join(pipelineDir, 'text2mid.md'),
        formatDoc('text', '.md', 'mid', '.md'),
      ),
      writeFile(
        join(pipelineDir, 'mid2out.md'),
        `${formatDoc('mid', '.md', 'out', '.ts')}\n- \`refs/shared.md\`\n`,
      ),
      writeFile(join(pipelineDir, 'refs', 'shared.md'), 'shared input\n'),
      writeFile(join(pipelineDir, 'link.md'), linkDoc),
      writeFile(sourcePath, 'source bytes\n'),
      writeFile(runtimePath, 'export const runtime = true;\n'),
    ]);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor): LineageDeps => ({
    resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
    executor,
    cwd: workDir,
    buildIdentity: identityContext,
  });

  const executor = (
    failAt?: string,
    afterSuccess?: (
      request: ExecuteRequest,
      callCount: number,
    ) => Promise<void>,
  ): FixtureExecutor => {
    const calls: ObservedCall[] = [];
    return {
      calls,
      async run(request, workspace): Promise<ExecutorResult> {
        const canonicalWriteExisted = await exists(workspace.write.logicalPath);
        const primaryRead = workspace.reads.find((read) =>
          request.kind === 'compile'
            ? read.role === 'source'
            : read.role === 'object:0',
        );
        if (primaryRead === undefined) {
          return { status: 'error', diagnostics: ['missing primary read'] };
        }
        const input = await readFile(primaryRead.physicalPath, 'utf8');
        calls.push({
          request,
          workspace,
          canonicalWriteExisted,
          input,
        });
        if (basename(request.definitionPath, '.md') === failAt) {
          return {
            status: 'blocked',
            diagnostics: ['fixture rejected before promotion'],
          };
        }
        const output =
          request.kind === 'link'
            ? `import ${JSON.stringify(
                workspace.reads.find((read) => read.role === 'link-target')
                  ?.kind === 'directory'
                  ? '../../runtime/index.js'
                  : '../../runtime.js',
              )};\nexport const linked = ${JSON.stringify(input)};\n`
            : `${basename(request.definitionPath, '.md')}:${input}`;
        await writeFile(workspace.write.physicalPath, output);
        await afterSuccess?.(request, calls.length);
        return { status: 'ok', diagnostics: [] };
      },
    };
  };

  const canonicalProducts = (linked: boolean): string[] => [
    join(artifactDir, 'workflow.mid.md'),
    join(artifactDir, 'workflow.out.ts'),
    ...(linked ? [join(artifactDir, 'workflow.run.ts')] : []),
  ];

  const assertNoPrivateResidue = async (): Promise<void> => {
    expect(
      (await readdir(workDir)).filter((name) =>
        name.startsWith('.workflow.flow.slc-'),
      ),
    ).toEqual([]);
  };

  it.each([
    { name: 'full', linked: false },
    { name: 'full-link', linked: true },
  ] as const)(
    'promotes an exact $name record only after staged interpreted execution',
    async ({ linked }) => {
      await mkdir(artifactDir);
      const unrecordedPath = join(artifactDir, 'notes.txt');
      await writeFile(unrecordedPath, 'keep me\n');
      const performing = executor();
      const argv = linked
        ? ['flow', sourcePath, '--link', runtimePath]
        : ['flow', sourcePath];

      const result = await runSlc(argv, deps(performing));

      expect(result.ok, result.diagnostics.join('\n')).toBe(true);
      const products = canonicalProducts(linked);
      expect(result.outputs).toEqual(products);
      expect(await readFile(unrecordedPath, 'utf8')).toBe('keep me\n');
      expect(await readFile(join(artifactDir, SOURCE_SNAPSHOT_FILE))).toEqual(
        await readFile(sourcePath),
      );

      expect(performing.calls).toHaveLength(linked ? 3 : 2);
      for (const call of performing.calls) {
        expect(call.canonicalWriteExisted).toBe(false);
        expect(call.workspace.write.logicalPath).toBe(
          call.request.kind === 'compile'
            ? call.request.target
            : call.request.linked,
        );
        expect(call.workspace.write.physicalPath).not.toBe(
          call.workspace.write.logicalPath,
        );
        expect(call.workspace.write.physicalPath).toContain(
          '.workflow.flow.slc-stage-',
        );
      }
      expect(
        performing.calls[1].workspace.reads.find(
          (read) => read.role === 'source',
        )?.physicalPath,
      ).toBe(performing.calls[0].workspace.write.physicalPath);
      expect(performing.calls[1].input).toContain('text2mid:source bytes');
      if (linked) {
        expect(
          performing.calls[2].workspace.reads.find(
            (read) => read.role === 'object:0',
          )?.physicalPath,
        ).toBe(performing.calls[1].workspace.write.physicalPath);
        expect(
          performing.calls[2].workspace.reads.find(
            (read) => read.role === 'link-target',
          )?.physicalPath,
        ).toBe(runtimePath);
      }

      const record = decodeBuildRecord(
        await readFile(join(artifactDir, BUILD_RECORD_FILE)),
      );
      const sourceHash = await hashFile(sourcePath);
      expect(record).toMatchObject({
        schema: 'sublang.slc.build.v1',
        hashAlgorithm: 'sha256',
        source: {
          locator: '../workflow.md',
          hash: sourceHash,
          snapshot: SOURCE_SNAPSHOT_FILE,
          snapshotHash: sourceHash,
        },
        lineage: { generation: 1, transition: null },
      });
      expect(record.plan.invocation.kind).toBe(linked ? 'full-link' : 'full');
      expect(record.plan.steps).toHaveLength(linked ? 3 : 2);
      expect(
        record.plan.steps.every((step) => step.origin === 'ordinary'),
      ).toBe(true);
      expect(record.plan.steps.every((step) => step.trace === null)).toBe(true);
      expect(
        record.plan.steps.every((step) => step.inputClosure === 'closed'),
      ).toBe(true);
      expect(record.plan.deterministicInputs).toEqual([]);

      const productsById = new Map(
        record.products.map((product) => [product.id, product]),
      );
      expect(record.products).toHaveLength(products.length);
      expect(
        record.products.every((product) => product.kind === 'semantic'),
      ).toBe(true);
      expect(
        record.products.every((product) => product.inputs.length === 0),
      ).toBe(true);
      for (const product of record.products) {
        expect(product.hash).toBe(
          await hashFile(resolve(artifactDir, ...product.path.split('/'))),
        );
      }

      for (const [index, step] of record.plan.steps.entries()) {
        const operand =
          index === 0
            ? ({ kind: 'source', hash: sourceHash } as const)
            : ({
                kind: 'product',
                product: record.plan.steps[index - 1].target.product,
                hash: (
                  productsById.get(
                    record.plan.steps[index - 1].target.product,
                  ) as ProductRecord
                ).hash,
              } as const);
        expect(step.inputKey).toBe(expectedInputKey(step.id, operand));
      }
      for (const path of products) {
        expect(await readFile(path, 'utf8')).not.toContain('.slc-stage-');
      }
      await assertNoPrivateResidue();
    },
  );

  it('discards a failed staged run without publishing metadata or partial products', async () => {
    await mkdir(artifactDir);
    const unrecordedPath = join(artifactDir, 'notes.txt');
    await writeFile(unrecordedPath, 'keep me\n');
    const performing = executor('mid2out');

    const result = await runSlc(['flow', sourcePath], deps(performing));

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toContain(
      'fixture rejected before promotion',
    );
    expect(performing.calls).toHaveLength(2);
    for (const path of [
      ...canonicalProducts(false),
      join(artifactDir, BUILD_RECORD_FILE),
      join(artifactDir, SOURCE_SNAPSHOT_FILE),
    ]) {
      expect(await exists(path)).toBe(false);
    }
    expect(await readFile(unrecordedPath, 'utf8')).toBe('keep me\n');
    expect(await readFile(sourcePath, 'utf8')).toBe('source bytes\n');
    await assertNoPrivateResidue();
  });

  it('records and executes against an exact directory link-target tree', async () => {
    await rm(runtimePath);
    runtimePath = join(root, 'runtime');
    await mkdir(runtimePath);
    await writeFile(
      join(runtimePath, 'index.ts'),
      'export const runtime = true;\n',
    );
    const performing = executor();

    const result = await runSlc(
      ['flow', sourcePath, '--link', runtimePath],
      deps(performing),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(
      await readFile(join(artifactDir, 'workflow.run.ts'), 'utf8'),
    ).toContain('import "../../runtime/index.js"');
    const record = decodeBuildRecord(
      await readFile(join(artifactDir, BUILD_RECORD_FILE)),
    );
    expect(
      record.plan.inputs.find((input) => input.kind === 'link-target'),
    ).toMatchObject({
      locator: '../../runtime',
      value: null,
      identity: expect.stringMatching(/^sha256:/),
    });
    await assertNoPrivateResidue();
  });

  it('revalidates the identified plan before granting the next phase workspace', async () => {
    const performing = executor(undefined, async (_request, callCount) => {
      if (callCount === 1) {
        await writeFile(
          join(pipelineDir, 'refs', 'shared.md'),
          'changed shared input\n',
        );
      }
    });

    const result = await runSlc(['flow', sourcePath], deps(performing));

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(performing.calls).toHaveLength(1);
    expect(result.diagnostics.join('\n')).toMatch(/basis:plan|identity/i);
    expect(await exists(join(artifactDir, BUILD_RECORD_FILE))).toBe(false);
    expect(await exists(join(artifactDir, SOURCE_SNAPSHOT_FILE))).toBe(false);
    expect(await exists(join(artifactDir, 'workflow.mid.md'))).toBe(false);
    await assertNoPrivateResidue();
  });
});

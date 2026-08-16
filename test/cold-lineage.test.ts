// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
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
  encodeBuildRecord,
  planIdentity,
  type BuildRecord,
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
import { PINS_FILE } from '../src/pins.js';
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

  /** A schema-valid record whose plan no longer matches the canonical layout. */
  const nonDerivable = (record: BuildRecord): BuildRecord => {
    const plan = {
      ...record.plan,
      steps: record.plan.steps.map((step, index) =>
        index === 0
          ? {
              ...step,
              id: 'phase:000009',
              inputKey: expectedInputKey('phase:000009', {
                kind: 'source',
                hash: record.source.hash,
              }),
            }
          : step,
      ),
    };
    return {
      ...record,
      plan: { ...plan, identity: planIdentity(plan) },
    } as BuildRecord;
  };

  const readRecord = async (): Promise<BuildRecord> =>
    decodeBuildRecord(await readFile(join(artifactDir, BUILD_RECORD_FILE)));

  const seedLineage = async (linked = false): Promise<BuildRecord> => {
    const seeding = executor();
    const result = await runSlc(
      linked
        ? ['flow', sourcePath, '--link', runtimePath]
        : ['flow', sourcePath],
      deps(seeding),
    );
    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    return readRecord();
  };

  const acceptedBytes = async (linked = false) =>
    new Map(
      await Promise.all(
        [
          ...canonicalProducts(linked),
          join(artifactDir, SOURCE_SNAPSHOT_FILE),
          join(artifactDir, BUILD_RECORD_FILE),
        ].map(async (path) => [path, await readFile(path)] as const),
      ),
    );

  const expectAcceptedBytes = async (
    accepted: ReadonlyMap<string, Uint8Array>,
  ): Promise<void> => {
    for (const [path, bytes] of accepted) {
      expect(await readFile(path)).toEqual(bytes);
    }
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

  it.each([
    { name: 'absent full', linked: false, seeded: false, generation: 1 },
    { name: 'current full-link', linked: true, seeded: true, generation: 2 },
  ] as const)(
    'executes every $name rebuild step ordinarily (INCR-19, INCR-26)',
    async ({ linked, seeded, generation }) => {
      if (seeded) await seedLineage(linked);
      const performing = executor();
      const result = await runSlc(
        linked
          ? ['flow', sourcePath, '--link', runtimePath, '--rebuild']
          : ['flow', sourcePath, '--rebuild'],
        deps(performing),
      );

      expect(result.ok, result.diagnostics.join('\n')).toBe(true);
      expect(result.outputs).toEqual(canonicalProducts(linked));
      expect(performing.calls).toHaveLength(linked ? 3 : 2);
      const record = await readRecord();
      expect(record.lineage).toEqual({ generation, transition: null });
      expect(
        record.plan.steps.every((step) => step.origin === 'ordinary'),
      ).toBe(true);
      expect(record.plan.steps.every((step) => step.trace === null)).toBe(true);
      await assertNoPrivateResidue();
    },
  );

  it.each([
    { name: 'current lineage', mutate: async () => undefined },
    {
      name: 'manually edited semantic product',
      mutate: async () =>
        writeFile(join(artifactDir, 'workflow.out.ts'), 'manual edit\n'),
    },
    {
      name: 'changed source bytes',
      mutate: async () => writeFile(sourcePath, 'changed source bytes\n'),
    },
    {
      name: 'changed declared input',
      mutate: async () =>
        writeFile(
          join(pipelineDir, 'refs', 'shared.md'),
          'changed shared input\n',
        ),
    },
  ])('replaces $name only after a complete rebuild', async ({ mutate }) => {
    await seedLineage();
    await mutate();
    const performing = executor();

    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(performing),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(performing.calls).toHaveLength(2);
    const record = await readRecord();
    expect(record.lineage).toEqual({ generation: 2, transition: null });
    expect(record.plan.steps.every((step) => step.origin === 'ordinary')).toBe(
      true,
    );
    expect(record.plan.steps.every((step) => step.trace === null)).toBe(true);
    expect(await readFile(join(artifactDir, SOURCE_SNAPSHOT_FILE))).toEqual(
      await readFile(sourcePath),
    );
    expect(
      await readFile(join(artifactDir, 'workflow.out.ts'), 'utf8'),
    ).not.toBe('manual edit\n');
    await assertNoPrivateResidue();
  });

  it('reports success when its own recovery finished the candidate forward', async () => {
    const performing = executor();
    let interrupted = false;
    const result = await runSlc(['flow', sourcePath], {
      ...deps(performing),
      promotionCheckpoint: ({ name }) => {
        if (name === 'record-committed' && !interrupted) {
          interrupted = true;
          throw new Error('fixture promotion interruption');
        }
      },
    });

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(result.outputs).toEqual(canonicalProducts(false));
    await readRecord();
    await assertNoPrivateResidue();
  });

  it('voids a run whose normalize source is aliased mid-run', async () => {
    // The collision can be created after the one-time check: rebinding the
    // link leaves the source bytes and the plan identity both unchanged, so
    // only a guarded basis fact catches it before promotion.
    const outside = join(root, 'outside');
    await mkdir(outside);
    const realSource = join(outside, 'workflow.text.md');
    await writeFile(realSource, 'raw input bytes\n');
    const aliasDir = join(workDir, 'alias');
    await symlink(outside, aliasDir);
    const aliased = join(aliasDir, 'workflow.text.md');
    await mkdir(artifactDir);

    let derivations = 0;
    const drifting: LineageDeps = {
      ...deps(executor()),
      async buildIdentity(topology) {
        derivations += 1;
        if (derivations === 2) {
          // Re-point the alias at the artifact directory, so the source path
          // now names the normalization target itself.
          await rm(aliasDir);
          await symlink(artifactDir, aliasDir);
          await writeFile(aliased, 'raw input bytes\n');
        }
        return identityContext(topology);
      },
    };

    const result = await runSlc(['flow', aliased, '--normalize'], drifting);

    expect(result.ok).toBe(false);
    // The named guard is what refuses it. Without that basis fact the run
    // still fails, but only incidentally through generic workspace checks —
    // never through PIPE-34's collision behavior.
    expect(result.diagnostics.join('\n')).toMatch(/basis:normalize-alias/);
    expect(await readFile(aliased, 'utf8')).toBe('raw input bytes\n');
    await assertNoPrivateResidue();
  });

  it('refuses a normalize source aliased through a symlinked parent', async () => {
    // resolve() does not follow symbolic links, so the lexical refusal in the
    // plan sees two different strings naming one file and lets the run
    // proceed to overwrite the raw input through its alias.
    await mkdir(artifactDir);
    const aliasDir = join(workDir, 'alias');
    await symlink(artifactDir, aliasDir);
    const aliased = join(aliasDir, 'workflow.text.md');
    await writeFile(aliased, 'aliased source bytes\n');
    const performing = executor();

    const result = await runSlc(
      ['flow', aliased, '--normalize'],
      deps(performing),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(
      /normalization would overwrite its own source/,
    );
    expect(performing.calls).toHaveLength(0);
    expect(await readFile(aliased, 'utf8')).toBe('aliased source bytes\n');
    await assertNoPrivateResidue();
  });

  it('refuses to normalize a source living at its own canonical normalized path', async () => {
    await mkdir(artifactDir);
    const aliased = join(artifactDir, 'workflow.text.md');
    await writeFile(aliased, 'aliased source bytes\n');
    const performing = executor();

    const result = await runSlc(
      ['flow', aliased, '--normalize'],
      deps(performing),
    );

    // Normalizing in place would consume the user's raw input and record
    // bytes the file no longer holds, so every later run would re-normalize
    // its own output instead of reaching a no-op (COMPILE-7).
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(
      /normalization would overwrite its own source/,
    );
    expect(performing.calls).toHaveLength(0);
    expect(await readFile(aliased, 'utf8')).toBe('aliased source bytes\n');
    await assertNoPrivateResidue();
  });

  it.each([
    { name: 'full', linked: false },
    { name: 'full-link', linked: true },
  ])(
    'returns an exact $name no-op without executing or writing (INCR-2, INCR-21)',
    async ({ linked }) => {
      await seedLineage(linked);
      const unrecordedPath = join(artifactDir, 'notes.txt');
      await writeFile(unrecordedPath, 'keep me\n');
      const accepted = await acceptedBytes(linked);
      const before = await Promise.all(
        canonicalProducts(linked).map(async (path) => (await stat(path)).ino),
      );
      const refusing: PhaseExecutor = {
        run: () => {
          throw new Error('an exact no-op must invoke no executor');
        },
      };

      const result = await runSlc(
        linked
          ? ['flow', sourcePath, '--link', runtimePath]
          : ['flow', sourcePath],
        deps(refusing),
      );

      expect(result.ok, result.diagnostics.join('\n')).toBe(true);
      expect(result.outcome).toBe('up-to-date');
      expect(result.outputs).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      // No write at all: accepted bytes, inodes, and the unrecorded file are
      // untouched, and no staging directory was ever created.
      await expectAcceptedBytes(accepted);
      expect(
        await Promise.all(
          canonicalProducts(linked).map(async (path) => (await stat(path)).ino),
        ),
      ).toEqual(before);
      expect(await readFile(unrecordedPath, 'utf8')).toBe('keep me\n');
      await assertNoPrivateResidue();
    },
  );

  it('normalizes a raw source and still reaches an exact no-op', async () => {
    const rawSource = join(workDir, 'workflow.txt');
    await writeFile(rawSource, 'raw bytes\n');
    const seeded = await runSlc(['flow', rawSource], deps(executor()));
    expect(seeded.ok, seeded.diagnostics.join('\n')).toBe(true);

    const refusing: PhaseExecutor = {
      run: () => {
        throw new Error('an exact no-op must invoke no executor');
      },
    };
    const result = await runSlc(['flow', rawSource], deps(refusing));

    // The SLC-owned normalizer declares its closure, so a normalized chain
    // is wholly reusable rather than perpetually re-running.
    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(result.outcome).toBe('up-to-date');
    await assertNoPrivateResidue();
  });

  const tracingExecutor = (
    trace: (input: string, output: string) => unknown,
  ): FixtureExecutor => {
    const base = executor();
    return {
      calls: base.calls,
      async run(request, workspace, signal) {
        const result = await base.run(request, workspace, signal);
        if (result.status !== 'ok') return result;
        const input = await readFile(
          workspace.reads.find((read) =>
            request.kind === 'compile'
              ? read.role === 'source'
              : read.role === 'object:0',
          )?.physicalPath ?? '',
          'utf8',
        );
        const output = await readFile(workspace.write.physicalPath, 'utf8');
        return {
          ...result,
          metadata: {
            'sublang.slc.update.v1': trace(input, output),
          } as never,
        };
      },
    };
  };

  const boundTrace = (input: string, output: string) => ({
    schema: 'sublang.slc.update.v1',
    input: {
      hash: hashBytes(new TextEncoder().encode(input)),
      byteLength: new TextEncoder().encode(input).byteLength,
      scopes: [
        {
          scope: 'whole',
          start: 0,
          end: new TextEncoder().encode(input).byteLength,
          classification: 'local',
        },
      ],
    },
    target: {
      hash: hashBytes(new TextEncoder().encode(output)),
      byteLength: new TextEncoder().encode(output).byteLength,
      scopes: [
        {
          scope: 'body',
          start: 0,
          end: new TextEncoder().encode(output).byteLength,
          classification: 'local',
        },
      ],
    },
    dependencies: [{ input: 'whole', targets: ['body'] }],
  });

  it('replans a downstream step from the actual upstream output (INCR-3, INCR-17)', async () => {
    // Seed with traces so both steps are update-capable in principle.
    await runSlc(['flow', sourcePath], deps(tracingExecutor(boundTrace)));
    const before = await readRecord();
    expect(before.plan.steps.every((step) => step.trace !== null)).toBe(true);

    // The source changes, so step 0 re-derives; step 1's operand is then the
    // new upstream output rather than the recorded one, and it must not be
    // reused on the strength of the stale recorded key.
    await writeFile(sourcePath, 'changed source\n');
    const performing = tracingExecutor(boundTrace);
    const result = await runSlc(['flow', sourcePath], deps(performing));

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(performing.calls).toHaveLength(2);
    const record = await readRecord();
    // The downstream step's recorded input key follows the actual bytes its
    // predecessor produced in this run.
    expect(record.plan.steps[1].inputKey).toBe(
      expectedInputKey(record.plan.steps[1].id, {
        kind: 'product',
        product: record.plan.steps[0].target.product,
        hash: record.products.find(
          (product) => product.id === record.plan.steps[0].target.product,
        )!.hash,
      }),
    );
    await assertNoPrivateResidue();
  });

  it('promotes one lineage carrying reused and ordinary origins together (INCR-23)', async () => {
    await seedLineage();
    // Only the second phase definition drifts, so step 0 reuses and step 1
    // re-executes — two origins decided independently in one promotion.
    await writeFile(
      join(pipelineDir, 'mid2out.md'),
      `${formatDoc('mid', '.md', 'out', '.ts')}\n- \`refs/shared.md\`\n\nrevised\n`,
    );
    const performing = executor();

    const result = await runSlc(['flow', sourcePath], deps(performing));

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(performing.calls).toHaveLength(1);
    const record = await readRecord();
    expect(record.plan.steps.map((step) => step.origin)).toEqual([
      'ordinary',
      'ordinary',
    ]);
    // Every product the record claims is present and attests, so the whole
    // lineage promoted as one accepted unit.
    for (const product of record.products) {
      const path = join(artifactDir, ...product.path.split('/'));
      expect(await hashFile(path)).toBe(product.hash);
    }
    await assertNoPrivateResidue();
  });

  it('records a bound ordinary trace and nulls an unbound one (INCR-13, INCR-20)', async () => {
    const result = await runSlc(
      ['flow', sourcePath],
      deps(tracingExecutor(boundTrace)),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    const record = await readRecord();
    // Every ordinary step's trace describes that step's own transformation.
    expect(record.plan.steps.map((step) => step.trace !== null)).toEqual([
      true,
      true,
    ]);
    expect(record.plan.steps[0].trace?.input.hash).toBe(record.source.hash);
  });

  it('nulls a trace that does not bind to its own step', async () => {
    const misbound = tracingExecutor(() =>
      boundTrace('unrelated input', 'unrelated output'),
    );

    const result = await runSlc(['flow', sourcePath], deps(misbound));

    // The artifact is still accepted; only the unusable trace is dropped.
    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    const record = await readRecord();
    expect(record.plan.steps.every((step) => step.trace === null)).toBe(true);
  });

  it('never records a trace for a link step', async () => {
    const result = await runSlc(
      ['flow', sourcePath, '--link', runtimePath],
      deps(tracingExecutor(boundTrace)),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    const record = await readRecord();
    const link = record.plan.steps.find((step) => step.kind === 'link');
    expect(link?.trace).toBeNull();
  });

  it.each([
    {
      name: 'no accepted lineage',
      setup: async () => {},
      reason: /no accepted lineage/,
    },
    {
      name: 'malformed record',
      setup: async () => {
        await seedLineage();
        await writeFile(join(artifactDir, BUILD_RECORD_FILE), '{not json\n');
      },
      reason: /adoption is not cold-build repair/,
    },
  ])('refuses --adopt for $name', async ({ setup, reason }) => {
    await setup();

    const result = await runSlc(
      ['flow', sourcePath, '--adopt'],
      deps(executor()),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(reason);
    await assertNoPrivateResidue();
  });

  it('voids an adoption whose source changes mid-run (INCR-13, INCR-34)', async () => {
    await seedLineage();
    const refined = join(artifactDir, 'workflow.mid.md');
    await writeFile(refined, 'manual refinement\n');
    const accepted = await acceptedBytes();
    const refusing: PhaseExecutor = {
      run: () => {
        throw new Error('adoption must invoke no semantic executor');
      },
    };
    // The plan guard re-derives identity through buildIdentity, so the guard's
    // own re-observation is the seam: the source is edited underneath the run
    // after adoption has already read and attested it.
    let derivations = 0;
    const drifting: LineageDeps = {
      ...deps(refusing),
      async buildIdentity(topology) {
        derivations += 1;
        if (derivations > 1) await writeFile(sourcePath, 'edited mid-run\n');
        return identityContext(topology);
      },
    };

    const result = await runSlc(['flow', sourcePath, '--adopt'], drifting);

    // Adoption used to carry no basis guard at all, so a concurrent edit
    // produced an accepted record describing a source that no longer existed.
    expect(result.ok).toBe(false);
    await expectAcceptedBytes(accepted);
    await assertNoPrivateResidue();
  });

  it('adopts a refined semantic product without an executor (INCR-34, INCR-35)', async () => {
    await seedLineage();
    const refined = join(artifactDir, 'workflow.mid.md');
    await writeFile(refined, 'manual refinement\n');
    const refusing: PhaseExecutor = {
      run: () => {
        throw new Error('adoption must invoke no semantic executor');
      },
    };

    const result = await runSlc(
      ['flow', sourcePath, '--adopt'],
      deps(refusing),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(result.outcome).toBe('adopted');
    // The attested bytes are recorded as-is and left untouched.
    expect(await readFile(refined, 'utf8')).toBe('manual refinement\n');
    const record = await readRecord();
    expect(record.plan.steps.every((s) => s.origin === 'user-adopted')).toBe(
      true,
    );
    expect(record.plan.steps.every((s) => s.trace === null)).toBe(true);
    expect(
      record.products.find((p) => p.path === 'workflow.mid.md')?.hash,
    ).toBe(hashBytes(new TextEncoder().encode('manual refinement\n')));
    await assertNoPrivateResidue();
  });

  it.each([
    {
      name: 'changed source',
      mutate: async () => writeFile(sourcePath, 'changed\n'),
      reason: /source bytes changed/,
    },
    {
      name: 'missing semantic product',
      mutate: async () => rm(join(artifactDir, 'workflow.mid.md')),
      reason: /missing or unsafe/,
    },
  ])(
    'refuses --adopt for $name without mutation',
    async ({ mutate, reason }) => {
      await seedLineage();
      await mutate();
      const before = await readRecord();

      const result = await runSlc(
        ['flow', sourcePath, '--adopt'],
        deps(executor()),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.join('\n')).toMatch(reason);
      // The refusal changed nothing.
      expect(await readRecord()).toEqual(before);
      await assertNoPrivateResidue();
    },
  );

  it('reuses an adopted lineage exactly on the next run (INCR-35)', async () => {
    await seedLineage();
    await writeFile(join(artifactDir, 'workflow.mid.md'), 'refined\n');
    const adopted = await runSlc(
      ['flow', sourcePath, '--adopt'],
      deps(executor()),
    );
    expect(adopted.ok, adopted.diagnostics.join('\n')).toBe(true);

    const refusing: PhaseExecutor = {
      run: () => {
        throw new Error('an adopted lineage must reuse without executing');
      },
    };
    const next = await runSlc(['flow', sourcePath], deps(refusing));

    expect(next.ok, next.diagnostics.join('\n')).toBe(true);
    expect(next.outcome).toBe('up-to-date');
  });

  it('never selects a scoped update while the feature is withheld (INCR-15)', async () => {
    // The reachable seeding path: a contract-bearing definition whose agent
    // emits a bound trace on an ordinary run. The trace is recorded like any
    // other, so a later edit inside one input unit is exactly the case that
    // would select the update path. Selection is closed until the candidate
    // gate enforces all of INCR-15 over a real transport.
    const contract = [
      '',
      '## Update',
      '',
      '```json',
      '{"schema":"sublang.slc.update-contract.v1","traceSchema":"sublang.slc.update.v1"}',
      '```',
      '',
      ...[
        'Stable input units',
        'Target scopes',
        'Dependency closure',
        'Structural and global scopes',
        'Update instructions',
        'Semantic verification',
      ].flatMap((title) => [`### ${title}`, '', 'content', '']),
    ].join('\n');
    await writeFile(
      join(pipelineDir, 'text2mid.md'),
      formatDoc('text', '.md', 'mid', '.md') + contract,
    );
    await writeFile(sourcePath, 'AAAA|BBBB\n');

    const partitioned = (input: string, output: string) => ({
      schema: 'sublang.slc.update.v1',
      input: {
        hash: hashBytes(new TextEncoder().encode(input)),
        byteLength: new TextEncoder().encode(input).byteLength,
        scopes: [
          { scope: 'left', start: 0, end: 4, classification: 'local' },
          {
            scope: 'right',
            start: 4,
            end: new TextEncoder().encode(input).byteLength,
            classification: 'local',
          },
        ],
      },
      target: {
        hash: hashBytes(new TextEncoder().encode(output)),
        byteLength: new TextEncoder().encode(output).byteLength,
        scopes: [
          {
            scope: 'head',
            start: 0,
            end: new TextEncoder().encode(output).byteLength,
            classification: 'local',
          },
        ],
      },
      dependencies: [
        { input: 'left', targets: ['head'] },
        { input: 'right', targets: ['head'] },
      ],
    });

    const seeded = await runSlc(
      ['flow', sourcePath],
      deps(tracingExecutor(partitioned)),
    );
    expect(seeded.ok, seeded.diagnostics.join('\n')).toBe(true);
    // The ordinary run does record the agent-supplied trace: this is the
    // reachability the quarantine exists for, not a hypothetical.
    expect((await readRecord()).plan.steps[0].trace).not.toBeNull();

    await writeFile(sourcePath, 'AAZA|BBBB\n');
    let sawUpdate = false;
    const base = tracingExecutor(partitioned);
    const watching: FixtureExecutor = {
      calls: base.calls,
      async run(request, workspace, signal) {
        if (request.kind === 'compile' && request.update !== undefined) {
          sawUpdate = true;
        }
        return base.run(request, workspace, signal);
      },
    };

    const result = await runSlc(['flow', sourcePath], deps(watching));

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(sawUpdate).toBe(false);
    expect((await readRecord()).plan.steps[0].origin).toBe('ordinary');
    await assertNoPrivateResidue();
  });

  it('reuses unaffected steps and executes only the dirty one (INCR-10, INCR-11)', async () => {
    await seedLineage();
    const reusedPath = join(artifactDir, 'workflow.mid.md');
    const reusedBefore = await stat(reusedPath);
    // Only the second phase definition changes, so step 1 is dirty and
    // step 0 stays exactly derivable.
    await writeFile(
      join(pipelineDir, 'mid2out.md'),
      `${formatDoc('mid', '.md', 'out', '.ts')}\n- \`refs/shared.md\`\n\nrevised\n`,
    );
    const performing = executor();

    const result = await runSlc(['flow', sourcePath], deps(performing));

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(performing.calls).toHaveLength(1);
    expect(basename(performing.calls[0].request.definitionPath)).toBe(
      'mid2out.md',
    );
    // The reused product was never rewritten: promotion installs by
    // temp+rename, so an unchanged inode proves no write occurred.
    expect((await stat(reusedPath)).ino).toBe(reusedBefore.ino);
    const record = await readRecord();
    expect(record.plan.steps.map((step) => step.origin)).toEqual([
      'ordinary',
      'ordinary',
    ]);
    expect(record.lineage.generation).toBe(2);
    await assertNoPrivateResidue();
  });

  it('refuses to reuse a step whose input closure is open (INCR-29)', async () => {
    // Without a `## Pin Inputs` section the phase declares no closed set of
    // readable inputs, so its result can never be assumed still exact.
    await writeFile(
      join(pipelineDir, 'text2mid.md'),
      formatDoc('text', '.md', 'mid', '.md').replace('## Pin Inputs\n', ''),
    );
    await seedLineage();
    const record = await readRecord();
    expect(record.plan.steps[0].inputClosure).toBe('open');

    const performing = executor();
    const result = await runSlc(['flow', sourcePath], deps(performing));

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    // The open step re-executes; the closed downstream step still reuses
    // because the regenerated bytes are identical.
    expect(performing.calls).toHaveLength(1);
    expect(basename(performing.calls[0].request.definitionPath)).toBe(
      'text2mid.md',
    );
    await assertNoPrivateResidue();
  });

  it('preserves a reused step origin verbatim (INCR-7, DR-021)', async () => {
    await seedLineage();
    const record = await readRecord();
    // A non-ordinary origin on the reusable step: reuse must carry it
    // forward rather than relabel the step as freshly executed.
    const amended: BuildRecord = {
      ...record,
      plan: {
        ...record.plan,
        steps: record.plan.steps.map((step, index) =>
          index === 0 ? { ...step, origin: 'user-adopted' as const } : step,
        ),
      },
    };
    await writeFile(
      join(artifactDir, BUILD_RECORD_FILE),
      encodeBuildRecord(amended),
    );
    await writeFile(
      join(pipelineDir, 'mid2out.md'),
      `${formatDoc('mid', '.md', 'out', '.ts')}\n- \`refs/shared.md\`\n\nrevised\n`,
    );

    const result = await runSlc(['flow', sourcePath], deps(executor()));

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    const next = await readRecord();
    expect(next.plan.steps[0].origin).toBe('user-adopted');
    expect(next.plan.steps[0].trace).toBeNull();
    expect(next.plan.steps[1].origin).toBe('ordinary');
  });

  it.each([
    {
      name: 'malformed record JSON',
      corrupt: async () =>
        writeFile(join(artifactDir, BUILD_RECORD_FILE), '{not json\n'),
    },
    {
      name: 'orphaned pair',
      corrupt: async () => rm(join(artifactDir, BUILD_RECORD_FILE)),
    },
    {
      name: 'symbolic-link record',
      corrupt: async () => {
        const outside = join(root, 'outside-record.json');
        await writeFile(outside, '{"schema":"forged"}\n');
        await rm(join(artifactDir, BUILD_RECORD_FILE));
        await symlink(outside, join(artifactDir, BUILD_RECORD_FILE));
      },
    },
    {
      name: 'wrong-typed snapshot',
      corrupt: async () => {
        await rm(join(artifactDir, SOURCE_SNAPSHOT_FILE));
        await mkdir(join(artifactDir, SOURCE_SNAPSHOT_FILE));
      },
    },
  ])(
    'rebuilds over $name at generation 1 (INCR-19, INCR-26)',
    async ({ corrupt }) => {
      await seedLineage();
      const unrecordedPath = join(artifactDir, 'notes.txt');
      await writeFile(unrecordedPath, 'keep me\n');
      await corrupt();
      const performing = executor();

      const result = await runSlc(
        ['flow', sourcePath, '--rebuild'],
        deps(performing),
      );

      expect(result.ok, result.diagnostics.join('\n')).toBe(true);
      const record = await readRecord();
      // Untrusted metadata grants no inventory, so the lineage restarts.
      expect(record.lineage).toEqual({ generation: 1, transition: null });
      expect(await readFile(unrecordedPath, 'utf8')).toBe('keep me\n');
      await assertNoPrivateResidue();
    },
  );

  it('removes an obsolete product a rebuild no longer plans (INCR-30)', async () => {
    await seedLineage(true);
    const obsolete = join(artifactDir, 'workflow.run.ts');
    const unrecordedPath = join(artifactDir, 'notes.txt');
    await writeFile(unrecordedPath, 'keep me\n');
    expect(await exists(obsolete)).toBe(true);

    // The un-linked rebuild no longer plans the linked product.
    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(executor()),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(await exists(obsolete)).toBe(false);
    expect(await readFile(unrecordedPath, 'utf8')).toBe('keep me\n');
    const record = await readRecord();
    expect(record.products.map((product) => product.path)).not.toContain(
      'workflow.run.ts',
    );
    await assertNoPrivateResidue();
  });

  it('grants a non-derivable recorded inventory no deletion authority (INCR-8, INCR-26)', async () => {
    await seedLineage(true);
    const obsolete = join(artifactDir, 'workflow.run.ts');
    // A schema-valid record whose plan is not derivable: the step IDs are
    // not the canonical ordinals. Automatic classification rejects this
    // inventory; the explicit paths loaded it without that check, so a
    // rebuild trusted its product list and deleted from it.
    await writeFile(
      join(artifactDir, BUILD_RECORD_FILE),
      encodeBuildRecord(nonDerivable(await readRecord())),
    );

    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(executor()),
    );

    // The rebuild succeeds on its own authority, but an untrusted record
    // grants no deletion authority, so the formerly-linked product survives
    // as an unrecorded file instead of being removed on its word.
    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(await exists(obsolete)).toBe(true);
    await assertNoPrivateResidue();
  });

  it('refuses --adopt on a non-derivable recorded inventory (INCR-34)', async () => {
    await seedLineage(true);
    await writeFile(
      join(artifactDir, BUILD_RECORD_FILE),
      encodeBuildRecord(nonDerivable(await readRecord())),
    );
    const accepted = await acceptedBytes(true);

    const result = await runSlc(
      ['flow', sourcePath, '--link', runtimePath, '--adopt'],
      deps(executor()),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(/--rebuild/);
    await expectAcceptedBytes(accepted);
    await assertNoPrivateResidue();
  });

  it('preserves a drifted obsolete product instead of deleting it (INCR-8)', async () => {
    await seedLineage(true);
    const obsolete = join(artifactDir, 'workflow.run.ts');
    // The recorded bytes no longer attest this leaf, so no deletion
    // authority is derived for it and the user's edit survives.
    await writeFile(obsolete, 'manual edit\n');

    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(executor()),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(await readFile(obsolete, 'utf8')).toBe('manual edit\n');
    await assertNoPrivateResidue();
  });

  it('preserves the accepted lineage and unrecorded files after a failed rebuild', async () => {
    await seedLineage();
    const unrecordedPath = join(artifactDir, 'notes.txt');
    await writeFile(unrecordedPath, 'keep me\n');
    const accepted = await acceptedBytes();
    const performing = executor('mid2out');

    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(performing),
    );

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toContain(
      'fixture rejected before promotion',
    );
    expect(performing.calls).toHaveLength(2);
    await expectAcceptedBytes(accepted);
    expect(await readFile(unrecordedPath, 'utf8')).toBe('keep me\n');
    await assertNoPrivateResidue();
  });

  it('resets generation when --rebuild explicitly rebinds the source locator', async () => {
    const prior = await seedLineage();
    const otherDir = join(root, 'other');
    const otherSource = join(otherDir, 'workflow.md');
    await mkdir(otherDir);
    await writeFile(otherSource, 'rebound source bytes\n');
    const performing = executor();

    const result = await runSlc(
      ['flow', otherSource, '--rebuild'],
      deps(performing),
    );

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(performing.calls).toHaveLength(2);
    const record = await readRecord();
    expect(record.source.locator).not.toBe(prior.source.locator);
    expect(record.lineage).toEqual({ generation: 1, transition: null });
    expect(await readFile(join(artifactDir, SOURCE_SNAPSHOT_FILE))).toEqual(
      await readFile(otherSource),
    );
    expect(record.plan.steps.every((step) => step.origin === 'ordinary')).toBe(
      true,
    );
    await assertNoPrivateResidue();
  });

  it('refuses same-binding generation overflow before executor work', async () => {
    const record = await seedLineage();
    record.lineage.generation = Number.MAX_SAFE_INTEGER;
    await writeFile(
      join(artifactDir, BUILD_RECORD_FILE),
      encodeBuildRecord(record),
    );
    const accepted = await acceptedBytes();
    const performing = executor();

    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(performing),
    );

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toMatch(/generation/i);
    expect(performing.calls).toHaveLength(0);
    await expectAcceptedBytes(accepted);
    await assertNoPrivateResidue();
  });

  it('validates pins before --rebuild and preserves the accepted lineage', async () => {
    await seedLineage();
    const accepted = await acceptedBytes();
    await writeFile(join(pipelineDir, PINS_FILE), '{malformed\n');
    const performing = executor();

    const result = await runSlc(
      ['flow', sourcePath, '--rebuild'],
      deps(performing),
    );

    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
    expect(result.diagnostics.join('\n')).toMatch(
      /pin.*(parse|json|malformed)/i,
    );
    expect(result.diagnostics.join('\n')).toMatch(/build.*review/i);
    expect(performing.calls).toHaveLength(0);
    await expectAcceptedBytes(accepted);
    await assertNoPrivateResidue();
  });

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

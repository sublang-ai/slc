// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  BUILD_HASH_ALGORITHM,
  BUILD_RECORD_FILE,
  BUILD_RECORD_SCHEMA,
  BuildRecordError,
  SOURCE_SNAPSHOT_FILE,
  decodeBuildRecord,
  encodeBuildRecord,
  encodeReadLocator,
  loadLineagePair,
  parseUpdateTrace,
  planIdentity,
  resolveManagedPath,
  resolveReadLocator,
  type BuildRecord,
} from '../src/build-record.js';
import { hashBytes } from '../src/hash.js';

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const H = (value: string) => hashBytes(bytes(value));

function validRecord(snapshot = bytes('source\n')): BuildRecord {
  const sourceHash = hashBytes(snapshot);
  const outputHash = H('target\n');
  const definitionHash = H('definition\n');
  const plan = {
    pipeline: 'fixture',
    invocation: {
      kind: 'full' as const,
      normalize: false,
      optimize: false,
      link: null,
    },
    inputs: [
      {
        id: 'definition:compile',
        kind: 'definition' as const,
        locator: '../pipelines/fixture/text2result.md',
        value: null,
        identity: definitionHash,
      },
      {
        id: 'executor:compile',
        kind: 'executor' as const,
        locator: null,
        value: 'fixture-executor-v1',
        identity: H('fixture-executor-v1'),
      },
    ],
    deterministicInputs: [] as string[],
    steps: [
      {
        id: 'phase:compile',
        kind: 'phase' as const,
        name: 'text2result',
        source: { format: 'text', ext: '.md' },
        target: {
          format: 'result',
          ext: '.md',
          path: 'work.result.md',
          product: 'semantic:result',
        },
        inputs: ['definition:compile', 'executor:compile'],
        inputClosure: 'closed' as const,
      },
    ],
  };
  const record: BuildRecord = {
    schema: BUILD_RECORD_SCHEMA,
    hashAlgorithm: BUILD_HASH_ALGORITHM,
    source: {
      locator: '../work.txt',
      hash: sourceHash,
      snapshot: SOURCE_SNAPSHOT_FILE,
      snapshotHash: sourceHash,
    },
    plan: {
      identity: H('placeholder'),
      pipeline: plan.pipeline,
      invocation: plan.invocation,
      inputs: plan.inputs,
      deterministicInputs: plan.deterministicInputs,
      steps: [
        {
          id: plan.steps[0].id,
          kind: plan.steps[0].kind,
          name: plan.steps[0].name,
          source: plan.steps[0].source,
          target: plan.steps[0].target,
          inputKey: H(
            JSON.stringify([
              'phase:compile',
              [{ kind: 'source', hash: sourceHash }],
            ]),
          ),
          inputs: plan.steps[0].inputs,
          inputClosure: plan.steps[0].inputClosure,
          origin: 'ordinary',
          trace: null,
        },
      ],
    },
    products: [
      {
        id: 'semantic:result',
        kind: 'semantic',
        path: 'work.result.md',
        hash: outputHash,
        inputs: [],
      },
    ],
    provenance: {
      packages: [
        { role: 'slc', name: '@sublang/slc', version: '0.3.0' },
        { role: 'pipeline', name: 'fixture', version: null },
      ],
      compatibility: [],
    },
    lineage: { generation: 1, transition: null },
  };
  record.plan.identity = planIdentity(record.plan);
  return record;
}

function recordObject(record = validRecord()): Record<string, unknown> {
  return structuredClone(record) as unknown as Record<string, unknown>;
}

function validFullLinkRecord(): BuildRecord {
  const record = validRecord();
  const result = record.products[0];
  const linkedHash = H('linked\n');
  record.plan.invocation = {
    kind: 'full-link',
    normalize: false,
    optimize: false,
    link: { target: '../runtime.ts', options: [] },
  };
  record.plan.inputs = [
    record.plan.inputs[0],
    {
      id: 'definition:link',
      kind: 'definition',
      locator: '../pipelines/fixture/link.md',
      value: null,
      identity: H('link definition\n'),
    },
    record.plan.inputs[1],
    {
      id: 'executor:link',
      kind: 'executor',
      locator: null,
      value: 'fixture-link-executor-v1',
      identity: H('fixture-link-executor-v1'),
    },
    {
      id: 'link-target:runtime',
      kind: 'link-target',
      locator: '../runtime.ts',
      value: null,
      identity: H('runtime\n'),
    },
  ];
  record.plan.steps.push({
    id: 'link:playbook',
    kind: 'link',
    name: 'link',
    source: { format: 'result', ext: '.md' },
    target: {
      format: 'playbook',
      ext: '.ts',
      path: 'work.playbook.ts',
      product: 'semantic:playbook',
    },
    inputKey: H(
      JSON.stringify([
        'link:playbook',
        [
          {
            kind: 'product',
            product: 'semantic:result',
            hash: result.hash,
          },
        ],
      ]),
    ),
    inputs: ['definition:link', 'executor:link', 'link-target:runtime'],
    inputClosure: 'closed',
    origin: 'ordinary',
    trace: null,
  });
  record.products = [
    {
      id: 'semantic:playbook',
      kind: 'semantic',
      path: 'work.playbook.ts',
      hash: linkedHash,
      inputs: [],
    },
    result,
  ];
  record.provenance.packages.push({
    role: 'link-runtime',
    name: '@sublang/playbook',
    version: '4.0.0',
  });
  record.plan.identity = planIdentity(record.plan);
  return record;
}

function encodedObject(value: unknown): Uint8Array {
  return bytes(`${JSON.stringify(value)}\n`);
}

describe('build-record codec (INCR-7, INCR-9)', () => {
  it('round-trips exact canonical bytes with one trailing LF', () => {
    const record = validRecord();
    const encoded = encodeBuildRecord(record);

    expect(new TextDecoder().decode(encoded)).toBe(
      `${JSON.stringify(record)}\n`,
    );
    expect(decodeBuildRecord(encoded)).toEqual(record);
  });

  it('round-trips the full-link branch with a null link trace', () => {
    const record = validFullLinkRecord();

    const decoded = decodeBuildRecord(encodeBuildRecord(record));

    expect(decoded.plan.invocation.kind).toBe('full-link');
    expect(decoded.plan.steps.at(-1)?.kind).toBe('link');
    expect(decoded.plan.steps.at(-1)?.trace).toBeNull();
    expect(decoded.provenance.packages.at(-1)?.role).toBe('link-runtime');
  });

  it('accepts a value-backed package-resolved link target', () => {
    const record = validFullLinkRecord();
    const target = record.plan.inputs.find(
      (input) => input.kind === 'link-target',
    );
    expect(target).toBeDefined();
    if (target === undefined) return;
    target.locator = null;
    target.value = '@sublang/playbook/xstate-runtime';
    target.identity = H(target.value);
    record.plan.identity = planIdentity(record.plan);

    expect(decodeBuildRecord(encodeBuildRecord(record))).toEqual(record);
  });

  it.each([
    [
      'unknown top-level field',
      (raw: Record<string, unknown>) => (raw.extra = true),
      /fields in order/,
    ],
    [
      'wrong field order',
      (raw: Record<string, unknown>) => {
        const schema = raw.schema;
        delete raw.schema;
        raw.schema = schema;
      },
      /fields in order/,
    ],
    [
      'uppercase hash',
      (raw: Record<string, unknown>) => {
        ((raw.source as Record<string, unknown>).hash as string) =
          `sha256:${'A'.repeat(64)}`;
      },
      /lowercase sha256/,
    ],
    [
      'null required field',
      (raw: Record<string, unknown>) => {
        (raw.source as Record<string, unknown>).locator = null;
      },
      /must be a string/,
    ],
    [
      'bad generation',
      (raw: Record<string, unknown>) => {
        (raw.lineage as Record<string, unknown>).generation = 0;
      },
      /safe integer/,
    ],
    [
      'mismatched source identities',
      (raw: Record<string, unknown>) => {
        (raw.source as Record<string, unknown>).snapshotHash = H('different');
      },
      /must match/,
    ],
    [
      'unresolved step input',
      (raw: Record<string, unknown>) => {
        const plan = raw.plan as Record<string, unknown>;
        (
          (plan.steps as Array<Record<string, unknown>>)[0].inputs as string[]
        )[0] = 'definition:missing';
        recomputePlanIdentity(raw);
      },
      /unknown input/,
    ],
    [
      'missing step executor',
      (raw: Record<string, unknown>) => {
        const plan = raw.plan as Record<string, unknown>;
        plan.inputs = (plan.inputs as Array<Record<string, unknown>>).filter(
          (input) => input.kind !== 'executor',
        );
        const step = (plan.steps as Array<Record<string, unknown>>)[0];
        step.inputs = (step.inputs as string[]).filter(
          (input) => input !== 'executor:compile',
        );
        recomputePlanIdentity(raw);
      },
      /one definition and one executor/,
    ],
    [
      'orphan deterministic input',
      (raw: Record<string, unknown>) => {
        const plan = raw.plan as Record<string, unknown>;
        (plan.inputs as Array<Record<string, unknown>>).push({
          id: 'generator:orphan',
          kind: 'generator',
          locator: null,
          value: 'orphan-generator',
          identity: H('orphan-generator'),
        });
        recomputePlanIdentity(raw);
      },
      /every and only generator\/checker plan input/,
    ],
    [
      'adoption transition on ordinary lineage',
      (raw: Record<string, unknown>) => {
        (raw.lineage as Record<string, unknown>).transition = {
          from: H('prior-plan'),
          to: (raw.plan as Record<string, unknown>).identity,
        };
      },
      /whole user-adopted lineage/,
    ],
    [
      'updated origin without a replacement trace',
      (raw: Record<string, unknown>) => {
        const plan = raw.plan as Record<string, unknown>;
        (plan.steps as Array<Record<string, unknown>>)[0].origin = 'updated';
      },
      /replacement traces/,
    ],
    [
      'invalid sibling entry basename',
      (raw: Record<string, unknown>) => {
        (raw.products as Array<Record<string, unknown>>).unshift({
          id: 'entry:bad',
          kind: 'entry',
          path: '../..',
          hash: H('entry'),
          inputs: [],
        });
      },
      /canonical sibling entry/,
    ],
    [
      'multiple entry products',
      (raw: Record<string, unknown>) => {
        (raw.products as Array<Record<string, unknown>>).unshift(
          {
            id: 'entry:first',
            kind: 'entry',
            path: '../first.ts',
            hash: H('first'),
            inputs: [],
          },
          {
            id: 'entry:second',
            kind: 'entry',
            path: '../second.ts',
            hash: H('second'),
            inputs: [],
          },
        );
      },
      /at most one entry product/,
    ],
    [
      'target-product mismatch',
      (raw: Record<string, unknown>) => {
        const plan = raw.plan as Record<string, unknown>;
        (
          (plan.steps as Array<Record<string, unknown>>)[0].target as Record<
            string,
            unknown
          >
        ).path = 'other.md';
        recomputePlanIdentity(raw);
      },
      /semantic product/,
    ],
  ])('rejects %s', (_name, mutate, expected) => {
    const raw = recordObject();
    mutate(raw);
    expect(() => decodeBuildRecord(encodedObject(raw))).toThrow(expected);
  });

  it('rejects noncanonical whitespace, missing LF, and invalid UTF-8', () => {
    const canonical = new TextDecoder().decode(
      encodeBuildRecord(validRecord()),
    );
    expect(() => decodeBuildRecord(bytes(` ${canonical}`))).toThrow(
      /canonical/,
    );
    expect(() => decodeBuildRecord(bytes(canonical.slice(0, -1)))).toThrow(
      /one LF/,
    );
    expect(() => decodeBuildRecord(new Uint8Array([0xff, 0x0a]))).toThrow(
      /UTF-8/,
    );
  });

  it('validates complete ordered update-trace partitions and bindings', () => {
    const record = validRecord();
    const source = record.source.hash;
    const target = record.products[0].hash;
    record.plan.steps[0].trace = {
      schema: 'sublang.slc.update.v1',
      input: {
        hash: source,
        byteLength: 7,
        scopes: [
          { scope: 'input-a', start: 0, end: 7, classification: 'local' },
        ],
      },
      target: {
        hash: target,
        byteLength: 7,
        scopes: [
          { scope: 'target-a', start: 0, end: 7, classification: 'local' },
        ],
      },
      dependencies: [{ input: 'input-a', targets: ['target-a'] }],
    };
    const decoded = decodeBuildRecord(encodeBuildRecord(record));
    expect(decoded.plan.steps[0].trace?.dependencies).toEqual([
      { input: 'input-a', targets: ['target-a'] },
    ]);

    const raw = recordObject(record);
    const trace = (
      (raw.plan as Record<string, unknown>).steps as Array<
        Record<string, unknown>
      >
    )[0].trace as Record<string, unknown>;
    const input = trace.input as Record<string, unknown>;
    (input.scopes as Array<Record<string, unknown>>)[0].end = 6;
    expect(() => decodeBuildRecord(encodedObject(raw))).toThrow(
      /complete byte length/,
    );

    expect(parseUpdateTrace(record.plan.steps[0].trace)).toEqual(
      record.plan.steps[0].trace,
    );
  });

  it('makes plan identity independent of object insertion order', () => {
    const record = validRecord();
    const invocation = record.plan.invocation;
    const reordered = {
      ...record.plan,
      invocation: {
        link: invocation.link,
        optimize: invocation.optimize,
        normalize: invocation.normalize,
        kind: invocation.kind,
      },
      inputs: record.plan.inputs.map((input) => ({
        identity: input.identity,
        value: input.value,
        locator: input.locator,
        kind: input.kind,
        id: input.id,
      })),
    } as typeof record.plan;

    expect(planIdentity(reordered)).toBe(record.plan.identity);
  });
});

describe('lineage pair and paths (INCR-7, INCR-9)', () => {
  let root: string;
  let artDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-lineage-'));
    artDir = join(root, 'work.fixture');
    await mkdir(artDir);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns absent only when both reserved paths are absent', async () => {
    await expect(loadLineagePair(artDir)).resolves.toEqual({ state: 'absent' });
    await writeFile(join(artDir, SOURCE_SNAPSHOT_FILE), 'source\n');
    await expect(loadLineagePair(artDir)).rejects.toThrow(/orphaned/);
  });

  it('treats a nonexistent artifact directory as absent lineage', async () => {
    await expect(
      loadLineagePair(join(root, 'missing.fixture')),
    ).resolves.toEqual({ state: 'absent' });
  });

  it('loads a valid binary snapshot and rejects a snapshot mismatch', async () => {
    const snapshot = new Uint8Array([0, 1, 255]);
    const record = validRecord(snapshot);
    await writeFile(join(artDir, BUILD_RECORD_FILE), encodeBuildRecord(record));
    await writeFile(join(artDir, SOURCE_SNAPSHOT_FILE), snapshot);

    const loaded = await loadLineagePair(artDir);
    expect(loaded.state).toBe('present');
    if (loaded.state === 'present')
      expect([...loaded.snapshot]).toEqual([...snapshot]);

    await writeFile(join(artDir, SOURCE_SNAPSHOT_FILE), 'changed');
    await expect(loadLineagePair(artDir)).rejects.toThrow(
      /raw source snapshot/,
    );
  });

  it('rejects a symlink at either reserved metadata path', async () => {
    const outside = join(root, 'outside');
    await writeFile(outside, 'source\n');
    await symlink(outside, join(artDir, SOURCE_SNAPSHOT_FILE));
    await writeFile(
      join(artDir, BUILD_RECORD_FILE),
      encodeBuildRecord(validRecord()),
    );
    await expect(loadLineagePair(artDir)).rejects.toThrow(/non-symbolic-link/);
  });

  it('round-trips canonical inside and outward read locators', () => {
    const outside = join(root, 'source.txt');
    const inside = join(artDir, 'input.txt');
    expect(encodeReadLocator(artDir, outside)).toBe('../source.txt');
    expect(resolveReadLocator(artDir, '../source.txt')).toBe(resolve(outside));
    expect(encodeReadLocator(artDir, inside)).toBe('input.txt');
    expect(() => resolveReadLocator(artDir, 'a/../input.txt')).toThrow(
      /canonical/,
    );
  });

  it.each(['', '/abs', 'C:/abs', 'a\\b', 'a//b', './a', 'a/'])(
    'rejects a noncanonical read locator %j',
    (locator) => {
      expect(() => resolveReadLocator(artDir, locator)).toThrow(
        BuildRecordError,
      );
    },
  );

  it('confines managed paths and permits only the named sibling entry', async () => {
    await expect(resolveManagedPath(artDir, 'work.result.md')).resolves.toBe(
      join(artDir, 'work.result.md'),
    );
    await expect(
      resolveManagedPath(artDir, '../work.ts', { entryBasename: 'work.ts' }),
    ).resolves.toBe(join(root, 'work.ts'));
    await expect(resolveManagedPath(artDir, '../other.ts')).rejects.toThrow();
    await expect(
      resolveManagedPath(artDir, '../../work.ts', { entryBasename: 'work.ts' }),
    ).rejects.toThrow();
  });

  it('rejects a symbolic-link artifact root for every managed path', async () => {
    const alias = join(root, 'alias.fixture');
    await symlink(artDir, alias);

    await expect(
      resolveManagedPath(alias, '../alias.ts', { entryBasename: 'alias.ts' }),
    ).rejects.toThrow(/non-symbolic-link directory/);
  });

  it('derives the canonical entry from a resolved artifact directory', async () => {
    const snapshot = bytes('source\n');
    const record = validRecord(snapshot);
    record.plan.inputs.push({
      id: 'generator:entry',
      kind: 'generator',
      locator: null,
      value: 'entry-generator-v1',
      identity: H('entry-generator-v1'),
    });
    record.plan.deterministicInputs.push('generator:entry');
    record.plan.identity = planIdentity(record.plan);
    record.products.unshift({
      id: 'entry:work',
      kind: 'entry',
      path: '../work.ts',
      hash: H('entry\n'),
      inputs: ['generator:entry'],
    });
    await writeFile(join(artDir, BUILD_RECORD_FILE), encodeBuildRecord(record));
    await writeFile(join(artDir, SOURCE_SNAPSHOT_FILE), snapshot);

    await expect(loadLineagePair(`${artDir}/`)).resolves.toMatchObject({
      state: 'present',
    });
  });

  it('rejects an existing symlink component in a managed path', async () => {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(artDir, 'linked'));
    await expect(resolveManagedPath(artDir, 'linked/file.md')).rejects.toThrow(
      /symbolic link/,
    );
  });
});

function recomputePlanIdentity(raw: Record<string, unknown>): void {
  const plan = raw.plan as Record<string, unknown>;
  const steps = plan.steps as Array<Record<string, unknown>>;
  const projection = {
    pipeline: plan.pipeline,
    invocation: plan.invocation,
    inputs: plan.inputs,
    deterministicInputs: plan.deterministicInputs,
    steps: steps.map((step) => ({
      id: step.id,
      kind: step.kind,
      name: step.name,
      source: step.source,
      target: step.target,
      inputs: step.inputs,
      inputClosure: step.inputClosure,
    })),
  };
  plan.identity = H(JSON.stringify(projection));
}

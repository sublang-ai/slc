// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import type { StepRecord, UpdateTrace } from '../src/build-record.js';
import {
  acceptUpdateCandidate,
  diffBytes,
  parseUpdateContract,
  planScopedUpdate,
} from '../src/scoped-update.js';

const DECLARATION =
  '{"schema":"sublang.slc.update-contract.v1","traceSchema":"sublang.slc.update.v1"}';

const SECTIONS = [
  'Stable input units',
  'Target scopes',
  'Dependency closure',
  'Structural and global scopes',
  'Update instructions',
  'Semantic verification',
];

const contract = (opts: { sections?: string[]; declaration?: string } = {}) =>
  [
    '# Fixture phase',
    '',
    '## Update',
    '',
    '```json',
    opts.declaration ?? DECLARATION,
    '```',
    '',
    ...(opts.sections ?? SECTIONS).flatMap((title) => [
      `### ${title}`,
      '',
      'content',
      '',
    ]),
    '## Formats',
    '',
  ].join('\n');

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('update contract grammar (INCR-12; DR-021)', () => {
  it('accepts the exact frozen structure', () => {
    expect(parseUpdateContract(contract())).toBe(true);
  });

  it.each([
    { name: 'absent heading', text: '# Phase\n\n## Formats\n' },
    {
      name: 'altered declaration',
      text: contract({ declaration: `${DECLARATION.slice(0, -1)},"x":1}` }),
    },
    {
      name: 'missing subsection',
      text: contract({ sections: SECTIONS.slice(0, 5) }),
    },
    {
      name: 'reordered subsections',
      text: contract({
        sections: [SECTIONS[1], SECTIONS[0], ...SECTIONS.slice(2)],
      }),
    },
    {
      name: 'extra subsection',
      text: contract({ sections: [...SECTIONS, 'Extra'] }),
    },
    { name: 'duplicate heading', text: `${contract()}\n## Update\n` },
    {
      name: 'prose before the fence',
      text: contract().replace('```json', 'note\n\n```json'),
    },
  ])('rejects $name', ({ text }) => {
    expect(parseUpdateContract(text)).toBe(false);
  });

  it('rejects an empty subsection', () => {
    const text = contract().replace(
      '### Target scopes\n\ncontent\n',
      '### Target scopes\n',
    );
    expect(parseUpdateContract(text)).toBe(false);
  });
});

describe('exact byte diff (INCR-23; DR-021)', () => {
  it('reports no hunk for identical bytes', () => {
    expect(diffBytes(bytes('abc'), bytes('abc'))).toEqual([]);
  });

  it('coalesces an adjacent delete and insert into one hunk', () => {
    // "aa" -> "a" is one maximal run, not a delete beside an insert.
    expect(diffBytes(bytes('aa'), bytes('a'))).toEqual([
      { priorStart: 1, priorEnd: 2, currentStart: 1, currentEnd: 1 },
    ]);
  });

  it('reports a pure insertion as an empty prior range', () => {
    expect(diffBytes(bytes('ac'), bytes('abc'))).toEqual([
      { priorStart: 1, priorEnd: 1, currentStart: 1, currentEnd: 2 },
    ]);
  });

  it('diffs a realistic prose-sized pair rather than refusing it', () => {
    // ~6 KB against ~6 KB is well inside a workflow's size, and must not
    // fall back to ordinary execution.
    const prior = new Uint8Array(6000).fill(65);
    const current = Uint8Array.from(prior);
    current[3000] = 66;
    expect(diffBytes(prior, current)).not.toBeNull();
  });

  it('refuses a pair beyond the diff budget rather than over-allocating', () => {
    const huge = new Uint8Array(40_000);
    const other = new Uint8Array(40_000).fill(1);
    expect(diffBytes(huge, other)).toBeNull();
  });
});

describe('scoped update selection (INCR-14)', () => {
  const trace = (overrides: Partial<UpdateTrace> = {}): UpdateTrace =>
    ({
      schema: 'sublang.slc.update.v1',
      input: {
        hash: `sha256:${'a'.repeat(64)}`,
        byteLength: 9,
        scopes: [
          { scope: 'one', start: 0, end: 4, classification: 'local' },
          { scope: 'two', start: 4, end: 9, classification: 'local' },
        ],
      },
      target: {
        hash: `sha256:${'b'.repeat(64)}`,
        byteLength: 6,
        scopes: [
          { scope: 'x', start: 0, end: 3, classification: 'local' },
          { scope: 'y', start: 3, end: 6, classification: 'local' },
        ],
      },
      dependencies: [
        { input: 'one', targets: ['x'] },
        { input: 'two', targets: ['y'] },
      ],
      ...overrides,
    }) as UpdateTrace;

  const step = (kind: StepRecord['kind'] = 'phase') => ({ kind, id: 'p:0' });

  const recorded = (overrides: Partial<StepRecord> = {}): StepRecord =>
    ({
      id: 'p:0',
      kind: 'phase',
      name: 'text2mid',
      source: { format: 'text', ext: '.md' },
      target: {
        format: 'mid',
        ext: '.md',
        path: 'x.md',
        product: 'semantic:0',
      },
      inputKey: `sha256:${'c'.repeat(64)}`,
      inputs: [],
      inputClosure: 'closed',
      origin: 'ordinary',
      trace: trace(),
      ...overrides,
    }) as StepRecord;

  const plan = (overrides: Record<string, unknown> = {}) =>
    planScopedUpdate({
      step: step(),
      recorded: recorded(),
      contract: true,
      identityDirty: false,
      currentClosure: 'closed',
      priorInput: bytes('aaaabbbbb'),
      currentInput: bytes('aaaZbbbbb'),
      ...overrides,
    } as Parameters<typeof planScopedUpdate>[0]);

  it('selects update for a local single-unit change', () => {
    const result = plan();
    expect(result.mode).toBe('update');
    if (result.mode !== 'update') return;
    expect(result.dirtyInputScopes).toEqual(['one']);
    // The allowed set is exactly that unit's recorded closure.
    expect(result.allowedTargetScopes).toEqual(['x']);
  });

  it.each([
    { reason: 'link-step', overrides: { step: step('link') } },
    { reason: 'no-contract', overrides: { contract: false } },
    { reason: 'identity-drift', overrides: { identityDirty: true } },
    { reason: 'open-closure', overrides: { currentClosure: 'open' } },
    {
      reason: 'no-trace',
      overrides: { recorded: recorded({ trace: null }) },
    },
    {
      reason: 'no-change',
      overrides: { currentInput: bytes('aaaabbbbb') },
    },
    {
      reason: 'unbound-trace',
      overrides: { priorInput: bytes('short') },
    },
    {
      reason: 'cross-unit-change',
      overrides: { currentInput: bytes('aaZZZbbbb') },
    },
    {
      reason: 'structural-or-global-scope',
      overrides: {
        recorded: recorded({
          trace: trace({
            input: {
              hash: `sha256:${'a'.repeat(64)}`,
              byteLength: 9,
              scopes: [
                {
                  scope: 'one',
                  start: 0,
                  end: 4,
                  classification: 'structural',
                },
                { scope: 'two', start: 4, end: 9, classification: 'local' },
              ],
            },
          } as Partial<UpdateTrace>),
        }),
      },
    },
    {
      reason: 'incomplete-closure',
      overrides: {
        recorded: recorded({
          trace: trace({ dependencies: [{ input: 'two', targets: ['y'] }] }),
        }),
      },
    },
  ])('selects ordinary execution for $reason', ({ reason, overrides }) => {
    const result = plan(overrides);
    expect(result.mode).toBe('ordinary');
    if (result.mode !== 'ordinary') return;
    expect(result.reason).toBe(reason);
  });

  it('refuses an insertion at a unit boundary as ambiguous', () => {
    // Inserting exactly between "one" and "two" belongs to neither unit.
    const result = plan({
      priorInput: bytes('aaaabbbbb'),
      currentInput: bytes('aaaaZbbbbb'),
    });
    expect(result.mode).toBe('ordinary');
    if (result.mode !== 'ordinary') return;
    expect(result.reason).toBe('ambiguous-insertion');
  });
});

describe('scoped candidate enforcement (INCR-15, INCR-16, INCR-25)', () => {
  const priorTrace = {
    schema: 'sublang.slc.update.v1',
    input: {
      hash: `sha256:${'a'.repeat(64)}`,
      byteLength: 9,
      scopes: [
        { scope: 'one', start: 0, end: 4, classification: 'local' },
        { scope: 'two', start: 4, end: 9, classification: 'local' },
      ],
    },
    target: {
      hash: `sha256:${'b'.repeat(64)}`,
      byteLength: 6,
      scopes: [
        { scope: 'x', start: 0, end: 3, classification: 'local' },
        { scope: 'y', start: 3, end: 6, classification: 'local' },
      ],
    },
    dependencies: [
      { input: 'one', targets: ['x'] },
      { input: 'two', targets: ['y'] },
    ],
  } as unknown as UpdateTrace;

  const replacement = (overrides: Record<string, unknown> = {}): UpdateTrace =>
    ({
      ...priorTrace,
      input: {
        hash: `sha256:${'c'.repeat(64)}`,
        byteLength: 9,
        scopes: priorTrace.input.scopes,
      },
      target: {
        hash: `sha256:${'d'.repeat(64)}`,
        byteLength: 6,
        scopes: priorTrace.target.scopes,
      },
      ...overrides,
    }) as UpdateTrace;

  const accept = (overrides: Record<string, unknown> = {}) =>
    acceptUpdateCandidate({
      priorTrace,
      replacement: replacement(),
      dirtyInputScopes: ['one'],
      allowedTargetScopes: ['x'],
      currentInputHash: `sha256:${'c'.repeat(64)}`,
      currentInputByteLength: 9,
      candidateHash: `sha256:${'d'.repeat(64)}`,
      candidateByteLength: 6,
      priorTargetBytes: bytes('abcxyz'),
      candidateBytes: bytes('abcxyz'),
      ...overrides,
    } as Parameters<typeof acceptUpdateCandidate>[0]);

  it('accepts a candidate satisfying every invariant', () => {
    expect(accept()).toBeNull();
  });

  it('rejects a candidate that rewrote a protected target scope', () => {
    // Scope 'y' is outside the allowed closure, so its bytes must survive
    // exactly; a full regeneration passes every other check.
    expect(
      accept({
        priorTargetBytes: bytes('abcxyz'),
        candidateBytes: bytes('abcXYZ'),
      }),
    ).toBe('protected-bytes-changed');
  });

  it('rejects a candidate that appended an unreferenced target scope', () => {
    // A new scope the closure never allowed is arbitrary bytes bolted onto
    // the artifact; walking only prior scopes would never see it.
    expect(
      accept({
        replacement: replacement({
          target: {
            hash: `sha256:${'e'.repeat(64)}`,
            byteLength: 9,
            scopes: [
              ...priorTrace.target.scopes,
              { scope: 'extra', start: 6, end: 9, classification: 'local' },
            ],
          },
        }),
        candidateHash: `sha256:${'e'.repeat(64)}`,
        candidateByteLength: 9,
        priorTargetBytes: bytes('abcxyz'),
        candidateBytes: bytes('abcxyzNEW'),
      }),
    ).toBe('target-partition-altered');
  });

  it('rejects a candidate that reordered two protected scopes', () => {
    // Both 'x' and 'y' are protected here: each keeps its bytes, but they
    // swap places, so the artifact's blocks moved outside the closure.
    const threeScope = {
      ...priorTrace,
      target: {
        hash: `sha256:${'b'.repeat(64)}`,
        byteLength: 6,
        scopes: [
          { scope: 'x', start: 0, end: 3, classification: 'local' },
          { scope: 'y', start: 3, end: 6, classification: 'local' },
        ],
      },
    } as unknown as UpdateTrace;
    expect(
      accept({
        priorTrace: threeScope,
        dirtyInputScopes: [],
        allowedTargetScopes: [],
        replacement: replacement({
          target: {
            hash: `sha256:${'d'.repeat(64)}`,
            byteLength: 6,
            scopes: [
              { scope: 'y', start: 0, end: 3, classification: 'local' },
              { scope: 'x', start: 3, end: 6, classification: 'local' },
            ],
          },
        }),
        priorTargetBytes: bytes('abcxyz'),
        candidateBytes: bytes('xyzabc'),
      }),
    ).toBe('protected-bytes-changed');
  });

  it('rejects a candidate that altered the input partition', () => {
    expect(
      accept({
        replacement: replacement({
          input: {
            hash: `sha256:${'c'.repeat(64)}`,
            byteLength: 9,
            scopes: [
              { scope: 'merged', start: 0, end: 9, classification: 'local' },
            ],
          },
        }),
      }),
    ).toBe('input-partition-altered');
  });

  it.each([
    { reason: 'no-replacement-trace', overrides: { replacement: undefined } },
    {
      reason: 'input-not-current',
      overrides: { currentInputHash: `sha256:${'e'.repeat(64)}` },
    },
    {
      reason: 'target-not-candidate',
      overrides: { candidateHash: `sha256:${'f'.repeat(64)}` },
    },
    {
      reason: 'scope-outside-closure',
      overrides: {
        replacement: replacement({
          dependencies: [
            { input: 'one', targets: ['x', 'y'] },
            { input: 'two', targets: ['y'] },
          ],
        }),
      },
    },
    {
      reason: 'unchanged-closure-altered',
      overrides: {
        replacement: replacement({
          dependencies: [
            { input: 'one', targets: ['x'] },
            { input: 'two', targets: ['x'] },
          ],
        }),
      },
    },
  ])('rejects a candidate for $reason', ({ reason, overrides }) => {
    expect(accept(overrides)).toBe(reason);
  });
});

describe('SLC-owned normalization contract (INCR-18, INCR-24)', () => {
  it('ships a valid update contract on the built-in normalizer', async () => {
    const definition = await readFile(
      new URL('../src/normalize.md', import.meta.url),
      'utf8',
    );
    expect(parseUpdateContract(definition)).toBe(true);
  });

  it('validates only structure, never scope meanings', () => {
    // Scope names are opaque: the planner maps by range and classification
    // and never interprets a normalized-step, GEARS-item, or FSM-state name.
    const opaque = {
      schema: 'sublang.slc.update.v1',
      input: {
        hash: `sha256:${'a'.repeat(64)}`,
        byteLength: 4,
        scopes: [
          {
            scope: 'fsm-state:Reviewing',
            start: 0,
            end: 4,
            classification: 'local',
          },
        ],
      },
      target: {
        hash: `sha256:${'b'.repeat(64)}`,
        byteLength: 4,
        scopes: [
          {
            scope: 'gears-item:SHALL-7',
            start: 0,
            end: 4,
            classification: 'local',
          },
        ],
      },
      dependencies: [
        { input: 'fsm-state:Reviewing', targets: ['gears-item:SHALL-7'] },
      ],
    } as unknown as UpdateTrace;

    const result = planScopedUpdate({
      step: { kind: 'phase', id: 'p:0' },
      recorded: {
        id: 'p:0',
        kind: 'phase',
        name: 'normalize',
        source: { format: 'text', ext: '.md' },
        target: {
          format: 'text',
          ext: '.md',
          path: 'x.md',
          product: 'semantic:0',
        },
        inputKey: `sha256:${'c'.repeat(64)}`,
        inputs: [],
        inputClosure: 'closed',
        origin: 'ordinary',
        trace: opaque,
      } as unknown as StepRecord,
      contract: true,
      identityDirty: false,
      currentClosure: 'closed',
      priorInput: bytes('aaaa'),
      currentInput: bytes('aZaa'),
    });

    expect(result.mode).toBe('update');
    if (result.mode !== 'update') return;
    expect(result.dirtyInputScopes).toEqual(['fsm-state:Reviewing']);
    expect(result.allowedTargetScopes).toEqual(['gears-item:SHALL-7']);
  });
});

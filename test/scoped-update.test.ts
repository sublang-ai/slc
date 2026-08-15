// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import type { StepRecord, UpdateTrace } from '../src/build-record.js';
import {
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

  it('selects ordinary execution rather than an unbounded allocation', () => {
    const huge = new Uint8Array(3000);
    const other = new Uint8Array(3000).fill(1);
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

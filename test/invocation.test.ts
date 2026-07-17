// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import { CliError, parseInvocation } from '../src/invocation.js';

describe('parseInvocation full pipeline (PIPE-9)', () => {
  it('routes a bare pipeline to a full run', () => {
    expect(parseInvocation(['playbook', 'flows/onboarding.md'])).toEqual({
      kind: 'full',
      pipeline: 'playbook',
      source: 'flows/onboarding.md',
      output: null,
      optimize: false,
      normalize: false,
    });
  });

  it('captures --normalize and -O on a full run (DR-013)', () => {
    expect(
      parseInvocation(['playbook', 'src.md', '--normalize', '-O']),
    ).toMatchObject({ kind: 'full', optimize: true, normalize: true });
    expect(parseInvocation(['playbook', 'src.md', '--optimize'])).toMatchObject(
      { kind: 'full', optimize: true, normalize: false },
    );
  });

  it('rejects --normalize and -O on a single-phase run (DR-013)', () => {
    expect(() =>
      parseInvocation(['playbook.text2gears', 'src.md', '-O']),
    ).toThrow(expect.objectContaining({ code: 'unexpected-flag' }));
    expect(() =>
      parseInvocation(['playbook.link', 'a.ts', 'r.ts', '--normalize']),
    ).toThrow(expect.objectContaining({ code: 'unexpected-flag' }));
  });

  it('captures -o, wherever it appears', () => {
    expect(
      parseInvocation(['-o', 'out.ts', 'playbook', 'src.md']),
    ).toMatchObject({
      kind: 'full',
      output: 'out.ts',
      source: 'src.md',
    });
  });
});

describe('parseInvocation single phase (PIPE-9)', () => {
  it('routes <pipeline>.<phase> to a single-phase run', () => {
    expect(parseInvocation(['playbook.text2gears', 'src.md'])).toEqual({
      kind: 'phase',
      pipeline: 'playbook',
      phase: 'text2gears',
      source: 'src.md',
      output: null,
    });
  });

  it('rejects --link on a single-phase run', () => {
    expect(() =>
      parseInvocation(['playbook.text2gears', 'src.md', '--link', 'r.ts']),
    ).toThrow(expect.objectContaining({ code: 'unexpected-link' }));
  });
});

describe('parseInvocation full-pipeline link (PIPE-13, PIPE-14)', () => {
  it('routes --link to a full-link run with options', () => {
    expect(
      parseInvocation([
        'playbook',
        'src.md',
        '--link',
        'runner.ts',
        '--link-option',
        'seed=42',
        '-o',
        'app.ts',
      ]),
    ).toEqual({
      kind: 'full-link',
      pipeline: 'playbook',
      source: 'src.md',
      linkTarget: 'runner.ts',
      output: 'app.ts',
      options: [{ name: 'seed', value: '42' }],
      optimize: false,
      normalize: false,
    });
  });

  it('rejects --link-option without a link phase', () => {
    expect(() =>
      parseInvocation(['playbook', 'src.md', '--link-option', 'seed=1']),
    ).toThrow(expect.objectContaining({ code: 'unexpected-link-option' }));
  });
});

describe('parseInvocation direct link (PIPE-12)', () => {
  it('treats the final operand as the target and earlier ones as ordered objects', () => {
    expect(
      parseInvocation([
        'playbook.link',
        'main.fsm.ts',
        'helper.fsm.ts',
        'runner.ts',
        '-o',
        'app.run.ts',
      ]),
    ).toEqual({
      kind: 'link',
      pipeline: 'playbook',
      objects: ['main.fsm.ts', 'helper.fsm.ts'],
      linkTarget: 'runner.ts',
      output: 'app.run.ts',
      options: [],
    });
  });

  it('assigns roles by position, not by extension', () => {
    const result = parseInvocation(['playbook.link', 'a.ts', 'b.ts', 'c.ts']);
    expect(result).toMatchObject({
      objects: ['a.ts', 'b.ts'],
      linkTarget: 'c.ts',
    });
  });

  it('accepts a single object plus a target', () => {
    expect(
      parseInvocation(['playbook.link', 'main.fsm.ts', 'runner.ts']),
    ).toMatchObject({
      objects: ['main.fsm.ts'],
      linkTarget: 'runner.ts',
    });
  });

  it('requires at least one object before the target', () => {
    expect(() => parseInvocation(['playbook.link', 'runner.ts'])).toThrow(
      expect.objectContaining({ code: 'operands' }),
    );
  });

  it('rejects --link combined with a .link invocation', () => {
    expect(() =>
      parseInvocation(['playbook.link', 'm.ts', 'r.ts', '--link', 'x.ts']),
    ).toThrow(expect.objectContaining({ code: 'unexpected-link' }));
  });
});

describe('parseInvocation errors', () => {
  it('rejects an empty argv', () => {
    expect(() => parseInvocation([])).toThrow(
      expect.objectContaining({ code: 'no-pipeline' }),
    );
  });

  it('rejects a trailing dot reference', () => {
    expect(() => parseInvocation(['playbook.', 'src.md'])).toThrow(
      expect.objectContaining({ code: 'no-pipeline' }),
    );
  });

  it('rejects extra source operands', () => {
    expect(() => parseInvocation(['playbook', 'a.md', 'b.md'])).toThrow(
      expect.objectContaining({ code: 'operands' }),
    );
  });

  it('rejects a missing option value', () => {
    expect(() => parseInvocation(['playbook', 'src.md', '-o'])).toThrow(
      expect.objectContaining({ code: 'option-value' }),
    );
  });

  it('rejects a malformed --link-option', () => {
    expect(() =>
      parseInvocation([
        'playbook',
        'src.md',
        '--link',
        'r.ts',
        '--link-option',
        'seed',
      ]),
    ).toThrow(expect.objectContaining({ code: 'invalid-link-option' }));
  });

  it('rejects an unknown option', () => {
    expect(() => parseInvocation(['playbook', 'src.md', '--nope'])).toThrow(
      CliError,
    );
  });

  it('rejects a repeated -o', () => {
    expect(() =>
      parseInvocation(['playbook', 'src.md', '-o', 'a', '-o', 'b']),
    ).toThrow(expect.objectContaining({ code: 'duplicate-option' }));
  });
});

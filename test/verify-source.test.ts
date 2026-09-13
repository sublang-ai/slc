// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { defaultComposePlayerPrompt } from '@sublang/playbook/xstate-runtime';

import {
  checkSourceGearsContract,
  parseGearsContract,
  sourcePromptFragments,
} from '../src/verify-source.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sdlc = join(
  repoRoot,
  'node_modules',
  '@sublang',
  'playbook',
  'reference',
  'sdlc',
);

const read = (path: string): string => readFileSync(path, 'utf8');

const maintained = (name: string): { source: string; gears: string } => ({
  source: read(join(sdlc, `${name}.md`)),
  gears: read(join(sdlc, `${name}.playbook`, `${name}.gears.md`)),
});

const authoredSource = (blocks: readonly (readonly string[])[]): string =>
  blocks
    .map((lines) => `\`\`\`markdown\n${lines.join('\n')}\n\`\`\``)
    .join('\n\n');

const gearsPrompt = (lines: readonly string[]): string =>
  `### FLOW-1\n\nCaptain shall prompt Worker:\n\n${lines.map((line) => `> ${line}`).join('\n')}\n`;

/** The gears line index carrying one resolved prompt line, from `from` on. */
const promptLineIndex = (
  lines: readonly string[],
  promptLine: string,
  from = 0,
): number => {
  for (let index = from; index < lines.length; index++) {
    const quote = /^>\s?(.*)$/.exec(lines[index]);
    if (quote !== null && quote[1].replace(/\\([<>])/g, '$1') === promptLine) {
      return index;
    }
  }
  return -1;
};

/** The gears line range `[start, end)` holding one fragment's prompt lines. */
const fragmentRange = (
  lines: readonly string[],
  fragment: readonly string[],
  from = 0,
): { start: number; end: number } => {
  for (let start = from; start < lines.length; start++) {
    if (promptLineIndex(lines, fragment[0], start) !== start) continue;
    const matched = fragment.every(
      (line, offset) =>
        promptLineIndex(lines, line, start + offset) === start + offset,
    );
    if (matched) return { start, end: start + fragment.length };
  }
  throw new Error(`fragment not found in the GEARS: ${fragment[0]}`);
};

describe('Source-fidelity conservation check (verification-25, verification-26)', () => {
  it.each(['code', 'review', 'decide', 'dev'])(
    'reports no finding for the maintained %s pair',
    (name) => {
      const { source, gears } = maintained(name);
      expect(checkSourceGearsContract(source, gears)).toEqual([]);
    },
  );

  it('reports no finding for a plain-prose Source that authors no fragment', () => {
    const source = read(join(repoRoot, 'demo', 'workflow.txt'));
    const gears = read(
      join(
        repoRoot,
        'demo',
        'reference',
        'workflow.playbook',
        'workflow.gears.md',
      ),
    );

    expect(sourcePromptFragments(source)).toEqual([]);
    expect(parseGearsContract(gears).length).toBeGreaterThan(0);
    expect(checkSourceGearsContract(source, gears)).toEqual([]);
  });

  it.each([
    ['prefix', ['Original request.', 'Round context.']],
    ['interior', ['Round context.', 'Original request.', 'Prior feedback.']],
    ['suffix', ['Round context.', 'Original request.']],
  ] as const)(
    'accepts a complete fragment with an incidental %s match, but rejects a separate swapped fragment',
    (_position, complete) => {
      const instruction = ['Review the complete request.'];
      const source = authoredSource([
        ['Original request.'],
        instruction,
        complete,
      ]);

      expect(
        checkSourceGearsContract(
          source,
          gearsPrompt([...instruction, ...complete]),
        ),
      ).toEqual([]);
      expect(
        checkSourceGearsContract(
          source,
          gearsPrompt([...complete, ...instruction]),
        ),
      ).toEqual(['FLOW-1: authored prompt fragments are out of Source order']);
    },
  );

  it('accepts identical Source fragments with a valid attribution and rejects an impossible repeated order', () => {
    const source = authoredSource([
      ['Read the original request.'],
      ['Review the changes.'],
      ['Read the original request.'],
    ]);
    const ordered = [
      'Read the original request.',
      'Review the changes.',
      'Read the original request.',
    ];

    expect(checkSourceGearsContract(source, gearsPrompt(ordered))).toEqual([]);
    expect(
      checkSourceGearsContract(
        source,
        gearsPrompt([...ordered, 'Review the changes.']),
      ),
    ).toEqual(['FLOW-1: authored prompt fragments are out of Source order']);
  });

  it('checks later repeated occurrences even when the first occurrences are in order', () => {
    const source = authoredSource([
      ['Read the original request.'],
      ['Review the changes.'],
      ['Read the original request.', 'Include the round context.'],
    ]);
    const ordered = [
      'Read the original request.',
      'Review the changes.',
      'Read the original request.',
      'Include the round context.',
    ];

    expect(checkSourceGearsContract(source, gearsPrompt(ordered))).toEqual([]);
    expect(
      checkSourceGearsContract(
        source,
        gearsPrompt([...ordered, 'Read the original request.']),
      ),
    ).toEqual(['FLOW-1: authored prompt fragments are out of Source order']);
  });

  it('does not order shared crossing lines but rejects a nonoverlapping swap of the same complete fragments', () => {
    const earlier = ['Shared context.', 'Conclude the review.'];
    const later = ['Begin the review.', 'Shared context.'];
    const source = authoredSource([earlier, later]);

    expect(
      checkSourceGearsContract(
        source,
        gearsPrompt([
          'Begin the review.',
          'Shared context.',
          'Conclude the review.',
        ]),
      ),
    ).toEqual([]);
    expect(
      checkSourceGearsContract(source, gearsPrompt([...later, ...earlier])),
    ).toEqual(['FLOW-1: authored prompt fragments are out of Source order']);
  });

  it('names an invented item whose prompt line the Source never authored', () => {
    const { source, gears } = maintained('code');
    const invented = `${gears}
### CODE-99

When a fabricated condition holds, Captain shall prompt Coder:

> Do whatever seems reasonable.
`;

    expect(checkSourceGearsContract(source, invented)).toEqual([
      'CODE-99: prompt line is not an authored fragment: "Do whatever seems reasonable."',
    ]);
  });

  it('names a dropped authored fragment by its Source line', () => {
    const { source, gears } = maintained('code');
    const fragment = sourcePromptFragments(source)[1];
    const lines = gears.split('\n');
    const range = fragmentRange(lines, fragment.lines);
    const dropped = [
      ...lines.slice(0, range.start),
      ...lines.slice(range.start + 1, range.end),
      ...lines.slice(range.end),
    ].join('\n');

    expect(checkSourceGearsContract(source, dropped)).toEqual([
      `source instruction fragment at line ${fragment.start + 1} was dropped or changed`,
    ]);
  });

  it('names an item whose authored fragments are out of Source order', () => {
    const { source, gears } = maintained('code');
    const fragments = sourcePromptFragments(source);
    const lines = gears.split('\n');
    // CODE-1 carries the first-phase instruction and the every-phase appendix,
    // in that order; swapping the two blocks keeps both contiguous.
    const instructions = fragments.filter(
      (fragment) => fragment.kind === 'instruction',
    );
    const first = fragmentRange(lines, instructions[0].lines);
    const second = fragmentRange(lines, instructions.at(-1)!.lines, first.end);
    expect(
      lines.slice(first.start, second.end).some((line) => /^###\s/.test(line)),
    ).toBe(false);
    const swapped = [
      ...lines.slice(0, first.start),
      ...lines.slice(second.start, second.end),
      ...lines.slice(first.end, second.start),
      ...lines.slice(first.start, first.end),
      ...lines.slice(second.end),
    ].join('\n');

    expect(checkSourceGearsContract(source, swapped)).toEqual([
      'CODE-1: authored prompt fragments are out of Source order',
    ]);
  });

  it('names a relayed field read without its literal quote marker', () => {
    const { source, gears } = maintained('code');
    const relay = sourcePromptFragments(source).find(
      (fragment) => fragment.kind === 'relay',
    );
    if (relay === undefined)
      throw new Error('the pair authors no relay fragment');
    const lines = gears.split('\n');
    const range = fragmentRange(lines, relay.lines);
    const itemHeading = lines
      .slice(0, range.start)
      .findLast((line) => /^###\s+/.test(line));
    if (itemHeading === undefined) throw new Error('the relay has no item');
    const itemId = itemHeading.replace(/^###\s+/, '');
    const unquoted = [
      ...lines.slice(0, range.start),
      lines[range.start].replace(/^>\s?>\s?/, '> '),
      ...lines.slice(range.start + 1),
    ].join('\n');

    expect(checkSourceGearsContract(source, unquoted)).toContain(
      `${itemId}: relayed player field callerInput lacks a literal quote marker`,
    );
  });

  it('explains the two GEARS quote layers for an additional token and delivers the exact quoted value', () => {
    const source =
      authoredSource([['Inspect the supplied evidence.']]) +
      '\n\nCaptain shall relay the evidence in quotes (`>`).\n';
    const unquoted = gearsPrompt([
      'Inspect the supplied evidence.',
      '<evidence>',
    ]);
    const quoted = gearsPrompt([
      'Inspect the supplied evidence.',
      '> <evidence>',
    ]);
    expect(checkSourceGearsContract(source, unquoted)).toEqual([
      'FLOW-1: additional placeholder line "<evidence>" lacks a literal quote marker in the prompt; use "> > <evidence>" in GEARS to retain "> <evidence>" as prompt content',
    ]);
    expect(checkSourceGearsContract(source, quoted)).toEqual([]);
    const [item] = parseGearsContract(quoted);
    const input = {
      stateId: 'inspect',
      role: 'worker',
      sourceItem: item.id,
      prompt: item.prompt.join('\n'),
      result: { done: 'Inspection is complete.' },
      evidence: 'Exact evidence $& <other-token>.',
    };
    expect(defaultComposePlayerPrompt(input)).toBe(
      'Inspect the supplied evidence.\n> Exact evidence $& <other-token>.',
    );
    expect(
      checkSourceGearsContract(
        source,
        gearsPrompt([
          'Inspect the supplied evidence.',
          '> Evidence: <evidence>',
        ]),
      ),
    ).toEqual([
      'FLOW-1: prompt line is not an authored fragment: "> Evidence: <evidence>"',
    ]);
  });

  it.each(['<run-results>', '<#>', '<$detail>', '<_value>', '\\<evidence\\>'])(
    'explains an additional standalone %s while preserving authored raw tokens and plain prose',
    (token) => {
      const source = authoredSource([['Inspect the supplied evidence.']]);
      const gears = gearsPrompt(['Inspect the supplied evidence.', token]);
      const normalized = token.replace(/\\([<>])/g, '$1');
      expect(checkSourceGearsContract(source, gears)).toEqual([
        `FLOW-1: additional placeholder line "${normalized}" lacks a literal quote marker in the prompt; use "> > ${normalized}" in GEARS to retain "> ${normalized}" as prompt content`,
      ]);
      expect(
        checkSourceGearsContract(
          authoredSource([['Inspect the supplied evidence.', token]]),
          gears,
        ),
      ).toEqual([]);
      expect(
        checkSourceGearsContract('Inspect the supplied evidence.', gears),
      ).toEqual([]);
    },
  );

  it('names a result that declares a non-identifier output property', () => {
    const { source, gears } = maintained('decide');
    const quotedKebab = gears.replace(
      '`latestCommit: <commit identity>`',
      '`decide-commit: <commit identity>`',
    );
    expect(quotedKebab).not.toBe(gears);

    expect(checkSourceGearsContract(source, quotedKebab)).toEqual([
      'DECIDE-3: result `committed` names the non-identifier output property "decide-commit"',
    ]);
  });

  it('names a field declared verbatim in one item and judge-authored in another', () => {
    const { source, gears } = maintained('code');
    const bullet = gears
      .split('\n')
      .find((line) => line.includes('`coderOutput: <verbatim final text>`'));
    if (bullet === undefined) {
      throw new Error('the pair declares no verbatim result field');
    }
    const mixed = gears.replace(
      bullet,
      bullet.replaceAll(
        '`coderOutput: <verbatim final text>`',
        '`coderOutput`',
      ),
    );

    expect(checkSourceGearsContract(source, mixed)).toEqual([
      'coderOutput: result field mixes verbatim and judge-authored ownership',
    ]);
  });
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
    const first = fragmentRange(lines, fragments[0].lines);
    const second = fragmentRange(lines, fragments[2].lines, first.end);
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
    const unquoted = [
      ...lines.slice(0, range.start),
      lines[range.start].replace(/^>\s?>\s?/, '> '),
      ...lines.slice(range.start + 1),
    ].join('\n');

    expect(checkSourceGearsContract(source, unquoted)).toContain(
      'CODE-2: relayed player field callerInput lacks a literal quote marker',
    );
  });

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

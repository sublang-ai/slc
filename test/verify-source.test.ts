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
  // A `\r` left on a split line defeats `/^>\s?(.*)$/` outright, which emptied
  // the fragment set and silently accepted an invented prompt (verification-25).
  it.each(['code', 'review', 'decide', 'dev', 'branch', 'pr'])(
    'reads the CRLF %s pair exactly as its LF form',
    (name) => {
      const { source, gears } = maintained(name);
      const crlf = (text: string) => text.replaceAll('\n', '\r\n');
      const invented = (text: string) =>
        text.replace(/^> .*$/mu, '> An invented prompt line.');
      expect(sourcePromptFragments(crlf(source))).toEqual(
        sourcePromptFragments(source),
      );
      expect(checkSourceGearsContract(crlf(source), crlf(gears))).toEqual(
        checkSourceGearsContract(source, gears),
      );
      expect(
        checkSourceGearsContract(crlf(source), crlf(invented(gears))),
      ).toEqual(checkSourceGearsContract(source, invented(gears)));
      expect(
        checkSourceGearsContract(crlf(source), crlf(invented(gears))),
      ).not.toEqual([]);
    },
  );

  it.each(['code', 'review', 'decide', 'dev', 'branch', 'pr'])(
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

  it('leaves an invented fragment-free item to semantic review', () => {
    const { source, gears } = maintained('code');
    const invented = `${gears}
### CODE-99

When a fabricated condition holds, Captain shall prompt Coder:

> Do whatever seems reasonable.
`;

    // Without interpreting Source prose, the checker cannot distinguish this
    // item from a legitimate narrative-derived item (DR-055).
    expect(checkSourceGearsContract(source, invented)).toEqual([]);
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
      'CODE-1: authored prompt fragments are out of Source order',
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

  // Playbook's prefix pass moves an item's standalone relay blocks after its
  // instructions and records nothing beside the rewritten prompts; the checker
  // reads that layout from the prompt itself, for any item (verification-25).
  describe('prefix-first items', () => {
    /** `gears` with a Playbook 15.1-era `## Prefixed prompts` section appended. */
    const legacySection = (
      gears: string,
      ...entries: readonly string[]
    ): string =>
      `${gears.replace(/\n+$/, '\n')}\n## Prefixed prompts\n\n${entries.join('\n')}\n`;

    /** The published CODE pair already carries prefix-first prompts. */
    const prefixedCode = (): { source: string; gears: string } => {
      const pair = maintained('code');
      const lines = pair.gears.split('\n');
      const relay = sourcePromptFragments(pair.source).find(
        (fragment) => fragment.kind === 'relay',
      );
      if (relay === undefined) throw new Error('the pair authors no relay');
      const block = fragmentRange(lines, relay.lines);
      // CODE-1's relay follows its instructions and ends the quoted prompt.
      expect(lines[block.start - 1]).toBe('>');
      expect(lines[block.end]).toBe('');
      return pair;
    };

    it('accepts a maintained item whose relays now trail its instructions, with no listing', () => {
      const { source, gears } = prefixedCode();
      expect(gears).not.toContain('## Prefixed prompts');
      expect(checkSourceGearsContract(source, gears)).toEqual([]);
      const crlf = (text: string): string => text.replaceAll('\n', '\r\n');
      expect(checkSourceGearsContract(crlf(source), crlf(gears))).toEqual([]);
    });

    it('ignores a legacy `## Prefixed prompts` section, whatever it lists', () => {
      const { source, gears } = maintained('code');
      // A no-op entry, a relay-first entry, an unknown item, and a malformed
      // entry, in two sections: none is read, so none is named.
      const legacy = legacySection(
        legacySection(
          gears,
          '- CODE-2: relays → tail',
          '- CODE-1: relays → tail',
          '- CODE-9: relays → tail',
          '- CODE-1 moved',
        ),
        '- CODE-3: relays → tail',
      );
      expect(checkSourceGearsContract(source, legacy)).toEqual([]);
      const prefixed = prefixedCode();
      expect(
        checkSourceGearsContract(
          prefixed.source,
          legacySection(prefixed.gears, '- CODE-1: relays → tail'),
        ),
      ).toEqual([]);
    });

    it('catches a dropped or duplicated relay in a prefix-first prompt', () => {
      const { source, gears } = prefixedCode();
      const relay = sourcePromptFragments(source).find(
        (fragment) => fragment.kind === 'relay',
      );
      if (relay === undefined) throw new Error('the pair authors no relay');
      const lines = gears.split('\n');
      const block = fragmentRange(lines, relay.lines);
      // The moved block trails CODE-1 behind the blank quoted line the pass left.
      expect(lines[block.start - 1]).toBe('>');
      const dropped = [
        ...lines.slice(0, block.start - 1),
        ...lines.slice(block.end),
      ].join('\n');
      expect(checkSourceGearsContract(source, dropped)).toEqual([
        `source relay fragment at line ${relay.start + 1} was dropped or changed`,
      ]);
      const duplicated = [
        ...lines.slice(0, block.end),
        '>',
        ...lines.slice(block.start, block.end),
        ...lines.slice(block.end),
      ].join('\n');
      expect(checkSourceGearsContract(source, duplicated)).toEqual([
        'CODE-1: authored prompt fragments are out of Source order',
      ]);
    });

    it('accepts a blank-separated quoted block moved out of a fenced instruction and keeps an adjacent one', () => {
      const source = [
        'Captain shall give Coder the following instruction:',
        '',
        '```markdown',
        '> Request: <caller-input>',
        '',
        'Read the request and act on it.',
        'Quote it back like this:',
        '> Request: <caller-input>',
        '```',
        '',
      ].join('\n');
      const prefixed = gearsPrompt([
        'Read the request and act on it.',
        'Quote it back like this:',
        '> Request: <caller-input>',
        '',
        '> Request: <caller-input>',
      ]);
      expect(checkSourceGearsContract(source, prefixed)).toEqual([]);
      // The adjacent quoted line moved up splits the fragment, which no
      // layout carries whole.
      const stillEmbedded = gearsPrompt([
        'Read the request and act on it.',
        '> Request: <caller-input>',
        'Quote it back like this:',
        '',
        '> Request: <caller-input>',
      ]);
      expect(checkSourceGearsContract(source, stillEmbedded)).toEqual([
        'source instruction fragment at line 3 was dropped or changed',
      ]);
    });

    // Whole fragments tile an item's prompt prefix-first in Source order, each
    // unit occurrence used once and each authored text conserved by count, so
    // the checker agrees with Playbook's over every layout the pass can produce.
    describe('tilings', () => {
      const FLOW_HEAD = ['# Flow', '', 'Roles:', '', '- Coder', ''];
      const quote = (line: string): string => (line === '' ? '>' : `> ${line}`);
      const item = (id: number, prompt: readonly string[]): string[] => [
        `### FLOW-${id}`,
        '',
        `When step ${id} starts, Captain shall prompt Coder:`,
        '',
        ...prompt.map(quote),
        '',
        'Results:',
        '- `done`: Coder finished.',
        '',
      ];
      /** A Source of fenced instructions and its faithful raw GEARS, one item each. */
      const flow = (
        instructions: readonly (readonly string[])[],
      ): { source: string; gears: string } => ({
        source: [
          ...FLOW_HEAD,
          ...instructions.flatMap((lines, index) => [
            `When step ${index + 1} starts, Captain shall give Coder the following instruction:`,
            '',
            '```markdown',
            ...lines,
            '```',
            '',
          ]),
        ].join('\n'),
        gears: [
          ...FLOW_HEAD,
          ...instructions.flatMap((lines, index) => item(index + 1, lines)),
        ].join('\n'),
      });
      /** A faithful raw GEARS of one Flow item with the given prompt lines. */
      const oneItem = (prompt: readonly string[]): string =>
        [...FLOW_HEAD, ...item(1, prompt)].join('\n');
      /** `gears` with each named item's prompt rewritten, recording nothing else. */
      const prefixed = (
        gears: string,
        rewrites: Readonly<Record<string, readonly string[]>>,
      ): string => {
        const lines = gears.split('\n');
        for (const [id, prompt] of Object.entries(rewrites)) {
          const heading = lines.indexOf(`### ${id}`);
          if (heading === -1) throw new Error(`no item ${id}`);
          let start = heading + 1;
          while (!/^>/.test(lines[start])) start++;
          let end = start;
          while (/^>/.test(lines[end])) end++;
          lines.splice(start, end - start, ...prompt.map(quote));
        }
        return lines.join('\n');
      };
      const REQUEST = '> Request: <caller-input>';
      const CONTEXT = '> Context: <context>';

      it('owns units by fragment and counts each occurrence', () => {
        const shared = flow([
          [REQUEST, '', 'Implement the request.', '', 'Report every result.'],
          [REQUEST, '', 'Test the change.', '', 'Report every result.'],
          [
            REQUEST,
            '',
            'Run the tests.',
            '',
            'Fix every failure.',
            '',
            'Run the tests.',
          ],
        ]);
        expect(
          checkSourceGearsContract(
            shared.source,
            prefixed(shared.gears, {
              'FLOW-1': [
                'Implement the request.',
                '',
                'Report every result.',
                '',
                REQUEST,
              ],
              'FLOW-2': [
                'Test the change.',
                '',
                'Report every result.',
                '',
                REQUEST,
              ],
              'FLOW-3': [
                'Run the tests.',
                '',
                'Fix every failure.',
                '',
                'Run the tests.',
                '',
                REQUEST,
              ],
            }),
          ),
        ).toEqual([]);

        const repeated = flow([
          [
            REQUEST,
            '',
            'Implement the request.',
            '',
            REQUEST,
            '',
            'Report every result.',
          ],
        ]);
        const both = prefixed(repeated.gears, {
          'FLOW-1': [
            'Implement the request.',
            '',
            'Report every result.',
            '',
            REQUEST,
            '',
            REQUEST,
          ],
        });
        expect(checkSourceGearsContract(repeated.source, both)).toEqual([]);
        expect(
          checkSourceGearsContract(
            repeated.source,
            both.replace('> > Request: <caller-input>\n>\n', ''),
          ),
        ).toEqual([
          'source instruction fragment at line 9 was dropped or changed',
        ]);

        // FLOW-2 already trails its relay, so the pass left it alone; FLOW-1's
        // moved relay and FLOW-2's own each stand for their own fragment.
        const masked = flow([
          [REQUEST, '', 'Implement the request.'],
          ['Test the change.', '', REQUEST],
        ]);
        expect(
          checkSourceGearsContract(
            masked.source,
            prefixed(masked.gears, {
              'FLOW-1': ['Implement the request.', '', REQUEST],
            }),
          ),
        ).toEqual([]);
      });

      it('still rejects a relay moved before an instruction', () => {
        // A separate quoted relay the Source authors after the instruction.
        const source = [
          ...FLOW_HEAD,
          'When step 1 starts, Captain shall give Coder this instruction:',
          '',
          '```markdown',
          'Do X.',
          '```',
          '',
          'and then relay the request in quotes (`>`):',
          '',
          '> Request: <caller-input>',
          '',
        ].join('\n');
        const gears = oneItem(['Do X.', '', REQUEST]);
        expect(checkSourceGearsContract(source, gears)).toEqual([]);
        const relayFirst = prefixed(gears, {
          'FLOW-1': [REQUEST, '', 'Do X.'],
        });
        expect(checkSourceGearsContract(source, relayFirst)).toEqual([
          'FLOW-1: authored prompt fragments are out of Source order',
        ]);
        // A legacy listing no longer vouches for any layout.
        expect(
          checkSourceGearsContract(
            source,
            legacySection(relayFirst, '- FLOW-1: relays → tail'),
          ),
        ).toEqual([
          'FLOW-1: authored prompt fragments are out of Source order',
        ]);

        // A quoted block the Source authors after a fenced instruction's text.
        const fenced = flow([['Do X.', '', REQUEST]]);
        expect(checkSourceGearsContract(fenced.source, fenced.gears)).toEqual(
          [],
        );
        expect(
          checkSourceGearsContract(
            fenced.source,
            prefixed(fenced.gears, { 'FLOW-1': [REQUEST, '', 'Do X.'] }),
          ),
        ).toEqual([
          'source instruction fragment at line 9 was dropped or changed',
        ]);
      });

      it('rejects a relay block kept before the last instruction while another trails', () => {
        const source = [
          ...FLOW_HEAD,
          'When step 1 starts, Captain shall relay the request in quotes (`>`):',
          '',
          '> Request: <caller-input>',
          '',
          'and then give Coder this instruction:',
          '',
          '```markdown',
          'Do X.',
          '```',
          '',
          'then relay the context in quotes (`>`):',
          '',
          '> Context: <context>',
          '',
          'and give Coder this one:',
          '',
          '```markdown',
          'Do Y.',
          '```',
          '',
        ].join('\n');
        const gears = oneItem([REQUEST, '', 'Do X.', '', CONTEXT, '', 'Do Y.']);
        expect(checkSourceGearsContract(source, gears)).toEqual([]);
        // The pass moves both standalone relay blocks after the last instruction.
        expect(
          checkSourceGearsContract(
            source,
            prefixed(gears, {
              'FLOW-1': ['Do X.', '', 'Do Y.', '', REQUEST, '', CONTEXT],
            }),
          ),
        ).toEqual([]);
        // Fragments in Source order would tile a prompt that trails only the
        // request and keeps the context in place, but a standalone relay block
        // before an instruction line is not the pass's layout.
        expect(
          checkSourceGearsContract(
            source,
            prefixed(gears, {
              'FLOW-1': ['Do X.', '', CONTEXT, '', 'Do Y.', '', REQUEST],
            }),
          ),
        ).toEqual([
          'FLOW-1: authored prompt fragments are out of Source order',
        ]);
      });

      it('holds a script item to Source order', () => {
        // Shell text the pass never moves: its `>`-leading line truncates the
        // report the next line appends to, so the order is the behavior.
        const source = [
          ...FLOW_HEAD,
          'When step 1 starts, Captain shall run exactly the following commands:',
          '',
          '> > report.txt',
          '>',
          '> make report >> report.txt',
          '',
        ].join('\n');
        const commands = ['> report.txt', '', 'make report >> report.txt'];
        const reordered = ['make report >> report.txt', '', '> report.txt'];
        const script = (prompt: readonly string[]): string =>
          oneItem(prompt).replace(
            'Captain shall prompt Coder:',
            'Captain shall run:',
          );
        expect(parseGearsContract(script(commands))[0].script).toBe(true);
        expect(checkSourceGearsContract(source, script(commands))).toEqual([]);
        expect(checkSourceGearsContract(source, script(reordered))).toEqual([
          'source prompt fragment at line 9 was dropped or changed',
        ]);
        // The same layout in a prompted item is a prefix-first prompt.
        expect(checkSourceGearsContract(source, oneItem(reordered))).toEqual(
          [],
        );
      });

      it("holds an instruction's interior blank lines exact and accepts the pass's one where a block stood", () => {
        const template = flow([
          [
            REQUEST,
            '',
            'Create `notes.txt` with exactly this content:',
            '',
            '~~~text',
            'first',
            '',
            '',
            'second',
            '~~~',
          ],
        ]);
        const text = prefixed(template.gears, {
          'FLOW-1': [
            'Create `notes.txt` with exactly this content:',
            '',
            '~~~text',
            'first',
            '',
            '',
            'second',
            '~~~',
            '',
            REQUEST,
          ],
        });
        expect(checkSourceGearsContract(template.source, text)).toEqual([]);
        for (const blanks of [0, 1, 3]) {
          const changed = text.replace(
            '> first\n>\n>\n> second',
            `> first\n${'>\n'.repeat(blanks)}> second`,
          );
          expect(changed).not.toBe(text);
          expect(checkSourceGearsContract(template.source, changed)).toContain(
            'source instruction fragment at line 9 was dropped or changed',
          );
        }

        const bounded = flow([['Do X.', '', '', REQUEST, '', 'Do Y.']]);
        expect(
          checkSourceGearsContract(
            bounded.source,
            prefixed(bounded.gears, {
              'FLOW-1': ['Do X.', '', 'Do Y.', '', REQUEST],
            }),
          ),
        ).toEqual([]);
      });

      it('accepts a boundary of more than one blank line that the Source put between fragments', () => {
        const source = [
          ...FLOW_HEAD,
          'When step 1 starts, Captain shall relay the request in quotes (`>`) and give Coder these instructions:',
          '',
          '> Request: <caller-input>',
          '',
          '```markdown',
          'Implement the request.',
          '```',
          '',
          'Two blank lines then separate the second instruction from the first:',
          '',
          '```markdown',
          'Report every result.',
          '```',
          '',
        ].join('\n');
        const gears = oneItem([
          REQUEST,
          '',
          'Implement the request.',
          '',
          '',
          'Report every result.',
        ]);
        expect(checkSourceGearsContract(source, gears)).toEqual([]);
        expect(
          checkSourceGearsContract(
            source,
            prefixed(gears, {
              'FLOW-1': [
                'Implement the request.',
                '',
                '',
                'Report every result.',
                '',
                REQUEST,
              ],
            }),
          ),
        ).toEqual([]);
      });

      it('carries a mirrored fragment through the tiling of an identical prompt', () => {
        // Two items whose fragments mirror each other rewrite to identical prompts.
        // Only a tiling carries FLOW-2's split fragment; carrying the contiguous
        // text in both items would report that fragment dropped.
        const mirrored = flow([
          ['Implement the request.', '', REQUEST],
          [REQUEST, '', 'Implement the request.'],
        ]);
        expect(
          checkSourceGearsContract(
            mirrored.source,
            prefixed(mirrored.gears, {
              'FLOW-2': ['Implement the request.', '', REQUEST],
            }),
          ),
        ).toEqual([]);
      });

      it('accepts moved bare relays authored through prose, alone and adjacent', () => {
        const source = [
          ...FLOW_HEAD,
          'When step 1 starts, Captain shall relay the caller input and the run results in quotes (`>`) before giving Coder this instruction:',
          '',
          '```markdown',
          'Do X.',
          '```',
          '',
        ].join('\n');
        for (const bare of [
          ['> <caller-input>'],
          ['> <caller-input>', '> <run-results>'],
        ]) {
          const gears = oneItem([...bare, '', 'Do X.']);
          expect(checkSourceGearsContract(source, gears)).toEqual([]);
          expect(
            checkSourceGearsContract(
              source,
              prefixed(gears, { 'FLOW-1': ['Do X.', '', ...bare] }),
            ),
          ).toEqual([]);
        }
      });

      it('accepts the boundaries the Source authored between fragments, including none', () => {
        const cases = [
          {
            // Two instruction fragments joined without a blank line.
            source: [
              ...FLOW_HEAD,
              'When step 1 starts, Captain shall relay the request in quotes (`>`) and give Coder these instructions, the second directly after the first:',
              '',
              '> Request: <caller-input>',
              '',
              '```markdown',
              'Do X.',
              '```',
              '',
              '```markdown',
              'Do Y.',
              '```',
              '',
            ],
            gears: oneItem([REQUEST, '', 'Do X.', 'Do Y.']),
            rewritten: ['Do X.', 'Do Y.', '', REQUEST],
          },
          {
            // Two relay fragments joined without a blank line.
            source: [
              ...FLOW_HEAD,
              'When step 1 starts, Captain shall relay the request in quotes (`>`):',
              '',
              '> Request: <caller-input>',
              '',
              'and, directly below it, the summary in quotes (`>`):',
              '',
              '> Summary: <summary>',
              '',
              'Then Captain shall give Coder this instruction:',
              '',
              '```markdown',
              'Do X.',
              '```',
              '',
            ],
            gears: oneItem([REQUEST, '> Summary: <summary>', '', 'Do X.']),
            rewritten: ['Do X.', '', REQUEST, '> Summary: <summary>'],
          },
          {
            // A relay fragment joined directly to an instruction stays beside it.
            source: [
              ...FLOW_HEAD,
              'When step 1 starts, Captain shall relay the summary in quotes (`>`):',
              '',
              '> Summary: <summary>',
              '',
              'and the request in quotes (`>`) directly followed by this instruction:',
              '',
              '> Request: <caller-input>',
              '',
              '```markdown',
              'Do X.',
              '```',
              '',
            ],
            gears: oneItem(['> Summary: <summary>', '', REQUEST, 'Do X.']),
            rewritten: [REQUEST, 'Do X.', '', '> Summary: <summary>'],
          },
        ];
        for (const { source: lines, gears, rewritten } of cases) {
          const source = lines.join('\n');
          expect(checkSourceGearsContract(source, gears)).toEqual([]);
          expect(
            checkSourceGearsContract(
              source,
              prefixed(gears, { 'FLOW-1': rewritten }),
            ),
          ).toEqual([]);
        }
      });

      it('keeps the authored boundary after and before a relay that stays in place', () => {
        // The second relay follows `Prepare.` directly, so it stays, and the
        // two blank lines Source authored after it survive with it.
        const after = {
          source: [
            ...FLOW_HEAD,
            'When step 1 starts, Captain shall give Coder these instructions, the second directly after the first:',
            '',
            '```markdown',
            '> First: <first>',
            '',
            'Prepare.',
            '```',
            '',
            '```markdown',
            '> Second: <second>',
            '',
            '',
            'Execute.',
            '```',
            '',
          ].join('\n'),
          gears: oneItem([
            '> First: <first>',
            '',
            'Prepare.',
            '> Second: <second>',
            '',
            '',
            'Execute.',
          ]),
          rewritten: [
            'Prepare.',
            '> Second: <second>',
            '',
            '',
            'Execute.',
            '',
            '> First: <first>',
          ],
          kept: '> > Second: <second>\n>\n>\n> Execute.',
          changed: (blanks: number) =>
            `> > Second: <second>\n${'>\n'.repeat(blanks)}> Execute.`,
          // Both: the change defeats the one tiling, which also carried the
          // first fragment's moved relay.
          uncarried: [9, 15],
        };
        // The first fragment ends with a relay two blank lines after its
        // instruction; the second fragment's instruction follows it directly,
        // so the relay stays and the two blank lines before it survive.
        const before = {
          source: [
            ...FLOW_HEAD,
            'When step 1 starts, Captain shall give Coder these instructions, the second directly after the first:',
            '',
            '```markdown',
            '> Zero: <zero>',
            '',
            'Prepare.',
            '',
            '',
            '> First: <first>',
            '```',
            '',
            '```markdown',
            'Execute.',
            '```',
            '',
          ].join('\n'),
          gears: oneItem([
            '> Zero: <zero>',
            '',
            'Prepare.',
            '',
            '',
            '> First: <first>',
            'Execute.',
          ]),
          rewritten: [
            'Prepare.',
            '',
            '',
            '> First: <first>',
            'Execute.',
            '',
            '> Zero: <zero>',
          ],
          kept: '> Prepare.\n>\n>\n> > First: <first>',
          changed: (blanks: number) =>
            `> Prepare.\n${'>\n'.repeat(blanks)}> > First: <first>`,
          // The first fragment changed; the second is still carried whole.
          uncarried: [9],
        };
        for (const { source, gears, rewritten, kept, changed, uncarried } of [
          after,
          before,
        ]) {
          expect(checkSourceGearsContract(source, gears)).toEqual([]);
          const text = prefixed(gears, { 'FLOW-1': rewritten });
          expect(checkSourceGearsContract(source, text)).toEqual([]);
          // The authored count is exact: one or three blank lines is a change
          // that no layout carries, so the fragment it splits is not conserved.
          for (const blanks of [1, 3]) {
            const mutated = text.replace(kept, changed(blanks));
            expect(mutated).not.toBe(text);
            expect(checkSourceGearsContract(source, mutated)).toEqual(
              uncarried.map(
                (line) =>
                  `source instruction fragment at line ${line} was dropped or changed`,
              ),
            );
          }
        }
      });

      it('conserves identical fragments across many items without a search bound', () => {
        const same = [CONTEXT, '', 'Act.'];
        const moved = ['Act.', '', CONTEXT];
        const seven = flow(Array.from({ length: 7 }, () => same));
        const sevenRewritten = prefixed(
          seven.gears,
          Object.fromEntries(
            Array.from({ length: 7 }, (_unused, index) => [
              `FLOW-${index + 1}`,
              moved,
            ]),
          ),
        );
        expect(checkSourceGearsContract(seven.source, sevenRewritten)).toEqual(
          [],
        );
        // Deleting one of the seven leaves six occurrences for seven fragments.
        const seventh = sevenRewritten.slice(
          sevenRewritten.indexOf('### FLOW-7'),
        );
        const dropped = checkSourceGearsContract(
          seven.source,
          sevenRewritten.replace(seventh, ''),
        );
        expect(dropped).toHaveLength(1);
        expect(dropped[0]).toMatch(
          /^source instruction fragment at line \d+ was dropped or changed$/,
        );

        const many = flow(Array.from({ length: 65 }, () => same));
        expect(
          checkSourceGearsContract(
            many.source,
            prefixed(many.gears, { 'FLOW-65': moved }),
          ),
        ).toEqual([]);
      });

      it('reports a fragment that only a tiling already spent could cover', () => {
        // Mirrored items rewrite to the same prompt: deleting one item leaves
        // one prompt, which can stand for one of the two authored fragments only.
        const mirrored = flow([
          ['Act.', '', CONTEXT],
          [CONTEXT, '', 'Act.'],
        ]);
        const rewritten = prefixed(mirrored.gears, {
          'FLOW-2': ['Act.', '', CONTEXT],
        });
        expect(checkSourceGearsContract(mirrored.source, rewritten)).toEqual(
          [],
        );
        const firstItem = rewritten.slice(
          rewritten.indexOf('### FLOW-1'),
          rewritten.indexOf('### FLOW-2'),
        );
        expect(
          checkSourceGearsContract(
            mirrored.source,
            rewritten.replace(firstItem, ''),
          ),
        ).toEqual([
          'source instruction fragment at line 17 was dropped or changed',
        ]);
        // One prompt composed of both fragments loses one of them the same way.
        const source = [
          ...FLOW_HEAD,
          'When step 1 starts, Captain shall give Coder these two instructions:',
          '',
          '```markdown',
          'Act.',
          '',
          CONTEXT,
          '```',
          '',
          '```markdown',
          CONTEXT,
          '',
          'Act.',
          '```',
          '',
        ].join('\n');
        const gears = oneItem(['Act.', '', CONTEXT, '', CONTEXT, '', 'Act.']);
        expect(checkSourceGearsContract(source, gears)).toEqual([]);
        const both = prefixed(gears, {
          'FLOW-1': ['Act.', '', 'Act.', '', CONTEXT, '', CONTEXT],
        });
        expect(checkSourceGearsContract(source, both)).toEqual([]);
        expect(
          checkSourceGearsContract(
            source,
            prefixed(gears, { 'FLOW-1': ['Act.', '', CONTEXT] }),
          ),
        ).toEqual([
          'source instruction fragment at line 15 was dropped or changed',
        ]);
      });
    });
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

  it('keeps a relayed value the Source authored inside a command line in its own form', () => {
    // pr.md relays the pull request in quotes to `code` and then compares it
    // as a single-quoted shell word inside two commands it authors verbatim.
    const source = [
      'When the checks fail, Captain shall call playbook `code` with the pull request in quotes (`>`):',
      '',
      '> Pull request: \\<pull-request-url\\>',
      '',
      '`pr` makes no more than one fix attempt.',
      'Only after `code` succeeds does `pr` publish the fix.',
      'The checkout can change while the nested `code` call suspends.',
      'The command therefore compares the pull request as data.',
      '',
      'When `code` succeeds, Captain shall publish the fix by running exactly the following command:',
      '',
      `> [ "$(gh pr view --json url --jq .url)" = '<pull-request-url>' ] || exit 1`,
      '> git push',
      '',
    ].join('\n');
    const command = [
      `> [ "$(gh pr view --json url --jq .url)" = '<pull-request-url>' ] || exit 1`,
      '> git push',
    ].join('\n');
    const results = [
      'Results:',
      '- `published`: The command exited with status zero.',
      '- `notPublished`: The command exited with a nonzero status.',
    ].join('\n');
    const gears = (acting: string, lines: string) =>
      `### PR-3\n\nWhen the checks fail, Captain shall call playbook \`code\`:\n\n> > Pull request: <pull-request-url>\n\n### PR-4\n\n${acting}\n\n${lines}\n\n${results}\n`;

    // Before the optimize pass the item is Captain's own work; after it, a
    // script. Both carry the Source's line, so neither owes a quote marker.
    expect(
      checkSourceGearsContract(
        source,
        gears(
          'When `code` succeeds, Captain shall publish the fix by running exactly the following command:',
          command,
        ),
      ),
    ).toEqual([]);
    expect(
      checkSourceGearsContract(
        source,
        gears('When `code` succeeds, Captain shall run:', command),
      ),
    ).toEqual([]);

    // A line the compiler composed still owes the marker.
    expect(
      checkSourceGearsContract(
        source,
        gears(
          'When `code` succeeds, Captain shall prompt Coder:',
          `> Publish the fix to <pull-request-url>.\n${command}`,
        ),
      ),
    ).toEqual([
      'PR-4: prompt line is not an authored fragment: "Publish the fix to <pull-request-url>."',
      'PR-4: relayed player field pullRequestUrl lacks a literal quote marker',
    ]);

    const fragmentFree = `${gears('When `code` succeeds, Captain shall run:', command)}\n### PR-99\n\nWhen publication finishes, Captain shall prompt Coder:\n\n> Report the result for <pull-request-url>.\n`;
    expect(checkSourceGearsContract(source, fragmentFree)).toEqual([
      'PR-99: relayed player field pullRequestUrl lacks a literal quote marker',
    ]);
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
      const fragmentFree = `${gearsPrompt(['Inspect the supplied evidence.'])}\n### FLOW-2\n\nWhen inspection finishes, Captain shall act:\n\n> Summarize the outcome.\n> ${token}\n`;
      expect(checkSourceGearsContract(source, fragmentFree)).toEqual([
        `FLOW-2: additional placeholder line "${normalized}" lacks a literal quote marker in the prompt; use "> > ${normalized}" in GEARS to retain "> ${normalized}" as prompt content`,
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

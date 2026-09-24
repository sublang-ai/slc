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
  it.each(['code', 'review', 'decide', 'dev'])(
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

  // Playbook's prefix pass moves an item's standalone relay blocks after its
  // instructions and lists the item under `## Prefixed prompts`; the checker
  // accepts exactly that layout for a listed item (verification-25).
  describe('prefixed items', () => {
    const SECTION = '## Prefixed prompts';
    const listed = (gears: string, ...ids: readonly string[]): string =>
      `${gears.replace(/\n+$/, '\n')}\n${SECTION}\n\n${ids.map((id) => `- ${id}: relays → tail`).join('\n')}\n`;

    /** The maintained code pair with CODE-1's leading relay block moved to its tail. */
    const prefixedCode = (): { source: string; gears: string } => {
      const { source, gears } = maintained('code');
      const lines = gears.split('\n');
      const relay = sourcePromptFragments(source).find(
        (fragment) => fragment.kind === 'relay',
      );
      if (relay === undefined) throw new Error('the pair authors no relay');
      const block = fragmentRange(lines, relay.lines);
      // CODE-1: relay block, blank quoted line, then the instruction lines.
      expect(lines[block.end]).toBe('>');
      let end = block.end + 1;
      while (/^>/.test(lines[end])) end++;
      const moved = [
        ...lines.slice(0, block.start),
        ...lines.slice(block.end + 1, end),
        '>',
        ...lines.slice(block.start, block.end),
        ...lines.slice(end),
      ].join('\n');
      return { source, gears: listed(moved, 'CODE-1') };
    };

    it('accepts a listed maintained item whose relays now trail its instructions', () => {
      const { source, gears } = prefixedCode();
      expect(checkSourceGearsContract(source, gears)).toEqual([]);
      const crlf = (text: string): string => text.replaceAll('\n', '\r\n');
      expect(checkSourceGearsContract(crlf(source), crlf(gears))).toEqual([]);
    });

    it('holds the same layout to Source order when the item is not listed', () => {
      const { source, gears } = prefixedCode();
      const unlisted = gears.slice(0, gears.indexOf(`\n${SECTION}`) + 1);
      expect(checkSourceGearsContract(source, unlisted)).toEqual([
        'CODE-1: authored prompt fragments are out of Source order',
      ]);
    });

    it('names a listing that is a no-op, absent, malformed, or still relay-first', () => {
      const { source, gears } = maintained('code');
      expect(checkSourceGearsContract(source, listed(gears, 'CODE-2'))).toEqual(
        ['CODE-2: listed as prefixed but its prompt is in Source order'],
      );
      expect(
        checkSourceGearsContract(
          source,
          `${listed(gears, 'CODE-9')}- CODE-1 moved\n`,
        ),
      ).toEqual([
        'Prefixed prompts: malformed entry: "- CODE-1 moved"',
        'Prefixed prompts: CODE-9 is not an item',
      ]);
      expect(checkSourceGearsContract(source, listed(gears, 'CODE-1'))).toEqual(
        ['CODE-1: listed as prefixed but a relay precedes an instruction'],
      );
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
      expect(
        checkSourceGearsContract(source, listed(prefixed, 'FLOW-1')),
      ).toEqual([]);
      expect(checkSourceGearsContract(source, prefixed)).toEqual([
        'source instruction fragment at line 3 was dropped or changed',
      ]);
      const stillEmbedded = gearsPrompt([
        'Read the request and act on it.',
        '> Request: <caller-input>',
        'Quote it back like this:',
        '',
        '> Request: <caller-input>',
      ]);
      expect(
        checkSourceGearsContract(source, listed(stillEmbedded, 'FLOW-1')),
      ).toEqual([
        'source instruction fragment at line 3 was dropped or changed',
        'FLOW-1: authored prompt fragments are out of Source order',
      ]);
    });

    it('names a second provenance section by its line', () => {
      const { source, gears } = prefixedCode();
      const twice = `${gears}\n${SECTION}\n\n- CODE-2: relays → tail\n`;
      expect(checkSourceGearsContract(source, twice)).toEqual([
        `Prefixed prompts: duplicate section at line ${twice.split('\n').lastIndexOf(SECTION) + 1}`,
        'CODE-2: listed as prefixed but its prompt is in Source order',
      ]);
    });

    // Whole fragments tile a listed item's prompt in Source order, each unit
    // occurrence used once and each authored text conserved by count, so the
    // checker agrees with Playbook's over every layout the pass can produce.
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
      /** `gears` with each named item's prompt rewritten and the items listed. */
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
        return listed(lines.join('\n'), ...Object.keys(rewrites));
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
          'FLOW-1: authored prompt fragments are out of Source order',
        ]);

        const masked = flow([
          [REQUEST, '', 'Implement the request.'],
          ['Test the change.', '', REQUEST],
        ]);
        expect(
          checkSourceGearsContract(
            masked.source,
            `${prefixed(masked.gears, { 'FLOW-1': ['Implement the request.', '', REQUEST] })}- FLOW-2: relays → tail\n`,
          ),
        ).toEqual([
          'FLOW-2: listed as prefixed but its prompt is in Source order',
        ]);
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

      it('keeps the alternative assignment that shows the rewrite', () => {
        // Two items whose fragments mirror each other rewrite to identical prompts.
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
        };
        for (const { source, gears, rewritten, kept, changed } of [
          after,
          before,
        ]) {
          expect(checkSourceGearsContract(source, gears)).toEqual([]);
          const text = prefixed(gears, { 'FLOW-1': rewritten });
          expect(checkSourceGearsContract(source, text)).toEqual([]);
          // The authored count is exact: one or three blank lines is a change.
          for (const blanks of [1, 3]) {
            const mutated = text.replace(kept, changed(blanks));
            expect(mutated).not.toBe(text);
            expect(checkSourceGearsContract(source, mutated)).toContain(
              'FLOW-1: authored prompt fragments are out of Source order',
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
          sevenRewritten.indexOf(SECTION),
        );
        const dropped = checkSourceGearsContract(
          seven.source,
          sevenRewritten
            .replace(seventh, '')
            .replace('- FLOW-7: relays → tail\n', ''),
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

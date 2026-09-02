// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import {
  checkCompiledExecutionFidelity,
  parseCompiledExecutionContract,
  unescapeMarkdown,
} from '../src/compiled-execution.js';

// A definition carrying the DR-047 closing section: one direct-Captain acting
// blockquote relaying the definition through `<definition>`, then the
// Results contract the compiled phase reports.
const definitionWithSection = `# Phase

## Rules

Some normative rules that are relayed, not transcribed.

> A rules blockquote that is not the compiled-execution prompt.

## Compiled execution

When a transformation request names the Source and Target, Captain shall transform the Source into the Target:

> Read <source> and write <target> following this definition:
>
> <definition>

Results:

- \`compiled\`: Captain wrote the Target.
- \`rejected\`: Captain reported the Source as unrepresentable.

Trailing note that is not part of the contract.
`;

const preservingGears = `# Phase

## Behaviors

### PHASE-1

When a transformation request names the Source and Target, Captain shall transform the Source into the Target:

> Read <source> and write <target> following this definition:
>
> <definition>

Results:

- \`compiled\`: Captain wrote the Target.
- \`rejected\`: Captain reported the Source as unrepresentable.
`;

// The exact closing section the shipped definitions carry (Playbook DR-047):
// an explanatory paragraph, one Where/when direct-Captain item, a five-line
// blockquote whose relay delimiters frame a Source-escaped placeholder, and a
// Results label immediately followed by its two bullets, before References.
const shippedSection = `## Compiled execution

This section governs compiled execution of this phase; the rules above remain the transformation's normative content for both execution paths.

Where the phase host supplies \`<definition>\` as the exact bytes of the definition file the request names, when a transformation request names a \`text\` Source (\`.md\`) and a \`gears\` Target (\`.md\`), Captain shall carry out the text-to-GEARS transformation as specified:

> Follow the definition relayed between the \`--- DEFINITION ---\` and \`--- END DEFINITION ---\` lines exactly, adding no rules of your own: read the named Source and write the named Target as the definition specifies.
> If the Source cannot be transformed under the definition, do not guess: leave the Target unwritten and report the concrete reason.
> --- DEFINITION ---
> \\<definition\\>
> --- END DEFINITION ---

Results:
- \`compiled\`: Captain wrote the named Target as the relayed definition specifies.
- \`rejected\`: Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.

## References

[1]: https://example.invalid "not part of the section"
`;

const shippedDefinition = `# text2gears

## Rules

Normative rules relayed at run time.

${shippedSection}`;

const shippedPrompt = [
  'Follow the definition relayed between the `--- DEFINITION ---` and `--- END DEFINITION ---` lines exactly, adding no rules of your own: read the named Source and write the named Target as the definition specifies.',
  'If the Source cannot be transformed under the definition, do not guess: leave the Target unwritten and report the concrete reason.',
  '--- DEFINITION ---',
  '<definition>',
  '--- END DEFINITION ---',
];

const shippedGears = `# text2gears

## Behaviors

### T2G-1

Where the phase host supplies \`<definition>\` as the exact bytes of the definition file the request names, when a transformation request names a \`text\` Source (\`.md\`) and a \`gears\` Target (\`.md\`), Captain shall carry out the text-to-GEARS transformation as specified:

${shippedPrompt.map((line) => `> ${line}`).join('\n')}

Results:

- \`compiled\`: Captain wrote the named Target as the relayed definition specifies.
- \`rejected\`: Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.
`;

describe('unescapeMarkdown (verification-23)', () => {
  it('resolves a backslash before ASCII punctuation and keeps every other backslash', () => {
    expect(unescapeMarkdown('\\<definition\\>')).toBe('<definition>');
    expect(unescapeMarkdown('a \\* b \\_ c \\\\ d \\`e\\`')).toBe(
      'a * b _ c \\ d `e`',
    );
    // A backslash before a letter, digit, space, or non-ASCII character is
    // content, as is a trailing one.
    expect(unescapeMarkdown('C:\\new \\1 \\é \\')).toBe('C:\\new \\1 \\é \\');
  });
});

describe('parseCompiledExecutionContract (verification-23)', () => {
  it('parses the exact section form the shipped definitions carry', () => {
    expect(parseCompiledExecutionContract(shippedDefinition)).toEqual({
      prompt: shippedPrompt,
      results: [
        [
          'compiled',
          'Captain wrote the named Target as the relayed definition specifies.',
        ],
        [
          'rejected',
          'Captain reported that the Source cannot be transformed under the relayed definition and left the Target unwritten.',
        ],
      ],
      findings: [],
    });
  });

  it('parses the section prompt lines and ordered Results entries', () => {
    expect(parseCompiledExecutionContract(definitionWithSection)).toEqual({
      prompt: [
        'Read <source> and write <target> following this definition:',
        '',
        '<definition>',
      ],
      results: [
        ['compiled', 'Captain wrote the Target.'],
        ['rejected', 'Captain reported the Source as unrepresentable.'],
      ],
      findings: [],
    });
  });

  it('returns undefined without the section and reports a malformed one', () => {
    expect(
      parseCompiledExecutionContract('# Phase\n\n## Rules\n\n> prompt\n'),
    ).toBeUndefined();
    expect(
      parseCompiledExecutionContract(
        '# Phase\n\n## Compiled execution\n\nProse only.\n',
      ),
    ).toEqual({
      prompt: [],
      results: [],
      findings: [
        'compiled-execution section declares no acting blockquote',
        'compiled-execution section declares no Results contract',
      ],
    });
    expect(
      parseCompiledExecutionContract(
        '## Compiled execution\n\n> act\n\nResults:\n\n- `a`: one\n- `a`: again\n\n## Compiled execution\n',
      )?.findings,
    ).toEqual([
      'definition declares 2 "## Compiled execution" sections (expected one)',
      'compiled-execution Results repeat guard a',
    ]);
    expect(
      parseCompiledExecutionContract(
        '## Compiled execution\n\n> act\n\nResults:\n\nnot a bullet\n',
      )?.findings,
    ).toEqual(['compiled-execution Results block declares no valid entries']);
  });
});

describe('checkCompiledExecutionFidelity (verification-23)', () => {
  it('is not applicable to a definition without the section', () => {
    expect(
      checkCompiledExecutionFidelity('# Phase\n\n> prompt\n', preservingGears),
    ).toEqual({
      applicable: false,
      reason: 'definition declares no "## Compiled execution" section',
    });
  });

  it('matches a Source-escaped placeholder with its compiled plain form', () => {
    // The shipped section spells `\<definition\>`; the compiled GEARS carries
    // the plain `<definition>` that Markdown unescaping yields.
    expect(
      checkCompiledExecutionFidelity(shippedDefinition, shippedGears),
    ).toEqual({ applicable: true, findings: [], item: 'T2G-1' });
    // A bundle that transcribed the escape literally drifted.
    const escapedGears = shippedGears.replace(
      '> <definition>',
      '> \\<definition\\>',
    );
    expect(
      checkCompiledExecutionFidelity(shippedDefinition, escapedGears).findings,
    ).toEqual([
      'no direct-Captain GEARS item preserves the compiled-execution acting prompt verbatim; nearest item T2G-1 differs at prompt line 4: expected "<definition>", found "\\\\<definition\\\\>"',
    ]);
  });

  it('accepts a direct-Captain item preserving the prompt and Results verbatim', () => {
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, preservingGears),
    ).toEqual({ applicable: true, findings: [], item: 'PHASE-1' });
    // Other items around it do not matter.
    const surrounded = `${preservingGears}
### PHASE-2

When more work is needed, Captain shall prompt Writer:

> Do more.
`;
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, surrounded),
    ).toMatchObject({ applicable: true, findings: [], item: 'PHASE-1' });
  });

  it('reports a drifted prompt line with the nearest item', () => {
    const drifted = preservingGears.replace(
      '> Read <source> and write <target> following this definition:',
      '> Read <source> and write <target> following the rules below:',
    );
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, drifted),
    ).toEqual({
      applicable: true,
      findings: [
        'no direct-Captain GEARS item preserves the compiled-execution acting prompt verbatim; nearest item PHASE-1 differs at prompt line 1: expected "Read <source> and write <target> following this definition:", found "Read <source> and write <target> following the rules below:"',
      ],
    });
    // A transcribed extra line is drift too.
    const extended = preservingGears.replace(
      '> <definition>\n',
      '> <definition>\n> Also follow every rule above.\n',
    );
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, extended).findings,
    ).toEqual([
      'no direct-Captain GEARS item preserves the compiled-execution acting prompt verbatim; nearest item PHASE-1 differs at prompt line 4: expected "<end of prompt>", found "Also follow every rule above."',
    ]);
  });

  it('reports drifted, reordered, or missing Results on the preserving item', () => {
    const reordered = preservingGears.replace(
      '- `compiled`: Captain wrote the Target.\n- `rejected`: Captain reported the Source as unrepresentable.\n',
      '- `rejected`: Captain reported the Source as unrepresentable.\n- `compiled`: Captain wrote the Target.\n',
    );
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, reordered).findings,
    ).toEqual([
      'GEARS item PHASE-1 preserves the compiled-execution acting prompt but its Results differ: expected compiled: Captain wrote the Target. | rejected: Captain reported the Source as unrepresentable., found rejected: Captain reported the Source as unrepresentable. | compiled: Captain wrote the Target.',
    ]);
    const missing = preservingGears.replace(/Results:[\s\S]*$/, '');
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, missing).findings,
    ).toEqual([
      'GEARS item PHASE-1 preserves the compiled-execution acting prompt but its Results differ: expected compiled: Captain wrote the Target. | rejected: Captain reported the Source as unrepresentable., found (none)',
    ]);
  });

  it('does not accept the prompt on a delegated-role item or in a GEARS without direct-Captain items', () => {
    const delegated = preservingGears.replace(
      'Captain shall transform the Source into the Target:',
      'Captain shall prompt Writer:',
    );
    expect(
      checkCompiledExecutionFidelity(definitionWithSection, delegated).findings,
    ).toEqual([
      'no direct-Captain GEARS item preserves the compiled-execution acting prompt verbatim (the GEARS declares no direct-Captain item)',
    ]);
  });

  it('reports a malformed section instead of comparing it', () => {
    expect(
      checkCompiledExecutionFidelity(
        '## Compiled execution\n\n> act\n',
        preservingGears,
      ),
    ).toEqual({
      applicable: true,
      findings: ['compiled-execution section declares no Results contract'],
    });
  });
});

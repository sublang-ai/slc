// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

// verification-67: a `gears` artifact in the spec-package form (DR-065) beside
// a machine compiled before it, whose sourceItem citations are uppercase.

import { describe, expect, it } from 'vitest';
import { createMachine } from 'xstate';

import {
  checkGearsActorContract,
  checkGearsFsmConformance,
  checkGearsResultContract,
  type MachineConfigLike,
} from '../src/verify.js';
import { checkGearsFsmConformanceAsync } from '../src/verify-coverage.js';

const NEEDS_BOSS_REPLY_TEXT =
  "The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.";

const packageGears = `<!-- SPDX-License-Identifier: Apache-2.0 -->

# flow: Flow

## Intent

\`flow\` drafts a change, checks it, and has it reviewed.

Roles:

- Coder

## External Behavior

### flow-5

When a caller starts \`flow\`, the caller shall supply one input holding:

- the intent;
- optional context.

### flow-6

\`flow\` shall return the outcome by case:

| Case | Return |
| --- | --- |
| Review passed | \`approved\` |
| Review failed | \`rejected\` |

## Internal Behavior

### flow-1

When the caller starts \`flow\` [[flow-5](#flow-5)], Captain shall prompt Coder:

> Draft the change for <intent>.

Results:
- \`done\`: Coder committed the draft.

### flow-2

When Coder commits the draft [[flow-1](#flow-1)], Captain shall run:

> npm test

Results:
- \`passed\`: The command exited with status zero.
- \`failed\`: The command exited with a nonzero status.

### flow-3

When the tests pass [[flow-2](#flow-2)], Captain shall call playbook \`review\`:

> Review the draft.

### flow-4

When the review returns [[flow-3](#flow-3)], Captain shall summarize directly:

> Summarize the outcome.

Results:
- \`done\`: Captain summarized the outcome.

### flow-7

Coder shall commit only within the working folder [[flow-1](#flow-1)].

## Verification

### flow-8

When the tests fail, a \`flow\` run shall:

- prompt Coder once [[flow-1](#flow-1)];
- call \`review\` never [[flow-3](#flow-3)].
`;

const identity = (stateId: string, role?: string) => ({
  id: stateId,
  meta: { playbook: { stateId, ...(role === undefined ? {} : { role }) } },
});

const packageConfig = (
  cite: Partial<Record<'draft' | 'test' | 'review' | 'summary', string>> = {},
): MachineConfigLike => ({
  initial: 'draft',
  states: {
    draft: {
      ...identity('draft', 'coder'),
      invoke: {
        src: 'player',
        input: () => ({
          stateId: 'draft',
          role: 'coder',
          sourceItem: cite.draft ?? 'FLOW-1',
          prompt: 'Draft the change for <intent>.',
          result: {
            done: 'Coder committed the draft.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
          },
        }),
        onDone: { target: '#test' },
      },
    },
    test: {
      ...identity('test'),
      invoke: {
        src: 'script',
        input: () => ({
          stateId: 'test',
          sourceItem: cite.test ?? 'FLOW-2',
          command: 'npm test',
          result: {
            passed: 'The command exited with status zero.',
            failed: 'The command exited with a nonzero status.',
          },
        }),
        onDone: { target: '#review' },
      },
    },
    review: {
      ...identity('review'),
      invoke: {
        src: 'playbook',
        input: () => ({
          stateId: 'review',
          sourceItem: cite.review ?? 'FLOW-3',
          playbookId: 'review',
          text: 'Review the draft.',
        }),
        onDone: { target: '#summary' },
      },
    },
    summary: {
      ...identity('summary'),
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'summary',
          sourceItem: cite.summary ?? 'FLOW-4',
          prompt: 'Summarize the outcome.',
          result: {
            done: 'Captain summarized the outcome.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
          },
        }),
        onDone: { target: '#done' },
      },
    },
    done: { ...identity('done'), type: 'final' },
  },
});

const options = { concurrentRoleSets: [] };

describe('package-form GEARS conformance (verification-67)', () => {
  it('lets uppercase leaf citations cite lowercase action items', async () => {
    // verification-1, verification-66
    expect(
      checkGearsFsmConformance(packageGears, packageConfig(), options),
    ).toEqual([]);
    expect(
      await checkGearsFsmConformanceAsync(packageGears, {
        machine: createMachine(
          packageConfig() as Parameters<typeof createMachine>[0],
        ),
        concurrentRoleSets: [],
      }),
    ).toEqual([]);
    // Exact spellings conform as well.
    expect(
      checkGearsFsmConformance(
        packageGears,
        packageConfig({
          draft: 'flow-1',
          test: 'flow-2',
          review: 'flow-3',
          summary: 'flow-4',
        }),
        options,
      ),
    ).toEqual([]);
  });

  it('maps requirement and test items to no leaf and checks none of their text', () => {
    // verification-1, verification-71: flow-5..flow-8 carry lists and a table.
    expect(checkGearsResultContract(packageGears)).toEqual([]);
    expect(checkGearsActorContract(packageGears)).toEqual([]);
    expect(
      checkGearsFsmConformance(packageGears, packageConfig(), options).join(
        '\n',
      ),
    ).not.toMatch(/flow-[5-8]/);
  });

  it('reports a declarative item carrying a prompt blockquote', () => {
    // An action that lost its acting clause is not read as a requirement.
    const lost = packageGears.replace(
      'When the review returns [[flow-3](#flow-3)], Captain shall summarize directly:',
      'When the review returns [[flow-3](#flow-3)], the outcome shall be summarized:',
    );
    expect(checkGearsFsmConformance(lost, packageConfig(), options)).toEqual(
      expect.arrayContaining([
        'GEARS item flow-4 has a prompt blockquote but no `Captain shall` acting clause',
        'GEARS item flow-4 declares Results metadata but no `Captain shall` acting clause',
        'FSM state summary cites declarative GEARS item flow-4, which has no `Captain shall` acting clause',
      ]),
    );
    expect(
      checkGearsFsmConformance(lost, packageConfig(), options).join('\n'),
    ).not.toContain('maps to no FSM state');
  });

  it('keeps the result-contract finding for Results on a declarative item without a prompt', () => {
    const results = packageGears.replace(
      'Coder shall commit only within the working folder [[flow-1](#flow-1)].\n',
      'Coder shall commit only within the working folder [[flow-1](#flow-1)].\n\nResults:\n- `done`: Done.\n',
    );
    const findings = checkGearsFsmConformance(
      results,
      packageConfig(),
      options,
    );
    expect(findings).toContain(
      'GEARS item flow-7: Results block shall follow a non-empty acting blockquote',
    );
    expect(findings.join('\n')).not.toContain(
      'flow-7 declares Results metadata',
    );
  });

  it('reports every leaf kind citing a declarative item', () => {
    const findings = checkGearsFsmConformance(
      packageGears,
      packageConfig({
        draft: 'FLOW-5',
        test: 'FLOW-6',
        review: 'FLOW-7',
        summary: 'FLOW-8',
      }),
      options,
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        'FSM state draft cites declarative GEARS item flow-5, which has no `Captain shall` acting clause',
        'FSM script state test cites declarative GEARS item flow-6, which has no `Captain shall` acting clause',
        'FSM playbook state review cites declarative GEARS item flow-7, which has no `Captain shall` acting clause',
        'FSM state summary cites declarative GEARS item flow-8, which has no `Captain shall` acting clause',
        // The action items those leaves left are still owed a leaf.
        'GEARS item flow-1 maps to no FSM state',
        'GEARS item flow-4 maps to no FSM state',
      ]),
    );
  });

  it('reports item IDs equal ignoring ASCII letter case', () => {
    const colliding = packageGears.replace('### flow-7\n', '### FLOW-1\n');
    expect(
      checkGearsFsmConformance(colliding, packageConfig(), options),
    ).toContain(
      'GEARS items flow-1, FLOW-1 have IDs equal ignoring ASCII letter case',
    );
  });

  it('still accepts the earlier form with prose around each action statement', () => {
    const earlier = `# Flow

Roles:

- Coder

## Behaviors

### FLOW-1

The caller supplies the intent; Coder keeps to the working folder.
When the caller starts the flow, Captain shall prompt Coder:

> Draft the change for <intent>.

Results:
- \`done\`: Coder committed the draft.

### FLOW-2

When Coder commits the draft, Captain shall run:

> npm test

Results:
- \`passed\`: The command exited with status zero.
- \`failed\`: The command exited with a nonzero status.

### FLOW-3

When the tests pass, Captain shall call playbook \`review\`:

> Review the draft.

When \`review\` returns, Captain shall continue with FLOW-4.

### FLOW-4

When the review returns, Captain shall summarize directly:

> Summarize the outcome.

Results:
- \`done\`: Captain summarized the outcome.
`;
    expect(checkGearsFsmConformance(earlier, packageConfig(), options)).toEqual(
      [],
    );
  });
});

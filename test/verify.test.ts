// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { describe, expect, it } from 'vitest';

import {
  checkGearsFsmConformance,
  enumerateCaptainStates,
  generateGearsFsmConformanceTest,
  parseGearsItems,
  type MachineConfigLike,
} from '../src/verify.js';

// A `gears` artifact in the `text2gears` output form (as produced for the real
// greeter sample): `### <ID>`, a "Captain shall prompt <Player>" line, and a
// blockquoted prompt body.
const gears = `<!-- SPDX-License-Identifier: Apache-2.0 -->

# Greeter

## Behaviors

### GREETER-1

When Boss requests a greeting, Captain shall prompt Writer:
> Draft a short hello message for <audience>.

### GREETER-2

When Writer proposes a greeting, Captain shall prompt Reviewer:
> Check it is friendly and concise.
> Approve it or return concrete edits.
`;

// A machine config in the `gears2fsm` shape: captain-invoking states whose
// `invoke.input` carries player, sourceItem, and the verbatim prompt.
const captain = (player: string, sourceItem: string, prompt: string) => ({
  invoke: { input: () => ({ player, sourceItem, prompt, result: {} }) },
});

const conformantConfig = (): MachineConfigLike => ({
  states: {
    ready: {},
    draft: captain(
      'Writer',
      'GREETER-1',
      'Draft a short hello message for <audience>.',
    ),
    review: captain(
      'Reviewer',
      'GREETER-2',
      'Check it is friendly and concise.\nApprove it or return concrete edits.',
    ),
    done: {},
  },
});

describe('parseGearsItems', () => {
  it('parses each item id, player, and verbatim prompt body', () => {
    expect(parseGearsItems(gears)).toEqual([
      {
        id: 'GREETER-1',
        player: 'Writer',
        prompt: 'Draft a short hello message for <audience>.',
      },
      {
        id: 'GREETER-2',
        player: 'Reviewer',
        prompt:
          'Check it is friendly and concise.\nApprove it or return concrete edits.',
      },
    ]);
  });

  // The real text2gears self-compile produces Captain-acts items
  // ("Captain shall compose ...") with no delegated player; their player is
  // Captain itself.
  it('treats a Captain-acts item (no delegated player) as player Captain', () => {
    const md = `### T2G-10

When Boss provides a description, Captain shall compose the Target:
> Recognize the default players.
`;
    expect(parseGearsItems(md)).toEqual([
      {
        id: 'T2G-10',
        player: 'Captain',
        prompt: 'Recognize the default players.',
      },
    ]);
  });
});

describe('enumerateCaptainStates', () => {
  it('recovers captain states and skips non-invoking states', () => {
    const states = enumerateCaptainStates(conformantConfig());
    expect(states.map((s) => s.stateId)).toEqual(['draft', 'review']);
    expect(states[0]).toEqual({
      stateId: 'draft',
      sourceItem: 'GREETER-1',
      player: 'Writer',
      prompt: 'Draft a short hello message for <audience>.',
    });
  });
});

describe('checkGearsFsmConformance', () => {
  it('reports no findings when the FSM matches the GEARS source', () => {
    expect(checkGearsFsmConformance(gears, conformantConfig())).toEqual([]);
  });

  it('detects a mis-bound player', () => {
    const config = conformantConfig();
    config.states!.draft = captain(
      'Reviewer',
      'GREETER-1',
      'Draft a short hello message for <audience>.',
    );
    expect(checkGearsFsmConformance(gears, config).join('\n')).toMatch(
      /GREETER-1: FSM player/,
    );
  });

  it('detects a drifted prompt body', () => {
    const config = conformantConfig();
    config.states!.draft = captain('Writer', 'GREETER-1', 'Draft a hello.');
    expect(checkGearsFsmConformance(gears, config).join('\n')).toMatch(
      /GREETER-1: FSM prompt is not the GEARS prompt verbatim/,
    );
  });

  it('detects a dropped state', () => {
    const config = conformantConfig();
    delete config.states!.review;
    expect(checkGearsFsmConformance(gears, config)).toContain(
      'GEARS item GREETER-2 maps to no FSM state',
    );
  });

  it('detects a state referencing an unknown GEARS item', () => {
    const config = conformantConfig();
    config.states!.stray = captain('Writer', 'GREETER-9', 'x');
    expect(checkGearsFsmConformance(gears, config)).toContain(
      'FSM state stray references unknown GEARS item GREETER-9',
    );
  });
});

describe('generateGearsFsmConformanceTest', () => {
  it('emits a test wiring the artifact fsm, gears file, and checker', () => {
    const emitted = generateGearsFsmConformanceTest({
      basename: 'code',
      fsmModule: './code.fsm.js',
      machineExport: 'codingMachine',
      gearsFile: './code.gears.md',
      verifyModule: '@sublang/slc/verify',
    });
    expect(emitted).toContain("import { codingMachine } from './code.fsm.js'");
    expect(emitted).toContain(
      'checkGearsFsmConformance(gears, codingMachine.config)',
    );
    expect(emitted).toContain('./code.gears.md');
    expect(emitted).toContain('SPDX-License-Identifier');
  });
});

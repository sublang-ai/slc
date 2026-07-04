// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkGearsFsmConformance,
  emitGearsFsmConformanceTest,
  enumerateCaptainStates,
  findMachineConfig,
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
// `invoke.input` carries player, sourceItem, the verbatim prompt, and the
// per-state result map with the mandated Boss-reply key.
const NEEDS_BOSS_REPLY_TEXT =
  "The player's prose surfaces a clarifying question for Boss that the player cannot answer alone. Output shall include `question: <verbatim question text from the player's prose>`.";

const captain = (
  player: string,
  sourceItem: string,
  prompt: string,
  result: Record<string, string> = {},
) => ({
  invoke: {
    input: () => ({
      player,
      sourceItem,
      prompt,
      result: {
        done: 'The player finished.',
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
        ...result,
      },
    }),
  },
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

  // Mirrors the real text2gears self-compile output: a Captain-acts item
  // ("Captain shall compose ...") with no delegated player and a multi-line
  // prompt body, so a clean checkout reproduces the real-format coverage. Its
  // player is Captain itself.
  it('treats a Captain-acts item (no delegated player) as player Captain', () => {
    const md = `## Behaviors

### T2G-10

When Boss provides a free-form procedure description as the Source, Captain shall compose the Target package of GEARS spec items:
> Recognize Boss (the human user) and Captain (the coordinating agent) as default players, together with any players declared in the Source's opening Players section.
> Address one state behavior in each spec item.
> Blockquote every prompt, one point per line.
> Write the Target in the same language as the Source.

## References
`;
    expect(parseGearsItems(md)).toEqual([
      {
        id: 'T2G-10',
        player: 'Captain',
        prompt: [
          "Recognize Boss (the human user) and Captain (the coordinating agent) as default players, together with any players declared in the Source's opening Players section.",
          'Address one state behavior in each spec item.',
          'Blockquote every prompt, one point per line.',
          'Write the Target in the same language as the Source.',
        ].join('\n'),
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
      result: {
        done: 'The player finished.',
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      },
    });
  });
});

describe('findMachineConfig', () => {
  it('finds the exported machine config regardless of export name', () => {
    const config = { states: { ready: {} } };
    expect(findMachineConfig({ other: 1, codingMachine: { config } })).toBe(
      config,
    );
  });

  it('throws when the module exports no machine', () => {
    expect(() => findMachineConfig({ notAMachine: 1 })).toThrow(
      /no XState machine/,
    );
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

  it('detects a GEARS item mapped to more than one state (not exactly one)', () => {
    const config = conformantConfig();
    // A second, conformant-looking state also claims GREETER-1.
    config.states!.draftDup = captain(
      'Writer',
      'GREETER-1',
      'Draft a short hello message for <audience>.',
    );
    expect(checkGearsFsmConformance(gears, config).join('\n')).toMatch(
      /GEARS item GREETER-1 maps to 2 FSM states/,
    );
  });

  it('detects a state with no needsBossReply result (VERIFY-3)', () => {
    const config = conformantConfig();
    const state = config.states!.draft as {
      invoke: { input: () => Record<string, unknown> };
    };
    const input = state.invoke.input();
    state.invoke.input = () => ({
      ...input,
      result: { done: 'The player finished.' },
    });
    expect(checkGearsFsmConformance(gears, config)).toContain(
      'FSM state draft declares no needsBossReply result',
    );
  });

  it('detects a needsBossReply description missing the question contract (VERIFY-3)', () => {
    const config = conformantConfig();
    config.states!.draft = captain(
      'Writer',
      'GREETER-1',
      'Draft a short hello message for <audience>.',
      { needsBossReply: 'The player asked something.' },
    );
    expect(checkGearsFsmConformance(gears, config).join('\n')).toMatch(
      /draft: needsBossReply description lacks/,
    );
  });
});

// The checker must hold for the real, human-reviewed reference artifacts that
// model DR-009's verification contract (IR-007 Task 8: "test the generator
// against the reference artifacts"). The installed @sublang/playbook ships them.
describe('conformance against the reference artifacts', () => {
  it('finds nothing on the reference code.gears.md + code.fsm', async () => {
    const dir = fileURLToPath(
      new URL(
        '../node_modules/@sublang/playbook/reference/sdlc/code.playbook/',
        import.meta.url,
      ),
    );
    const referenceGears = readFileSync(join(dir, 'code.gears.md'), 'utf8');
    const fsm: unknown = await import(join(dir, 'code.fsm.js'));
    const items = parseGearsItems(referenceGears);
    expect(items).toHaveLength(19);
    expect(
      checkGearsFsmConformance(referenceGears, findMachineConfig(fsm)),
    ).toEqual([]);
  });
});

describe('generateGearsFsmConformanceTest', () => {
  it('emits a test wiring the artifact fsm, gears file, and checker', () => {
    const emitted = generateGearsFsmConformanceTest({
      basename: 'code',
      fsmModule: './code.fsm.js',
      gearsFile: './code.gears.md',
      verifyModule: '@sublang/slc/verify',
    });
    expect(emitted).toContain("import * as fsm from './code.fsm.js'");
    expect(emitted).toContain(
      "import { checkGearsFsmConformance, findMachineConfig } from '@sublang/slc/verify'",
    );
    expect(emitted).toContain(
      'checkGearsFsmConformance(gears, findMachineConfig(fsm))',
    );
    expect(emitted).toContain('./code.gears.md');
    expect(emitted).toContain('SPDX-License-Identifier');
  });

  it("exports './verify' so a generated test's @sublang/slc/verify import resolves", () => {
    const pkg = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../package.json', import.meta.url)),
        'utf8',
      ),
    ) as { exports?: Record<string, { default?: string }> };
    expect(pkg.exports?.['./verify']?.default).toBe('./dist/verify.js');
  });
});

describe('emitGearsFsmConformanceTest', () => {
  it('writes the conformance test into the artifact directory (VERIFY-2)', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-emit-'));
    try {
      const path = await emitGearsFsmConformanceTest({
        artifactDir,
        basename: 'code',
      });
      expect(path).toBe(join(artifactDir, 'code.gears-fsm.test.ts'));
      const content = await readFile(path, 'utf8');
      expect(content).toContain("from '@sublang/slc/verify'");
      // The emitted test imports the `.fsm.ts` artifact the run wrote.
      expect(content).toContain("import * as fsm from './code.fsm.ts'");
      expect(content).toContain('./code.gears.md');
      expect(content).toContain(
        'checkGearsFsmConformance(gears, findMachineConfig(fsm))',
      );
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});

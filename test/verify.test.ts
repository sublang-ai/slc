// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkGearsFsmConformance,
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  enumerateCaptainStates,
  findMachineConfig,
  generateFsmIntrospectionTest,
  generateGearsFsmConformanceTest,
  normalizeArms,
  parseGearsItems,
  pinIntrospection,
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

const referenceDir = fileURLToPath(
  new URL(
    '../node_modules/@sublang/playbook/reference/sdlc/code.playbook/',
    import.meta.url,
  ),
);
const referenceFsm = async (): Promise<unknown> =>
  import(join(referenceDir, 'code.fsm.js'));

// The checkers must hold for the real, human-reviewed reference artifacts that
// model DR-009's verification contract (IR-007 Task 8: "test the generator
// against the reference artifacts"). The installed @sublang/playbook ships them.
describe('conformance against the reference artifacts', () => {
  it('finds nothing on the reference code.gears.md + code.fsm', async () => {
    const referenceGears = readFileSync(
      join(referenceDir, 'code.gears.md'),
      'utf8',
    );
    const items = parseGearsItems(referenceGears);
    expect(items).toHaveLength(19);
    expect(
      checkGearsFsmConformance(
        referenceGears,
        findMachineConfig(await referenceFsm()),
      ),
    ).toEqual([]);
  });
});

describe('normalizeArms', () => {
  it('normalizes string, object, array, and absent declarations', () => {
    expect(normalizeArms(undefined)).toEqual([]);
    expect(normalizeArms('#failed')).toEqual([
      { index: 0, target: 'failed', guarded: false },
    ]);
    expect(
      normalizeArms([
        { target: '#done', guard: () => true },
        { target: 'ready' },
        { actions: 'remember' },
      ]),
    ).toEqual([
      { index: 0, target: 'done', guarded: true },
      { index: 1, target: 'ready', guarded: false },
      { index: 2, target: null, guarded: false },
    ]);
  });
});

// A machine fixture with transitions, root events, and a quiescent surface, in
// the `gears2fsm` shape the introspection pins (VERIFY-4).
const introspectableConfig = (): MachineConfigLike => ({
  initial: 'ready',
  states: {
    ready: { on: { START: { target: 'draft' } } },
    draft: {
      ...captain('Writer', 'GREETER-1', 'Draft a short hello message.'),
      invoke: {
        ...captain('Writer', 'GREETER-1', 'Draft a short hello message.')
          .invoke,
        onDone: [
          { target: '#review', guard: () => true },
          { target: '#awaitBossReply', guard: () => true },
        ],
        onError: { target: '#failed' },
      },
    },
    review: {
      ...captain('Reviewer', 'GREETER-2', 'Check it.'),
      invoke: {
        ...captain('Reviewer', 'GREETER-2', 'Check it.').invoke,
        onDone: [{ target: '#done', guard: () => true }],
        onError: { target: '#failed' },
      },
    },
    awaitBossReply: {
      on: { BOSS_REPLY: [{ target: '#draft', guard: () => true }] },
    },
    failed: { on: { START: { target: 'draft' } } },
    done: { type: 'final' },
  },
  on: {
    BOSS_INTERRUPT: [
      { target: '#draft', guard: () => true },
      { target: '#review', guard: () => true },
    ],
  },
});

describe('pinIntrospection (VERIFY-4)', () => {
  it('pins captain bindings, transition arms, event surfaces, and the jumpable set', () => {
    const pins = pinIntrospection(introspectableConfig());
    expect(pins.initial).toBe('ready');
    expect(pins.captain.map((state) => state.state)).toEqual([
      'draft',
      'review',
    ]);
    expect(pins.captain[0]).toMatchObject({
      sourceItem: 'GREETER-1',
      player: 'Writer',
      resultKeys: ['done', 'needsBossReply'],
      onDone: [
        { index: 0, target: 'review', guarded: true },
        { index: 1, target: 'awaitBossReply', guarded: true },
      ],
      onError: [{ index: 0, target: 'failed', guarded: false }],
    });
    expect(pins.quiescent.map((state) => state.state)).toEqual([
      'ready',
      'awaitBossReply',
      'failed',
      'done',
    ]);
    expect(pins.quiescent[3].final).toBe(true);
    expect(Object.keys(pins.rootOn)).toEqual(['BOSS_INTERRUPT']);
    expect(pins.interruptTargets).toEqual(['draft', 'review']);
  });

  it('pins the reference machine: 19 captain states, 21 interrupt targets', async () => {
    const pins = pinIntrospection(findMachineConfig(await referenceFsm()));
    expect(pins.captain).toHaveLength(19);
    // Declaration order in the reference is not item order; coverage is a set.
    expect(pins.captain.map((state) => state.sourceItem).sort()).toEqual(
      Array.from({ length: 19 }, (_, i) => `CODE-${i + 1}`).sort(),
    );
    expect(pins.interruptTargets).toHaveLength(21);
    expect(pins.quiescent.map((state) => state.state)).toEqual([
      'ready',
      'awaitBossReply',
      'failed',
      'done',
    ]);
    // Every captain state declares Boss-reply suspension and error wiring.
    for (const state of pins.captain) {
      expect(state.resultKeys).toContain('needsBossReply');
      expect(state.onError.length).toBeGreaterThan(0);
    }
  });
});

describe('generateFsmIntrospectionTest / emitFsmIntrospectionTest', () => {
  it('emits a test pinning the topology derived from the artifact at build time', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-intro-'));
    try {
      await writeFile(
        join(artifactDir, 'code.fsm.ts'),
        [
          'export const machine = {',
          '  config: {',
          "    initial: 'ready',",
          '    states: {',
          "      ready: { on: { GO: { target: 'work' } } },",
          '      work: {',
          '        invoke: {',
          "          src: 'captain',",
          '          input: () => ({',
          "            player: 'Writer',",
          "            sourceItem: 'X-1',",
          "            prompt: 'p',",
          "            result: { done: 'd', needsBossReply: 'Output shall include `question: ...`' },",
          '          }),',
          "          onDone: [{ target: '#done', guard: () => true }],",
          "          onError: { target: '#failed' },",
          '        },',
          '      },',
          '      failed: {},',
          "      done: { type: 'final' },",
          '    },',
          "    on: { BOSS_INTERRUPT: [{ target: '#work', guard: () => true }] },",
          '  },',
          '};',
          '',
        ].join('\n'),
      );
      const path = await emitFsmIntrospectionTest({
        artifactDir,
        basename: 'code',
      });
      expect(path).toBe(join(artifactDir, 'code.fsm.introspect.test.ts'));
      const content = await readFile(path, 'utf8');
      expect(content).toContain(
        "import { findMachineConfig, pinIntrospection } from '@sublang/slc/verify'",
      );
      expect(content).toContain("import * as fsm from './code.fsm.ts'");
      expect(content).toContain('"sourceItem": "X-1"');
      expect(content).toContain('"interruptTargets": [\n    "work"\n  ]');
      expect(content).toContain('pinIntrospection(findMachineConfig(fsm))');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('throws when the fsm artifact cannot be imported, so emission degrades to a diagnostic', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-intro-bad-'));
    try {
      await writeFile(join(artifactDir, 'code.fsm.ts'), 'not typescript {{{\n');
      await expect(
        emitFsmIntrospectionTest({ artifactDir, basename: 'code' }),
      ).rejects.toThrow();
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('bakes drift detection: the generated pins differ when the machine changes', () => {
    const pins = pinIntrospection(introspectableConfig());
    const drifted = introspectableConfig();
    delete drifted.states!.review;
    expect(pinIntrospection(drifted)).not.toEqual(pins);
    const generated = generateFsmIntrospectionTest({
      basename: 'greeter',
      fsmModule: './greeter.fsm.ts',
      verifyModule: '@sublang/slc/verify',
      pins,
    });
    expect(generated).toContain('const PINNED =');
    expect(generated).toContain('"sourceItem": "GREETER-1"');
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

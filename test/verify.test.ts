// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  CONTINUATION_PREAMBLE,
  capturePromptContract,
  checkGearsFsmConformance,
  checkPromptComposition,
  deriveSubstitutions,
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  emitPromptContractTest,
  enumerateCaptainStates,
  findMachineConfig,
  generateFsmIntrospectionTest,
  generateGearsFsmConformanceTest,
  generatePromptContractTest,
  normalizeArms,
  parseGearsItems,
  pinIntrospection,
  placeholdersIn,
  probeContextReads,
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
  it('parses quoted non-English player names (text2gears.md Players)', () => {
    const md = `## Behaviors

### DOC-1

When Boss requests a draft, Captain shall prompt "作者":
> 起草一段简短的问候。
`;
    expect(parseGearsItems(md)).toEqual([
      { id: 'DOC-1', player: '作者', prompt: '起草一段简短的问候。' },
    ]);
  });

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

  it('retains explicit captain invokes whose input cannot be introspected', () => {
    const config: MachineConfigLike = {
      states: {
        missingSource: {
          invoke: {
            src: 'captain',
            input: () => ({
              player: 'Writer',
              prompt: 'Hidden work.',
              result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
            }),
          },
        },
        throwing: {
          invoke: {
            src: 'captain',
            input: () => {
              throw new Error('context unavailable');
            },
          },
        },
        malformed: {
          invoke: { src: 'captain', input: () => 'not an input object' },
        },
      },
    };

    const states = enumerateCaptainStates(config);
    expect(states.map((state) => state.stateId)).toEqual([
      'missingSource',
      'throwing',
      'malformed',
    ]);
    expect(states[0].bindingFindings).toContain(
      'invoke.input.sourceItem is not a non-empty string',
    );
    expect(states[1].bindingFindings?.join('\n')).toMatch(
      /threw during introspection: context unavailable/,
    );
    expect(states[2].bindingFindings).toContain(
      'invoke.input returned a non-object',
    );

    const pins = pinIntrospection(config);
    expect(pins.captain.map((state) => state.state)).toEqual([
      'missingSource',
      'throwing',
      'malformed',
    ]);
    expect(pins.quiescent).toEqual([]);
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

  it('reports malformed explicit captain bindings instead of omitting them', () => {
    const config = conformantConfig();
    config.states!.missingSource = {
      invoke: {
        src: 'captain',
        input: () => ({
          player: 'Writer',
          prompt: 'Hidden work.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    };
    config.states!.throwing = {
      invoke: {
        src: 'captain',
        input: () => {
          throw new Error('cannot inspect');
        },
      },
    };

    const findings = checkGearsFsmConformance(gears, config).join('\n');
    expect(findings).toMatch(
      /FSM state missingSource: invoke\.input\.sourceItem is not a non-empty string/,
    );
    expect(findings).toMatch(
      /FSM state throwing: invoke\.input threw during introspection: cannot inspect/,
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
        'import { findMachineConfig, pinIntrospection } from "@sublang/slc/verify"',
      );
      expect(content).toContain('import * as fsm from "./code.fsm.ts"');
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

// A composer following link.md's composition contract, for fixture states whose
// prompts carry the <audience> placeholder wired from context.audience.
const contractCaptain = (
  player: string,
  sourceItem: string,
  promptLines: string[],
) => ({
  invoke: {
    input: ({ context }: { context: Record<string, unknown> }) => ({
      player,
      sourceItem,
      prompt: promptLines.join('\n'),
      result: {
        done: 'The player finished.',
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      },
      audience: context.audience,
      ...(context.pendingBossQuestion && context.bossReply
        ? {
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }
        : {}),
    }),
  },
});

const contractConfig = (): MachineConfigLike => ({
  states: {
    ready: {},
    draft: contractCaptain('Writer', 'GREETER-1', [
      'Draft a short hello message for <audience>.',
      'Keep it warm.',
    ]),
    done: { type: 'final' },
  },
});

type ComposerInput = {
  prompt: string;
  audience?: string;
  pendingBossQuestion?: { question: string };
  bossReply?: string;
};

const goodCompose = (raw: unknown): string => {
  const input = raw as ComposerInput;
  const blocks: string[] = [];
  if (input.pendingBossQuestion && input.bossReply) {
    blocks.push(
      CONTINUATION_PREAMBLE,
      `Boss question:\n${input.pendingBossQuestion.question}`,
      `Boss reply:\n${input.bossReply}`,
    );
  }
  let body = input.prompt;
  if (input.audience !== undefined) {
    body = body.replaceAll('<audience>', input.audience);
  }
  blocks.push(body);
  return blocks.join('\n\n');
};

describe('prompt contract capture (VERIFY-5)', () => {
  it('probes context reads through a recording proxy', () => {
    const reads = probeContextReads(({ context }) => ({
      a: context.audience,
      b: context.bossReply,
    }));
    expect(reads).toEqual(['audience', 'bossReply']);
  });

  it('lists distinct placeholder tokens in order', () => {
    expect(
      placeholdersIn('Use <coder-llm> then <#> and <coder-llm> again.'),
    ).toEqual(['<coder-llm>', '<#>']);
  });

  it('captures per-state reads, wiring, and placeholders', () => {
    const rows = capturePromptContract(contractConfig());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      state: 'draft',
      sourceItem: 'GREETER-1',
      player: 'Writer',
      placeholders: ['<audience>'],
    });
    expect(rows[0].reads).toContain('audience');
    expect(rows[0].wires.audience).toEqual(['audience']);
  });

  it('derives which placeholders the composer substitutes', () => {
    expect(deriveSubstitutions(contractConfig(), goodCompose)).toEqual({
      draft: ['<audience>'],
    });
    // A composer that never substitutes leaves the token literal.
    expect(
      deriveSubstitutions(contractConfig(), (input) =>
        String((input as ComposerInput).prompt),
      ),
    ).toEqual({ draft: [] });

    // Absence alone is not substitution: the replacement position must carry
    // the context sentinel, so deleting a token derives no substitution.
    const deleting = (input: unknown): string =>
      goodCompose(input).replaceAll('«audience»', '');
    expect(deriveSubstitutions(contractConfig(), deleting)).toEqual({
      draft: [],
    });
  });
});

describe('checkPromptComposition (VERIFY-5)', () => {
  it('accepts a composer following the link contract', () => {
    expect(
      checkPromptComposition({
        config: contractConfig(),
        compose: goodCompose,
      }),
    ).toEqual([]);
  });

  it('flags a composer that mutates the body', () => {
    const compose = (raw: unknown): string =>
      goodCompose(raw).replace('Keep it warm.', 'Keep it professional.');
    expect(
      checkPromptComposition({ config: contractConfig(), compose }).join('\n'),
    ).toMatch(/does not preserve the body line "Keep it warm."/);
  });

  it('flags placeholder deletion instead of treating absence as substitution', () => {
    const compose = (raw: unknown): string =>
      goodCompose(raw).replaceAll('«audience»', '');
    expect(
      checkPromptComposition({ config: contractConfig(), compose }).join('\n'),
    ).toMatch(/does not preserve the body line/);
  });

  it('flags prefixes, suffixes, and reordered body lines', () => {
    const prefixed = (raw: unknown): string =>
      goodCompose(raw).replace(
        'Draft a short hello message',
        'MUTATED: Draft a short hello message',
      );
    expect(
      checkPromptComposition({
        config: contractConfig(),
        compose: prefixed,
      }).join('\n'),
    ).toMatch(/does not preserve the body line/);

    const suffixed = (raw: unknown): string =>
      goodCompose(raw).replace('Keep it warm.', 'Keep it warm. EXTRA');
    expect(
      checkPromptComposition({
        config: contractConfig(),
        compose: suffixed,
      }).join('\n'),
    ).toMatch(/does not preserve the body line/);

    const reordered = (raw: unknown): string =>
      goodCompose(raw).replace(
        'Draft a short hello message for «audience».\nKeep it warm.',
        'Keep it warm.\nDraft a short hello message for «audience».',
      );
    expect(
      checkPromptComposition({
        config: contractConfig(),
        compose: reordered,
      }).join('\n'),
    ).toMatch(/verbatim and in order/);
  });

  it('flags adjudicator-contract leakage into the player prompt', () => {
    const compose = (raw: unknown): string =>
      `${goodCompose(raw)}\n\nIf unsure: Output shall include \`question: ...\`.`;
    expect(
      checkPromptComposition({ config: contractConfig(), compose }).join('\n'),
    ).toMatch(/leaks into the player prompt/);
  });

  it('flags continuation blocks on an ordinary turn', () => {
    const compose = (raw: unknown): string =>
      `${CONTINUATION_PREAMBLE}\n\n${goodCompose(raw)}`;
    expect(
      checkPromptComposition({ config: contractConfig(), compose }).join('\n'),
    ).toMatch(/continuation|preamble/);
  });

  it('flags a continuation turn missing the preamble or Q&A blocks', () => {
    const compose = (raw: unknown): string => {
      const input = raw as ComposerInput;
      return input.audience !== undefined
        ? goodCompose({
            ...input,
            pendingBossQuestion: undefined,
            bossReply: undefined,
          })
        : goodCompose(raw);
    };
    const findings = checkPromptComposition({
      config: contractConfig(),
      compose,
    }).join('\n');
    expect(findings).toMatch(/does not open with the exact preamble/);
    expect(findings).toMatch(/lacks the "Boss question:" block/);
  });

  it('flags reversed or non-adjacent continuation Q&A blocks', () => {
    const continuationBody = (input: ComposerInput): string =>
      goodCompose({
        ...input,
        pendingBossQuestion: undefined,
        bossReply: undefined,
      });
    const reversed = (raw: unknown): string => {
      const input = raw as ComposerInput;
      if (!input.pendingBossQuestion || input.bossReply === undefined) {
        return goodCompose(raw);
      }
      return [
        CONTINUATION_PREAMBLE,
        `Boss reply:\n${input.bossReply}`,
        `Boss question:\n${input.pendingBossQuestion.question}`,
        continuationBody(input),
      ].join('\n\n');
    };
    expect(
      checkPromptComposition({
        config: contractConfig(),
        compose: reversed,
      }).join('\n'),
    ).toMatch(/exact ordered Boss question\/reply blocks/);

    const nonAdjacent = (raw: unknown): string => {
      const input = raw as ComposerInput;
      if (!input.pendingBossQuestion || input.bossReply === undefined) {
        return goodCompose(raw);
      }
      return [
        CONTINUATION_PREAMBLE,
        `Boss question:\nextra text\n${input.pendingBossQuestion.question}`,
        `Boss reply:\n${input.bossReply}`,
        continuationBody(input),
      ].join('\n\n');
    };
    const findings = checkPromptComposition({
      config: contractConfig(),
      compose: nonAdjacent,
    }).join('\n');
    expect(findings).toMatch(/lacks the "Boss question:" block/);
    expect(findings).toMatch(/exact ordered Boss question\/reply blocks/);
  });

  it('does not flag body-carried marker or continuation text (self-hosting)', () => {
    // A self-hosted playbook's domain body legitimately QUOTES the adjudicator
    // contract and continuation texts — instructions about them, not leaks.
    const selfHostConfig: MachineConfigLike = {
      states: {
        work: contractCaptain('Writer', 'META-1', [
          'Use this exact description: Output shall include `question: <text>`.',
          `Preserve the continuation preamble exactly: ${CONTINUATION_PREAMBLE}`,
          'Preserve the labels Boss question: and Boss reply: verbatim.',
        ]),
      },
    };
    expect(
      checkPromptComposition({ config: selfHostConfig, compose: goodCompose }),
    ).toEqual([]);
    // A composer that actually ADDS the marker beyond the body still flags.
    const leaky = (raw: unknown): string =>
      `${goodCompose(raw)}\n\nOutput shall include \`question: ...\`.`;
    expect(
      checkPromptComposition({ config: selfHostConfig, compose: leaky }).join(
        '\n',
      ),
    ).toMatch(/leaks into the player prompt/);
  });

  it('finds nothing on the reference fsm + linked composer', async () => {
    const fsm = await referenceFsm();
    const playbook = (await import(join(referenceDir, 'code.playbook.js'))) as {
      _internal: { composePlayerPrompt: (input: unknown) => string };
    };
    const config = findMachineConfig(fsm);
    const rows = capturePromptContract(config);
    expect(rows).toHaveLength(19);
    expect(
      checkPromptComposition({
        config,
        compose: playbook._internal.composePlayerPrompt,
      }),
    ).toEqual([]);
    const substituted = deriveSubstitutions(
      config,
      playbook._internal.composePlayerPrompt,
    );
    // The reference substitutes <#> on IR states and player models on commits.
    expect(substituted.continueIr).toEqual(['<#>']);
    expect(substituted.commitJoint).toEqual(['<coder-llm>', '<reviewer-llm>']);
  });
});

describe('emitPromptContractTest (VERIFY-5)', () => {
  const fsmFixture = [
    'export const machine = {',
    '  config: {',
    '    states: {',
    '      work: {',
    '        invoke: {',
    "          src: 'captain',",
    '          input: ({ context }: { context: Record<string, unknown> }) => ({',
    "            player: 'Writer',",
    "            sourceItem: 'X-1',",
    "            prompt: 'Greet <audience>.',",
    "            result: { done: 'd', needsBossReply: 'Output shall include `question: ...`' },",
    '            audience: context.audience,',
    '            ...(context.pendingBossQuestion && context.bossReply',
    '              ? { pendingBossQuestion: context.pendingBossQuestion, bossReply: context.bossReply }',
    '              : {}),',
    '          }),',
    '        },',
    '      },',
    '    },',
    '  },',
    '};',
    '',
  ].join('\n');

  it('emits the FSM-only variant when no linked module sits beside', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-pc-'));
    try {
      await writeFile(join(artifactDir, 'code.fsm.ts'), fsmFixture);
      const { path, diagnostics } = await emitPromptContractTest({
        artifactDir,
        basename: 'code',
      });
      expect(path).toBe(join(artifactDir, 'code.prompt-contract.test.ts'));
      expect(diagnostics).toEqual([]);
      const content = await readFile(path, 'utf8');
      expect(content).toContain('capturePromptContract');
      expect(content).toContain('"placeholders": [');
      expect(content).toContain('"<audience>"');
      expect(content).not.toContain('checkPromptComposition');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('emits composition checks when the linked module exposes its composer', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-pc-link-'));
    try {
      await writeFile(join(artifactDir, 'code.fsm.ts'), fsmFixture);
      await writeFile(
        join(artifactDir, 'code.playbook.ts'),
        [
          "const CONTINUATION = '" + CONTINUATION_PREAMBLE + "';",
          'const compose = (input: any): string => {',
          '  const blocks: string[] = [];',
          '  if (input.pendingBossQuestion && input.bossReply) {',
          '    blocks.push(CONTINUATION, `Boss question:\\n${input.pendingBossQuestion.question}`, `Boss reply:\\n${input.bossReply}`);',
          '  }',
          '  let body: string = input.prompt;',
          "  if (input.audience !== undefined) body = body.replaceAll('<audience>', input.audience);",
          '  blocks.push(body);',
          "  return blocks.join('\\n\\n');",
          '};',
          'export const _internal = { composePlayerPrompt: compose };',
          'export default function createPlaybookRuntime() {',
          '  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };',
          '}',
          '',
        ].join('\n'),
      );
      const { path, diagnostics } = await emitPromptContractTest({
        artifactDir,
        basename: 'code',
      });
      expect(diagnostics).toEqual([]);
      const content = await readFile(path, 'utf8');
      expect(content).toContain('checkPromptComposition');
      expect(content).toContain(
        'import * as playbook from "./code.playbook.ts"',
      );
      expect(content).toContain('"<audience>"');
      expect(content).toContain('const SUBSTITUTED =');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('degrades to the FSM-only variant with a diagnostic when the composer is absent', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-pc-nocomp-'));
    try {
      await writeFile(join(artifactDir, 'code.fsm.ts'), fsmFixture);
      await writeFile(
        join(artifactDir, 'code.playbook.ts'),
        'export default function createPlaybookRuntime() {\n  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };\n}\n',
      );
      const { diagnostics } = await emitPromptContractTest({
        artifactDir,
        basename: 'code',
      });
      expect(diagnostics.join('\n')).toMatch(
        /no _internal\.composePlayerPrompt/,
      );
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
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
    expect(emitted).toContain('import * as fsm from "./code.fsm.js"');
    expect(emitted).toContain(
      'import { checkGearsFsmConformance, findMachineConfig } from "@sublang/slc/verify"',
    );
    expect(emitted).toContain(
      'checkGearsFsmConformance(gears, findMachineConfig(fsm))',
    );
    expect(emitted).toContain('./code.gears.md');
    expect(emitted).toContain('SPDX-License-Identifier');
  });

  it('quotes legal basenames and module specifiers as parseable TypeScript', () => {
    const basename = "boss's flow";
    const fsmModule = `./${basename}.fsm.ts`;
    const verifyModule = "@sublang/slc/verify's-fixture";
    const generated = [
      generateGearsFsmConformanceTest({
        basename,
        fsmModule,
        gearsFile: `./${basename}.gears.md`,
        verifyModule,
      }),
      generateFsmIntrospectionTest({
        basename,
        fsmModule,
        verifyModule,
        pins: pinIntrospection(introspectableConfig()),
      }),
      generatePromptContractTest({
        basename,
        fsmModule,
        verifyModule,
        rows: [],
        composer: {
          playbookModule: `./${basename}.playbook.ts`,
          substituted: {},
        },
      }),
    ];

    for (const source of generated) {
      const result = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        reportDiagnostics: true,
      });
      expect(result.diagnostics ?? []).toEqual([]);
    }
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
      expect(content).toContain('from "@sublang/slc/verify"');
      // The emitted test imports the `.fsm.ts` artifact the run wrote.
      expect(content).toContain('import * as fsm from "./code.fsm.ts"');
      expect(content).toContain('./code.gears.md');
      expect(content).toContain(
        'checkGearsFsmConformance(gears, findMachineConfig(fsm))',
      );
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});

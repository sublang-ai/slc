// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { defaultComposePlayerPrompt } from '../node_modules/@sublang/playbook/src/xstate-playbook-runtime.js';

import {
  CONTROLLER_ACTION_GUARDS,
  CONTINUATION_PREAMBLE,
  artifactSchemaForPlaybookProvenance,
  capturePromptContract,
  checkGearsFsmConformance,
  checkPromptComposition,
  deriveSubstitutions,
  emitFsmIntrospectionTest,
  emitGearsFsmConformanceTest,
  emitPromptContractTest,
  enumerateCaptainStates,
  enumeratePlaybookStates,
  findConcurrentRoleSets,
  findMachineConfig,
  generateFsmIntrospectionTest,
  generateGearsFsmConformanceTest,
  generatePromptContractTest,
  inspectGearsRoleContract,
  isControllerDecisionResult,
  isControllerMachine,
  normalizeArms,
  parseGearsItems,
  pinIntrospection,
  placeholdersIn,
  playbookProvenanceForLinkTarget,
  probeContextReads,
  resolveArtifactSchemaForVerification,
  type MachineConfigLike,
} from '../src/verify.js';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('standalone artifact review entry', () => {
  it('recognizes a symlinked script path as the CLI main module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-review-entry-'));
    try {
      const script = join(root, 'verify-artifacts.mjs');
      await symlink(join(repoRoot, 'scripts', 'verify-artifacts.mjs'), script);

      await expect(
        execFileAsync(process.execPath, [script]),
      ).rejects.toMatchObject({
        code: 2,
        stderr: expect.stringContaining(
          'usage: node scripts/verify-artifacts.mjs',
        ),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('reviewed Playbook artifact schemas', () => {
  it.each([
    ['@sublang/playbook@0.10.0', 1],
    ['@sublang/playbook@1.0.0', 1],
    ['@sublang/playbook@2.0.0', 1],
    ['@sublang/playbook@3.1.0', 1],
    ['@sublang/playbook@4.0.0', 1],
    ['@sublang/playbook@10.0.0', 3],
  ] as const)(
    'maps exact reviewed provenance %s to schema %s',
    (value, schema) => {
      expect(artifactSchemaForPlaybookProvenance(value)).toBe(schema);
    },
  );

  it.each([
    undefined,
    '@sublang/playbook@0.9.0',
    '@sublang/playbook@4',
    '@sublang/playbook@5.0.0',
    '@sublang/playbook@9.0.0',
    '@sublang/playbook@10.0.1',
  ])('leaves unsupported provenance %s unmapped', (value) => {
    expect(artifactSchemaForPlaybookProvenance(value)).toBeUndefined();
  });

  it('reads provenance from the package that owns the concrete link target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-link-provenance-'));
    try {
      const packageRoot = join(root, 'node_modules', '@sublang', 'playbook');
      const linkTarget = join(packageRoot, 'src', 'runtime.ts');
      await mkdir(join(packageRoot, 'src'), { recursive: true });
      await writeFile(
        join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@sublang/playbook', version: '10.0.0' }),
      );
      await writeFile(linkTarget, 'export {}\n');

      expect(await playbookProvenanceForLinkTarget(linkTarget)).toBe(
        '@sublang/playbook@10.0.0',
      );

      const localTarget = join(root, 'local', 'runtime.ts');
      await mkdir(join(root, 'local'));
      await writeFile(
        join(root, 'local', 'package.json'),
        JSON.stringify({ name: 'local-runtime', version: '10.0.0' }),
      );
      await writeFile(localTarget, 'export {}\n');
      expect(
        await playbookProvenanceForLinkTarget(localTarget),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires strong schema signals to agree and otherwise preserves compat-less schema 1', () => {
    const schema3Factory = (): object => ({});
    Object.defineProperty(schema3Factory, 'compat', {
      value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),
      enumerable: true,
      writable: false,
      configurable: false,
    });

    expect(
      resolveArtifactSchemaForVerification({
        linked: { default: () => ({}) },
      }),
    ).toEqual({ artifactSchema: 1, findings: [] });
    expect(
      resolveArtifactSchemaForVerification({
        provenance: '@sublang/playbook@10.0.0',
        linked: { default: schema3Factory },
      }),
    ).toEqual({ artifactSchema: 3, findings: [] });

    const conflict = resolveArtifactSchemaForVerification({
      provenance: '@sublang/playbook@4.0.0',
      linked: { default: schema3Factory },
    });
    expect(conflict.artifactSchema).toBeUndefined();
    expect(conflict.findings.join('\n')).toMatch(
      /schema signals disagree.*provenance: 1.*compatibility: 3/,
    );
    const malformedFactory = (): object => ({});
    Object.defineProperty(malformedFactory, 'compat', {
      value: { artifactSchema: 3, runtimeAbi: 1 },
      enumerable: true,
      writable: false,
      configurable: false,
    });
    const malformedWithConflict = resolveArtifactSchemaForVerification({
      provenance: '@sublang/playbook@4.0.0',
      config: {
        states: {
          role: {
            invoke: {
              src: 'player',
              input: () => ({
                sourceItem: 'ROLE-1',
                role: 'coder',
                prompt: 'Code.',
                result: { done: 'Done.' },
              }),
            },
          },
        },
      },
      linked: { default: malformedFactory },
    });
    expect(malformedWithConflict.artifactSchema).toBeUndefined();
    expect(malformedWithConflict.findings).toEqual([
      'linked factory has an own compatibility declaration that is not exact immutable schema 3/runtime ABI 1',
    ]);
    const unsupported = resolveArtifactSchemaForVerification({
      provenance: '@sublang/playbook@5.0.0',
      linked: { default: () => ({}) },
    });
    expect(unsupported.artifactSchema).toBeUndefined();
    expect(unsupported.findings.join('\n')).toMatch(
      /unsupported link-target provenance.*5\.0\.0/,
    );
    expect(resolveArtifactSchemaForVerification({})).toEqual({
      findings: [],
    });
    const ambiguousCaptain = resolveArtifactSchemaForVerification({
      config: {
        states: {
          acting: {
            invoke: {
              src: 'captain',
              input: () => ({
                sourceItem: 'CAPTAIN-1',
                prompt: 'Decide.',
                result: { needsBossReply: 'Need Boss.' },
              }),
            },
          },
        },
      },
    });
    expect(ambiguousCaptain.artifactSchema).toBeUndefined();
    expect(ambiguousCaptain.findings.join('\n')).toMatch(
      /no reviewed provenance.*callable linked factory.*direct-Captain continuation/,
    );
  });

  it.each([
    [
      'role and historical player',
      {
        states: {
          role: {
            invoke: {
              src: 'player',
              input: () => ({
                sourceItem: 'ROLE-1',
                role: 'coder',
                prompt: 'Code.',
                result: { done: 'Done.' },
              }),
            },
          },
          player: {
            invoke: {
              src: 'player',
              input: () => ({
                sourceItem: 'PLAYER-1',
                player: 'Writer',
                prompt: 'Write.',
                result: { done: 'Done.' },
              }),
            },
          },
        },
      },
    ],
    [
      'controller and historical player',
      {
        states: {
          controller: {
            invoke: {
              src: 'captain',
              input: () => ({
                sourceItem: 'CONTROLLER-1',
                prompt: 'Choose.',
                result: Object.fromEntries(
                  CONTROLLER_ACTION_GUARDS.map((guard) => [guard, guard]),
                ),
              }),
            },
          },
          player: {
            invoke: {
              src: 'player',
              input: () => ({
                sourceItem: 'PLAYER-1',
                player: 'Writer',
                prompt: 'Write.',
                result: { done: 'Done.' },
              }),
            },
          },
        },
      },
    ],
  ] as const)(
    'rejects mixed %s actor-generation evidence',
    (_label, config) => {
      const resolution = resolveArtifactSchemaForVerification({
        config,
        linked: { default: () => ({}) },
      });
      expect(resolution.artifactSchema).toBeUndefined();
      expect(resolution.findings.join('\n')).toMatch(
        /schema signals disagree.*historical-player structure: 1.*role\/controller structure: 3/,
      );
    },
  );
});

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

const structuredGears = `## Behaviors

### FLOW-1
Parallel group: initial-proposals

When Boss starts a flow, Captain shall prompt Host:
> Propose independently for <topic>.

### FLOW-2
Parallel group: initial-proposals

When Boss starts a flow, Captain shall prompt Participant:
> Challenge independently for <topic>.

### FLOW-3

When both proposals complete, Captain shall call playbook \`code-review\`:
> Review these changes:
> <changes>
`;

const dynamicGears = `## Behaviors

### CAPTAIN-2

When Captain selects a next call, Captain shall call playbook selected by \`nextPlaybookId\`:
> <nextPlaybookInput>
`;

const dynamicConfig = (): MachineConfigLike => ({
  states: {
    callNext: {
      invoke: {
        src: 'playbook',
        input: ({ context }) => ({
          stateId: 'callNext',
          sourceItem: 'CAPTAIN-2',
          playbookId: context.nextPlaybookId,
          text: context.nextPlaybookInput,
          playbookIdContext: 'nextPlaybookId',
          textContext: 'nextPlaybookInput',
        }),
      },
    },
  },
});

const directGears = `## Behaviors

### DIRECT-1

When Boss asks for a short answer, Captain shall answer directly:
> Answer <question> concisely.
`;

const directConfig = (): MachineConfigLike => ({
  states: {
    answer: {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'answer',
          sourceItem: 'DIRECT-1',
          prompt: 'Answer <question> concisely.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    },
  },
});

const scriptGears = `## Behaviors

### SETUP-1

当工作流启动时，Captain shall run:
> git rev-parse --is-inside-work-tree 2>/dev/null || git init

Results:
- \`ok\`: The command exited with status zero.
- \`failed\`: The command exited with a nonzero status.
`;

const scriptConfig = (
  overrides: Partial<{
    command: string;
    result: Record<string, string>;
    src: string;
  }> = {},
): MachineConfigLike => ({
  states: {
    setupRepo: {
      invoke: {
        src: overrides.src ?? 'script',
        input: () => ({
          stateId: 'setupRepo',
          sourceItem: 'SETUP-1',
          ...(overrides.src === undefined || overrides.src === 'script'
            ? {
                command:
                  overrides.command ??
                  'git rev-parse --is-inside-work-tree 2>/dev/null || git init',
              }
            : {
                prompt:
                  'git rev-parse --is-inside-work-tree 2>/dev/null || git init',
              }),
          result: overrides.result ?? {
            ok: 'The command exited with status zero.',
            failed: 'The command exited with a nonzero status.',
          },
        }),
      },
    },
  },
});

const resultGears = `## Behaviors

### ROUTE-1

When Boss supplies an intent, Captain shall choose the next route:
> Decide whether one material routing question is needed or select a playbook.

Results:
- \`question\`: Captain needs one material routing answer from Boss.
- \`delegation\`: Captain selected a playbook and supplied its call input.
`;

const resultConfig = (
  result: Record<string, string> = {
    question: 'Captain needs one material routing answer from Boss.',
    delegation: 'Captain selected a playbook and supplied its call input.',
  },
): MachineConfigLike => ({
  states: {
    route: {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'route',
          sourceItem: 'ROUTE-1',
          prompt:
            'Decide whether one material routing question is needed or select a playbook.',
          result: {
            ...result,
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
          },
        }),
      },
    },
  },
});

const structuredCaptainInput =
  (stateId: string, player: string, sourceItem: string, prompt: string) =>
  ({ context }: { context: Record<string, unknown> }) => ({
    stateId,
    player,
    sourceItem,
    prompt,
    result: {
      done: 'The player finished.',
      needsBossReply: NEEDS_BOSS_REPLY_TEXT,
    },
    topic: context.topic,
  });

const stateIdentity = (stateId: string) => ({
  id: stateId,
  meta: { playbook: { stateId } },
});

const schema3Gears = `# Schema-3 fixture

Roles:

- Coder
- Reviewer

## Behaviors

### SCHEMA3-1
Parallel group: independent-review

When Boss starts the task, Captain shall prompt Coder:
> > Preserve this quoted context.
> Draft <topic> with <coder-llm>.

Results:
- \`done\`: Coder produced a draft.

### SCHEMA3-2
Parallel group: independent-review

When Boss starts the task, Captain shall prompt Reviewer:
> Review <topic> independently.

Results:
- \`done\`: Reviewer produced findings.

### SCHEMA3-3

When both roles finish, Captain shall summarize directly:
> Summarize <topic>.

Results:
- \`done\`: Captain produced the summary.
`;

const schema3Identity = (stateId: string, role?: string) => ({
  id: stateId,
  meta: { playbook: { stateId, ...(role === undefined ? {} : { role }) } },
});

const schema3PlayerInput =
  (
    stateId: string,
    role: string,
    sourceItem: string,
    prompt: string,
    description: string,
    stateKeyedContinuation = false,
  ) =>
  ({ context }: { context: Record<string, unknown> }) => {
    const keyedQuestions = context.pendingBossQuestions as
      | Record<string, unknown>
      | undefined;
    const keyedReplies = context.bossReplies as
      | Record<string, unknown>
      | undefined;
    return {
      stateId,
      role,
      sourceItem,
      prompt,
      result: {
        done: description,
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      },
      topic: context.topic,
      pendingBossQuestion: stateKeyedContinuation
        ? keyedQuestions?.[stateId]
        : context.pendingBossQuestion,
      bossReply: stateKeyedContinuation
        ? keyedReplies?.[stateId]
        : context.bossReply,
    };
  };

const schema3Config = (): MachineConfigLike => ({
  initial: 'ready',
  states: {
    ready: { ...schema3Identity('ready') },
    independentReview: {
      ...schema3Identity('independentReview'),
      type: 'parallel',
      onDone: { target: '#summarize' },
      states: {
        coderRegion: {
          ...schema3Identity('coderRegion'),
          initial: 'working',
          states: {
            working: {
              ...schema3Identity('coderWork', 'coder'),
              tags: 'playbook.busy',
              invoke: {
                src: 'player',
                input: schema3PlayerInput(
                  'coderWork',
                  'coder',
                  'SCHEMA3-1',
                  '> Preserve this quoted context.\nDraft <topic> with <coder-llm>.',
                  'Coder produced a draft.',
                ),
                onDone: { target: 'complete' },
                onError: { target: '#failed' },
              },
            },
            complete: {
              ...schema3Identity('coderComplete'),
              type: 'final',
            },
          },
        },
        reviewerRegion: {
          ...schema3Identity('reviewerRegion'),
          initial: 'working',
          states: {
            working: {
              ...schema3Identity('reviewerWork', 'reviewer'),
              tags: 'playbook.busy',
              invoke: {
                src: 'player',
                input: schema3PlayerInput(
                  'reviewerWork',
                  'reviewer',
                  'SCHEMA3-2',
                  'Review <topic> independently.',
                  'Reviewer produced findings.',
                  true,
                ),
                onDone: { target: 'complete' },
                onError: { target: '#failed' },
              },
            },
            complete: {
              ...schema3Identity('reviewerComplete'),
              type: 'final',
            },
          },
        },
      },
    },
    summarize: {
      ...schema3Identity('summarize'),
      invoke: {
        src: 'captain',
        input: ({ context }) => ({
          stateId: 'summarize',
          sourceItem: 'SCHEMA3-3',
          prompt: 'Summarize <topic>.',
          result: {
            done: 'Captain produced the summary.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
          },
          topic: context.topic,
        }),
      },
    },
    failed: { ...schema3Identity('failed') },
    done: { ...schema3Identity('done'), type: 'final' },
  },
});

const controllerGears = `# Controller fixture

### CONTROL-1

Where this source declares the session-scoped controller policy, when Boss sends a turn, Captain shall decide directly:
> Select exactly one controller action.

Results:
- \`respond\`: Reply without an engagement action.
- \`resume\`: Resume a retained generation.
- \`start\`: Start a fresh engagement.
- \`switch\`: Switch to another engagement.
- \`dismiss\`: Dismiss the current engagement.
- \`deliver\`: Deliver the retained result.
- \`runtime\`: Apply a runtime control action.
`;

const controllerConfig = (): MachineConfigLike => ({
  states: {
    decide: {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'decide',
          sourceItem: 'CONTROL-1',
          prompt: 'Select exactly one controller action.',
          result: {
            respond: 'Reply without an engagement action.',
            resume: 'Resume a retained generation.',
            start: 'Start a fresh engagement.',
            switch: 'Switch to another engagement.',
            dismiss: 'Dismiss the current engagement.',
            deliver: 'Deliver the retained result.',
            runtime: 'Apply a runtime control action.',
          },
        }),
      },
    },
  },
});

const structuredConfig = (): MachineConfigLike => ({
  initial: 'ready',
  states: {
    ready: { ...stateIdentity('ready') },
    proposalRound: {
      ...stateIdentity('proposalRound'),
      type: 'parallel',
      onDone: { target: '#reviewCall' },
      states: {
        host: {
          ...stateIdentity('hostBranch'),
          initial: 'working',
          states: {
            working: {
              ...stateIdentity('askHost'),
              tags: 'playbook.busy',
              invoke: [
                { src: 'observer' },
                {
                  src: 'captain',
                  input: structuredCaptainInput(
                    'askHost',
                    'Host',
                    'FLOW-1',
                    'Propose independently for <topic>.',
                  ),
                  onDone: { target: 'complete' },
                  onError: { target: '#failed' },
                },
              ],
            },
            complete: {
              ...stateIdentity('hostComplete'),
              type: 'final',
            },
          },
        },
        participant: {
          ...stateIdentity('participantBranch'),
          initial: 'working',
          states: {
            working: {
              ...stateIdentity('askParticipant'),
              tags: ['playbook.busy'],
              invoke: {
                src: 'captain',
                input: structuredCaptainInput(
                  'askParticipant',
                  'Participant',
                  'FLOW-2',
                  'Challenge independently for <topic>.',
                ),
                onDone: { target: 'complete' },
                onError: { target: '#failed' },
              },
            },
            complete: {
              ...stateIdentity('participantComplete'),
              type: 'final',
            },
          },
        },
      },
    },
    reviewCall: {
      ...stateIdentity('reviewCall'),
      tags: 'playbook.suspended',
      invoke: [
        { src: 'observer' },
        {
          src: 'playbook',
          input: () => ({
            stateId: 'reviewCall',
            playbookId: 'code-review',
            text: 'Review these changes:\n<changes>',
          }),
          onDone: { target: '#done' },
          onError: { target: '#failed' },
        },
      ],
    },
    failed: { ...stateIdentity('failed') },
    done: { ...stateIdentity('done'), type: 'final' },
  },
  on: {
    BOSS_INTERRUPT: [
      { target: '#askHost', guard: () => true },
      { target: '#askParticipant', guard: () => true },
      { target: '#reviewCall', guard: () => true },
    ],
  },
});

describe('parseGearsItems', () => {
  it('parses each item id, player, and verbatim prompt body', () => {
    expect(parseGearsItems(gears)).toEqual([
      {
        id: 'GREETER-1',
        actor: 'player',
        player: 'Writer',
        prompt: 'Draft a short hello message for <audience>.',
      },
      {
        id: 'GREETER-2',
        actor: 'player',
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
      {
        id: 'DOC-1',
        actor: 'player',
        player: '作者',
        prompt: '起草一段简短的问候。',
      },
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
        actor: 'captain',
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

  it('records a nested playbook target without changing the legacy item fields', () => {
    expect(parseGearsItems(structuredGears)[2]).toEqual({
      id: 'FLOW-3',
      player: 'Captain',
      prompt: 'Review these changes:\n<changes>',
      playbookId: 'code-review',
    });
  });

  it('records dynamic target and text context fields', () => {
    expect(parseGearsItems(dynamicGears)).toEqual([
      {
        id: 'CAPTAIN-2',
        player: 'Captain',
        prompt: '<nextPlaybookInput>',
        playbookIdContext: 'nextPlaybookId',
        textContext: 'nextPlaybookInput',
      },
    ]);
  });

  it('parses ordered Results metadata outside the acting prompt', () => {
    expect(parseGearsItems(resultGears)).toEqual([
      {
        id: 'ROUTE-1',
        actor: 'captain',
        player: 'Captain',
        prompt:
          'Decide whether one material routing question is needed or select a playbook.',
        result: {
          question: 'Captain needs one material routing answer from Boss.',
          delegation:
            'Captain selected a playbook and supplied its call input.',
        },
      },
    ]);
  });
});

describe('inspectGearsRoleContract', () => {
  it('derives canonical Roles and source-ordered concurrent role sets', () => {
    expect(inspectGearsRoleContract(schema3Gears)).toEqual({
      generation: 'schema-3',
      names: ['Coder', 'Reviewer'],
      roleIds: ['coder', 'reviewer'],
      concurrentRoleSets: [['coder', 'reviewer']],
      findings: [],
    });
  });

  it('rejects removed aliases and canonical role collisions', () => {
    const source = schema3Gears.replace(
      '- Coder\n- Reviewer',
      '- Coder = primary\n- Reviewer | reviewer-player\n- coder',
    );
    expect(inspectGearsRoleContract(source).findings.join('\n')).toMatch(
      /removed alias syntax[\s\S]*removed alias syntax[\s\S]*undeclared role "Reviewer"/,
    );

    const collision = schema3Gears.replace(
      '- Coder\n- Reviewer',
      '- Coder\n- coder\n- Reviewer',
    );
    expect(inspectGearsRoleContract(collision).findings.join('\n')).toMatch(
      /collide as canonical role "coder"/,
    );

    const invalid = schema3Gears.replace(
      '- Coder\n- Reviewer',
      '- Captain\n- Code Reviewer',
    );
    expect(inspectGearsRoleContract(invalid).findings.join('\n')).toMatch(
      /reserved local role "captain"[\s\S]*noncanonical local role "code reviewer"/,
    );

    // Playbook 10 admits non-English role names ("quote non-English names
    // (e.g., `作者`)"), and a script without case lowercases to itself, so a
    // Chinese name derives a canonical id and is accepted. The shipped Chinese
    // demo depends on this: an ASCII-only class would make it uncompilable.
    const nonAscii = schema3Gears.replace(
      '- Coder\n- Reviewer',
      '- 编码者\n- Reviewer',
    );
    const nonAsciiContract = inspectGearsRoleContract(nonAscii);
    expect(nonAsciiContract.findings.join('\n')).not.toMatch(
      /noncanonical local role/,
    );
    expect(nonAsciiContract.roleIds).toContain('编码者');

    // A name that is not canonical for a reason other than its script - here an
    // embedded separator - is still rejected.
    const spaced = schema3Gears.replace(
      '- Coder\n- Reviewer',
      '- Code Reviewer\n- Reviewer',
    );
    expect(inspectGearsRoleContract(spaced).findings.join('\n')).toMatch(
      /noncanonical local role "code reviewer"/,
    );

    const duplicateSet = `${schema3Gears}\n### SCHEMA3-4\nParallel group: duplicate-review\n\nCaptain shall prompt Coder:\n> Draft again.\n\n### SCHEMA3-5\nParallel group: duplicate-review\n\nCaptain shall prompt Reviewer:\n> Review again.\n`;
    expect(inspectGearsRoleContract(duplicateSet).findings.join('\n')).toMatch(
      /duplicate concurrent role set \["coder","reviewer"\]/,
    );
  });

  it('preserves historical quoted Players composites without treating aliases as bindings', () => {
    const historical = [
      'Players:',
      '',
      '- `编码者`',
      '- `提交者` = `编码者` | `审查者`',
      '',
    ].join('\n');
    expect(inspectGearsRoleContract(historical)).toEqual({
      generation: 'schema-1',
      names: ['编码者'],
      roleIds: ['编码者'],
      concurrentRoleSets: [],
      findings: [],
    });
  });

  it('detects duplicate concurrent sets regardless of source member order', () => {
    const reorderedDuplicate = `${schema3Gears}
### SCHEMA3-4

Parallel group: duplicate-review

Captain shall prompt Reviewer:
> Review again.

### SCHEMA3-5

Parallel group: duplicate-review

Captain shall prompt Coder:
> Draft again.
`;
    expect(
      inspectGearsRoleContract(reorderedDuplicate).findings.join('\n'),
    ).toMatch(/duplicate concurrent role set \["coder","reviewer"\]/);
  });
});

describe('controller machine discrimination', () => {
  const result = Object.fromEntries(
    CONTROLLER_ACTION_GUARDS.map((guard) => [guard, `${guard} action`]),
  );

  it('recognizes only the exact Playbook 10 decision-result guard set', () => {
    expect(isControllerDecisionResult(result)).toBe(true);
    expect(
      isControllerDecisionResult({
        ...result,
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      }),
    ).toBe(true);
    expect(
      isControllerDecisionResult({ ...result, unexpected: 'extra action' }),
    ).toBe(false);
    const missing = { ...result };
    delete missing.runtime;
    expect(isControllerDecisionResult(missing)).toBe(false);
    expect(isControllerDecisionResult({ ...result, runtime: 1 })).toBe(false);
  });

  it('grounds controller identity in an explicit Captain decision state', () => {
    expect(isControllerMachine(controllerConfig())).toBe(true);
    const ordinary = controllerConfig();
    const decide = ordinary.states!.decide as {
      invoke: { input: () => Record<string, unknown> };
    };
    decide.invoke.input = () => ({
      stateId: 'decide',
      sourceItem: 'CONTROL-1',
      prompt: 'This prose mentions session-scoped controller policy.',
      result: { respond: 'ordinary result' },
    });
    expect(isControllerMachine(ordinary)).toBe(false);

    const malformedSuperset = controllerConfig();
    const malformedDecision = malformedSuperset.states!.decide as {
      invoke: { input: () => Record<string, unknown> };
    };
    malformedDecision.invoke.input = () => ({
      stateId: 'decide',
      sourceItem: 'CONTROL-1',
      prompt: 'Choose the controller action.',
      result: { ...result, unexpected: 1 },
    });
    expect(isControllerMachine(malformedSuperset)).toBe(false);
  });

  it('retains controller identity while diagnosing an invented Boss wait', () => {
    const drifted = controllerConfig();
    const decision = drifted.states!.decide as {
      invoke: { input: () => Record<string, unknown> };
    };
    const input = decision.invoke.input();
    decision.invoke.input = () => ({
      ...input,
      result: {
        ...(input.result as Record<string, string>),
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      },
    });
    expect(isControllerMachine(drifted)).toBe(true);
  });
});

describe('enumerateCaptainStates', () => {
  it('recovers captain states and skips non-invoking states', () => {
    const states = enumerateCaptainStates(conformantConfig());
    expect(states.map((s) => s.stateId)).toEqual(['draft', 'review']);
    expect(states[0]).toEqual({
      stateId: 'draft',
      sourceItem: 'GREETER-1',
      actor: 'player',
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

  it('walks nested states and normalizes object and array invokes', () => {
    const captains = enumerateCaptainStates(structuredConfig());
    expect(captains.map(({ stateId }) => stateId)).toEqual([
      'askHost',
      'askParticipant',
    ]);
    expect(captains.map(({ statePath }) => statePath)).toEqual([
      'proposalRound.host.working',
      'proposalRound.participant.working',
    ]);

    expect(enumeratePlaybookStates(structuredConfig())).toEqual([
      {
        stateId: 'reviewCall',
        playbookId: 'code-review',
        text: 'Review these changes:\n<changes>',
      },
    ]);
  });

  it('distinguishes direct, delegated, legacy, and playbook actors', () => {
    const config: MachineConfigLike = {
      states: {
        legacyWork: {
          invoke: {
            src: { type: 'captain' },
            input: () => ({
              stateId: 'legacyWork',
              sourceItem: 'FLOW-1',
              player: 'Host',
              prompt: 'Propose independently for <topic>.',
              result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
            }),
          },
        },
        directWork: {
          invoke: {
            src: { type: 'captain' },
            input: () => ({
              stateId: 'directWork',
              sourceItem: 'DIRECT-1',
              prompt: 'Answer <question> concisely.',
              result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
            }),
          },
        },
        delegatedWork: {
          invoke: {
            src: { type: 'player' },
            input: () => ({
              stateId: 'delegatedWork',
              sourceItem: 'FLOW-2',
              player: 'Participant',
              prompt: 'Challenge independently for <topic>.',
              result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
            }),
          },
        },
        childWork: {
          invoke: {
            src: { type: 'playbook' },
            input: () => ({
              stateId: 'childWork',
              playbookId: 'code-review',
              text: 'Review these changes:\n<changes>',
            }),
          },
        },
      },
    };

    expect(
      enumerateCaptainStates(config).map(({ stateId, actor, player }) => ({
        stateId,
        actor,
        player,
      })),
    ).toEqual([
      { stateId: 'legacyWork', actor: 'player', player: 'Host' },
      { stateId: 'directWork', actor: 'captain', player: '' },
      {
        stateId: 'delegatedWork',
        actor: 'player',
        player: 'Participant',
      },
    ]);
    expect(enumeratePlaybookStates(config)).toHaveLength(1);
    expect(pinIntrospection(config).captain.map(({ actor }) => actor)).toEqual([
      undefined,
      'captain',
      'player',
    ]);
  });

  it('introspects dynamic playbook metadata and pins no runtime value', () => {
    expect(enumeratePlaybookStates(dynamicConfig())).toEqual([
      {
        stateId: 'callNext',
        sourceItem: 'CAPTAIN-2',
        playbookId: '',
        text: '',
        playbookIdContext: 'nextPlaybookId',
        textContext: 'nextPlaybookInput',
      },
    ]);
    expect(pinIntrospection(dynamicConfig()).playbook).toEqual([
      {
        state: 'callNext',
        sourceItem: 'CAPTAIN-2',
        playbookIdContext: 'nextPlaybookId',
        textContext: 'nextPlaybookInput',
        onDone: [],
        onError: [],
        on: {},
      },
    ]);
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

  it('accepts direct Captain work without a player binding', () => {
    expect(checkGearsFsmConformance(directGears, directConfig())).toEqual([]);
  });

  it('validates schema-3 Roles and concurrent role sets', () => {
    expect(
      checkGearsFsmConformance(schema3Gears, schema3Config(), {
        concurrentRoleSets: [['coder', 'reviewer']],
      }),
    ).toEqual([]);

    expect(pinIntrospection(schema3Config()).captain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'coderWork',
          actor: 'player',
          player: '',
          role: 'coder',
        }),
      ]),
    );
  });

  it('rejects schema-3 role metadata and concurrent-set drift', () => {
    const config = schema3Config();
    config.states!.independentReview.states!.coderRegion.states!.working.meta =
      {
        playbook: { stateId: 'coderWork', role: 'reviewer' },
      };
    const findings = checkGearsFsmConformance(schema3Gears, config, {
      concurrentRoleSets: [['reviewer', 'coder']],
    }).join('\n');
    expect(findings).toMatch(/meta\.playbook\.role "reviewer" does not match/);
    expect(findings).toMatch(/concurrentRoleSets.*do not match GEARS groups/);
  });

  it('rejects a historical player binding substituted for a schema-3 role', () => {
    const config = schema3Config();
    const working = config.states!.independentReview.states!.coderRegion.states!
      .working as {
      meta: { playbook: { stateId: string; role?: string } };
      invoke: {
        input: (args: {
          context: Record<string, unknown>;
        }) => Record<string, unknown>;
      };
    };
    delete working.meta.playbook.role;
    const roleInput = working.invoke.input;
    working.invoke.input = ({ context }) => {
      const input = { ...roleInput({ context }) };
      delete input.role;
      return { ...input, player: 'Coder' };
    };

    const findings = checkGearsFsmConformance(schema3Gears, config, {
      concurrentRoleSets: [['coder', 'reviewer']],
    }).join('\n');
    expect(findings).toMatch(/FSM role "" is not GEARS canonical role "coder"/);
    expect(findings).toMatch(
      /schema-3 delegated role carries removed invoke\.input\.player "Coder"/,
    );
  });

  it('rejects a schema-3 role invoked through the Captain actor', () => {
    const config = schema3Config();
    const working = config.states!.independentReview.states!.coderRegion.states!
      .working as { invoke: { src: string } };
    working.invoke.src = 'captain';

    expect(
      checkGearsFsmConformance(schema3Gears, config, {
        concurrentRoleSets: [['coder', 'reviewer']],
      }).join('\n'),
    ).toMatch(/schema-3 delegated work does not invoke the player actor/);
  });

  it('preserves historical schema-1 player bindings', () => {
    const historical = `# Historical fixture\n\nPlayers:\n\n- Writer\n\n${gears}`;
    expect(
      checkGearsFsmConformance(historical, conformantConfig(), {
        concurrentRoleSets: [['unrelated', 'schema3-only-export']],
      }),
    ).toEqual([]);
    const historicalState = enumerateCaptainStates(conformantConfig())[0];
    expect(historicalState).toMatchObject({ player: 'Writer' });
    expect(historicalState).not.toHaveProperty('role');
  });

  it('accepts a controller decision state without needsBossReply', () => {
    expect(
      checkGearsFsmConformance(controllerGears, controllerConfig()),
    ).toContain('schema-3 FSM exports no valid concurrentRoleSets array');
    expect(
      checkGearsFsmConformance(controllerGears, controllerConfig(), {
        concurrentRoleSets: [],
      }),
    ).toEqual([]);

    const drifted = controllerConfig();
    const decision = drifted.states!.decide as {
      invoke: { input: () => Record<string, unknown> };
    };
    const input = decision.invoke.input();
    decision.invoke.input = () => ({
      ...input,
      result: {
        ...(input.result as Record<string, string>),
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      },
    });
    expect(
      checkGearsFsmConformance(controllerGears, drifted).join('\n'),
    ).toMatch(/controller state decide unexpectedly declares needsBossReply/);
  });

  it.each([
    ['missing', false],
    ['extra', true],
  ] as const)(
    'reports a controller decision %s-key near-miss without requiring the ordinary wait key',
    (_label, extra) => {
      const config = controllerConfig();
      const decision = config.states!.decide as {
        invoke: { input: () => Record<string, unknown> };
      };
      const input = decision.invoke.input();
      const result = {
        ...(input.result as Record<string, string>),
        ...(extra ? { other: 'Invented action.' } : {}),
      };
      if (!extra) delete result.runtime;
      decision.invoke.input = () => ({ ...input, result });

      const findings = checkGearsFsmConformance(controllerGears, config, {
        concurrentRoleSets: [],
      });
      expect(findings).toContainEqual(
        expect.stringContaining(
          `controller decision contract near-miss (${extra ? 'extra "other"' : 'missing "runtime"'})`,
        ),
      );
      expect(findings).not.toContainEqual(
        expect.stringContaining('declares no needsBossReply result'),
      );
    },
  );

  it('scopes controller near-miss suppression to the malformed state', () => {
    const config = controllerConfig();
    const decision = config.states!.decide as {
      invoke: { input: () => Record<string, unknown> };
    };
    const input = decision.invoke.input();
    const result = { ...(input.result as Record<string, string>) };
    delete result.runtime;
    decision.invoke.input = () => ({ ...input, result });
    config.states!.ordinaryMissing = {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'ordinaryMissing',
          sourceItem: '',
          prompt: 'Perform ordinary work.',
          result: { done: 'The work is complete.' },
        }),
      },
    };
    config.states!.ordinaryMalformed = {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'ordinaryMalformed',
          sourceItem: '',
          prompt: 'Perform ordinary work.',
          result: {
            done: 'The work is complete.',
            needsBossReply: 'Ask Boss without the adjudicator contract.',
          },
        }),
      },
    };

    const findings = checkGearsFsmConformance(controllerGears, config, {
      concurrentRoleSets: [],
    });
    expect(findings).toContain(
      'FSM state ordinaryMissing declares no needsBossReply result',
    );
    expect(findings).toContainEqual(
      expect.stringContaining(
        'FSM state ordinaryMalformed: needsBossReply description lacks',
      ),
    );
    expect(findings).not.toContain(
      'FSM state decide declares no needsBossReply result',
    );
  });

  it('requires the schema-3 concurrent-role export even when no group is declared', () => {
    expect(checkGearsFsmConformance(schema3Gears, schema3Config())).toContain(
      'schema-3 FSM exports no valid concurrentRoleSets array',
    );

    const sequentialRoles = schema3Gears.replaceAll(
      'Parallel group: independent-review\n',
      '',
    );
    expect(
      checkGearsFsmConformance(sequentialRoles, schema3Config()),
    ).toContain('schema-3 FSM exports no valid concurrentRoleSets array');
    expect(
      checkGearsFsmConformance(sequentialRoles, schema3Config(), {
        concurrentRoleSets: [],
      }),
    ).toEqual([]);
  });

  it('accepts a script item realized by a matching script state (verification-15, verification-17)', () => {
    expect(checkGearsFsmConformance(scriptGears, scriptConfig())).toEqual([]);
  });

  it('reports a drifted script command (verification-17)', () => {
    expect(
      checkGearsFsmConformance(
        scriptGears,
        scriptConfig({ command: 'git init' }),
      ).join('\n'),
    ).toMatch(/FSM script command is not the GEARS blockquote verbatim/);
  });

  it('reports reordered script guards and a needsBossReply on a script state (verification-17)', () => {
    expect(
      checkGearsFsmConformance(
        scriptGears,
        scriptConfig({
          result: {
            failed: 'The command exited with a nonzero status.',
            ok: 'The command exited with status zero.',
          },
        }),
      ).join('\n'),
    ).toMatch(/FSM script result contract .* is not GEARS Results/);
    expect(
      checkGearsFsmConformance(
        scriptGears,
        scriptConfig({
          result: {
            ok: 'The command exited with status zero.',
            failed: 'The command exited with a nonzero status.',
            needsBossReply: NEEDS_BOSS_REPLY_TEXT,
          },
        }),
      ).join('\n'),
    ).toMatch(/script/);
  });

  it('reports a script item realized by a captain state (verification-17)', () => {
    expect(
      checkGearsFsmConformance(
        scriptGears,
        scriptConfig({ src: 'captain' }),
      ).join('\n'),
    ).toMatch(/is not GEARS actor "script"|maps to no FSM script state/);
  });

  it('matches explicit ordered domain results apart from needsBossReply', () => {
    expect(checkGearsFsmConformance(resultGears, resultConfig())).toEqual([]);
  });

  it.each([
    [
      'missing',
      {
        question: 'Captain needs one material routing answer from Boss.',
      },
    ],
    [
      'extra',
      {
        question: 'Captain needs one material routing answer from Boss.',
        delegation: 'Captain selected a playbook and supplied its call input.',
        direct: 'Captain handled the routed work.',
      },
    ],
    [
      'reordered',
      {
        delegation: 'Captain selected a playbook and supplied its call input.',
        question: 'Captain needs one material routing answer from Boss.',
      },
    ],
    [
      'description-drifted',
      {
        question: 'Captain asked something.',
        delegation: 'Captain selected a playbook and supplied its call input.',
      },
    ],
  ])('rejects a %s FSM domain result contract', (_label, result) => {
    expect(
      checkGearsFsmConformance(resultGears, resultConfig(result)).join('\n'),
    ).toMatch(/FSM domain result contract .* is not GEARS Results/);
  });

  it.each([
    [
      'malformed',
      resultGears.replace(
        '- `question`: Captain needs one material routing answer from Boss.',
        '- question: Captain needs one material routing answer from Boss.',
      ),
      /malformed Results entry/,
    ],
    [
      'empty',
      resultGears.replace(
        '- `question`: Captain needs one material routing answer from Boss.\n- `delegation`: Captain selected a playbook and supplied its call input.',
        '',
      ),
      /Results block declares no valid entries/,
    ],
    [
      'duplicate',
      `${resultGears}- \`question\`: Duplicate.\n`,
      /duplicate Results guard question/,
    ],
    [
      'framework-owned',
      `${resultGears}- \`needsBossReply\`: Source tries to own it.\n`,
      /needsBossReply is compiler-owned/,
    ],
    [
      'misplaced',
      resultGears.replace('\nResults:\n', '\nIntervening prose.\n\nResults:\n'),
      /Results block shall immediately follow the acting blockquote/,
    ],
    [
      'near-miss label',
      resultGears.replace('\nResults:\n', '\nResults :\n'),
      /malformed Results label/,
    ],
  ])('reports %s source result metadata', (_label, source, finding) => {
    expect(checkGearsFsmConformance(source, resultConfig()).join('\n')).toMatch(
      finding,
    );
  });

  it('rejects Results metadata on a nested-playbook call item', () => {
    const source = `${dynamicGears}\nResults:\n- \`done\`: Child finished.\n`;
    expect(
      checkGearsFsmConformance(source, dynamicConfig()).join('\n'),
    ).toMatch(/nested-playbook call item shall not declare Results metadata/);
  });

  it('accepts new player actors and legacy captain-with-player actors', () => {
    const config = conformantConfig();
    const delegated = captain(
      'Writer',
      'GREETER-1',
      'Draft a short hello message for <audience>.',
    );
    config.states!.draft = {
      invoke: { ...delegated.invoke, src: 'player' },
    };

    expect(checkGearsFsmConformance(gears, config)).toEqual([]);
  });

  it('detects explicit direct and delegated actor-kind mismatches', () => {
    const directAsLegacyPlayer = directConfig();
    directAsLegacyPlayer.states!.answer = {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'answer',
          sourceItem: 'DIRECT-1',
          player: 'Captain',
          prompt: 'Answer <question> concisely.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    };
    // The published shape is intentionally non-authoritative during migration.
    expect(checkGearsFsmConformance(directGears, directAsLegacyPlayer)).toEqual(
      [],
    );

    const directAsPlayer = directConfig();
    directAsPlayer.states!.answer = {
      invoke: {
        src: 'player',
        input: () => ({
          stateId: 'answer',
          sourceItem: 'DIRECT-1',
          player: 'Captain',
          prompt: 'Answer <question> concisely.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    };
    expect(
      checkGearsFsmConformance(directGears, directAsPlayer).join('\n'),
    ).toMatch(/FSM actor "player" is not GEARS actor "captain"/);

    const delegatedAsDirect = conformantConfig();
    delegatedAsDirect.states!.draft = {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'draft',
          sourceItem: 'GREETER-1',
          prompt: 'Draft a short hello message for <audience>.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    };
    expect(
      checkGearsFsmConformance(gears, delegatedAsDirect).join('\n'),
    ).toMatch(/FSM actor "captain" is not GEARS actor "player"/);
  });

  it('requires a player only for delegated work', () => {
    const config = conformantConfig();
    config.states!.draft = {
      invoke: {
        src: 'player',
        input: () => ({
          stateId: 'draft',
          sourceItem: 'GREETER-1',
          prompt: 'Draft a short hello message for <audience>.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    };

    expect(checkGearsFsmConformance(gears, config).join('\n')).toMatch(
      /invoke\.input\.player is not a string/,
    );
    expect(checkGearsFsmConformance(directGears, directConfig())).toEqual([]);
  });

  it('maps nested parallel captain work and a playbook actor', () => {
    expect(
      checkGearsFsmConformance(structuredGears, structuredConfig()),
    ).toEqual([]);
  });

  it('matches a dynamic GEARS call through metadata and sentinel wiring', () => {
    expect(checkGearsFsmConformance(dynamicGears, dynamicConfig())).toEqual([]);
  });

  it('rejects drifted dynamic-call metadata without inspecting source', () => {
    const config = dynamicConfig();
    config.states!.callNext.invoke = {
      src: 'playbook',
      input: ({ context }) => ({
        stateId: 'callNext',
        sourceItem: 'CAPTAIN-2',
        playbookId: context.otherPlaybookId,
        text: context.otherInput,
        playbookIdContext: 'otherPlaybookId',
        textContext: 'otherInput',
      }),
    };

    const findings = checkGearsFsmConformance(dynamicGears, config).join('\n');
    expect(findings).toMatch(
      /FSM playbookIdContext "otherPlaybookId" is not GEARS context "nextPlaybookId"/,
    );
    expect(findings).toMatch(
      /FSM textContext "otherInput" is not GEARS context "nextPlaybookInput"/,
    );
  });

  it('rejects dynamic runtime values not wired from the named fields', () => {
    const config = dynamicConfig();
    config.states!.callNext.invoke = {
      src: 'playbook',
      input: () => ({
        stateId: 'callNext',
        sourceItem: 'CAPTAIN-2',
        playbookId: 'hard-coded',
        text: 'hard-coded',
        playbookIdContext: 'nextPlaybookId',
        textContext: 'nextPlaybookInput',
      }),
    };

    const findings = checkGearsFsmConformance(dynamicGears, config).join('\n');
    expect(findings).toMatch(
      /invoke\.input\.playbookId is not wired from context\.nextPlaybookId/,
    );
    expect(findings).toMatch(
      /invoke\.input\.text is not wired from context\.nextPlaybookInput/,
    );
  });

  it('detects a drifted nested-playbook target and child-input body', () => {
    const config = structuredConfig();
    config.states!.reviewCall.invoke = {
      src: 'playbook',
      input: () => ({
        stateId: 'reviewCall',
        sourceItem: 'FLOW-3',
        playbookId: 'security-review',
        text: 'Review something else.',
      }),
    };

    const findings = checkGearsFsmConformance(structuredGears, config).join(
      '\n',
    );
    expect(findings).toMatch(/FSM playbook "security-review"/);
    expect(findings).toMatch(
      /FSM playbook text is not the GEARS prompt verbatim/,
    );
  });

  it('rejects invocation state ids that disagree with public stable state ids', () => {
    const config = conformantConfig();
    config.states!.draft = {
      id: 'actualDraft',
      meta: { playbook: { stateId: 'publicDraft' } },
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'wrongDraft',
          sourceItem: 'GREETER-1',
          player: 'Writer',
          prompt: 'Draft a short hello message for <audience>.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
    };
    config.states!.childCall = {
      id: 'actualChildCall',
      invoke: {
        src: 'playbook',
        input: () => ({
          stateId: 'wrongChildCall',
          playbookId: 'code-review',
          text: 'Review these changes:\n<changes>',
        }),
      },
    };

    const combinedGears = `${gears}\n### GREETER-3\n\nCaptain shall call playbook \`code-review\`:\n> Review these changes:\n> <changes>\n`;
    const findings = checkGearsFsmConformance(combinedGears, config).join('\n');
    expect(findings).toMatch(
      /stateId "wrongDraft" does not match state\.id "actualDraft"/,
    );
    expect(findings).toMatch(
      /stateId "wrongDraft" does not match state\.meta\.playbook\.stateId "publicDraft"/,
    );
    expect(findings).toMatch(
      /stateId "wrongChildCall" does not match state\.id "actualChildCall"/,
    );
  });

  it('validates and pins every structured state public identity', () => {
    const config = structuredConfig();
    const pinned = pinIntrospection(config);
    config.states!.ready.meta = undefined;
    config.states!.proposalRound.states!.host.states!.working.meta = {
      playbook: { stateId: 'driftedHost' },
    };

    const findings = checkGearsFsmConformance(structuredGears, config).join(
      '\n',
    );
    expect(findings).toMatch(
      /structured state ready: state\.meta\.playbook\.stateId is not a non-empty string/,
    );
    expect(findings).toMatch(
      /structured state proposalRound\.host\.working: state\.meta\.playbook\.stateId "driftedHost" does not match state\.id "askHost"/,
    );
    expect(pinIntrospection(config)).not.toEqual(pinned);
  });

  it('rejects actor work declared on a compound state instead of a leaf', () => {
    const config = conformantConfig();
    config.states!.compoundWork = {
      invoke: {
        src: 'captain',
        input: () => ({
          sourceItem: 'GREETER-1',
          player: 'Writer',
          prompt: 'Draft a short hello message for <audience>.',
          result: { needsBossReply: NEEDS_BOSS_REPLY_TEXT },
        }),
      },
      states: { child: {} },
    };

    expect(checkGearsFsmConformance(gears, config).join('\n')).toMatch(
      /captain invocation is declared on a compound state instead of a leaf/,
    );
  });

  it('rejects one playbook actor reused by identical GEARS call items', () => {
    const duplicateCalls = `${structuredGears}\n### FLOW-4\n\nCaptain shall call playbook \`code-review\`:\n> Review these changes:\n> <changes>\n`;
    const findings = checkGearsFsmConformance(
      duplicateCalls,
      structuredConfig(),
    ).join('\n');
    expect(findings).toMatch(/GEARS item FLOW-4 maps to no FSM playbook state/);
  });

  it('pairs equal duplicate playbook calls deterministically by cardinality', () => {
    const duplicateCalls = `${structuredGears}\n### FLOW-4\n\nCaptain shall call playbook \`code-review\`:\n> Review these changes:\n> <changes>\n`;
    const config = structuredConfig();
    config.states!.secondReviewCall = {
      ...stateIdentity('secondReviewCall'),
      tags: 'playbook.suspended',
      invoke: {
        src: 'playbook',
        input: () => ({
          stateId: 'secondReviewCall',
          playbookId: 'code-review',
          text: 'Review these changes:\n<changes>',
        }),
        onDone: { target: '#done' },
        onError: { target: '#failed' },
      },
    };

    expect(checkGearsFsmConformance(duplicateCalls, config)).toEqual([]);
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

  it('detects a state with no needsBossReply result (verification-3)', () => {
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

  it('detects a needsBossReply description missing the question contract (verification-3)', () => {
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
// model DR-009's verification contract and exercise the generator against the
// reference artifacts. The installed @sublang/playbook ships them.
describe('conformance against the reference artifacts', () => {
  it('finds nothing on the reference code.gears.md + code.fsm', async () => {
    const referenceGears = readFileSync(
      join(referenceDir, 'code.gears.md'),
      'utf8',
    );
    // Playbook 10's reference is a schema-3 `Roles` workflow: two delegated
    // Coder phases (CODE-1, CODE-3) each followed by a literal nested `review`
    // call (CODE-2, CODE-4).
    const items = parseGearsItems(referenceGears);
    expect(items.map((item) => item.id)).toEqual([
      'CODE-1',
      'CODE-2',
      'CODE-3',
      'CODE-4',
    ]);
    expect(inspectGearsRoleContract(referenceGears)).toMatchObject({
      generation: 'schema-3',
      roleIds: ['coder'],
      concurrentRoleSets: [],
      findings: [],
    });
    const fsm = await referenceFsm();
    // Playbook 10.0.0's shipped reference does not satisfy its own gears2fsm
    // definition, which requires that "the artifact shall export
    // `concurrentRoleSets` as a deeply readonly array"; `code.fsm.ts` declares
    // role `coder` yet exports no such array, and the two nested `review` calls
    // do not carry their GEARS prompt verbatim. The conformance checker is
    // correct to report all three, and every artifact this repository compiles
    // exports `concurrentRoleSets` and passes cleanly. Pinning the exact
    // findings keeps the checker honest about upstream while making any change
    // in either the checker or a later Playbook release visible here.
    expect(
      checkGearsFsmConformance(referenceGears, findMachineConfig(fsm), {
        artifactSchema: 3,
        concurrentRoleSets: findConcurrentRoleSets(fsm),
      }),
    ).toEqual([
      'schema-3 FSM exports no valid concurrentRoleSets array',
      'CODE-2: FSM playbook text is not the GEARS prompt verbatim',
      'CODE-4: FSM playbook text is not the GEARS prompt verbatim',
    ]);
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
// the `gears2fsm` shape the introspection pins (verification-4).
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

describe('pinIntrospection (verification-4)', () => {
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
    expect(Object.keys(pins)).toEqual([
      'initial',
      'captain',
      'quiescent',
      'rootOn',
      'interruptTargets',
    ]);
  });

  it('adds recursive topology and playbook bindings only for a structured machine', () => {
    const pins = pinIntrospection(structuredConfig());
    expect(pins.captain.map(({ state, path }) => ({ state, path }))).toEqual([
      { state: 'askHost', path: 'proposalRound.host.working' },
      {
        state: 'askParticipant',
        path: 'proposalRound.participant.working',
      },
    ]);
    expect(pins.playbook).toEqual([
      {
        state: 'reviewCall',
        playbookId: 'code-review',
        onDone: [{ index: 0, target: 'done', guarded: false }],
        onError: [{ index: 0, target: 'failed', guarded: false }],
        on: {},
      },
    ]);
    expect(
      pins.structured?.states.find(({ path }) => path === 'proposalRound'),
    ).toMatchObject({
      type: 'parallel',
      children: ['host', 'participant'],
      onDone: [{ index: 0, target: 'reviewCall', guarded: false }],
    });
    expect(
      pins.structured?.states.find(({ path }) => path === 'reviewCall'),
    ).toMatchObject({
      tags: ['playbook.suspended'],
      invokes: ['observer', 'playbook'],
    });
  });

  it('pins the reference machine: two delegated Coder phases and two review calls', async () => {
    const pins = pinIntrospection(findMachineConfig(await referenceFsm()));
    expect(pins.initial).toBe('ready');
    // Declaration order in the reference is not item order; coverage is a set.
    expect(pins.captain.map((state) => state.sourceItem).sort()).toEqual([
      'CODE-1',
      'CODE-3',
    ]);
    expect(pins.captain.map((state) => state.state)).toEqual([
      'runFirstPhase',
      'runIrTask',
    ]);
    // Schema-3 delegation binds the canonical local role, never a player.
    for (const state of pins.captain) {
      expect(state).toMatchObject({ actor: 'player', role: 'coder' });
      expect(state.player).toBe('');
    }
    // The nested calls are literal `review` targets carrying their items.
    expect(
      pins.playbook?.map(({ state, playbookId, sourceItem }) => ({
        state,
        playbookId,
        sourceItem,
      })),
    ).toEqual([
      {
        state: 'reviewFirstCommit',
        playbookId: 'review',
        sourceItem: 'CODE-2',
      },
      { state: 'reviewIrTask', playbookId: 'review', sourceItem: 'CODE-4' },
    ]);
    // Playbook 10's `code` reference exposes no root interrupt surface; the
    // jumpable set belongs to the separate controller `captain` playbook.
    expect(pins.rootOn).toEqual({});
    expect(pins.interruptTargets).toEqual([]);
    expect(pins.quiescent.map((state) => state.state)).toEqual([
      'ready',
      'awaitBossReply',
      'failed',
      'reportedReviewFailure',
      'done',
    ]);
    expect(
      pins.quiescent.filter(({ final }) => final).map(({ state }) => state),
    ).toEqual(['reportedReviewFailure', 'done']);
    // Every acting state declares Boss-reply suspension and error wiring.
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
      expect(content).toContain('import * as fsm from "./code.fsm.js"');
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
      fsmModule: './greeter.fsm.js',
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

const directCaptainContract = (sourceItem: string, promptLines: string[]) => ({
  invoke: {
    src: 'captain',
    input: ({ context }: { context: Record<string, unknown> }) => ({
      stateId: 'route',
      sourceItem,
      prompt: promptLines.join('\n'),
      result: {
        done: 'The Captain finished.',
        needsBossReply: NEEDS_BOSS_REPLY_TEXT,
      },
      ...(context.pendingBossQuestion && context.bossReply
        ? {
            pendingBossQuestion: context.pendingBossQuestion,
            bossReply: context.bossReply,
          }
        : {}),
    }),
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

const composeSchema3Prompt = (
  raw: unknown,
  promptIdentity: (roleId: string) => string,
): string => {
  const input = raw as {
    prompt: string;
    topic?: string;
    pendingBossQuestion?: { question: string };
    bossReply?: string;
  };
  const blocks: string[] = [];
  if (input.pendingBossQuestion && input.bossReply) {
    blocks.push(
      CONTINUATION_PREAMBLE,
      `Boss question:\n${input.pendingBossQuestion.question}`,
      `Boss reply:\n${input.bossReply}`,
    );
  }
  let body = input.prompt;
  if (input.topic !== undefined) {
    body = body.replaceAll('<topic>', input.topic);
  }
  if (body.includes('<coder-llm>')) {
    body = body.replaceAll('<coder-llm>', promptIdentity('coder'));
  }
  blocks.push(body);
  return blocks.join('\n\n');
};

describe('prompt contract capture (verification-5)', () => {
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

  it('captures prompt contracts from nested parallel leaves', () => {
    expect(capturePromptContract(structuredConfig())).toEqual([
      {
        state: 'askHost',
        sourceItem: 'FLOW-1',
        player: 'Host',
        reads: ['topic'],
        wires: { topic: ['topic'] },
        placeholders: ['<topic>'],
      },
      {
        state: 'askParticipant',
        sourceItem: 'FLOW-2',
        player: 'Participant',
        reads: ['topic'],
        wires: { topic: ['topic'] },
        placeholders: ['<topic>'],
      },
    ]);
  });

  it('captures canonical roles without relabelling historical players', () => {
    const rows = capturePromptContract(schema3Config());
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'coderWork',
          player: '',
          role: 'coder',
        }),
        expect.objectContaining({
          state: 'reviewerWork',
          player: '',
          role: 'reviewer',
        }),
      ]),
    );
    expect(capturePromptContract(contractConfig())[0]).not.toHaveProperty(
      'role',
    );
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

describe('checkPromptComposition (verification-5)', () => {
  it('accepts a composer following the link contract', () => {
    const arities: number[] = [];
    const historicalCompose = (...args: unknown[]): string => {
      arities.push(args.length);
      return goodCompose(args[0]);
    };
    expect(
      checkPromptComposition({
        config: contractConfig(),
        compose: historicalCompose,
      }),
    ).toEqual([]);
    expect(new Set(arities)).toEqual(new Set([1]));
  });

  it('resolves schema-3 prompt identity through the canonical role', () => {
    expect(
      checkPromptComposition({
        config: schema3Config(),
        compose: composeSchema3Prompt,
        actor: 'player',
      }),
    ).toEqual([]);
    expect(
      deriveSubstitutions(schema3Config(), composeSchema3Prompt, 'player'),
    ).toMatchObject({
      coderWork: ['<topic>', '<coder-llm>'],
      reviewerWork: ['<topic>'],
    });
  });

  it('accepts the installed default composer without requiring a role-identity call', () => {
    const config: MachineConfigLike = {
      states: {
        work: {
          id: 'work',
          meta: { playbook: { stateId: 'work', role: 'coder' } },
          invoke: {
            src: 'player',
            input: ({ context }) => ({
              stateId: 'work',
              role: 'coder',
              sourceItem: 'ROLE-1',
              prompt: 'Address <name>.',
              result: {
                done: 'The player finished.',
                needsBossReply: NEEDS_BOSS_REPLY_TEXT,
              },
              name: context.name,
              ...(context.pendingBossQuestion && context.bossReply
                ? {
                    pendingBossQuestion: context.pendingBossQuestion,
                    bossReply: context.bossReply,
                  }
                : {}),
            }),
          },
        },
      },
    };
    const compose = defaultComposePlayerPrompt as unknown as (
      input: unknown,
      promptIdentity: (roleId: string) => string,
    ) => string;

    // The installed composer treats its second argument as placeholder-field
    // metadata. The verifier's callable identity lookup must therefore expose
    // no Function.name property that can capture the <name> token.
    expect(
      checkPromptComposition({ config, compose, actor: 'player' }),
    ).toEqual([]);
    expect(deriveSubstitutions(config, compose, 'player')).toEqual({
      work: ['<name>'],
    });
  });

  it('rejects a concrete player binding exposed by a schema-3 role composer', () => {
    const leaking = (
      raw: unknown,
      promptIdentity: (roleId: string) => string,
    ): string =>
      `${composeSchema3Prompt(raw, promptIdentity)}\n\nPlayer binding: configured-coder`;

    expect(
      checkPromptComposition({
        config: schema3Config(),
        compose: leaking,
        actor: 'player',
      }).join('\n'),
    ).toMatch(/exposes a concrete player binding/);
  });

  it('rejects a schema-3 prompt lookup through another role', () => {
    const compose = (
      raw: unknown,
      promptIdentity: (roleId: string) => string,
    ): string => {
      const input = raw as { prompt: string; topic?: string };
      return input.prompt
        .replaceAll('<topic>', input.topic ?? '<topic>')
        .replaceAll('<coder-llm>', promptIdentity('reviewer'));
    };
    expect(
      checkPromptComposition({
        config: schema3Config(),
        compose,
        actor: 'player',
      }).join('\n'),
    ).toMatch(/instead of canonical local role "coder"/);
  });

  it('checks controller prompt text without inventing a Boss continuation', () => {
    const config = controllerConfig();
    config.states!.report = {
      invoke: {
        src: 'captain',
        input: () => ({
          stateId: 'report',
          sourceItem: 'CONTROL-REPORT',
          prompt: 'Report the settled controller action.',
          result: { respond: 'Reply with the settled outcome.' },
        }),
      },
    };
    const compose = (raw: unknown): string =>
      (raw as { prompt: string }).prompt;
    expect(
      checkPromptComposition({
        config,
        compose,
        actor: 'captain',
      }),
    ).toEqual([]);

    const mutated = (raw: unknown): string =>
      `Mutated ${(raw as { prompt: string }).prompt}`;
    expect(
      checkPromptComposition({
        config,
        compose: mutated,
        actor: 'captain',
      }).join('\n'),
    ).toMatch(/does not preserve the body line/);

    const inventedContinuation = (raw: unknown): string =>
      `${CONTINUATION_PREAMBLE}\n\n${compose(raw)}`;
    expect(
      checkPromptComposition({
        config,
        compose: inventedContinuation,
        actor: 'captain',
      }).join('\n'),
    ).toMatch(/continuation blocks appear on an ordinary turn/);
  });

  it('accepts a state-keyed branch continuation mapper', () => {
    const config: MachineConfigLike = {
      states: {
        draft: {
          id: 'draft',
          meta: { playbook: { stateId: 'draft', role: 'coder' } },
          invoke: {
            src: 'player',
            input: ({ context }) => {
              const candidate = (
                context.pendingBossQuestions as
                  | Record<
                      string,
                      {
                        question: string;
                        questionId: string;
                        resumeStateId: string;
                      }
                    >
                  | undefined
              )?.draft;
              const pendingBossQuestion =
                candidate?.questionId === 'draft' &&
                candidate.resumeStateId === 'draft'
                  ? candidate
                  : undefined;
              const bossReply = (
                context.bossReplies as Record<string, string> | undefined
              )?.draft;
              return {
                stateId: 'draft',
                role: 'coder',
                sourceItem: 'GREETER-1',
                prompt: 'Draft a short hello message for <audience>.',
                result: {
                  done: 'The player finished.',
                  needsBossReply: NEEDS_BOSS_REPLY_TEXT,
                },
                audience: context.audience,
                ...(pendingBossQuestion && bossReply
                  ? { pendingBossQuestion, bossReply }
                  : {}),
              };
            },
          },
        },
      },
    };

    expect(checkPromptComposition({ config, compose: goodCompose })).toEqual(
      [],
    );
  });

  it('recognizes a sentinel rendered as deterministic JSON', () => {
    const config: MachineConfigLike = {
      states: {
        route: {
          invoke: {
            src: 'captain',
            input: ({ context }) => ({
              stateId: 'route',
              sourceItem: 'ROUTE-1',
              prompt: 'Enabled playbooks: <enabled-playbooks>',
              result: {
                done: 'The Captain finished.',
                needsBossReply: NEEDS_BOSS_REPLY_TEXT,
              },
              enabledPlaybooks: context.enabledPlaybooks,
              ...(context.pendingBossQuestion && context.bossReply
                ? {
                    pendingBossQuestion: context.pendingBossQuestion,
                    bossReply: context.bossReply,
                  }
                : {}),
            }),
          },
        },
      },
    };
    const compose = (raw: unknown): string => {
      const input = raw as {
        prompt: string;
        enabledPlaybooks: unknown;
        pendingBossQuestion?: { question: string };
        bossReply?: string;
      };
      const body = input.prompt.replace(
        '<enabled-playbooks>',
        JSON.stringify(input.enabledPlaybooks),
      );
      return input.pendingBossQuestion && input.bossReply
        ? [
            CONTINUATION_PREAMBLE,
            `Boss question:\n${input.pendingBossQuestion.question}`,
            `Boss reply:\n${input.bossReply}`,
            body,
          ].join('\n\n')
        : body;
    };
    expect(
      checkPromptComposition({
        config,
        compose,
        actor: 'captain',
        artifactSchema: 1,
      }),
    ).toEqual([]);
    expect(deriveSubstitutions(config, compose, 'captain')).toEqual({
      route: ['<enabled-playbooks>'],
    });
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

  it('rejects player, role, and resume text added to a direct-Captain prompt', () => {
    const config: MachineConfigLike = {
      states: {
        route: directCaptainContract('ROUTE-1', ['Route this intent.']),
      },
    };
    const compose = (raw: unknown): string =>
      [
        goodCompose(raw),
        'Player binding: Writer',
        'Role binding: coder',
        'Resume the same player session for this task.',
      ].join('\n\n');
    const findings = checkPromptComposition({
      config,
      compose,
      actor: 'captain',
      artifactSchema: 1,
    }).join('\n');
    expect(findings).toMatch(/introduces a player binding/);
    expect(findings).toMatch(/introduces a role binding/);
    expect(findings).toMatch(/introduces a player resume instruction/);
  });

  it('allows identical player-control markers already in the Captain body', () => {
    const config: MachineConfigLike = {
      states: {
        route: directCaptainContract('ROUTE-1', [
          'Quote this header exactly: Player binding: Writer',
          'Quote this instruction exactly: Resume the same player session for this task.',
        ]),
      },
    };
    expect(
      checkPromptComposition({
        config,
        compose: goodCompose,
        actor: 'captain',
        artifactSchema: 1,
      }),
    ).toEqual([]);
  });

  it('uses schema-specific direct-Captain continuation records and one composer argument', () => {
    for (const artifactSchema of [1, 3] as const) {
      const config: MachineConfigLike = {
        states: {
          route: directCaptainContract('ROUTE-1', ['Route this intent.']),
        },
      };
      const arities: number[] = [];
      const pending: unknown[] = [];
      const compose = (...args: unknown[]): string => {
        arities.push(args.length);
        const input = args[0] as ComposerInput;
        if (input.pendingBossQuestion !== undefined) {
          pending.push(input.pendingBossQuestion);
        }
        return goodCompose(input);
      };

      expect(
        checkPromptComposition({
          config,
          compose,
          actor: 'captain',
          artifactSchema,
        }),
      ).toEqual([]);
      expect(new Set(arities)).toEqual(new Set([1]));
      expect(pending).toEqual([
        artifactSchema === 1
          ? {
              player: 'Captain',
              questionId: 'route',
              resumeStateId: 'route',
              sourceItem: 'ROUTE-1',
              question: '«question»',
            }
          : {
              asker: { kind: 'captain' },
              questionId: 'route',
              resumeStateId: 'route',
              sourceItem: 'ROUTE-1',
              question: '«question»',
            },
      ]);
    }
  });

  it('requires a grounded schema for an otherwise ambiguous direct-Captain continuation', () => {
    const config: MachineConfigLike = {
      states: {
        route: directCaptainContract('ROUTE-1', ['Route this intent.']),
      },
    };
    expect(
      checkPromptComposition({
        config,
        compose: goodCompose,
        actor: 'captain',
      }).join('\n'),
    ).toMatch(/requires artifactSchema 1 or 3/);
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
        work: contractCaptain('Writer', 'meta-1', [
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
    expect(
      rows.map(({ state, sourceItem, player, role }) => ({
        state,
        sourceItem,
        player,
        role,
      })),
    ).toEqual([
      {
        state: 'runFirstPhase',
        sourceItem: 'CODE-1',
        player: '',
        role: 'coder',
      },
      { state: 'runIrTask', sourceItem: 'CODE-3', player: '', role: 'coder' },
    ]);
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
    // The reference substitutes the relayed intent and run results on every
    // phase, <#> on the IR-task phase, and the Coder model on both commits.
    expect(substituted.runFirstPhase).toEqual([
      '<caller-input>',
      '<run-results>',
      '<coder-llm>',
    ]);
    expect(substituted.runIrTask).toEqual([
      '<ir-task>',
      '<run-results>',
      '<#>',
      '<coder-llm>',
    ]);
  });
});

describe('emitPromptContractTest (verification-5)', () => {
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

  const directCaptainFsmFixture = [
    'export const machine = {',
    '  config: {',
    '    states: {',
    '      route: {',
    '        invoke: {',
    "          src: 'captain',",
    '          input: ({ context }: { context: Record<string, unknown> }) => ({',
    "            stateId: 'route',",
    "            sourceItem: 'ROUTE-1',",
    "            prompt: 'Route <boss-intent>.',",
    "            result: { done: 'd', needsBossReply: 'Output shall include `question: ...`' },",
    '            bossIntent: context.bossIntent,',
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
      expect(content).toContain('import * as fsm from "./code.fsm.js"');
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
        'import * as playbook from "./code.playbook.js"',
      );
      expect(content).toContain('"<audience>"');
      expect(content).toContain('const PLAYER_SUBSTITUTED =');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('verifies a direct-Captain composer across a NodeNext .js FSM edge', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-pc-captain-'));
    try {
      await writeFile(
        join(artifactDir, 'captain.fsm.ts'),
        directCaptainFsmFixture,
      );
      const linkedPath = join(artifactDir, 'captain.playbook.ts');
      const linkedSource = [
        "import { machine } from './captain.fsm.js';",
        'void machine;',
        "const CONTINUATION = '" + CONTINUATION_PREAMBLE + "';",
        'const compose = (input: any): string => {',
        '  const blocks: string[] = [];',
        '  if (input.pendingBossQuestion && input.bossReply) {',
        '    blocks.push(CONTINUATION, `Boss question:\\n${input.pendingBossQuestion.question}`, `Boss reply:\\n${input.bossReply}`);',
        '  }',
        "  blocks.push(input.prompt.replaceAll('<boss-intent>', input.bossIntent));",
        "  return blocks.join('\\n\\n');",
        '};',
        'export const _internal = { composeCaptainPrompt: compose };',
        '',
      ].join('\n');
      await writeFile(linkedPath, linkedSource);

      const { path, diagnostics } = await emitPromptContractTest({
        artifactDir,
        basename: 'captain',
        verifyModule: join(repoRoot, 'dist/verify.js'),
        artifactSchema: 1,
      });

      expect(diagnostics).toEqual([]);
      expect(await readFile(linkedPath, 'utf8')).toBe(linkedSource);
      const content = await readFile(path, 'utf8');
      expect(content).toContain('_internal.composeCaptainPrompt');
      expect(content).toContain("actor: 'captain'");
      expect(content).toContain('artifactSchema: 1');
      expect(content).toContain('CAPTAIN_SUBSTITUTED');
      expect(content).toContain('"<boss-intent>"');

      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [
          join(repoRoot, 'node_modules/vitest/vitest.mjs'),
          'run',
          '--root',
          artifactDir,
          'captain.prompt-contract.test.ts',
        ],
        { cwd: artifactDir, timeout: 15_000 },
      );
      expect(`${stdout}\n${stderr}`).toMatch(/4 passed/);

      // The emission-time check executes the imported Captain composer, not
      // merely discovers its export. A body mutation must be diagnosed.
      await writeFile(
        linkedPath,
        linkedSource.replace(
          "blocks.push(input.prompt.replaceAll('<boss-intent>', input.bossIntent));",
          "blocks.push('mutated ' + input.prompt.replaceAll('<boss-intent>', input.bossIntent));",
        ),
      );
      const rerun = await emitPromptContractTest({
        artifactDir,
        basename: 'captain',
        verifyModule: join(repoRoot, 'dist/verify.js'),
        artifactSchema: 1,
      });
      expect(rerun.diagnostics.join('\n')).toMatch(
        /composeCaptainPrompt|does not preserve the body line/,
      );
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('retains schema 1 for a direct-Captain artifact with a compat-less linked factory', async () => {
    const artifactDir = await mkdtemp(
      join(tmpdir(), 'slc-verify-pc-captain-v1-'),
    );
    try {
      await writeFile(
        join(artifactDir, 'captain.fsm.ts'),
        directCaptainFsmFixture,
      );
      await writeFile(
        join(artifactDir, 'captain.playbook.ts'),
        [
          "const CONTINUATION = '" + CONTINUATION_PREAMBLE + "';",
          'const compose = (input: any): string => {',
          '  const blocks: string[] = [];',
          '  if (input.pendingBossQuestion && input.bossReply) {',
          "    if (input.pendingBossQuestion.player !== 'Captain' || 'asker' in input.pendingBossQuestion) throw new Error('wrong schema');",
          '    blocks.push(CONTINUATION, `Boss question:\\n${input.pendingBossQuestion.question}`, `Boss reply:\\n${input.bossReply}`);',
          '  }',
          "  blocks.push(input.prompt.replaceAll('<boss-intent>', input.bossIntent));",
          "  return blocks.join('\\n\\n');",
          '};',
          'export const _internal = { composeCaptainPrompt: compose };',
          'export default function createPlaybookRuntime() { return {}; }',
          '',
        ].join('\n'),
      );

      const { path, diagnostics } = await emitPromptContractTest({
        artifactDir,
        basename: 'captain',
      });

      expect(diagnostics).toEqual([]);
      expect(await readFile(path, 'utf8')).toContain('artifactSchema: 1');
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });

  it('infers schema 3 for a direct-Captain composer only from exact immutable factory compatibility', async () => {
    const artifactDir = await mkdtemp(
      join(tmpdir(), 'slc-verify-pc-captain-v3-'),
    );
    try {
      await writeFile(
        join(artifactDir, 'captain.fsm.ts'),
        directCaptainFsmFixture,
      );
      const linkedPath = join(artifactDir, 'captain.playbook.ts');
      const linkedSource = [
        "const CONTINUATION = '" + CONTINUATION_PREAMBLE + "';",
        'const compose = (input: any): string => {',
        '  const blocks: string[] = [];',
        '  if (input.pendingBossQuestion && input.bossReply) {',
        "    if (input.pendingBossQuestion.asker?.kind !== 'captain' || 'player' in input.pendingBossQuestion) throw new Error('wrong schema');",
        '    blocks.push(CONTINUATION, `Boss question:\\n${input.pendingBossQuestion.question}`, `Boss reply:\\n${input.bossReply}`);',
        '  }',
        "  blocks.push(input.prompt.replaceAll('<boss-intent>', input.bossIntent));",
        "  return blocks.join('\\n\\n');",
        '};',
        'function createPlaybookRuntime() { return {}; }',
        "Object.defineProperty(createPlaybookRuntime, 'compat', {",
        '  value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 }),',
        '  enumerable: true, writable: false, configurable: false,',
        '});',
        'export const _internal = { composeCaptainPrompt: compose };',
        'export default createPlaybookRuntime;',
        '',
      ].join('\n');
      await writeFile(linkedPath, linkedSource);

      const { path, diagnostics } = await emitPromptContractTest({
        artifactDir,
        basename: 'captain',
      });
      expect(diagnostics).toEqual([]);
      expect(await readFile(path, 'utf8')).toContain('artifactSchema: 3');

      await writeFile(
        linkedPath,
        linkedSource.replace(
          'value: Object.freeze({ artifactSchema: 3, runtimeAbi: 1 })',
          'value: { artifactSchema: 3, runtimeAbi: 1 }',
        ),
      );
      const ungrounded = await emitPromptContractTest({
        artifactDir,
        basename: 'captain',
      });
      expect(ungrounded.diagnostics.join('\n')).toMatch(
        /requires artifactSchema 1 or 3/,
      );
      const ungroundedSource = await readFile(ungrounded.path, 'utf8');
      expect(ungroundedSource).not.toContain('artifactSchema:');
      expect(ungroundedSource).toContain(
        'linked factory has an own compatibility declaration that is not exact immutable schema 3/runtime ABI 1',
      );
      expect(ungroundedSource).toContain(
        "it('uses consistent artifact-schema evidence'",
      );
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
      artifactSchema: 3,
    });
    expect(emitted).toContain('import * as fsm from "./code.fsm.js"');
    expect(emitted).toContain(
      'import { checkGearsFsmConformance, findConcurrentRoleSets, findMachineConfig } from "@sublang/slc/verify"',
    );
    expect(emitted).toContain(
      'checkGearsFsmConformance(gears, findMachineConfig(fsm), {',
    );
    expect(emitted).toContain(
      'concurrentRoleSets: findConcurrentRoleSets(fsm)',
    );
    expect(emitted).toContain('artifactSchema: 3');
    expect(emitted).toContain('./code.gears.md');
    expect(emitted).toContain('SPDX-License-Identifier');
  });

  it('quotes legal basenames and module specifiers as parseable TypeScript', () => {
    const basename = "boss's flow";
    const fsmModule = `./${basename}.fsm.js`;
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
          playbookModule: `./${basename}.playbook.js`,
          player: {},
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

  it('bakes schema-resolution findings into generated prompt tests', () => {
    const finding = 'reviewed provenance disagrees with factory compatibility';
    const emitted = generatePromptContractTest({
      basename: 'code',
      fsmModule: './code.fsm.js',
      verifyModule: '@sublang/slc/verify',
      rows: [],
      schemaFindings: [finding],
    });
    expect(emitted).toContain(JSON.stringify(finding));
    expect(emitted).toContain("it('uses consistent artifact-schema evidence'");
    expect(emitted).toContain('expect(SCHEMA_FINDINGS).toEqual([])');
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
  it('writes the conformance test into the artifact directory (verification-2)', async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), 'slc-verify-emit-'));
    try {
      const path = await emitGearsFsmConformanceTest({
        artifactDir,
        basename: 'code',
      });
      expect(path).toBe(join(artifactDir, 'code.gears-fsm.test.ts'));
      const content = await readFile(path, 'utf8');
      expect(content).toContain('from "@sublang/slc/verify"');
      // NodeNext imports the emitted TypeScript artifact through `.js`.
      expect(content).toContain('import * as fsm from "./code.fsm.js"');
      expect(content).toContain('./code.gears.md');
      expect(content).toContain(
        'checkGearsFsmConformance(gears, findMachineConfig(fsm), {',
      );
    } finally {
      await rm(artifactDir, { recursive: true, force: true });
    }
  });
});

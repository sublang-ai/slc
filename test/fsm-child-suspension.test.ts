// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizePlaybookSnapshot } from '@sublang/playbook/xstate-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActor, fromPromise, setup } from 'xstate';

import {
  createConfiguredExecutor,
  type AdapterFactory,
} from '../src/config.js';
import type { PhaseExecutor } from '../src/execution.js';
import { runSlc, type SlcDeps } from '../src/runner.js';
import {
  checkFsmChildSuspension,
  checkGearsFsmConformance,
  type MachineConfigLike,
} from '../src/verify.js';

const literalGears = `## Behaviors

### CALL-1

When Captain delegates implementation review, Captain shall call playbook \`child-review\`:
> Review these changes:
> <changes>
`;

const dynamicGears = `## Behaviors

### CALL-2

When Captain selects follow-up work, Captain shall call playbook selected by \`nextPlaybookId\`:
> <nextPlaybookInput>
`;

const outputDefinition =
  '## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | fsm | .ts |\n| target | output | .ts |\n';

const definition = (source: string, target: string) =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${source} | ${source === 'gears' ? '.md' : '.ts'} |\n| target | ${target} | .ts |\n`;

const pendingCall = {
  callId: 'call-1',
  playbookId: 'child-review',
  childSessionId: 'child-session',
  input: 'Review these changes:\npatch',
};

const stateIdentity = (stateId: string) => ({
  id: stateId,
  meta: { playbook: { stateId } },
});

const invokeInput = (kind: 'literal' | 'dynamic') =>
  kind === 'literal'
    ? {
        stateId: 'callChild',
        sourceItem: 'CALL-1',
        playbookId: 'child-review',
        text: 'Review these changes:\n<changes>',
      }
    : ({
        context,
      }: {
        context: { nextPlaybookId: string; nextPlaybookInput: string };
      }) => ({
        stateId: 'callChild',
        sourceItem: 'CALL-2',
        playbookId: context.nextPlaybookId,
        text: context.nextPlaybookInput,
        playbookIdContext: 'nextPlaybookId',
        textContext: 'nextPlaybookInput',
      });

const childConfig = (
  kind: 'literal' | 'dynamic',
  busy:
    | 'none'
    | 'leaf-string'
    | 'leaf-array'
    | 'ancestor'
    | 'root'
    | 'parallel-sibling' = 'none',
): MachineConfigLike => ({
  ...(busy === 'root' ? { tags: 'playbook.busy' } : {}),
  context:
    kind === 'dynamic'
      ? { nextPlaybookId: 'child-review', nextPlaybookInput: 'child input' }
      : {},
  initial: 'parallel',
  states: {
    parallel: {
      ...stateIdentity('parallel'),
      type: 'parallel',
      states: {
        childRegion: {
          ...stateIdentity('childRegion'),
          ...(busy === 'ancestor' ? { tags: ['playbook.busy'] } : {}),
          initial: 'call',
          states: {
            call: {
              ...stateIdentity('callChild'),
              tags:
                busy === 'leaf-string'
                  ? 'playbook.busy'
                  : busy === 'leaf-array'
                    ? ['playbook.suspended', 'playbook.busy']
                    : 'playbook.suspended',
              invoke: {
                src: 'playbook',
                input: invokeInput(kind),
              },
            },
          },
        },
        siblingRegion: {
          ...stateIdentity('siblingRegion'),
          initial: 'working',
          states: {
            working: {
              ...stateIdentity('siblingWorking'),
              ...(busy === 'parallel-sibling' ? { tags: 'playbook.busy' } : {}),
            },
          },
        },
      },
    },
  },
});

const snapshotMachine = (busy: 'none' | 'leaf' | 'ancestor' | 'root') =>
  setup({
    actors: {
      playbook: fromPromise(async () => new Promise<never>(() => {})),
    },
  }).createMachine({
    id: 'snapshotFixture',
    ...(busy === 'root' ? { tags: 'playbook.busy' } : {}),
    initial: 'parent',
    states: {
      parent: {
        ...(busy === 'ancestor' ? { tags: 'playbook.busy' } : {}),
        initial: 'call',
        states: {
          call: {
            id: 'callChild',
            meta: { playbook: { stateId: 'callChild' } },
            tags:
              busy === 'leaf'
                ? ['playbook.suspended', 'playbook.busy']
                : 'playbook.suspended',
            invoke: {
              src: 'playbook',
              input: () => invokeInput('literal'),
            },
          },
        },
      },
    },
  });

const fsmSource = (
  kind: 'literal' | 'dynamic',
  busy: 'none' | 'leaf' | 'ancestor' | 'root',
) => {
  const rootTag = busy === 'root' ? "tags: 'playbook.busy'," : '';
  const ancestorTag = busy === 'ancestor' ? "tags: ['playbook.busy']," : '';
  const leafTag =
    busy === 'leaf'
      ? "tags: ['playbook.suspended', 'playbook.busy'],"
      : "tags: 'playbook.suspended',";
  const context =
    kind === 'dynamic'
      ? "context: { nextPlaybookId: 'child-review', nextPlaybookInput: 'child input' },"
      : 'context: {},';
  const sourceItem = kind === 'dynamic' ? 'CALL-2' : 'CALL-1';
  const input =
    kind === 'dynamic'
      ? `({ context }: { context: { nextPlaybookId: string; nextPlaybookInput: string } }) => ({
          stateId: 'callChild',
          sourceItem: '${sourceItem}',
          playbookId: context.nextPlaybookId,
          text: context.nextPlaybookInput,
          playbookIdContext: 'nextPlaybookId',
          textContext: 'nextPlaybookInput',
        })`
      : `() => ({
          stateId: 'callChild',
          sourceItem: '${sourceItem}',
          playbookId: 'child-review',
          text: 'Review these changes:\\n<changes>',
        })`;
  return `export const concurrentRoleSets = [];
export const machine = { config: {
  ${rootTag}
  ${context}
  initial: 'parent',
  states: {
    parent: {
      id: 'parent',
      meta: { playbook: { stateId: 'parent' } },
      ${ancestorTag}
      initial: 'call',
      states: {
        call: {
          id: 'callChild',
          meta: { playbook: { stateId: 'callChild' } },
          ${leafTag}
          invoke: {
            src: 'playbook',
            input: ${input},
          },
        },
      },
    },
  },
} };
`;
};

const repairEnvelope = JSON.stringify({
  dispositions: [
    {
      finding: 1,
      decision: 'accept',
      reason: 'Removed playbook.busy from the suspended child call path.',
    },
  ],
  result: 'Repaired child suspension tag.',
});

describe('FSM child suspension boundary', () => {
  let root: string;
  let pipeline: string;
  let source: string;
  let target: string;
  let output: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-fsm-child-suspension-'));
    pipeline = join(root, 'pipeline');
    await mkdir(pipeline);
    await writeFile(join(pipeline, 'gears2fsm.md'), definition('gears', 'fsm'));
    await writeFile(join(pipeline, 'link.md'), definition('fsm', 'playbook'));
    await writeFile(join(pipeline, 'fsm2output.md'), outputDefinition);
    source = join(root, 'task.gears.md');
    target = join(root, 'task.flow', 'task.fsm.ts');
    output = join(root, 'task.flow', 'task.output.ts');
    await writeFile(source, literalGears);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (executor: PhaseExecutor): SlcDeps => ({
    cwd: root,
    resolver: () => [pipeline],
    executor,
  });

  it.each([
    ['leaf', false],
    ['ancestor', false],
    ['root', false],
    ['none', true],
  ] as const)(
    'matches runtime quiescence for a suspended child with %s busy tag',
    (busy, quiescent) => {
      const actor = createActor(snapshotMachine(busy)).start();
      try {
        expect(
          normalizePlaybookSnapshot(actor.getSnapshot(), { pendingCall })
            .quiescent,
        ).toBe(quiescent);
      } finally {
        actor.stop();
      }
    },
  );

  it.each([
    ['literal', 'leaf-string'],
    ['literal', 'leaf-array'],
    ['literal', 'ancestor'],
    ['literal', 'root'],
    ['dynamic', 'leaf-string'],
    ['dynamic', 'ancestor'],
    ['dynamic', 'root'],
  ] as const)('rejects %s child calls with %s busy tags', (kind, busy) => {
    const findings = checkFsmChildSuspension(childConfig(kind, busy));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('FSM playbook state callChild');
    expect(findings[0]).toContain('playbook.busy');
  });

  it('accepts suspended children without busy tags and busy parallel siblings', () => {
    expect(checkFsmChildSuspension(childConfig('literal'))).toEqual([]);
    expect(checkFsmChildSuspension(childConfig('dynamic'))).toEqual([]);
    expect(
      checkGearsFsmConformance(
        literalGears,
        childConfig('literal', 'parallel-sibling'),
      ),
    ).toEqual([]);
    expect(
      checkGearsFsmConformance(
        dynamicGears,
        childConfig('dynamic', 'parallel-sibling'),
      ),
    ).toEqual([]);
  });

  it('rejects a malformed producer before linking and preserves the source', async () => {
    const calls: string[] = [];
    const result = await runSlc(
      ['flow', source, '--link', join(root, 'task.playbook.ts')],
      deps({
        async run(request) {
          calls.push(request.kind);
          if (request.kind !== 'compile')
            throw new Error('link must never run');
          await writeFile(request.target, fsmSource('literal', 'leaf'));
          return { status: 'ok' };
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('playbook.busy');
    expect(calls).toEqual(['compile']);
    expect(await readFile(source, 'utf8')).toBe(literalGears);
  });

  it('rejects a supplied FSM consumer before executor selection', async () => {
    const input = join(root, 'task.fsm.ts');
    const original = fsmSource('dynamic', 'root');
    await writeFile(input, original);
    await writeFile(source, dynamicGears);
    let constructions = 0;
    const result = await runSlc(['flow.fsm2output', input], {
      cwd: root,
      resolver: () => [pipeline],
      get executor() {
        constructions++;
        throw new Error('consumer must not be selected');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('playbook.busy');
    expect(constructions).toBe(0);
    expect(await readFile(input, 'utf8')).toBe(original);
  });

  it('repairs only the busy child tag with the same Coder before the consumer runs', async () => {
    const prompts: string[] = [];
    const busy = fsmSource('literal', 'leaf');
    const repaired = fsmSource('literal', 'none');
    const factory: AdapterFactory = (agent) => ({
      agent,
      async isAvailable() {
        return true;
      },
      async *run(prompt) {
        prompts.push(prompt);
        if (prompts.length === 1) await writeFile(target, busy);
        else if (prompts.length === 2) await writeFile(target, repaired);
        else await writeFile(output, 'export const consumerRan = true;\n');
        yield {
          type: 'done',
          agent,
          timestamp: 1,
          sessionId: 'coder',
          payload: {
            status: 'success',
            result:
              prompts.length === 2
                ? repairEnvelope
                : 'Wrote the requested artifact.',
            usage: { inputTokens: 0, outputTokens: 0, toolUses: 0 },
            durationMs: 1,
          },
        } as never;
      },
    });
    const result = await runSlc(['flow', source], {
      ...deps(
        createConfiguredExecutor(
          { agent: 'codex' },
          { cwd: root, adapterFactory: factory },
        ),
      ),
    });
    expect(result, JSON.stringify(result.diagnostics)).toMatchObject({
      ok: true,
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain('playbook.busy');
    expect(
      busy.replace(
        "['playbook.suspended', 'playbook.busy']",
        "'playbook.suspended'",
      ),
    ).toBe(repaired);
    expect(await readFile(target, 'utf8')).toBe(repaired);
    expect(await readFile(output, 'utf8')).toBe(
      'export const consumerRan = true;\n',
    );
    expect(await readFile(source, 'utf8')).toBe(literalGears);
  });
});

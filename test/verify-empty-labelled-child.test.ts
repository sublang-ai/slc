// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import {
  checkGearsFsmArtifact,
  checkGearsFsmConformanceAsync,
} from '../src/verify-coverage.js';
import {
  checkGearsFsmConformance,
  generateGearsFsmConformanceTest,
} from '../src/verify.js';
import { emitVerifierSupport } from '../src/verify-support.js';

import {
  commits,
  fixture,
  gears,
  type Reached,
  type Style,
} from './fixtures/empty-labelled-child.js';

const unproved =
  'REVIEW-1: FSM playbook text could not prove the complete expanded GEARS child-input composition';
const mixed =
  'REVIEW-1: FSM playbook text mixes kept and omitted empty labelled child-input relay lines';

/** The child input each entry owes the `review` child, written out in full. */
const rendered: Record<Style, Record<Reached, string>> = {
  keep: {
    direct: [
      'Review the accepted work.',
      '> Request: Request',
      '',
      '> Note: ',
      '',
      `Scope: every commit, namely ${commits[1]}, and the resulting state.`,
      'Evidence follows.',
      '> Report: Done',
      '',
      '> IR number: ',
    ].join('\n'),
    noted: [
      'Review the accepted work.',
      '> Request: Request',
      '',
      '> Note: Noted',
      '',
      `Scope: every commit, namely ${commits.join(', ')}, and the resulting state.`,
      'Evidence follows.',
      '> Report: Done',
      '',
      '> IR number: ',
    ].join('\n'),
    planned: [
      'Review the accepted work.',
      '> Request: Request',
      '',
      '> Note: Planned',
      '',
      `Scope: every commit, namely ${commits.join(', ')}, and the resulting state.`,
      'Evidence follows.',
      '> Report: Done',
      '',
      '> IR number: 7',
    ].join('\n'),
  },
  omit: {
    // The blank lines around the omitted note stay; the one before the
    // omitted trailing IR number goes with it.
    direct: [
      'Review the accepted work.',
      '> Request: Request',
      '',
      '',
      `Scope: every commit, namely ${commits[1]}, and the resulting state.`,
      'Evidence follows.',
      '> Report: Done',
    ].join('\n'),
    noted: [
      'Review the accepted work.',
      '> Request: Request',
      '',
      '> Note: Noted',
      '',
      `Scope: every commit, namely ${commits.join(', ')}, and the resulting state.`,
      'Evidence follows.',
      '> Report: Done',
    ].join('\n'),
    planned: [
      'Review the accepted work.',
      '> Request: Request',
      '',
      '> Note: Planned',
      '',
      `Scope: every commit, namely ${commits.join(', ')}, and the resulting state.`,
      'Evidence follows.',
      '> Report: Done',
      '',
      '> IR number: 7',
    ].join('\n'),
  },
};

/** The child input a real run hands the `review` child after `entry`. */
async function produced(
  machine: ReturnType<typeof fixture>,
  entry: Reached,
): Promise<string | undefined> {
  let text: string | undefined;
  const actor = createActor(
    machine.provide({
      actors: {
        playbook: fromPromise(async ({ input }) => {
          const value = input as { playbookId: string; text: string };
          if (value.playbookId === 'review') text = value.text;
        }),
      },
    }),
  );
  actor.start();
  actor.send({ type: entry.toUpperCase() });
  for (let turn = 0; turn < 50 && text === undefined; turn++)
    await Promise.resolve();
  actor.stop();
  return text;
}

/** Both gates: the combined artifact gate and the conformance-only replay. */
async function gates(
  reached: readonly Reached[],
  machine: ReturnType<typeof fixture>,
): Promise<string[][]> {
  return [
    await checkGearsFsmArtifact(gears(reached), { machine }),
    await checkGearsFsmConformanceAsync(gears(reached), { machine }),
  ];
}

describe('reached empty labelled child relays', () => {
  it.each<[Style, Reached[]]>([
    ['keep', ['direct']],
    ['omit', ['direct']],
    ['keep', ['noted']],
    ['omit', ['noted']],
    ['keep', ['planned']],
    ['omit', ['planned']],
    ['keep', ['direct', 'planned']],
    ['omit', ['direct', 'planned']],
    ['keep', ['direct', 'noted', 'planned']],
    ['omit', ['direct', 'noted', 'planned']],
  ])(
    'accepts an invocation that would %s every empty labelled relay, reached through %j',
    async (style, reached) => {
      const machine = fixture(style, reached);
      for (const entry of reached)
        expect(await produced(machine, entry)).toBe(rendered[style][entry]);
      expect(await gates(reached, machine)).toEqual([[], []]);
    },
  );

  it('keeps the synchronous conformance check conservative', () => {
    for (const style of ['keep', 'omit'] as const)
      expect(
        checkGearsFsmConformance(
          gears(['direct']),
          fixture(style, ['direct']).config,
        ).join('\n'),
      ).toContain(unproved);
  });

  it('rejects one case that keeps one empty label and omits another line', async () => {
    const machine = fixture('omit', ['direct'], 'mix-lines');
    expect(await produced(machine, 'direct')).toBe(
      `${rendered.omit.direct}\n\n> IR number: `,
    );
    for (const findings of await gates(['direct'], machine))
      expect(findings.join('\n')).toContain(unproved);
  });

  it.each<[string, Style, Reached[], Reached]>([
    // No reached case leaves a label empty: the probes alone tell.
    ['mix-lines', 'omit', ['planned'], 'planned'],
    // Every reached case keeps its labels; an emptied request omits them.
    ['mix-probes', 'keep', ['direct'], 'direct'],
    ['mix-probes', 'keep', ['planned'], 'planned'],
  ])(
    'rejects a %s invocation whose reached text is faithful, under its probes',
    async (fault, style, reached, entry) => {
      const machine = fixture(style, reached, fault);
      expect(await produced(machine, entry)).toBe(rendered[style][entry]);
      for (const findings of await gates(reached, machine))
        expect(findings).toEqual([mixed]);
    },
  );

  it('rejects an invocation that keeps the labels in one reached case and omits a line in another', async () => {
    // The IR number is read only where one was planned, so no earlier case
    // proves the call alone and each is held to the same rendering.
    const reached: Reached[] = ['direct', 'noted', 'planned'];
    const machine = fixture('keep', reached, 'mix-cases', true);
    expect(await produced(machine, 'direct')).toBe(rendered.keep.direct);
    expect(await produced(machine, 'noted')).toBe(rendered.omit.noted);
    for (const findings of await gates(reached, machine))
      expect(findings).toEqual([mixed]);
  });

  it.each<[Reached[]]>([[['planned']], [['direct', 'planned']]])(
    'rejects an invocation that omits a labelled line whose value is present, reached through %j',
    async (reached) => {
      const machine = fixture('omit', reached, 'omit-present');
      // The fault shows only where the note is empty beside an IR number.
      for (const entry of reached)
        expect(await produced(machine, entry)).toBe(rendered.omit[entry]);
      for (const findings of await gates(reached, machine)) {
        expect(findings.join('\n')).toContain('REVIEW-1: FSM playbook text');
        expect(findings.join('\n')).not.toContain(mixed);
      }
    },
  );

  it.each<[string, Reached[]]>([
    ['leave-blank', ['direct']],
    ['leave-blank', ['planned']],
    ['remove-blank', ['direct']],
    ['remove-blank', ['planned']],
    ['drop-static', ['direct']],
  ])(
    'rejects an omitting invocation with a %s fault, reached through %j',
    async (fault, reached) => {
      const machine = fixture('omit', reached, fault);
      if (reached.includes('planned'))
        expect(await produced(machine, 'planned')).toBe(rendered.omit.planned);
      for (const findings of await gates(reached, machine)) {
        expect(findings.join('\n')).toContain('REVIEW-1: FSM playbook text');
        expect(findings.join('\n')).not.toContain(mixed);
      }
    },
  );

  it('rejects the trailing blank line an omission leaves behind', async () => {
    const machine = fixture('omit', ['direct'], 'leave-blank');
    expect(await produced(machine, 'direct')).toBe(`${rendered.omit.direct}\n`);
    for (const findings of await gates(['direct'], machine))
      expect(findings.join('\n')).toContain(unproved);
  });

  it('rejects another blank line removed with an omitted line', async () => {
    const machine = fixture('omit', ['direct'], 'remove-blank');
    expect(await produced(machine, 'direct')).toBe(
      rendered.omit.direct.replace('\n\n\n', '\n\n'),
    );
    for (const findings of await gates(['direct'], machine))
      expect(findings.join('\n')).toContain(unproved);
  });

  it.each<[Style, string, boolean, Reached[]]>([
    // Dropped although an IR number is reached.
    ['omit', 'never', false, ['planned']],
    ['omit', 'never', false, ['direct', 'planned']],
    // Faithfully empty, but no reached case reads an IR number at all.
    ['omit', '', true, ['direct']],
    ['omit', '', true, ['direct', 'noted']],
    ['keep', '', true, ['direct']],
  ])(
    'leaves unproved a relay no reached case fills (%s, fault %j, gated %s, reached %j)',
    async (style, fault, gated, reached) => {
      const machine = fixture(style, reached, fault, gated);
      for (const findings of await gates(reached, machine)) {
        expect(findings.join('\n')).toContain('REVIEW-1: FSM playbook text');
        expect(findings.join('\n')).not.toContain(mixed);
      }
    },
  );

  it('takes an omitted line for no mapping evidence until a reached case fills it', async () => {
    for (const reached of [
      ['direct', 'planned'],
      ['direct', 'noted', 'planned'],
    ] as Reached[][]) {
      const machine = fixture('omit', reached, '', true);
      for (const entry of reached)
        expect(await produced(machine, entry)).toBe(rendered.omit[entry]);
      expect(await gates(reached, machine)).toEqual([[], []]);
    }
  });

  it('uses the same bounded proof in actual emitted conformance suites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-empty-labelled-emitted-'));
    const repo = fileURLToPath(new URL('..', import.meta.url));
    try {
      await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      await writeFile(
        join(root, 'vitest.config.mjs'),
        `export default { cacheDir: ${JSON.stringify(join(root, '.vite'))}, test: { cache: false } };`,
      );
      await emitVerifierSupport(root);
      for (const [name, style, reached, fault] of [
        ['keep', 'keep', ['direct', 'planned'], ''],
        ['omit', 'omit', ['direct', 'planned'], ''],
        ['mix-lines', 'omit', ['direct'], 'mix-lines'],
        ['mix-probes', 'keep', ['direct'], 'mix-probes'],
        ['omit-present', 'omit', ['planned'], 'omit-present'],
        ['leave-blank', 'omit', ['direct'], 'leave-blank'],
      ] as [string, Style, Reached[], string][]) {
        await writeFile(
          join(root, `${name}.fsm.ts`),
          `import { fixture } from ${JSON.stringify(join(repo, 'test/fixtures/empty-labelled-child.ts'))}; export const machine = fixture(${JSON.stringify(style)}, ${JSON.stringify(reached)}, ${JSON.stringify(fault)});`,
        );
        await writeFile(join(root, `${name}.gears.md`), gears(reached));
        await writeFile(
          join(root, `${name}.gears-fsm.test.ts`),
          generateGearsFsmConformanceTest({
            basename: name,
            fsmModule: `./${name}.fsm.js`,
            gearsFile: `./${name}.gears.md`,
            verifyModule: './.slc-verify/verify.js',
          }),
        );
        const result = await promisify(execFile)(
          process.execPath,
          [
            join(repo, 'node_modules/vitest/vitest.mjs'),
            'run',
            '--root',
            root,
            '--config',
            join(root, 'vitest.config.mjs'),
            `${name}.gears-fsm.test.ts`,
          ],
          { cwd: root, timeout: 15000 },
        ).then(
          ({ stdout, stderr }) => ({ ok: true, output: stdout + stderr }),
          (error: { stdout?: string; stderr?: string }) => ({
            ok: false,
            output: (error.stdout ?? '') + (error.stderr ?? ''),
          }),
        );
        expect(result.ok, result.output).toBe(fault === '');
        if (name === 'mix-lines' || name === 'leave-blank')
          expect(result.output).toContain(
            'could not prove the complete expanded GEARS child-input composition',
          );
        if (name === 'mix-probes')
          expect(result.output).toContain(
            'mixes kept and omitted empty labelled child-input relay lines',
          );
        if (name === 'omit-present')
          expect(result.output).toContain('REVIEW-1: FSM playbook text');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 90000);
});

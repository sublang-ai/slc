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
  ownerFixture,
  ownerGears,
  template,
  type Reached,
  type Slot,
} from './fixtures/string-list-child.js';

const evidence = JSON.stringify([{ kind: 'caller', text: 'Request' }]);
const rendered = (slot: Slot, list: readonly string[]): string =>
  template(slot)
    .replace('<caller>', 'Request')
    .replaceAll('<commits>', list.join(', '))
    .replace('<evidence>', evidence);

/** The child input a real run hands the `review` child after `type`. */
async function produced(
  machine: ReturnType<typeof fixture>,
  type: 'DIRECT' | 'SERIES',
): Promise<string> {
  let text = '';
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
  actor.send({ type });
  for (let turn = 0; turn < 20 && !text; turn++) await Promise.resolve();
  actor.stop();
  return text;
}

describe('reached string-list child relays', () => {
  it.each<[Slot, Reached[]]>([
    ['inline', ['one']],
    ['inline', ['several']],
    ['labelled', ['one']],
    ['labelled', ['several']],
    ['both', ['one', 'several']],
    ['standalone', ['one']],
    ['standalone', ['one', 'several']],
    ['inline', ['empty', 'one']],
    ['standalone', ['empty', 'one']],
  ])(
    'accepts a %s list of %j accumulated by real predecessors, beside scalar and JSON relays',
    async (slot, reached) => {
      const machine = fixture(slot, reached);
      if (reached.includes('one'))
        expect(await produced(machine, 'DIRECT')).toBe(
          rendered(slot, commits.slice(1)),
        );
      if (reached.includes('several'))
        expect(await produced(machine, 'SERIES')).toBe(rendered(slot, commits));
      expect(
        await checkGearsFsmArtifact(gears(slot, reached), { machine }),
      ).toEqual([]);
      expect(
        await checkGearsFsmConformanceAsync(gears(slot, reached), { machine }),
      ).toEqual([]);
    },
  );

  it('keeps the synchronous conformance check conservative', () => {
    const findings = checkGearsFsmConformance(
      gears('inline'),
      fixture('inline').config,
    );
    expect(findings.join('\n')).toContain(
      'REVIEW-1: FSM playbook text could not prove the complete expanded GEARS child-input composition; check literal text, relay substitution/quoting/omission, canonical compact JSON for structured relays, and comma-joined string lists',
    );
  });

  it.each<[Slot]>([['inline'], ['labelled'], ['standalone']])(
    'validates an empty reached %s list under another case mapping',
    async (slot) => {
      expect(
        await checkGearsFsmArtifact(gears(slot), {
          machine: fixture(slot, ['empty', 'several']),
        }),
      ).toEqual([]);
      // An empty list is the empty string, never a slot of its own.
      expect(
        await checkGearsFsmArtifact(gears(slot), {
          machine: fixture(slot, ['empty', 'several'], 'separator'),
        }),
      ).not.toEqual([]);
    },
  );

  it.each<[Slot]>([['inline'], ['labelled'], ['standalone']])(
    'does not invent a %s list mapping when its only reached case is empty',
    async (slot) => {
      const machine = fixture(slot, ['empty']);
      expect(
        (await checkGearsFsmArtifact(gears(slot, ['empty']), { machine })).join(
          '\n',
        ),
      ).toContain('REVIEW-1: FSM playbook text');
      expect(
        await checkGearsFsmConformanceAsync(gears(slot, ['empty']), {
          machine,
        }),
      ).not.toEqual([]);
    },
  );

  it.each<[string, Slot]>([
    ['separator', 'inline'],
    ['separator', 'labelled'],
    ['compact', 'inline'],
    ['drop', 'inline'],
    ['drop', 'labelled'],
    ['reorder', 'inline'],
    ['reorder', 'labelled'],
    ['alter', 'inline'],
    ['alter', 'labelled'],
    ['hardcode', 'inline'],
    ['hardcode', 'labelled'],
    ['partly-json', 'inline'],
    ['partly-json', 'labelled'],
    ['json-and-list', 'both'],
    ['non-string', 'inline'],
    ['non-string', 'labelled'],
  ])('refuses a %s list in a %s slot', async (fault, slot) => {
    const machine = fixture(slot, ['several'], fault);
    const findings = await checkGearsFsmArtifact(gears(slot), { machine });
    expect(findings.join('\n')).toContain('REVIEW-1: FSM playbook text');
    expect(
      await checkGearsFsmConformanceAsync(gears(slot), { machine }),
    ).not.toEqual([]);
    if (fault === 'hardcode')
      expect(findings.join('\n')).toContain(
        'does not preserve comma-joined string-list substitutions',
      );
    // A baseline mismatch names the composition, never a reached payload.
    for (const commit of commits)
      expect(findings.join('\n')).not.toContain(commit);
  });

  it.each(['hardcode', 'alter', 'non-string'])(
    'refuses a %s single-element list',
    async (fault) => {
      for (const slot of ['inline', 'labelled'] as const)
        expect(
          await checkGearsFsmArtifact(gears(slot, ['one']), {
            machine: fixture(slot, ['one'], fault),
          }),
        ).not.toEqual([]);
    },
  );

  // One element shows no separator, order or selection: every rendering below
  // equals the faithful join there, and the search proves on the shortest path.
  it.each(['separator', 'compact', 'reorder', 'first', 'last', 'lowercase'])(
    'refuses a %s list wherever one element is reached before several',
    async (fault) => {
      for (const slot of ['inline', 'labelled', 'standalone'] as const)
        for (const reached of [
          ['one'],
          ['one', 'several'],
          ['empty', 'one'],
        ] as Reached[][]) {
          const machine = fixture(slot, reached, fault);
          // The real one-element run hands the child the faithful text.
          expect(await produced(machine, 'DIRECT')).toBe(
            rendered(slot, commits.slice(1)),
          );
          for (const findings of [
            await checkGearsFsmArtifact(gears(slot, reached), { machine }),
            await checkGearsFsmConformanceAsync(gears(slot, reached), {
              machine,
            }),
          ]) {
            expect(findings.join('\n')).toContain(
              'REVIEW-1: FSM playbook text does not preserve comma-joined string-list substitutions',
            );
            for (const commit of commits)
              expect(findings.join('\n')).not.toContain(commit);
          }
        }
    },
  );

  // An empty list a case merely reads earns no wait: an inline scalar relay
  // absent in the first reached case keeps the finding it has without a list.
  it.each<[string, boolean, unknown]>([
    ['reading a list that gains a string', true, commits[1]],
    ['reading a list that gains a number', true, 7],
    ['reading no list', false, commits[1]],
  ])(
    'keeps an absent scalar relay unproved when %s',
    async (_, readsTags, tag) => {
      const reached = ['absent', 'present'] as const;
      const machine = ownerFixture(readsTags, reached, tag);
      for (const findings of [
        await checkGearsFsmArtifact(ownerGears(reached), { machine }),
        await checkGearsFsmConformanceAsync(ownerGears(reached), { machine }),
      ])
        expect(findings.join('\n')).toContain(
          'REVIEW-1: FSM playbook text could not prove the complete expanded GEARS child-input composition',
        );
      // The composition itself is provable from the present case alone.
      expect(
        await checkGearsFsmArtifact(ownerGears(['present']), {
          machine: ownerFixture(readsTags, ['present'], tag),
        }),
      ).toEqual([]);
    },
  );

  it.each(['proxy', 'getter', 'hole', 'extra', 'prototype', 'bytes'])(
    'refuses an unsafe or excessive %s list without inspector hooks',
    async (fault) => {
      let hooks = 0;
      const decorate = (value: unknown) => {
        const data = value as string[];
        if (fault === 'proxy')
          return new Proxy(data, {
            getPrototypeOf(target) {
              hooks++;
              return Reflect.getPrototypeOf(target);
            },
            ownKeys(target) {
              hooks++;
              return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(target, key) {
              hooks++;
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
            isExtensible(target) {
              hooks++;
              return Reflect.isExtensible(target);
            },
          });
        if (fault === 'getter')
          Object.defineProperty(data, 0, {
            enumerable: true,
            configurable: true,
            get() {
              hooks++;
              return commits[0];
            },
          });
        if (fault === 'hole') delete data[0];
        if (fault === 'extra')
          Object.defineProperty(data, 'extra', {
            value: 'Extra',
            enumerable: true,
          });
        if (fault === 'prototype')
          Object.setPrototypeOf(data, Object.create(Array.prototype));
        if (fault === 'bytes') data[0] = 'x'.repeat(65537);
        return data;
      };
      // A faithful join of an unsafe list is refused all the same.
      for (const slot of ['inline', 'labelled'] as const)
        expect(
          await checkGearsFsmArtifact(gears(slot), {
            machine: fixture(slot, ['several'], '', decorate),
          }),
        ).not.toEqual([]);
      hooks = 0;
      expect(
        await checkGearsFsmArtifact(gears('labelled'), {
          machine: fixture('labelled', ['several'], 'unsafe', decorate),
        }),
      ).not.toEqual([]);
      expect(hooks).toBe(0);
    },
  );

  it('uses the same bounded proof in actual emitted conformance suites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-string-list-emitted-'));
    const repo = fileURLToPath(new URL('..', import.meta.url));
    try {
      await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      await writeFile(
        join(root, 'vitest.config.mjs'),
        `export default { cacheDir: ${JSON.stringify(join(root, '.vite'))}, test: { cache: false } };`,
      );
      await emitVerifierSupport(root);
      for (const [name, reached, fault] of [
        ['faithful', ['several'], ''],
        ['separator', ['several'], 'separator'],
        ['hardcode', ['several'], 'hardcode'],
        ['one', ['one'], ''],
        ['one-separator', ['one'], 'separator'],
      ] as [string, Reached[], string][]) {
        await writeFile(
          join(root, `${name}.fsm.ts`),
          `import { fixture } from ${JSON.stringify(join(repo, 'test/fixtures/string-list-child.ts'))}; export const machine = fixture('both', ${JSON.stringify(reached)}, ${JSON.stringify(fault)});`,
        );
        await writeFile(join(root, `${name}.gears.md`), gears('both', reached));
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
        if (name === 'separator')
          expect(result.output).toContain(
            'canonical compact JSON for structured relays, and comma-joined string lists',
          );
        // One reached element hides the separator from the baseline alone.
        if (name === 'hardcode' || name === 'one-separator')
          expect(result.output).toContain(
            'does not preserve comma-joined string-list substitutions',
          );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);
});

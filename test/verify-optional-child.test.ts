// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup } from 'xstate';
import { checkGearsFsmArtifact } from '../src/verify-coverage.js';

import { generateGearsFsmConformanceTest } from '../src/verify.js';
import { emitVerifierSupport } from '../src/verify-support.js';

import { fixture, gears, prompt } from './fixtures/optional-child.js';

async function gate(machine: ReturnType<typeof fixture>) {
  return checkGearsFsmArtifact(gears, { machine });
}

describe('reached optional literal-child relays', () => {
  it('proves mutually exclusive payloads through real public entries without sentinelizing mode', async () => {
    const machine = fixture();
    for (const type of ['LOCAL', 'REMOTE'] as const) {
      let text = '';
      const actor = createActor(
        machine.provide({
          actors: {
            playbook: fromPromise(async ({ input }) => {
              text = (input as { text: string }).text;
            }),
          },
        }),
      );
      actor.start();
      actor.send({ type });
      await Promise.resolve();
      actor.stop();
      expect(text).toBe(
        `Review exactly.\n> Request\n> ${type === 'LOCAL' ? 'Local' : 'Remote'}\nFinish exactly.\n`,
      );
    }
    expect(await gate(machine)).toEqual([]);
  });
  it('does not treat eager inactive reads as substituted payloads', async () => {
    expect(await gate(fixture('eager'))).toEqual([]);
  });

  it('does not deduplicate an unread stale payload between equivalent local entries', async () => {
    expect((await gate(fixture('stale-entry'))).join('\n')).toContain(
      'complete expanded GEARS child-input composition',
    );
  });

  it('retains the authored LF before omitted final standalone relays', async () => {
    const template =
      'Review exactly.\n> <caller>\n\n> <local-report>\n> <remote-report>';
    const source = `### RELAY-1\n\nCaptain shall call playbook \`review\`:\n${template
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n`;
    expect(
      await checkGearsFsmArtifact(source, {
        machine: fixture('', false, template),
      }),
    ).toEqual([]);
    expect(
      (
        await checkGearsFsmArtifact(source, {
          machine: fixture('terminal-separator', false, template),
        })
      ).join('\n'),
    ).toContain('empty standalone relay omission');
  });

  it('preserves strict control selectors while probing actual payloads', async () => {
    expect(await gate(fixture('strict-selector'))).toEqual([]);
  });

  it('retains predecessor assignments in the same replay search', async () => {
    const prefix =
      '### PREPARE-1\n\nCaptain shall call playbook `prepare`:\n> Prepare the report.\n\n';
    expect(
      await checkGearsFsmArtifact(prefix + gears, {
        machine: fixture('', true),
      }),
    ).toEqual([]);
  });

  it('keeps legacy sourceItem-less binding conservative for reversed same-target calls', async () => {
    const templates = [
      'First template.\n> Data: <payload>',
      'Second template.\n> Data: <payload>',
    ];
    const input =
      (stateId: string, template: string) =>
      ({ context }: { context: { value: string } }) => ({
        stateId,
        playbookId: 'review',
        text: template.replace('<payload>', () =>
          context.value.replace(/\n/g, '\n> '),
        ),
      });
    const machine = setup({
      actors: { playbook: fromPromise(async () => undefined) },
    }).createMachine({
      context: { value: 'Actual' },
      initial: 'second',
      states: {
        second: {
          id: 'second',
          tags: 'playbook.suspended',
          invoke: {
            src: 'playbook',
            input: input('second', templates[1]),
            onDone: 'first',
            onError: 'failed',
          },
        },
        first: {
          id: 'first',
          tags: 'playbook.suspended',
          invoke: {
            src: 'playbook',
            input: input('first', templates[0]),
            onDone: 'done',
            onError: 'failed',
          },
        },
        done: { type: 'final' },
        awaitBossReply: {
          tags: 'playbook.parked',
          on: { BOSS_REPLY: 'first' },
        },
        failed: { tags: 'playbook.parked' },
      },
    });
    const source = templates
      .map(
        (template, index) =>
          `### LEGACY-${index + 1}\n\nCaptain shall call playbook \`review\`:\n${template
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')}\n`,
      )
      .join('\n');
    expect(await checkGearsFsmArtifact(source, { machine })).toEqual([]);
  });

  it('refuses prior nested context mutation before another mode supplies its mapping', async () => {
    const shared: { left?: string; right?: string } = {
      left: 'Local',
      right: 'Hidden',
    };
    const machine = setup({
      types: {
        context: {} as { mode?: string; caller: string; facts: typeof shared },
      },
      actors: { playbook: fromPromise(async () => undefined) },
    }).createMachine({
      context: () => ({ caller: 'Request', facts: shared }),
      initial: 'idle',
      states: {
        idle: {
          on: {
            LOCAL: { target: 'call', actions: assign({ mode: 'local' }) },
            REMOTE: {
              target: 'call',
              actions: assign({
                mode: 'remote',
                facts: () => ({ right: 'Remote' }),
              }),
            },
          },
        },
        call: {
          id: 'call',
          tags: 'playbook.suspended',
          invoke: {
            src: 'playbook',
            input: ({ context }) => {
              const eager = {
                left: context.facts.left,
                right: context.facts.right,
              };
              const values: Record<string, string | undefined> = {
                '<caller>': context.caller,
                '<local-report>':
                  context.mode === 'local' ? eager.left : undefined,
                '<remote-report>':
                  context.mode === 'remote' ? eager.right : undefined,
              };
              const text = prompt
                .split(/(?<=\n)/)
                .filter((line) => {
                  const token = /^> (<[^>]+>)(?:\n)?$/.exec(line)?.[1];
                  return (
                    token === undefined ||
                    (values[token] !== undefined && values[token] !== '')
                  );
                })
                .join('')
                .replace(/<[^>]+>/g, (token) =>
                  (values[token] ?? token).replace(
                    /\r?\n/g,
                    (separator) => `${separator}> `,
                  ),
                );
              return {
                stateId: 'call',
                sourceItem: 'RELAY-1',
                playbookId: 'review',
                text,
              };
            },
            onDone: {
              target: 'done',
              actions: ({ context }) => {
                if (context.mode === 'local') shared.right = undefined;
              },
            },
            onError: 'failed',
          },
        },
        done: { type: 'final' },
        failed: { tags: 'playbook.parked' },
        awaitBossReply: { on: { BOSS_REPLY: 'idle' } },
      },
    });
    expect(
      (await checkGearsFsmArtifact(gears, { machine })).join('\n'),
    ).toContain('observed context changed before proof');
  });

  it('uses the same bounded proof in actual emitted conformance suites', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-optional-relay-emitted-'));
    const repo = fileURLToPath(new URL('..', import.meta.url));
    try {
      await symlink(join(repo, 'node_modules'), join(root, 'node_modules'));
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      await writeFile(
        join(root, 'vitest.config.mjs'),
        `export default { cacheDir: ${JSON.stringify(join(root, '.vite'))}, test: { cache: false } };`,
      );
      await emitVerifierSupport(root);
      for (const fault of ['', 'stale', 'separator']) {
        const name = fault || 'faithful';
        await writeFile(
          join(root, `${name}.fsm.ts`),
          `import { fixture } from ${JSON.stringify(join(repo, 'test/fixtures/optional-child.ts'))}; export const machine = fixture(${JSON.stringify(fault)});`,
        );
        await writeFile(join(root, `${name}.gears.md`), gears);
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
        if (fault === 'stale')
          expect(result.output).toContain(
            'complete expanded GEARS child-input composition',
          );
        if (fault === 'separator')
          expect(result.output).toContain('empty standalone relay omission');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20000);

  it.each([
    'deleted',
    'nonempty',
    'stale',
    'blank',
    'crlf',
    'identity',
    'invent',
    'separator',
  ])('refuses %s drift', async (fault) => {
    expect(await gate(fixture(fault))).not.toEqual([]);
  });
});

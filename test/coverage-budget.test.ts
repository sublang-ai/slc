// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
import { describe, expect, it } from 'vitest';
import { assign, createActor, fromPromise, setup } from 'xstate';
import {
  checkFsmCoverage,
  checkGearsFsmArtifact,
  checkGearsFsmConformanceAsync,
  fsmCoverageTestTimeout,
  generateFsmCoverageTest,
  FsmCoverageDeadlineError,
  resolveCoverageBudget,
  type CoverageBudget,
} from '../src/verify-coverage.js';
import { generateGearsFsmConformanceTest } from '../src/verify.js';
import { emitVerifierSupport } from '../src/verify-support.js';
import { resolveRunConfig, buildSlcDeps, usageText } from '../src/app.js';
import { loadConfigFile } from '../src/config-file.js';
import { runSlc } from '../src/runner.js';
import { branchingMachine } from './fixtures/coverage-budget-branching.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
function longMachine(
  impossible = false,
  observed: string[] = [],
  multipleResultCandidates = false,
) {
  const states: Record<string, any> = {
    idle: { on: { START: 'step0' } },
    done: { id: 'done', type: 'final' },
    awaitBossReply: { id: 'awaitBossReply', tags: 'playbook.parked' },
    failed: { id: 'failed', type: 'final' },
  };
  for (let i = 0; i < 10; i++)
    states[`step${i}`] = {
      id: `step${i}`,
      invoke: {
        src: 'playbook',
        input: () => ({
          stateId: `step${i}`,
          sourceItem: `STEP-${i}`,
          playbookId: 'child',
          text: 'Perform the child.',
        }),
        onDone: [
          {
            guard: ({ context, event }: any) =>
              context.position === i &&
              (multipleResultCandidates
                ? event.output?.accepted === true
                : Object.keys(event.output).length === 0) &&
              !(impossible && i === 9),
            target: i === 9 ? '#done' : `#step${i + 1}`,
            actions: assign(({ context }: any) => ({
              position: context.position + 1,
            })),
          },
        ],
        onError: '#failed',
      },
      entry: () => observed.push(`step${i}`),
    };
  return setup({
    actors: {
      playbook: fromPromise(async () => {
        throw Error('unbound');
      }),
    },
  }).createMachine({
    id: 'long-budget',
    initial: 'idle',
    context: { position: 0 },
    states,
  });
}
const large = { maxInvocations: 12, maxAttempts: 1024 };

describe('finite coverage policy through public integration boundaries', () => {
  it('executes a real ten-invocation path and isolates concurrent default/larger checks', async () => {
    let starts = 0;
    const live = createActor(
      longMachine().provide({
        actors: {
          playbook: fromPromise(async () => {
            starts++;
            return {};
          }),
        },
      }),
    );
    live.start();
    live.send({ type: 'START' });
    for (let i = 0; i < 50 && live.getSnapshot().status !== 'done'; i++)
      await new Promise((r) => setTimeout(r, 0));
    expect(live.getSnapshot().value).toBe('done');
    expect(starts).toBe(10);
    live.stop();
    const [defaults, expanded] = await Promise.all([
      checkFsmCoverage({ machine: longMachine() }),
      checkFsmCoverage({ machine: longMachine() }, { coverage: large }),
    ]);
    expect(defaults.join('\n')).toContain('8-invocation');
    expect(expanded).toEqual([]);
  }, 120000);

  it('retains generic competing-prefix exhaustion by default and proves it with an explicit attempt budget', async () => {
    const defaults = await checkFsmCoverage({
      machine: branchingMachine({ strictEntry: true }),
    });
    expect(defaults).toContain(
      'state inspect: nested playbook onDone arm 3: exhausted 64-attempt path budget',
    );
    const moderateStarted = performance.now();
    const moderate = await checkFsmCoverage(
      { machine: branchingMachine({ strictEntry: true }) },
      { coverage: { maxAttempts: 256 } },
    );
    console.info(
      JSON.stringify({
        control: 'generic-branching',
        maxAttempts: 256,
        elapsedMs: performance.now() - moderateStarted,
        findings: moderate,
      }),
    );
    expect(moderate).toEqual([]);
    const trace: any[] = [];
    const expanded = await checkFsmCoverage(
      { machine: branchingMachine({ strictEntry: true, trace }) },
      { coverage: { maxAttempts: 1024 } },
    );
    expect(
      trace.some(
        (x) =>
          x.id === 'inspect' &&
          x.origin === 'afterBoth' &&
          x.planAccepted &&
          x.buildAccepted,
      ),
    ).toBe(true);
    console.info(
      JSON.stringify({
        control: 'generic-branching',
        maxAttempts: 1024,
        findings: expanded,
      }),
    );
    expect(expanded).toEqual([]);
  }, 180000);

  it('retains the many-result ten-child exhaustion even at the finite cap', async () => {
    const findings = await checkFsmCoverage(
      { machine: longMachine(false, [], true) },
      { coverage: large },
    );
    expect(
      findings.some((x) => x.includes('step9') && x.includes('1024-attempt')),
    ).toBe(true);
  }, 120000);

  it('does not accept an impossible guarded completion or extend the deadline', async () => {
    const findings = await checkFsmCoverage(
      { machine: longMachine(true) },
      { coverage: large },
    );
    expect(
      findings.some((x) => x.includes('step9') && x.includes('arm 0')),
    ).toBe(true);
    await expect(
      checkFsmCoverage(
        { machine: longMachine() },
        { coverage: large, timeoutMs: 1 },
      ),
    ).rejects.toBeInstanceOf(FsmCoverageDeadlineError);
    expect(
      fsmCoverageTestTimeout(
        { machine: longMachine() },
        { maxInvocations: 64, maxAttempts: 1024 },
      ),
    ).toBe(300000);
  }, 120000);

  it.each([
    null,
    0,
    [],
    { maxInvocations: 0 },
    { maxInvocations: 65 },
    { maxInvocations: 1.1 },
    { maxInvocations: '9' },
    { maxAttempts: -1 },
    { maxAttempts: Infinity },
    { maxAttempts: NaN },
    { maxAttempts: 1025 },
    { maxAttempt: 10 },
    { [Symbol('extra')]: 1 },
    Object.defineProperty({}, 'extra', { value: 1 }),
  ])(
    'rejects %j before accessing the artifact at every public check',
    async (value) => {
      let accessed = 0;
      const artifact = {
        get machine() {
          accessed++;
          throw Error('must not inspect');
        },
      };
      const coverage = value as CoverageBudget;
      await expect(checkFsmCoverage(artifact, { coverage })).rejects.toThrow(
        /coverage/,
      );
      await expect(
        checkGearsFsmArtifact('', artifact, { coverage }),
      ).rejects.toThrow(/coverage/);
      await expect(
        checkGearsFsmConformanceAsync('', artifact, { coverage }),
      ).rejects.toThrow(/coverage/);
      expect(() => fsmCoverageTestTimeout(artifact, coverage)).toThrow(
        /coverage/,
      );
      expect(accessed).toBe(0);
    },
  );

  it('passes the same policy through real producer and protected FSM consumer gates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-budget-producer-'));
    const repository = fileURLToPath(new URL('..', import.meta.url));
    try {
      await symlink(
        join(repository, 'node_modules'),
        join(root, 'node_modules'),
        'dir',
      );
      const pipeline = join(root, 'pipeline');
      await mkdir(pipeline);
      const format = (sf: string, tf: string) =>
        `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${sf} | ${sf === 'gears' ? '.md' : '.ts'} |\n| target | ${tf} | .ts |\n`;
      await writeFile(join(pipeline, 'gears2fsm.md'), format('gears', 'fsm'));
      await writeFile(join(pipeline, 'fsm2output.md'), format('fsm', 'output'));
      const gears = Array.from(
        { length: 10 },
        (_, i) =>
          `### STEP-${i}\n\nCaptain shall call playbook \`child\`:\n> Perform the child.\n`,
      ).join('\n');
      const source = join(root, 'case.gears.md');
      await writeFile(source, gears);
      const testSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
      const fn = testSource.slice(
        testSource.indexOf('function longMachine'),
        testSource.indexOf('const large ='),
      );
      const content = `import { assign, fromPromise, setup } from 'xstate';\n${fn}\nexport const machine = longMachine();\n`;
      let calls = 0;
      const executor = {
        run: async (request: any) => {
          calls++;
          await writeFile(request.target, content);
          return { status: 'ok' as const };
        },
      };
      const deps = { cwd: root, resolver: () => [pipeline], executor };
      const rejected = await runSlc(['flow.gears2fsm', source], deps);
      expect(rejected.ok, rejected.diagnostics.join('\n')).toBe(false);
      expect(rejected.diagnostics.join('\n')).toContain('8-invocation');
      const accepted = await runSlc(['flow.gears2fsm', source], {
        ...deps,
        coverage: large,
      });
      expect(accepted.ok, accepted.diagnostics.join('\n')).toBe(true);
      const target = join(root, 'case.flow', 'case.fsm.ts');
      const before = await readFile(target);
      const beforeCalls = calls;
      const refusedConsumer = await runSlc(['flow.fsm2output', target], deps);
      expect(refusedConsumer.ok).toBe(false);
      expect(calls).toBe(beforeCalls);
      const acceptedConsumer = await runSlc(['flow.fsm2output', target], {
        ...deps,
        coverage: large,
      });
      expect(acceptedConsumer.ok, acceptedConsumer.diagnostics.join('\n')).toBe(
        true,
      );
      expect(calls).toBe(beforeCalls + 1);
      expect(await readFile(target)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120000);

  it('executes portable emitted suites with the selected policy on a ten-invocation path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-budget-emitted-'));
    const repository = fileURLToPath(new URL('..', import.meta.url));
    try {
      await symlink(
        join(repository, 'node_modules'),
        join(root, 'node_modules'),
        'dir',
      );
      await writeFile(join(root, 'package.json'), '{"type":"module"}');
      await writeFile(
        join(root, 'vitest.config.mjs'),
        `export default { cacheDir: ${JSON.stringify(join(root, '.vite'))}, test: { cache: false } };`,
      );
      await emitVerifierSupport(root);
      const testSource = await readFile(fileURLToPath(import.meta.url), 'utf8');
      const fn = testSource.slice(
        testSource.indexOf('function longMachine'),
        testSource.indexOf('const large ='),
      );
      await writeFile(
        join(root, 'long.fsm.ts'),
        `import { assign, fromPromise, setup } from 'xstate';\n${fn}\nexport const machine = longMachine();\n`,
      );
      await writeFile(
        join(root, 'long.gears.md'),
        Array.from(
          { length: 10 },
          (_, i) =>
            `### STEP-${i}\n\nCaptain shall call playbook \`child\`:\n> Perform the child.\n`,
        ).join('\n'),
      );
      for (const [name, coverage, expected] of [
        ['default', undefined, false],
        ['expanded', large, true],
      ] as const) {
        const options = {
          basename: name,
          fsmModule: './long.fsm.js',
          fsmSourceFile: './long.fsm.ts',
          gearsFile: './long.gears.md',
          verifyModule: './.slc-verify/verify.js',
          coverage,
        };
        const suites = [
          `${name}.gears-fsm.test.ts`,
          `${name}.fsm.coverage.test.ts`,
        ];
        await writeFile(
          join(root, suites[0]),
          generateGearsFsmConformanceTest(options),
        );
        await writeFile(
          join(root, suites[1]),
          generateFsmCoverageTest(options),
        );
        const result = await promisify(execFile)(
          process.execPath,
          [
            join(repository, 'node_modules/vitest/vitest.mjs'),
            'run',
            '--root',
            root,
            '--config',
            join(root, 'vitest.config.mjs'),
            ...suites,
          ],
          { cwd: root, timeout: 30000 },
        ).then(
          ({ stdout, stderr }) => ({ ok: true, output: stdout + stderr }),
          (error: { stdout?: string; stderr?: string }) => ({
            ok: false,
            output: (error.stdout ?? '') + (error.stderr ?? ''),
          }),
        );
        expect(result.ok, result.output).toBe(expected);
        if (!expected) expect(result.output).toContain('8-invocation');
        else expect(result.output).toMatch(/2 passed/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);

  it('serializes policy for both emitted checkers and their timeout without ambient environment lookup', () => {
    for (const text of [
      generateFsmCoverageTest({
        basename: 'long',
        fsmModule: './long.fsm.js',
        fsmSourceFile: './long.fsm.ts',
        verifyModule: './verify.js',
        coverage: large,
      }),
      generateGearsFsmConformanceTest({
        basename: 'long',
        fsmModule: './long.fsm.js',
        gearsFile: './long.gears.md',
        verifyModule: './verify.js',
        coverage: large,
      }),
    ]) {
      expect(text).toContain('"maxInvocations":12,"maxAttempts":1024');
      expect(text).toContain('fsmCoverageTestTimeout(fsm, coverage)');
      expect(text).not.toContain('process.env');
    }
    expect(resolveCoverageBudget()).toEqual({
      maxInvocations: 8,
      maxAttempts: 64,
    });
  });

  it('loads YAML, overlays each environment key, and passes policy without constructing a real adapter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'slc-budget-config-'));
    try {
      const configPath = join(root, 'slc.config.yaml');
      await writeFile(
        configPath,
        'agent: claude-code\ncoverageMaxInvocations: 12\ncoverageMaxAttempts: 256\n',
      );
      const file = await loadConfigFile({ cwd: root, configPath });
      const env = {
        SLC_COVERAGE_MAX_ATTEMPTS: '1024',
        SLC_COVERAGE_MAX_INVOCATIONS: ' ',
      };
      expect(resolveRunConfig(env, file.config).coverage).toEqual(large);
      const deps = await buildSlcDeps(
        { env, cwd: root, configPath, signal: new AbortController().signal },
        () => ({
          run: async () => {
            throw Error('no phase');
          },
        }),
        () => () => ({
          run: async () => {
            throw Error('no compiled phase');
          },
        }),
      );
      expect(deps.coverage).toEqual(large);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['0', '-1', '1.5', '1025', 'Infinity', 'NaN', 'no'])(
    'rejects invalid environment attempt limit %s before adapter construction',
    async (value) => {
      const root = await mkdtemp(join(tmpdir(), 'slc-budget-invalid-'));
      try {
        const configPath = join(root, 'slc.config.yaml');
        await writeFile(configPath, 'agent: claude-code\n');
        await expect(
          buildSlcDeps(
            {
              env: { SLC_COVERAGE_MAX_ATTEMPTS: value },
              cwd: root,
              configPath,
              signal: new AbortController().signal,
            },
            () => {
              throw Error('adapter must not be constructed');
            },
          ),
        ).rejects.toThrow('coverage.maxAttempts');
        await writeFile(configPath, `coverageMaxAttempts: ${value}\n`);
        await expect(loadConfigFile({ cwd: root, configPath })).rejects.toThrow(
          'coverage.maxAttempts',
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('refuses invalid run policy before resolver IO or phase work and documents env/config names', async () => {
    const result = await runSlc(['playbook', 'missing.md'], {
      coverage: { maxAttempts: 1025 },
      resolver: () => {
        throw Error('resolver must not run');
      },
      executor: {
        run: async () => {
          throw Error('no phase');
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join(' ')).toContain('maxAttempts');
    expect(usageText()).toContain('SLC_COVERAGE_MAX_INVOCATIONS');
    expect(usageText()).toContain('coverageMaxAttempts');
  });
});

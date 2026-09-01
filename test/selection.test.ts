// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ExecuteRequest,
  ExecutorResult,
  PhaseExecutor,
} from '../src/execution.js';
import { hashFile } from '../src/hash.js';
import { evaluatePins, hashTree } from '../src/pin-currency.js';
import { PIN_INPUTS_FILE, PIN_INPUTS_SCHEMA } from '../src/pin-inputs.js';
import {
  PINS_FILE,
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  type PinRecord,
} from '../src/pins.js';
import { runSlc, type CompiledSelection, type SlcDeps } from '../src/runner.js';

const formats = (sf: string, se: string, tf: string, te: string): string =>
  `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | ${sf} | ${se} |\n| target | ${tf} | ${te} |\n`;

const linkDoc = `## Formats\n\n| Role | Format | Extension |\n| --- | --- | --- |\n| source | fsm | .ts |\n| target | run | .ts |\n\n## Link Targets\n\n| Target form | Meaning |\n| --- | --- |\n| <path>.ts | A runner module. |\n`;

/** An executor that records its calls and writes its target so generic checks pass. */
function spyExecutor(
  label: string,
): PhaseExecutor & { calls: ExecuteRequest[] } {
  const calls: ExecuteRequest[] = [];
  return {
    calls,
    async run(request: ExecuteRequest): Promise<ExecutorResult> {
      calls.push(request);
      const target =
        request.kind === 'compile' ? request.target : request.linked;
      await writeFile(target, `${label} output\n`);
      return { status: 'ok', diagnostics: [`${label} ran`] };
    },
  };
}

describe('compiled selection and pin-input safety (phase-execution-28, phase-execution-40)', () => {
  let root: string;
  let pipelineDir: string;
  let source: string;
  let interpreted: ReturnType<typeof spyExecutor>;
  let compiled: ReturnType<typeof spyExecutor>;
  let selections: CompiledSelection[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'slc-sel-'));
    pipelineDir = join(root, 'pipe');
    const srcDir = join(root, 'work');
    await mkdir(pipelineDir);
    await mkdir(srcDir);
    await writeFile(
      join(pipelineDir, 'text2gears.md'),
      formats('text', '.md', 'gears', '.md'),
    );
    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      formats('gears', '.md', 'fsm', '.ts'),
    );
    await writeFile(join(pipelineDir, 'link.md'), linkDoc);
    source = join(srcDir, 'onboarding.md');
    await writeFile(source, 'prose');

    interpreted = spyExecutor('interpreted');
    compiled = spyExecutor('compiled');
    selections = [];
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const deps = (withCompiled = true): SlcDeps => ({
    resolver: (reference) =>
      reference === 'playbook' || reference === 'flow' ? [pipelineDir] : [],
    executor: interpreted,
    compiled: withCompiled
      ? (selection) => {
          selections.push(selection);
          return compiled;
        }
      : undefined,
    // DR-014: anchor artifact placement to the fixture, not the process cwd.
    cwd: dirname(source),
  });

  /** Writes a current pin over committed artifact and link files. */
  const writeCurrentPin = async (phase = 'text2gears'): Promise<PinRecord> => {
    const bundleDir = join(pipelineDir, `${phase}.slc`);
    await mkdir(bundleDir);
    await writeFile(
      join(bundleDir, `${phase}.playbook.ts`),
      'export default function createPlaybookRuntime() {\n  return { init: async () => {}, handleBossInput: async () => {}, dispose: async () => {} };\n}\n',
    );
    for (const suffix of [
      'fsm.ts',
      'gears.md',
      'gears-fsm.test.ts',
      'fsm.introspect.test.ts',
      'prompt-contract.test.ts',
      'fsm.coverage.test.ts',
    ]) {
      const name = `${phase}.${suffix}`;
      await writeFile(join(bundleDir, name), `fixture: ${name}\n`);
    }
    await writeFile(join(pipelineDir, 'linktarget.ts'), 'link target bytes\n');
    const record: PinRecord = {
      definition: {
        path: `${phase}.md`,
        hash: await hashFile(join(pipelineDir, `${phase}.md`)),
      },
      artifact: {
        path: `${phase}.slc/${phase}.playbook.ts`,
        hash: await hashFile(join(bundleDir, `${phase}.playbook.ts`)),
      },
      artifactBundle: {
        path: `${phase}.slc`,
        hash: await hashTree(bundleDir),
      },
      semanticInputs: [],
      externalInputs: [],
      runtimeDependencies: [],
      linkTarget: {
        kind: 'file',
        locator: 'linktarget.ts',
        identity: await hashFile(join(pipelineDir, 'linktarget.ts')),
      },
    };
    await writePins({ [phase]: record });
    return record;
  };

  const writePins = async (
    pins: Record<string, unknown>,
    pathBoundary = '.',
  ): Promise<void> => {
    await writeFile(
      join(pipelineDir, PINS_FILE),
      JSON.stringify(
        {
          schema: PIN_SCHEMA,
          hashAlgorithm: PIN_HASH_ALGORITHM,
          pathBoundary: { path: pathBoundary },
          pins,
        },
        null,
        2,
      ),
    );
  };

  const runPhase = () => runSlc(['playbook.text2gears', source], deps());

  it('interprets a phase with no pin file', async () => {
    const result = await runPhase();
    expect(result.ok).toBe(true);
    expect(interpreted.calls).toHaveLength(1);
    expect(compiled.calls).toHaveLength(0);
  });

  it('interprets a phase absent from a present pin file', async () => {
    await writePins({});
    const result = await runPhase();
    expect(result.ok).toBe(true);
    expect(interpreted.calls).toHaveLength(1);
    expect(compiled.calls).toHaveLength(0);
  });

  it('runs the compiled artifact for a current pin', async () => {
    await writeCurrentPin();
    const result = await runPhase();
    expect(result.ok).toBe(true);
    expect(compiled.calls).toHaveLength(1);
    expect(interpreted.calls).toHaveLength(0);
    expect(selections[0]?.phase).toBe('text2gears');
    expect(selections[0]?.record.artifact.path).toBe(
      'text2gears.slc/text2gears.playbook.ts',
    );
  });

  it('accepts an in-boundary definition symlink to the selected file (phase-execution-28)', async () => {
    const record = await writeCurrentPin();
    const aliases = join(pipelineDir, 'aliases');
    const definitionAlias = join(aliases, 'text2gears.md');
    await mkdir(aliases);
    await symlink('../text2gears.md', definitionAlias);
    record.definition = {
      path: 'aliases/text2gears.md',
      hash: await hashFile(definitionAlias),
    };
    await writePins({ text2gears: record });

    expect((await evaluatePins(pipelineDir)).verdicts?.text2gears).toEqual({
      status: 'current',
    });
    const result = await runPhase();

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(compiled.calls).toHaveLength(1);
    expect(interpreted.calls).toHaveLength(0);
    expect(selections).toHaveLength(1);
  });

  it('keeps a current external-definition pin dormant until resolution selects it (phase-execution-28)', async () => {
    const record = await writeCurrentPin();
    const installedDefinition = join(
      root,
      'node_modules/@sublang/playbook/slc/text2gears.md',
    );
    await mkdir(dirname(installedDefinition), { recursive: true });
    await writeFile(
      installedDefinition,
      await readFile(join(pipelineDir, 'text2gears.md')),
    );
    record.definition = {
      path: '../node_modules/@sublang/playbook/slc/text2gears.md',
      hash: await hashFile(installedDefinition),
    };
    await writePins({ text2gears: record }, '..');

    expect((await evaluatePins(pipelineDir)).verdicts?.text2gears).toEqual({
      status: 'current',
    });
    const result = await runPhase();

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(
      /pin-recorded definition.*selected pipeline definition/,
    );
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
    expect(selections).toHaveLength(0);
  });

  it('does not let Reuse bypass the external-definition dormancy guard (phase-execution-28)', async () => {
    const record = await writeCurrentPin();
    const first = await runSlc(['flow', source], deps());
    expect(first.ok, first.diagnostics.join('\n')).toBe(true);

    const installedDefinition = join(
      root,
      'node_modules/@sublang/playbook/slc/text2gears.md',
    );
    await mkdir(dirname(installedDefinition), { recursive: true });
    const definitionBytes = await readFile(join(pipelineDir, 'text2gears.md'));
    await symlink(join(pipelineDir, 'text2gears.md'), installedDefinition);
    record.definition = {
      path: '../node_modules/@sublang/playbook/slc/text2gears.md',
      hash: await hashFile(installedDefinition),
    };
    await writePins({ text2gears: record }, '..');
    interpreted.calls.length = 0;
    compiled.calls.length = 0;
    selections.length = 0;

    const reuseControl = await runSlc(['flow', source], deps());
    expect(reuseControl).toMatchObject({ ok: true, outcome: 'up-to-date' });
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
    expect(selections).toHaveLength(0);

    await rm(installedDefinition);
    await writeFile(installedDefinition, definitionBytes);
    const result = await runSlc(['flow', source], deps());

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(
      /pin-recorded definition.*selected pipeline definition/,
    );
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
    expect(selections).toHaveLength(0);
  });

  it('never selects a pipeline pass pin for the built-in normalizer', async () => {
    await writeFile(
      join(pipelineDir, 'normalize.md'),
      formats('gears', '.md', 'gears', '.md'),
    );
    await writeCurrentPin('normalize');

    const result = await runSlc(['flow', source, '--normalize'], deps());

    expect(result.ok, result.diagnostics.join('\n')).toBe(true);
    expect(compiled.calls).toHaveLength(1);
    expect(compiled.calls[0]?.definitionPath).toBe(
      join(pipelineDir, 'normalize.md'),
    );
    expect(selections.map((selection) => selection.phase)).toEqual([
      'normalize',
    ]);
    expect(interpreted.calls[0]?.kind).toBe('compile');
    expect(interpreted.calls[0]?.definitionPath).not.toBe(
      join(pipelineDir, 'normalize.md'),
    );
  });

  it('refuses a phase target that aliases the pin index', async () => {
    await writeCurrentPin();
    const pinsPath = join(pipelineDir, PINS_FILE);
    const gearsSource = join(dirname(source), 'onboarding.gears.md');
    await writeFile(gearsSource, 'gears input\n');
    const original = await readFile(pinsPath);

    const result = await runSlc(
      ['playbook.gears2fsm', gearsSource, '-o', pinsPath],
      deps(),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('aliases protected input');
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
    expect(await readFile(pinsPath)).toEqual(original);
  });

  it('refuses a phase target inside a pinned artifact bundle', async () => {
    await writeCurrentPin();
    const gearsSource = join(dirname(source), 'onboarding.gears.md');
    await writeFile(gearsSource, 'gears input\n');
    const target = join(pipelineDir, 'text2gears.slc', 'generated.md');

    const result = await runSlc(
      ['playbook.gears2fsm', gearsSource, '-o', target],
      deps(),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('aliases protected input');
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
  });

  it.each(['regular file', 'dangling symlink'] as const)(
    'does not let an impossible stale-pin path through a %s veto an unpinned phase (phase-execution-45)',
    async (shape) => {
      await writeCurrentPin();
      const bundleDir = join(pipelineDir, 'text2gears.slc');
      await rm(bundleDir, { recursive: true });
      if (shape === 'regular file') {
        await writeFile(bundleDir, 'stale bundle path\n');
      } else {
        await symlink(join(pipelineDir, 'missing-bundle'), bundleDir);
      }
      const gearsSource = join(dirname(source), 'onboarding.gears.md');
      await writeFile(gearsSource, 'gears input\n');

      const result = await runSlc(['playbook.gears2fsm', gearsSource], deps());

      expect(result.ok).toBe(true);
      expect(interpreted.calls).toHaveLength(1);
      expect(compiled.calls).toHaveLength(0);
    },
  );

  it('keeps the file blocking a stale pin path protected (phase-execution-45)', async () => {
    await writeCurrentPin();
    const bundleDir = join(pipelineDir, 'text2gears.slc');
    await rm(bundleDir, { recursive: true });
    await writeFile(bundleDir, 'protected stale bundle\n');
    const gearsSource = join(dirname(source), 'onboarding.gears.md');
    await writeFile(gearsSource, 'gears input\n');

    const result = await runSlc(
      ['playbook.gears2fsm', gearsSource, '-o', bundleDir],
      deps(),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toContain('aliases protected input');
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
    expect(await readFile(bundleDir, 'utf8')).toBe('protected stale bundle\n');
  });

  it('fails closed for a stale pin without interpreting', async () => {
    await writeCurrentPin();
    // Mutate the pinned artifact after pinning so its hash no longer matches.
    await writeFile(
      join(pipelineDir, 'text2gears.slc/text2gears.playbook.ts'),
      'changed\n',
    );
    const result = await runPhase();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(/stale/);
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
  });

  it('fails closed for a malformed pin record', async () => {
    const record = await writeCurrentPin();
    record.definition.hash = 'not-a-hash';
    await writePins({ text2gears: record });
    const result = await runPhase();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(/malformed/);
    expect(compiled.calls).toHaveLength(0);
  });

  it('fails closed when an unselected stale pin has a malformed sidecar closure', async () => {
    const record = await writeCurrentPin();
    const unrelated = await writeCurrentPin('gears2fsm');
    await writePins({ text2gears: record, gears2fsm: unrelated });
    await writeFile(
      join(pipelineDir, PIN_INPUTS_FILE),
      JSON.stringify({
        schema: PIN_INPUTS_SCHEMA,
        closures: { gears2fsm: ['./gears2fsm.md'] },
      }),
    );
    await writeFile(
      join(pipelineDir, 'gears2fsm.md'),
      `${await readFile(join(pipelineDir, 'gears2fsm.md'), 'utf8')}\n<!-- independently stale -->\n`,
    );

    const result = await runPhase();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(
      /closures\.gears2fsm\[0\].*definition/,
    );
    expect(interpreted.calls).toHaveLength(0);
    expect(compiled.calls).toHaveLength(0);
    expect(selections).toHaveLength(0);
  });

  it('fails closed for an unparseable pin file', async () => {
    await writeFile(join(pipelineDir, PINS_FILE), '{ not json');
    const result = await runPhase();
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(/not valid JSON/);
    expect(interpreted.calls).toHaveLength(0);
  });

  it('fails closed for a current pin when no compiled executor is configured', async () => {
    await writeCurrentPin();
    const result = await runSlc(['playbook.text2gears', source], deps(false));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.join('\n')).toMatch(
      /no compiled executor configured/,
    );
  });
});

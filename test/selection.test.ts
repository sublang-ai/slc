// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  ExecuteRequest,
  ExecutorResult,
  PhaseExecutor,
} from '../src/execution.js';
import { hashFile } from '../src/hash.js';
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

describe('compiled selection (PHEXEC-28)', () => {
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
    resolver: (reference) => (reference === 'playbook' ? [pipelineDir] : []),
    executor: interpreted,
    compiled: withCompiled
      ? (selection) => {
          selections.push(selection);
          return compiled;
        }
      : undefined,
  });

  /** Writes a current pin for `text2gears` over committed artifact and link files. */
  const writeCurrentPin = async (): Promise<PinRecord> => {
    await writeFile(
      join(pipelineDir, 'text2gears.phase.mjs'),
      'export default () => ({});\n',
    );
    await writeFile(join(pipelineDir, 'linktarget.ts'), 'link target bytes\n');
    const record: PinRecord = {
      definition: {
        path: 'text2gears.md',
        hash: await hashFile(join(pipelineDir, 'text2gears.md')),
      },
      artifact: {
        path: 'text2gears.phase.mjs',
        hash: await hashFile(join(pipelineDir, 'text2gears.phase.mjs')),
      },
      semanticInputs: [],
      externalInputs: [],
      linkTarget: {
        kind: 'file',
        locator: 'linktarget.ts',
        identity: await hashFile(join(pipelineDir, 'linktarget.ts')),
      },
    };
    await writePins({ text2gears: record });
    return record;
  };

  const writePins = async (pins: Record<string, unknown>): Promise<void> => {
    await writeFile(
      join(pipelineDir, PINS_FILE),
      JSON.stringify(
        {
          schema: PIN_SCHEMA,
          hashAlgorithm: PIN_HASH_ALGORITHM,
          pathBoundary: { path: '.' },
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
    expect(selections[0]?.record.artifact.path).toBe('text2gears.phase.mjs');
  });

  it('fails closed for a stale pin without interpreting', async () => {
    await writeCurrentPin();
    // Mutate the pinned artifact after pinning so its hash no longer matches.
    await writeFile(join(pipelineDir, 'text2gears.phase.mjs'), 'changed\n');
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

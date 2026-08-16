// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai>

/**
 * Integration acceptance for incremental compilation (INCR-18..26), driven by
 * fixture pipelines and counting fixture agents — no live model calls.
 */

import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadBuildHistory } from '../src/build-history.js';
import { hashBytes, hashFile } from '../src/hash.js';
import {
  createInterpretedExecutor,
  type AgentClient,
} from '../src/interpreter.js';
import { hashTree } from '../src/pin-currency.js';
import {
  PINS_FILE,
  PIN_HASH_ALGORITHM,
  PIN_SCHEMA,
  type PinRecord,
} from '../src/pins.js';
import { runSlc, type SlcDeps } from '../src/runner.js';

const formats = (sf: string, se: string, tf: string, te: string): string =>
  `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | ${sf} | ${se} |
| target | ${tf} | ${te} |
`;

const linkDoc = `## Formats

| Role | Format | Extension |
| --- | --- | --- |
| source | fsm | .ts |
| target | run | .ts |

## Link Targets

| Target form | Meaning |
| --- | --- |
| <path>.ts | A runner module. |
`;

interface AgentCall {
  prompt: string;
  /** Bytes at the declared target when the agent ran, or null when absent. */
  priorTarget: string | null;
}

/**
 * An agent that writes each prompt's declared target. `content` maps a target
 * basename to the bytes written (default `output\n`); `failOn` makes the call
 * for that target basename fail without writing.
 */
const makeAgent = (
  opts: {
    content?: Record<string, string>;
    failOn?: string;
  } = {},
): { agent: AgentClient; calls: AgentCall[] } => {
  const calls: AgentCall[] = [];
  const agent: AgentClient = {
    run: async ({ prompt }) => {
      const match = /artifact to write: (.+)/.exec(prompt);
      const target = match ? match[1].trim() : null;
      let priorTarget: string | null = null;
      if (target !== null) {
        try {
          priorTarget = await readFile(target, 'utf8');
        } catch {
          priorTarget = null;
        }
      }
      calls.push({ prompt, priorTarget });
      if (target === null) return { status: 'error', text: 'no target' };
      const base = target.split('/').pop() as string;
      if (opts.failOn === base) {
        return { status: 'error', text: 'agent failed' };
      }
      await writeFile(target, opts.content?.[base] ?? 'output\n');
      return { status: 'success', text: 'wrote the artifact' };
    },
  };
  return { agent, calls };
};

let root: string;
let pipelineDir: string;
let srcDir: string;
let source: string;
let artDir: string;

const deps = (agent: AgentClient): SlcDeps => ({
  resolver: (reference) => (reference === 'flow' ? [pipelineDir] : []),
  executor: createInterpretedExecutor({ agent }),
  cwd: srcDir,
});

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'slc-incr-'));
  pipelineDir = join(root, 'pipe');
  srcDir = join(root, 'work');
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
  await writeFile(source, 'prose\n');
  artDir = join(srcDir, 'onboarding.flow');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('INCR-18: a cold run records a complete first build', () => {
  it('records manifest, copies, and latest', async () => {
    const { agent } = makeAgent();
    const result = await runSlc(['flow', source], deps(agent));
    expect(result.ok).toBe(true);

    expect(await readFile(join(artDir, '.slc/latest'), 'utf8')).toBe('1\n');
    const history = await loadBuildHistory(artDir);
    expect(history).not.toBeNull();
    expect(history?.manifest.pipeline).toBe('flow');
    expect(history?.manifest.source).toEqual({
      path: '../onboarding.md',
      hash: hashBytes(Buffer.from('prose\n')),
    });
    expect(
      history?.manifest.steps.map((step) => [
        step.kind,
        step.name,
        step.target,
      ]),
    ).toEqual([
      ['phase', 'text2gears', 'onboarding.gears.md'],
      ['phase', 'gears2fsm', 'onboarding.fsm.ts'],
    ]);
    for (const step of history?.manifest.steps ?? []) {
      const live = await readFile(join(artDir, step.target));
      expect(hashBytes(live)).toBe(step.output);
      expect(await readFile(join(artDir, '.slc/builds/1', step.copy))).toEqual(
        live,
      );
    }
    expect(await readFile(join(artDir, '.slc/builds/1/source'), 'utf8')).toBe(
      'prose\n',
    );
  });
});

describe('INCR-19: an unchanged repeat is a write-free no-op', () => {
  it('reports up to date with zero executor calls and unchanged files', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    const { agent: again, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(again));

    expect(result.ok).toBe(true);
    expect(result.outcome).toBe('up-to-date');
    expect(calls).toHaveLength(0);
    expect(await readdir(join(artDir, '.slc/builds'))).toEqual(['1']);
    expect(await readFile(join(artDir, '.slc/latest'), 'utf8')).toBe('1\n');
  });
});

describe('INCR-20: a changed source updates the affected step and reuses the rest', () => {
  it('supplies prior input, diff, and the prior output in place', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    await writeFile(source, 'prose v2\n');
    // The gears agent reproduces byte-identical output, so gears2fsm stays
    // reusable downstream of an executed step.
    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(second));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.prompt).toContain('Incremental update');
    expect(call.prompt).toContain(
      `prior input to consult (read-only): ${join(artDir, '.slc/builds/1/source')}`,
    );
    expect(call.prompt).toContain('-prose');
    expect(call.prompt).toContain('+prose v2');
    // The target still held the previously accepted output when the agent ran.
    expect(call.priorTarget).toBe('output\n');
    // The run recorded build 2 with both steps.
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(2);
    expect(history?.manifest.steps).toHaveLength(2);
  });
});

describe('INCR-12: declared semantic inputs enter step identities', () => {
  it('invalidates reuse when a `## Pin Inputs` citation changes', async () => {
    await mkdir(join(pipelineDir, 'reference'));
    await writeFile(join(pipelineDir, 'reference/rules.md'), 'rules v1\n');
    await writeFile(
      join(pipelineDir, 'text2gears.md'),
      `${formats('text', '.md', 'gears', '.md')}\n## Pin Inputs\n\n- \`reference/rules.md\`\n`,
    );

    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);
    const history = await loadBuildHistory(artDir);
    // Chained input + definition + the declared semantic input.
    expect(history?.manifest.steps[0].inputs).toHaveLength(3);

    await writeFile(join(pipelineDir, 'reference/rules.md'), 'rules v2\n');
    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(second));

    expect(result.ok).toBe(true);
    expect(result.outcome).toBeUndefined();
    // The declared-input change re-executes the phase in update mode; the
    // chained input itself is byte-identical.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].prompt).toContain('Incremental update');
    expect(calls[0].prompt).toContain('byte-identical');
  });
});

describe('a relative invocation source keys reuse at its resolved location', () => {
  it('reuses on repeat when the source argument is relative to the run cwd', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', 'onboarding.md'], deps(agent))).ok).toBe(
      true,
    );
    const history = await loadBuildHistory(artDir);
    expect(history?.manifest.source.path).toBe('../onboarding.md');
    expect(history?.manifest.steps).toHaveLength(2);

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', 'onboarding.md'], deps(second));
    expect(result.outcome).toBe('up-to-date');
    expect(calls).toHaveLength(0);
  });
});

describe('INCR-21: a hand-edited intermediate becomes the next update baseline', () => {
  it('reuses upstream steps and updates the consumer with the edited bytes', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    await writeFile(join(artDir, 'onboarding.gears.md'), 'refined gears\n');
    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(second));

    expect(result.ok).toBe(true);
    // text2gears is reused (its input, the source, is unchanged); gears2fsm
    // updates from the refined bytes.
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.prompt).toContain('Incremental update');
    expect(call.prompt).toContain('artifact to write');
    expect(call.prompt).toContain('+refined gears');
    expect(call.priorTarget).toBe('output\n');
    // The refined intermediate survives byte-for-byte and is recorded.
    expect(await readFile(join(artDir, 'onboarding.gears.md'), 'utf8')).toBe(
      'refined gears\n',
    );
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(2);
    expect(history?.manifest.steps[0].output).toBe(
      hashBytes(Buffer.from('refined gears\n')),
    );
  });
});

describe('INCR-22: bad history reads as a first compile', () => {
  it.each([
    [
      'garbage manifest',
      async (): Promise<void> => {
        await writeFile(join(artDir, '.slc/builds/1/manifest.json'), 'garbage');
      },
    ],
    [
      'wrong schema',
      async (): Promise<void> => {
        await writeFile(
          join(artDir, '.slc/builds/1/manifest.json'),
          JSON.stringify({ schema: 'sublang.slc.build.v0' }),
        );
      },
    ],
    [
      'unparsable latest',
      async (): Promise<void> => {
        await writeFile(join(artDir, '.slc/latest'), 'not-a-number');
      },
    ],
  ])('%s: succeeds and records fresh history', async (_name, corrupt) => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);
    await corrupt();
    await writeFile(source, 'prose v2\n');

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(second));

    expect(result.ok).toBe(true);
    // No reuse and no update context: a first compile.
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.prompt).not.toContain('Incremental update');
    }
    expect(
      result.diagnostics.filter((line) => line.includes('history')),
    ).toEqual([]);
    expect(await loadBuildHistory(artDir)).not.toBeNull();
  });

  it('falls back to ordinary execution when the prior-input copy is gone', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);
    await rm(join(artDir, '.slc/builds/1/source'));
    await writeFile(source, 'prose v2\n');

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(second));

    expect(result.ok).toBe(true);
    expect(calls[0].prompt).not.toContain('Incremental update');
  });

  it('ignores an orphaned build directory above latest', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);
    await mkdir(join(artDir, '.slc/builds/9'), { recursive: true });

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source], deps(second));

    expect(result.outcome).toBe('up-to-date');
    expect(calls).toHaveLength(0);
  });
});

describe('INCR-23: a failed run keeps completed work', () => {
  it('records the completed prefix, carries the rest, and resumes', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    await writeFile(source, 'prose v2\n');
    const { agent: failing, calls: failingCalls } = makeAgent({
      content: { 'onboarding.gears.md': 'gears v2\n' },
      failOn: 'onboarding.fsm.ts',
    });
    const failed = await runSlc(['flow', source], deps(failing));
    expect(failed.ok).toBe(false);
    expect(failingCalls).toHaveLength(2);

    // The failed run still recorded: fresh text2gears, carried gears2fsm.
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(2);
    expect(history?.manifest.steps.map((step) => step.name)).toEqual([
      'text2gears',
      'gears2fsm',
    ]);
    expect(history?.manifest.steps[0].output).toBe(
      hashBytes(Buffer.from('gears v2\n')),
    );

    // The repeat reuses the completed step and only re-runs the failed one.
    const { agent: third, calls: thirdCalls } = makeAgent();
    const resumed = await runSlc(['flow', source], deps(third));
    expect(resumed.ok).toBe(true);
    expect(thirdCalls).toHaveLength(1);
    expect(thirdCalls[0].prompt).toContain('onboarding.fsm.ts');
  });
});

describe('INCR-24: --rebuild bypasses reuse but not pin validation', () => {
  it('executes every step ordinarily and records a fresh build', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source, '--rebuild'], deps(second));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.prompt).not.toContain('Incremental update');
    }
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(2);
  });

  it('still fails closed on an unusable pin index', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);
    await writeFile(join(pipelineDir, 'slc.pins.json'), '{ not json');

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', source, '--rebuild'], deps(second));

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('fails closed before the step on a stale pin, history notwithstanding', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    // A shape-valid pin whose recorded definition hash drifted: every other
    // reference matches the committed fixture bytes, so the verdict is
    // stale, not malformed.
    const bundleDir = join(pipelineDir, 'text2gears.slc');
    await mkdir(bundleDir);
    for (const name of [
      'text2gears.playbook.ts',
      'text2gears.fsm.ts',
      'text2gears.gears.md',
      'text2gears.gears-fsm.test.ts',
      'text2gears.fsm.introspect.test.ts',
      'text2gears.prompt-contract.test.ts',
      'text2gears.fsm.coverage.test.ts',
    ]) {
      await writeFile(join(bundleDir, name), `fixture: ${name}\n`);
    }
    await writeFile(join(pipelineDir, 'linktarget.ts'), 'link target bytes\n');
    const record: PinRecord = {
      definition: {
        path: 'text2gears.md',
        hash: hashBytes(Buffer.from('drifted definition bytes\n')),
      },
      artifact: {
        path: 'text2gears.slc/text2gears.playbook.ts',
        hash: await hashFile(join(bundleDir, 'text2gears.playbook.ts')),
      },
      artifactBundle: {
        path: 'text2gears.slc',
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
    await writeFile(
      join(pipelineDir, PINS_FILE),
      JSON.stringify({
        schema: PIN_SCHEMA,
        hashAlgorithm: PIN_HASH_ALGORITHM,
        pathBoundary: { path: '.' },
        pins: { text2gears: record },
      }),
    );

    for (const argv of [
      ['flow', source, '--rebuild'],
      ['flow', source],
    ]) {
      const { agent: gated, calls } = makeAgent();
      const result = await runSlc(argv, deps(gated));
      expect(result.ok).toBe(false);
      expect(calls).toHaveLength(0);
      expect(result.diagnostics.join('\n')).toContain('stale');
    }
  });
});

describe('INCR-25: -o and partial forms stay outside history', () => {
  it('writes no .slc for -o or single-phase runs', async () => {
    const { agent } = makeAgent();
    const out = join(srcDir, 'custom.fsm.ts');
    expect((await runSlc(['flow', source, '-o', out], deps(agent))).ok).toBe(
      true,
    );
    expect(await exists(join(artDir, '.slc'))).toBe(false);

    const { agent: phaseAgent } = makeAgent();
    expect(
      (await runSlc(['flow.text2gears', source], deps(phaseAgent))).ok,
    ).toBe(true);
    expect(await exists(join(artDir, '.slc'))).toBe(false);
  });

  it('does not consult history recorded by a canonical run', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    // The single-phase repeat executes even though the canonical record
    // matches: partial forms neither consult nor advance history.
    const { agent: phaseAgent, calls } = makeAgent();
    expect(
      (await runSlc(['flow.text2gears', source], deps(phaseAgent))).ok,
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await readdir(join(artDir, '.slc/builds'))).toEqual(['1']);
  });
});

describe('INCR-26: source rebinding and changed link inputs', () => {
  it('diagnoses a rebound source and compiles fresh', async () => {
    const { agent } = makeAgent();
    expect((await runSlc(['flow', source], deps(agent))).ok).toBe(true);

    const otherDir = join(root, 'other');
    await mkdir(otherDir);
    const other = join(otherDir, 'onboarding.md');
    await writeFile(other, 'different prose\n');

    const { agent: second, calls } = makeAgent();
    const result = await runSlc(['flow', other], deps(second));

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.prompt).not.toContain('Incremental update');
    }
    expect(result.diagnostics.some((line) => line.includes('rebinding'))).toBe(
      true,
    );
    const history = await loadBuildHistory(artDir);
    expect(history?.build).toBe(2);
    expect(history?.manifest.source.path).toBe('../../other/onboarding.md');
  });

  it('runs a link step in full when its inputs changed', async () => {
    const runner = join(srcDir, 'runner.ts');
    await writeFile(runner, 'export default {};\n');
    const linked = makeAgent({
      content: { 'onboarding.run.ts': 'export {};\n' },
    });
    expect(
      (await runSlc(['flow', source, '--link', runner], deps(linked.agent))).ok,
    ).toBe(true);
    expect(linked.calls).toHaveLength(3);

    await writeFile(runner, 'export default { changed: true };\n');
    const { agent: second, calls } = makeAgent({
      content: { 'onboarding.run.ts': 'export {};\n' },
    });
    const result = await runSlc(
      ['flow', source, '--link', runner],
      deps(second),
    );

    expect(result.ok).toBe(true);
    // Both compile steps reuse; only the link runs, in full.
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toContain('link target module');
    expect(calls[0].prompt).not.toContain('Incremental update');
  });
});
